// FR-12 생성 부분을 DB 없이 확인한다: 체험 교안 조각 → 실제 생성 모델 호출 → 서버와 같은 형식·근거 검사.
// 실행: node --env-file=.env.local scripts/generate-check.ts [교안 JSON 경로]
// 학교 키(KOOKMIN_KEY)가 없으면 Gateway 대체 모델로 생성한다. 저장은 하지 않는다.
import { readFileSync } from "node:fs";
import { chunkPages } from "../lib/chunk.ts";
import { generateFirstUnit } from "../lib/ai/generate.ts";
import { normalizeBody } from "../lib/rules.ts";
import { embed, cosine } from "../lib/embed.ts";
import { QUALITY } from "../lib/config.ts";

const src = process.argv[2] ?? "demo/os-demo-pages.json";
const pages = JSON.parse(readFileSync(src, "utf8")).pages;
const chunks = chunkPages(pages).map((c) => ({ ref: `1:${c.page}`, text: c.content }));
const t0 = Date.now();
const r = await generateFirstUnit(chunks);
console.log(`생성: ${r.provider} ${r.model}, ${Math.round((Date.now() - t0) / 1000)}초, 토큰 입력 ${r.usage.prompt_tokens} 출력 ${r.usage.completion_tokens}${r.fallbackReason ? `, 대체 이유: ${r.fallbackReason}` : ""}`);
console.log(`개념 ${r.concepts.length}개: ${r.concepts.map((c) => c.name).join(", ")}`);

const refs = new Set(chunks.map((c) => c.ref));
const names = new Set(r.concepts.map((c) => String(c.name)));
const problems: string[] = [];
r.questions.forEach((q, i) => {
  const choices = Array.isArray(q.choices) ? (q.choices as string[]) : [];
  const cl = (q.checklist ?? {}) as Record<string, unknown>;
  if (!names.has(String(q.concept))) problems.push(`${i}: 개념 이름 불일치`);
  if (choices.length < 3 || choices.length > 5) problems.push(`${i}: 선택지 수 ${choices.length}`);
  if (new Set(choices.map(normalizeBody)).size !== choices.length) problems.push(`${i}: 선택지 중복`);
  if (choices.filter((c) => c === q.answer).length !== 1) problems.push(`${i}: 정답이 선택지에 1개가 아님`);
  if (!((q.evidence_refs as string[]) ?? []).every((x) => refs.has(x))) problems.push(`${i}: 근거 위치 없음`);
  if (!["answer_correct", "evidence_match", "difficulty_fit", "choices_clear"].every((k) => cl[k] === true)) problems.push(`${i}: 1차 검수 false`);
});
const qv = await embed(r.questions.map((q) => `${q.body}\n정답: ${q.answer}`));
const cv = await embed(chunks.map((c) => c.text));
let low = 0;
r.questions.forEach((q, i) => {
  const want = (q.evidence_refs as string[]) ?? [];
  const best = Math.max(-1, ...chunks.map((c, k) => (want.includes(c.ref) ? cosine(qv[i], cv[k]) : -1)));
  if (best < QUALITY.evidenceMin) low++;
});
console.log(`문항 ${r.questions.length}개, 형식 문제 ${problems.length}건, 근거 관련성 ${QUALITY.evidenceMin} 미만 ${low}건`);
problems.slice(0, 8).forEach((p) => console.log("  " + p));
console.log("예시:", JSON.stringify(r.questions[0]).slice(0, 300));
