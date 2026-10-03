// PRD FR-04·05 규칙 확인. 실행: npm test (Node 22.6+ 의 TypeScript 실행 기능 사용)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gradeShort,
  gradeChoice,
  normalizeText,
  orderStages,
  stageStates,
  scoreAttempt,
  nextStars,
  nextMastery,
  currentDifficulty,
  unitOf,
} from "../lib/rules.ts";

test("단답형: 띄어쓰기·대소문자·문장부호를 무시하고 허용 답안과 비교", () => {
  assert.equal(gradeShort(" 후입 선출. ", ["후입선출", "LIFO"]), true);
  assert.equal(gradeShort("lifo", ["후입선출", "LIFO"]), true);
  assert.equal(gradeShort("선입선출", ["후입선출", "LIFO"]), false); // 반대 개념은 오답
  assert.equal(gradeShort("FIFO", ["후입선출", "LIFO"]), false);
  assert.equal(gradeShort("", ["후입선출"]), false); // 빈 답은 오답
  assert.equal(gradeShort("   ", ["후입선출"]), false);
});

test("객관식: 빈 답은 오답", () => {
  assert.equal(gradeChoice("스택", "스택"), true);
  assert.equal(gradeChoice("", "스택"), false);
  assert.equal(gradeChoice("큐", "스택"), false);
});

test("중복 판정용 정규화", () => {
  assert.equal(normalizeText("TCP는 몇 단계?"), normalizeText("tcp는 몇단계"));
});

const c = (id: string, name: string, pre: string[], imp: number | null, t: string) => ({
  id,
  name,
  prerequisites: pre,
  importance: imp,
  createdAt: t,
});

test("스테이지 순서: 선수 개념 먼저, 그다음 중요도, 같으면 등록 순", () => {
  const list = [
    c("a", "스레드", ["프로세스"], 0.9, "2026-10-03T01:00:00Z"),
    c("b", "프로세스", [], 0.2, "2026-10-03T01:00:01Z"),
    c("d", "PCB", [], 0.5, "2026-10-03T01:00:02Z"),
    c("e", "문맥 교환", [], null, "2026-10-03T01:00:03Z"),
  ];
  assert.deepEqual(orderStages(list).map((x) => x.name), ["PCB", "프로세스", "스레드", "문맥 교환"]);
});

test("선수 관계가 순환하면 등록 순", () => {
  const list = [
    c("a", "A", ["B"], 0.9, "2026-10-03T01:00:00Z"),
    c("b", "B", ["A"], 0.1, "2026-10-03T01:00:01Z"),
  ];
  assert.deepEqual(orderStages(list).map((x) => x.name), ["A", "B"]);
});

test("잠금·유료: 처음에는 첫 스테이지만, 6번째부터 이용권 필요", () => {
  assert.deepEqual(stageStates([0, 0, 0], false), ["open", "locked", "locked"]);
  assert.deepEqual(stageStates([1, 0, 0], false), ["cleared", "open", "locked"]);
  const six = stageStates([1, 1, 1, 1, 1, 0, 0], false);
  assert.equal(six[5], "paywall");
  assert.equal(six[6], "locked");
  assert.equal(stageStates([1, 1, 1, 1, 1, 0], true)[5], "open");
  assert.equal(stageStates([1, 1, 1, 1, 1, 1], false)[5], "paywall"); // 만료 뒤 다시 막힘
  assert.equal(unitOf(0), 1);
  assert.equal(unitOf(5), 2);
});

test("클리어·XP: 4개 이상이면 클리어, 만점이면 +10", () => {
  assert.deepEqual(scoreAttempt([true, true, true, true, false]).xp, { correct: 40, clear: 20, perfect: 0, total: 60 });
  assert.equal(scoreAttempt([true, true, true, false, false]).cleared, false);
  assert.deepEqual(scoreAttempt([true, true, true, true, true]).xp, { correct: 50, clear: 20, perfect: 10, total: 80 });
});

test("별과 숙련도", () => {
  assert.equal(currentDifficulty(0), 1);
  assert.equal(currentDifficulty(3), 3);
  assert.equal(nextStars(0, 1, true), 1);
  assert.equal(nextStars(0, 1, false), 0);
  assert.equal(nextStars(1, 1, true), 1); // 이미 깬 단계를 다시 깨도 그대로
  assert.equal(nextStars(3, 3, true), 3);
  assert.equal(nextMastery(0.3, 0.6), 0.39);
});
