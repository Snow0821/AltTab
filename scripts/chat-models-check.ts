// AI Gateway 무료 등급(OIDC)에서 호출되는 생성형 모델 확인. 실행: node --env-file=.env.local scripts/chat-models-check.ts
const key = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || "";
const models = ["openai/gpt-5-mini", "openai/gpt-5-nano", "anthropic/claude-haiku-4.5", "google/gemini-2.5-flash", "google/gemini-2.5-flash-lite"];
for (const model of models) {
  const t0 = Date.now();
  const res = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "스택의 꺼내는 순서를 한 단어로." }], max_tokens: 30 }),
  });
  const text = await res.text();
  if (res.ok) {
    const j = JSON.parse(text);
    console.log(`가능 ${model} ${Date.now() - t0}ms: ${String(j.choices?.[0]?.message?.content ?? "").slice(0, 40)}`);
  } else console.log(`불가 ${model} ${res.status} ${text.slice(0, 90)}`);
}
