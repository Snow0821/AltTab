// AI Gateway 무료 등급에서 호출되는 임베딩 모델 찾기. 실행: node --env-file=.env.local scripts/embed-models-check.ts
const key = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || "";
const models: [string, Record<string, unknown>][] = [
  ["google/gemini-embedding-001", { dimensions: 1536 }],
  ["google/text-multilingual-embedding-002", {}],
  ["alibaba/qwen3-embedding-0.6b", {}],
  ["alibaba/qwen3-embedding-4b", { dimensions: 1536 }],
  ["amazon/titan-embed-text-v2", {}],
  ["voyage/voyage-3.5-lite", {}],
  ["mistral/mistral-embed", {}],
  ["cohere/embed-v4.0", { dimensions: 1536 }],
  ["perplexity/pplx-embed-v1-0.6b", {}],
  ["openai/text-embedding-3-large", { dimensions: 1536 }],
];
for (const [model, extra] of models) {
  const res = await fetch("https://ai-gateway.vercel.sh/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: ["스택은 후입선출 구조이다", "스택은 선입선출 구조이다"], ...extra }),
  });
  const text = await res.text();
  if (res.ok) {
    const d = JSON.parse(text).data;
    console.log(`가능 ${model} dim=${d[0].embedding.length}`);
  } else {
    console.log(`불가 ${model} ${res.status} ${text.slice(0, 90)}`);
  }
}
