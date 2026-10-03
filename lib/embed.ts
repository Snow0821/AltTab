// 임베딩(소유: 교안 모듈). 서버가 부르는 유일한 AI다. 생성형 LLM은 부르지 않는다.
// 우선순위: OPENAI_API_KEY(직접) → Vercel AI Gateway(AI_GATEWAY_API_KEY 또는 Vercel 배포의 OIDC 토큰)
// Gateway 무료 등급은 openai/text-embedding-3-small을 막는다(2026-10-03 403 실측). 무료 등급에서 호출되는 qwen3-embedding-4b를 1536차원으로 쓴다(PRD 부록 2-13).
export const EMBED_MODEL = process.env.EMBED_MODEL || "alibaba/qwen3-embedding-4b";
export const EMBED_DIM = 1536;
const BATCH = 100;

export class EmbedError extends Error {}

function endpoint(req?: Request): { url: string; key: string; model: string } {
  if (process.env.OPENAI_API_KEY) {
    return { url: "https://api.openai.com/v1/embeddings", key: process.env.OPENAI_API_KEY, model: "text-embedding-3-small" };
  }
  const key =
    process.env.AI_GATEWAY_API_KEY ||
    process.env.VERCEL_OIDC_TOKEN ||
    req?.headers.get("x-vercel-oidc-token") ||
    "";
  if (!key) throw new EmbedError("임베딩 키가 없습니다");
  return { url: "https://ai-gateway.vercel.sh/v1/embeddings", key, model: EMBED_MODEL };
}

async function call(texts: string[], req?: Request): Promise<number[][]> {
  const { url, key, model } = endpoint(req);
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: texts, dimensions: EMBED_DIM }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (e) {
      if (attempt === 2) throw new EmbedError(`임베딩 요청 실패: ${(e as Error).message}`);
      continue;
    }
    if (res.ok) {
      const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    }
    if (res.status !== 429 && res.status < 500) {
      throw new EmbedError(`임베딩 응답 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new EmbedError("임베딩 서버가 바빠요");
}

export async function embed(texts: string[], req?: Request): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    out.push(...(await call(texts.slice(i, i + BATCH).map((t) => t.slice(0, 8000) || " "), req)));
  }
  return out;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// Postgres vector 컬럼은 "[0.1,0.2,…]" 문자열로 읽힌다.
export function parseVector(v: unknown): number[] | null {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === "string" && v.startsWith("[")) return JSON.parse(v) as number[];
  return null;
}
