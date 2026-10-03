// 체험 과목 만들기: 배포된 서비스의 실제 API·생성 기능·MCP 도구만 쓴다(DB 직접 쓰기 없음, 미리 써 둔 문항 없음).
// 필요한 값: BASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY(또는 PUBLISHABLE_KEY).
// 2차 검수 판정에는 생성형 모델을 부른다(KOOKMIN_KEY가 있으면 학교 API, 없으면 Gateway — 로컬은 VERCEL_OIDC_TOKEN).
// 실행: BASE_URL=https://배포주소 node --env-file=.env.local scripts/seed-demo.mjs
// 순서: 계정 A·B·C 가입 → A가 과목 생성·체험 교안 업로드·색인 → A가 "AI로 첫 유닛 문제 만들기"(FR-12)
//       → B·C가 참여 코드로 들어와 각자 MCP로 검수할 문항을 받고, 생성형 모델이 근거와 대조해 판정한 결과를 제출 → 참여 코드 출력
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { generateJson } from "../lib/ai/gateway.ts";

const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!BASE || !SB_URL || !SB_KEY) {
  console.error("BASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 가 필요합니다.");
  process.exit(1);
}
const upload = JSON.parse(readFileSync("demo/os-demo-pages.json", "utf8"));
const COURSE_TITLE = "운영체제 체험 과목";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function api(token, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status} ${json.message ?? ""}`);
  return json;
}

function mcpClient(url) {
  let id = 0;
  const rpc = async (method, params) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
    const json = await res.json();
    if (json.error) throw new Error(`MCP ${method}: ${json.error.message}`);
    return json.result;
  };
  return {
    rpc,
    call: async (name, args) => {
      const r = await rpc("tools/call", { name, arguments: args });
      const text = r.content?.[0]?.text ?? "";
      if (r.isError) throw new Error(`MCP ${name}: ${text}`);
      return JSON.parse(text);
    },
  };
}

async function account(label) {
  const email = `passfinder-demo-${label}-${Date.now()}@example.com`;
  const password = randomBytes(12).toString("base64url");
  const res = await fetch(`${BASE}/api/auth/signup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw new Error(`가입 실패 ${label}: ${res.status}`);
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { label, email, password, token: data.session.access_token };
}

// 2차 검수: 다른 학생의 AI 역할을 생성형 모델이 맡는다. 근거 글과 대조해 판정하고 이유를 남긴다.
async function aiReview(questions) {
  const system = "너는 같은 수업을 듣는 학생의 AI 검수자다. 문항마다 정답이 맞는지, 근거 글과 일치하는지, 난이도가 기초(정의·용어)에 맞는지, 선택지가 명확한지 확인한다. 결과는 JSON 하나만 출력한다.";
  const user = `문항 목록(JSON):\n${JSON.stringify(questions.map((q) => ({ question_id: q.question_id, body: q.body, choices: q.choices, answer: q.answer, explanation: q.explanation, evidence: q.evidence })))}\n\n출력 형식: {"reviews":[{"question_id":"","verdict":"pass 또는 revise 또는 fail","reason":"한 줄 이유"}]}`;
  const r = await generateJson(system, user);
  const reviews = Array.isArray(r.json?.reviews) ? r.json.reviews : [];
  return { reviews, model: r.model };
}

const [A, B, C] = [await account("a"), await account("b"), await account("c")];
writeFileSync("demo/accounts.local.json", JSON.stringify({ base: BASE, accounts: [A, B, C].map(({ label, email, password }) => ({ label, email, password })) }, null, 2));
log("계정 3개 가입·로그인 (계정 정보는 demo/accounts.local.json, Git 제외)");

const { course } = await api(A.token, "/api/courses", { title: COURSE_TITLE });
log("과목", course.title, "참여 코드", course.joinCode);
const { material } = await api(A.token, `/api/courses/${course.id}/materials`, upload);
const indexed = await api(A.token, `/api/materials/${material.id}/index`, {});
log("교안", material.filename, "분석:", indexed.material.status, "청크", indexed.material.chunkCount);

const gen = await api(A.token, `/api/courses/${course.id}/generate`, {});
log("AI 생성:", gen.message, "모델", gen.model);

for (const R of [B, C]) {
  await api(R.token, "/api/courses/join", { code: course.joinCode });
  const { url } = await api(R.token, "/api/mcp-token", {});
  const mcp = mcpClient(url);
  await mcp.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "seed-demo", version: "1" } });
  const counts = { pass: 0, revise: 0, fail: 0 };
  for (let round = 0; round < 5; round++) {
    const batch = await mcp.call("get_review_batch", { course_id: course.id, limit: 20 });
    if (!batch.questions.length) break;
    const { reviews, model } = await aiReview(batch.questions);
    const valid = reviews.filter((r) => batch.questions.some((q) => q.question_id === r.question_id) && ["pass", "revise", "fail"].includes(r.verdict) && r.reason);
    if (!valid.length) break;
    const res = await mcp.call("submit_reviews", { course_id: course.id, reviews: valid.map((r) => ({ question_id: r.question_id, verdict: r.verdict, reason: String(r.reason).slice(0, 300) })) });
    for (const r of valid) counts[r.verdict]++;
    log(`계정 ${R.label.toUpperCase()} 검수(${model}):`, res.message);
  }
  log(`계정 ${R.label.toUpperCase()} 판정 합계`, JSON.stringify(counts));
}

const mcpA = mcpClient((await api(A.token, "/api/mcp-token", {})).url);
await mcpA.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "seed-demo", version: "1" } });
const bank = await mcpA.call("get_question_bank", { course_id: course.id });
const totals = { first_pass: 0, verified: 0, hidden: 0 };
for (const c of bank.concepts) for (const d of ["1", "2", "3"]) for (const k of Object.keys(totals)) totals[k] += c.counts[d][k];
log("문항 상태:", JSON.stringify(totals));
console.log(`\n체험 과목 참여 코드: ${course.joinCode}  (배포 환경 변수 NEXT_PUBLIC_DEMO_JOIN_CODE 에 넣는다)`);
