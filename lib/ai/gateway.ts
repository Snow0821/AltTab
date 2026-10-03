// Vercel AI Gateway 호출(임베딩·생성 공용). 키 순서: AI_GATEWAY_API_KEY → VERCEL_OIDC_TOKEN(로컬) → 요청 헤더 x-vercel-oidc-token(배포)
import { AI } from "../config.ts";

export class AiError extends Error {}

export function gatewayKey(req?: Request): string {
  const key = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || req?.headers.get("x-vercel-oidc-token") || "";
  if (!key) throw new AiError("AI 호출 키가 없습니다");
  return key;
}

type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };

// 생성형 모델에 JSON 하나를 받아 온다. 응답에서 첫 { 부터 마지막 } 까지를 JSON으로 읽는다.
export async function chatJson(
  system: string,
  user: string,
  req?: Request,
): Promise<{ json: unknown; usage: Usage; model: string }> {
  let res: Response;
  try {
    res = await fetch(`${AI.gatewayUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${gatewayKey(req)}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: AI.genModel,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: AI.genMaxOutputTokens,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(AI.genTimeoutMs),
    });
  } catch (e) {
    throw new AiError(`생성 요청 실패: ${(e as Error).message}`);
  }
  if (!res.ok) throw new AiError(`생성 응답 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: Usage; model?: string };
  const text = body.choices?.[0]?.message?.content ?? "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("생성 결과에 JSON이 없습니다");
  try {
    return { json: JSON.parse(text.slice(start, end + 1)), usage: body.usage ?? {}, model: body.model ?? AI.genModel };
  } catch {
    throw new AiError("생성 결과 JSON을 읽지 못했습니다");
  }
}

// 학교 생성형 AI API(Anthropic 메시지 형식, Authorization: Bearer). 키는 서버 환경 변수에만 둔다.
function schoolKey(): string {
  return process.env.KOOKMIN_API_KEY || process.env.KOOKMIN_KEY || "";
}

async function schoolJson(system: string, user: string): Promise<{ json: unknown; usage: Usage; model: string }> {
  let res: Response;
  try {
    res = await fetch(`${AI.schoolUrl}/v1/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${schoolKey()}`, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: AI.schoolModel,
        max_tokens: AI.schoolMaxOutputTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(AI.schoolTimeoutMs),
    });
  } catch (e) {
    throw new AiError(`학교 API 요청 실패: ${(e as Error).message}`);
  }
  if (!res.ok) throw new AiError(`학교 API 응답 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number }; model?: string };
  const text = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("학교 API 결과에 JSON이 없습니다");
  try {
    return {
      json: JSON.parse(text.slice(start, end + 1)),
      usage: { prompt_tokens: body.usage?.input_tokens, completion_tokens: body.usage?.output_tokens },
      model: body.model ?? AI.schoolModel,
    };
  } catch {
    throw new AiError("학교 API 결과 JSON을 읽지 못했습니다");
  }
}

export type GenResult = { json: unknown; usage: Usage; model: string; provider: "school" | "gateway"; fallbackReason?: string };

// PRD 8절: 학교 API를 먼저 부르고, 키가 없거나 실패하면 Gateway 모델을 부른다.
export async function generateJson(system: string, user: string, req?: Request): Promise<GenResult> {
  let fallbackReason = "학교 API 키 없음";
  if (schoolKey()) {
    try {
      return { ...(await schoolJson(system, user)), provider: "school" };
    } catch (e) {
      fallbackReason = (e as Error).message;
      console.error("school api failed, falling back", fallbackReason);
    }
  }
  return { ...(await chatJson(system, user, req)), provider: "gateway", fallbackReason };
}
