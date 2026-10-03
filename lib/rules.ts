// PRD 4절 레벨 디자인과 설계서 6절 계산 규칙. DB를 모르는 순수 함수만 둔다.
// 확인: npm test (tests/rules.test.ts)

export const STAGE_SIZE = 5; // 스테이지 1회 문제 수
export const CLEAR_MIN = 4; // 클리어에 필요한 1회차 정답 수
export const UNIT_SIZE = 5; // 유닛 하나의 스테이지 수
export const FREE_STAGES = 5; // 이용권 없이 풀 수 있는 스테이지 수(첫 유닛)
export const XP = { correct: 10, clear: 20, perfect: 10 };

// 채점·중복 판정용 정규화: 대소문자·띄어쓰기·문장부호를 무시하고 글자와 숫자만 남긴다.
export function normalizeText(s: string): string {
  return (s ?? "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

// ★3 단답형: 허용 답안 중 하나와 정규화 결과가 같으면 정답. 빈 답은 오답.
export function gradeShort(answer: string, accepted: string[]): boolean {
  const a = normalizeText(answer);
  return a.length > 0 && accepted.some((x) => normalizeText(x) === a);
}

// ★1·★2 객관식: 고른 선택지 글자가 정답과 같으면 정답. 빈 답은 오답.
export function gradeChoice(answer: string, correct: string): boolean {
  return answer.trim().length > 0 && answer.trim() === correct.trim();
}

export type ConceptNode = {
  id: string;
  name: string;
  prerequisites: string[];
  importance: number | null;
  createdAt: string;
};

// 스테이지 순서: 선수 개념이 먼저, 고를 수 있는 것 중에서는 중요도 높은 순, 같거나 없으면 등록 순.
// 선수 관계가 순환하면 전체를 등록 순으로 둔다.
export function orderStages<T extends ConceptNode>(concepts: T[]): T[] {
  const byCreated = [...concepts].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const position = new Map(byCreated.map((c, i) => [c.id, i]));
  const byName = new Map(byCreated.map((c) => [c.name, c]));
  const indegree = new Map<string, number>(byCreated.map((c) => [c.id, 0]));
  const after = new Map<string, string[]>(byCreated.map((c) => [c.id, []]));
  for (const c of byCreated) {
    for (const name of new Set(c.prerequisites)) {
      const pre = byName.get(name);
      if (!pre || pre.id === c.id) continue; // 등록되지 않은 선수 개념은 순서에 쓰지 않는다
      indegree.set(c.id, indegree.get(c.id)! + 1);
      after.get(pre.id)!.push(c.id);
    }
  }
  const better = (a: T, b: T) => {
    const ia = a.importance ?? -1;
    const ib = b.importance ?? -1;
    if (ia !== ib) return ib - ia;
    return position.get(a.id)! - position.get(b.id)!;
  };
  const ready = byCreated.filter((c) => indegree.get(c.id) === 0);
  const result: T[] = [];
  const byId = new Map(byCreated.map((c) => [c.id, c]));
  while (ready.length) {
    ready.sort(better);
    const c = ready.shift()!;
    result.push(c);
    for (const id of after.get(c.id)!) {
      indegree.set(id, indegree.get(id)! - 1);
      if (indegree.get(id) === 0) ready.push(byId.get(id)!);
    }
  }
  return result.length === byCreated.length ? result : byCreated;
}

export type StageState = "cleared" | "open" | "locked" | "paywall";

// stars: 순서대로 놓인 스테이지의 별 수. 앞 스테이지 별 1개 이상이면 열린다.
// 열린 스테이지라도 6번째부터는 이용권이 없으면 paywall(구독 만료 뒤에도 같음).
export function stageStates(stars: number[], hasAccess: boolean): StageState[] {
  return stars.map((s, i) => {
    const unlocked = i === 0 || stars[i - 1] >= 1;
    if (!unlocked) return "locked";
    if (i >= FREE_STAGES && !hasAccess) return "paywall";
    return s >= 1 ? "cleared" : "open";
  });
}

export function unitOf(order: number): number {
  return Math.floor(order / UNIT_SIZE) + 1;
}

// 지금 풀 단계: 별 0 → ★1, 별 1 → ★2, 별 2 이상 → ★3
export function currentDifficulty(stars: number): 1 | 2 | 3 {
  return Math.min(stars + 1, 3) as 1 | 2 | 3;
}

// firstRound: 5문제의 1회차 정답 여부. 끝에 다시 푼 문제는 넣지 않는다.
export function scoreAttempt(firstRound: boolean[]) {
  const correct = firstRound.filter(Boolean).length;
  const cleared = correct >= CLEAR_MIN;
  const perfect = firstRound.length === STAGE_SIZE && correct === STAGE_SIZE;
  const xp = {
    correct: correct * XP.correct,
    clear: cleared ? XP.clear : 0,
    perfect: perfect ? XP.perfect : 0,
  };
  return { correct, cleared, perfect, xp: { ...xp, total: xp.correct + xp.clear + xp.perfect } };
}

// 지금 단계(별+1)를 클리어했을 때만 별이 1개 는다. 최대 3개.
export function nextStars(stars: number, difficulty: number, cleared: boolean): number {
  if (!cleared || difficulty !== currentDifficulty(stars) || stars >= 3) return stars;
  return stars + 1;
}

// 숙련도 = 이전 × 0.7 + 이번 1회차 정답률 × 0.3 (소수 둘째 자리)
export function nextMastery(prev: number, ratio: number): number {
  return Math.round((prev * 0.7 + ratio * 0.3) * 100) / 100;
}
