// 웹 첫 유닛 생성(FR-12, 소유: AI 생성 모듈). 교안 조각을 생성형 모델에 주고 개념·문항 JSON을 받는다.
// 받은 결과는 저장하지 않고 돌려준다. 저장과 검사는 MCP 도구(submit_concepts, submit_questions)와 같은 코드가 맡는다.
import { AI } from "../config.ts";
import { generateJson, AiError, type GenResult } from "./gateway.ts";

export type ContextChunk = { ref: string; text: string };
type Obj = Record<string, unknown>;

const SYSTEM =
  "너는 대학 시험 대비 문제를 만드는 출제자다. 주어진 교안 조각만 근거로 쓰고, 교안에 없는 내용은 만들지 않는다. 결과는 설명 없이 JSON 하나만 출력한다.";

export function selectContext(chunks: ContextChunk[], maxChars = AI.genContextChars): ContextChunk[] {
  const out: ContextChunk[] = [];
  let used = 0;
  for (const c of chunks) {
    if (used + c.text.length > maxChars && out.length) break;
    out.push(c);
    used += c.text.length;
  }
  return out;
}

export function buildPrompt(chunks: ContextChunk[]): string {
  const ctx = chunks.map((c) => `[${c.ref}] ${c.text}`).join("\n");
  return `아래는 교안 조각이다. 각 조각 앞의 [교안번호:쪽]이 근거 위치다.

${ctx}

할 일
1. 쉬운 기초 개념부터 핵심 개념 ${AI.genConcepts}개를 고른다. 앞 개념이 뒤 개념의 선수 개념이 되도록 순서를 정한다.
2. 개념마다 난이도 1(기초: 정의·용어) 객관식 문항을 ${AI.genQuestionsPerConcept}개 만든다.

규칙
- name은 60자 이내, summary는 300자 이내로 쓴다.
- evidence_refs에는 위 조각의 [교안번호:쪽] 값(예 "1:3")만 쓴다.
- prerequisites에는 앞에서 고른 개념 이름만 쓴다. 첫 개념은 빈 배열이다.
- 문항 body는 5자 이상이다. choices는 4개(정답 1개, 오답 3개)이고 서로 달라야 한다. answer는 choices 중 하나와 글자까지 같아야 한다.
- explanation은 근거 쪽 내용을 한 문장으로 쓴다.
- 각 문항을 직접 검토해 checklist 네 항목(answer_correct, evidence_match, difficulty_fit, choices_clear)을 true 또는 false로 정하고, check_note에 판단 이유를 한 줄로 쓴다. 확신이 없으면 false로 둔다.
- 같은 개념 안에서 문항 본문이 겹치지 않게 한다.

출력 형식(JSON만)
{"concepts":[{"name":"","summary":"","evidence_refs":["1:1"],"prerequisites":[]}],"questions":[{"concept":"개념 이름","body":"","choices":["","","",""],"answer":"","explanation":"","evidence_refs":["1:1"],"checklist":{"answer_correct":true,"evidence_match":true,"difficulty_fit":true,"choices_clear":true},"check_note":""}]}`;
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// 모델 출력이 형식을 어기면 저장 전에 실패로 처리한다(PRD FR-12: 실패하면 아무것도 저장하지 않음).
export function normalize(json: unknown): { concepts: Obj[]; questions: Obj[] } {
  if (!isObj(json) || !Array.isArray(json.concepts) || !Array.isArray(json.questions)) {
    throw new AiError("생성 결과 형식이 올바르지 않습니다");
  }
  const concepts = json.concepts.filter(isObj).slice(0, AI.genConcepts);
  const questions = json.questions
    .filter(isObj)
    .slice(0, AI.genConcepts * AI.genQuestionsPerConcept)
    .map((q) => ({ ...q, difficulty: 1, qtype: "choice" }));
  if (!concepts.length || !questions.length) throw new AiError("생성 결과에 개념이나 문항이 없습니다");
  return { concepts, questions };
}

export async function generateFirstUnit(chunks: ContextChunk[], req?: Request): Promise<GenResult & { concepts: Obj[]; questions: Obj[] }> {
  const result = await generateJson(SYSTEM, buildPrompt(selectContext(chunks)), req);
  return { ...result, ...normalize(result.json) };
}
