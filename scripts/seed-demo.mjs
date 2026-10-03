// 체험 과목 만들기: 배포된 서비스의 실제 API와 MCP 도구만 써서 데이터를 넣는다(DB 직접 쓰기 없음).
// 필요한 값은 공개 값뿐이다: BASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY(또는 PUBLISHABLE_KEY)
// 실행: BASE_URL=https://배포주소 node --env-file=.env.local scripts/seed-demo.mjs
// 순서: 계정 A·B·C 가입 → A가 과목 생성·교안 업로드·색인 → A의 MCP로 개념·문항 제출(1차 검수)
//       → B·C가 참여 코드로 들어와 각자 MCP로 2차 검수(통과) → 모든 문항 "검증 완료" 확인 → 참여 코드 출력
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!BASE || !SB_URL || !SB_KEY) {
  console.error("BASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 가 필요합니다.");
  process.exit(1);
}
const seed = JSON.parse(readFileSync("demo/os-seed.json", "utf8"));
const upload = JSON.parse(readFileSync("demo/os-demo-pages.json", "utf8"));
const CHECKLIST = { answer_correct: true, evidence_match: true, difficulty_fit: true, choices_clear: true };

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

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
  must(res.ok, `가입 실패 ${label}: ${res.status}`);
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { label, email, password, token: data.session.access_token };
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const [A, B, C] = [await account("a"), await account("b"), await account("c")];
writeFileSync("demo/accounts.local.json", JSON.stringify({ base: BASE, accounts: [A, B, C].map(({ label, email, password }) => ({ label, email, password })) }, null, 2));
log("계정 3개 가입·로그인 (계정 정보는 demo/accounts.local.json, Git 제외)");

const { course } = await api(A.token, "/api/courses", { title: seed.course_title });
log("과목", course.title, "참여 코드", course.joinCode);

const { material } = await api(A.token, `/api/courses/${course.id}/materials`, upload);
const indexed = await api(A.token, `/api/materials/${material.id}/index`, {});
must(indexed.material.status === "ready", "교안 분석이 끝나지 않았습니다");
log("교안", material.filename, "분석 준비 완료, 청크", indexed.material.chunkCount);

const { url: urlA } = await api(A.token, "/api/mcp-token", {});
const mcpA = mcpClient(urlA);
const init = await mcpA.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "seed-demo", version: "1" } });
const tools = await mcpA.rpc("tools/list", {});
log("MCP 연결", init.serverInfo?.name, "도구", tools.tools.length, "개");
const ctx = await mcpA.call("get_course_context", { course_id: course.id, limit: 60 });
log("교안 맥락", ctx.chunks.length, "조각");

const conceptsRes = await mcpA.call("submit_concepts", { course_id: course.id, concepts: seed.concepts });
log(conceptsRes.message);
const idOf = new Map([...conceptsRes.saved, ...conceptsRes.existing].map((c) => [c.name, c.concept_id]));
must(idOf.size === seed.concepts.length, `개념 저장 수 불일치: ${idOf.size}`);

const questions = seed.questions.map((q) => ({
  concept_id: idOf.get(q.concept),
  difficulty: q.difficulty,
  qtype: q.qtype,
  body: q.body,
  choices: q.choices,
  answer: q.answer,
  accepted_answers: q.accepted_answers,
  explanation: q.explanation,
  evidence_refs: q.evidence_refs,
  checklist: CHECKLIST,
  check_note: `교안 ${q.evidence_refs.join(", ")}쪽 문장과 정답·해설이 일치하고 선택지가 겹치지 않음`,
}));
let passed = 0;
for (let i = 0; i < questions.length; i += 20) {
  const r = await mcpA.call("submit_questions", { course_id: course.id, questions: questions.slice(i, i + 20) });
  passed += r.passed.length;
  if (r.rejected.length) log("반려", JSON.stringify(r.rejected));
}
log("1차 통과", passed, "/", questions.length);

for (const R of [B, C]) {
  await api(R.token, "/api/courses/join", { code: course.joinCode });
  const { url } = await api(R.token, "/api/mcp-token", {});
  const mcp = mcpClient(url);
  await mcp.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "seed-demo", version: "1" } });
  let reviewed = 0;
  for (;;) {
    const batch = await mcp.call("get_review_batch", { course_id: course.id, limit: 20 });
    if (!batch.questions.length) break;
    const r = await mcp.call("submit_reviews", {
      course_id: course.id,
      reviews: batch.questions.map((q) => ({ question_id: q.question_id, verdict: "pass", reason: "근거 쪽 문장과 정답·해설이 일치함" })),
    });
    reviewed += batch.questions.length - r.rejected.length;
    if (r.rejected.length) log("검수 거절", JSON.stringify(r.rejected));
    if (r.rejected.length === batch.questions.length) break;
  }
  log(`계정 ${R.label.toUpperCase()} 2차 검수 통과`, reviewed);
}

const bank = await mcpA.call("get_question_bank", { course_id: course.id });
let verified = 0;
for (const c of bank.concepts) for (const d of ["1", "2", "3"]) verified += c.counts[d].verified;
log("검증 완료 문항", verified, "/", passed);
console.log(`\n체험 과목 참여 코드: ${course.joinCode}  (배포 환경 변수 NEXT_PUBLIC_DEMO_JOIN_CODE 에 넣는다)`);
process.exitCode = verified === passed && passed === questions.length ? 0 : 1;
