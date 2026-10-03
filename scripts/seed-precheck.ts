// 체험 과목 문항을 DB에 넣기 전에 서버와 같은 규칙으로 점검한다(형식 + 실제 임베딩 근거 관련성).
// 실행: node --env-file=.env.local scripts/seed-precheck.ts
import { readFileSync } from "node:fs";
import { normalizeBody } from "../lib/rules.ts";
import { chunkPages } from "../lib/chunk.ts";
import { embed, cosine } from "../lib/embed.ts";

const EVIDENCE_MIN = 0.5; // lib/mcp/tools.ts와 같은 값
const seed = JSON.parse(readFileSync("demo/os-seed.json", "utf8"));
const pages = JSON.parse(readFileSync("demo/os-demo-pages.json", "utf8")).pages;
const chunks = chunkPages(pages);
const names = new Set(seed.concepts.map((c: { name: string }) => c.name));
let bad = 0;
const fail = (i: number, why: string) => {
  bad++;
  console.log(`문항 ${i}: ${why}`);
};

seed.questions.forEach((q: any, i: number) => {
  if (!names.has(q.concept)) fail(i, `없는 개념 ${q.concept}`);
  if (q.difficulty === 3 ? q.qtype !== "short" : q.qtype !== "choice") fail(i, "난이도와 유형 불일치");
  if (q.qtype === "choice") {
    const norms = q.choices.map(normalizeBody);
    if (new Set(norms).size !== norms.length) fail(i, "선택지 중복");
    if (q.choices.filter((c: string) => c === q.answer).length !== 1) fail(i, "정답이 선택지에 정확히 1개가 아님");
    if (q.choices.length < 3 || q.choices.length > 5) fail(i, "선택지 3~5개 아님");
  } else if (!q.accepted_answers?.length) fail(i, "허용 답안 없음");
});
const bodies = seed.questions.map((q: any) => `${q.concept}|${normalizeBody(q.body)}`);
if (new Set(bodies).size !== bodies.length) fail(-1, "같은 개념 안에 본문 중복");

const qv = await embed(seed.questions.map((q: any) => `${q.body}\n정답: ${q.answer}`));
const cv = await embed(chunks.map((c) => c.content));
const scores: number[] = [];
seed.questions.forEach((q: any, i: number) => {
  const pagesWanted = q.evidence_refs.map((r: string) => Number(r.split(":")[1]));
  const sims = chunks.map((c, k) => (pagesWanted.includes(c.page) ? cosine(qv[i], cv[k]) : -1)).filter((s) => s >= 0);
  const best = Math.max(...sims);
  scores.push(best);
  if (best < EVIDENCE_MIN) fail(i, `근거 관련성 ${best.toFixed(3)} < ${EVIDENCE_MIN}`);
});
scores.sort((a, b) => a - b);
console.log(`문항 ${seed.questions.length}개, 개념 ${seed.concepts.length}개, 청크 ${chunks.length}개`);
console.log(`근거 관련성 최소 ${scores[0].toFixed(3)}, 중앙 ${scores[Math.floor(scores.length / 2)].toFixed(3)}, 최대 ${scores[scores.length - 1].toFixed(3)}`);
console.log(bad ? `문제 ${bad}건` : "모두 통과");
process.exitCode = bad ? 1 : 0;
