// FR-12B 출제 품질: 수업 운영 안내(시험 날짜·연락처·출석·과제 기한·성적 비율)를 학습 문제로 내지 않는다.
// 모델은 모의 응답으로 대신한다. 실제 학교 AI 호출 검증은 별도(비용)이며 이 검사는 서버 검사 규칙만 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generate, check, isLogistics, prompt, squash } = require('../ai-generate.js');

const LECTURE = [
  '스택은 LIFO(Last In, First Out) 구조로, 가장 나중에 넣은 데이터를 가장 먼저 꺼낸다.',
  '큐는 FIFO(First In, First Out) 구조로 먼저 들어온 데이터가 먼저 나간다.',
  '이진 탐색의 최악 시간 복잡도는 O(log n)이다.',
  '배열은 인덱스로 원소에 O(1)에 접근한다.',
  '1945년 8월 15일 광복은 한국 현대사의 출발점이다.',
  '실험 일정은 배양 3일과 측정 2일을 더해 총 5일로 계산한다.',
].join(' ');

const NOTICE = [
  '중간고사는 10월 20일(월) 3교시에 B101 강의실에서 실시한다.',
  '교수 연락처는 연구실 702호이며 상담 시간은 화요일 오후다.',
  '출석은 전체 성적의 10%를 반영하며 3회 결석 시 감점한다.',
  '과제 제출 기한은 매주 일요일 밤 11시다.',
  '성적 반영 비율은 중간 30%, 기말 40%, 과제 20%, 출석 10%다.',
].join(' ');

const q = (kind, body, quote, page = 1) => ({
  kind, body, choices: ['가', '나', '다', '라'], answer_index: 0, explanation: `${body} 해설`, evidence: { page, quote }
});

const LEARNING = [
  q('concept', '가장 나중에 넣은 데이터를 가장 먼저 꺼내는 자료구조는?', '스택은 LIFO(Last In, First Out) 구조로, 가장 나중에 넣은 데이터를 가장 먼저 꺼낸다.'),
  q('comparison', '큐가 스택과 다른 처리 순서는?', '큐는 FIFO(First In, First Out) 구조로 먼저 들어온 데이터가 먼저 나간다.'),
  q('algorithm', '이진 탐색의 최악 시간 복잡도는?', '이진 탐색의 최악 시간 복잡도는 O(log n)이다.'),
  q('concept', '광복은 몇 년 몇 월 며칠인가?', '1945년 8월 15일 광복은 한국 현대사의 출발점이다.'),
  q('calculation', '실험 일정은 총 며칠로 계산하는가?', '실험 일정은 배양 3일과 측정 2일을 더해 총 5일로 계산한다.'),
  q('principle', '배열에서 인덱스 접근이 O(1)인 까닭은?', '배열은 인덱스로 원소에 O(1)에 접근한다.'),
];

const NOTICES = [
  q('concept', '중간고사는 언제 실시하는가?', '중간고사는 10월 20일(월) 3교시에 B101 강의실에서 실시한다.'),
  q('concept', '교수 연구실은 몇 호인가?', '교수 연락처는 연구실 702호이며 상담 시간은 화요일 오후다.'),
  q('calculation', '출석은 전체 성적의 몇 %를 반영하는가?', '출석은 전체 성적의 10%를 반영하며 3회 결석 시 감점한다.'),
  q('notice', '과제 제출 기한은 언제인가?', '과제 제출 기한은 매주 일요일 밤 11시다.'),
  q(undefined, '기말고사의 성적 반영 비율은?', '성적 반영 비율은 중간 30%, 기말 40%, 과제 20%, 출석 10%다.'),
];

const pages = (text) => [{ page: 1, text }];
const mock = (questions) => {
  const calls = [];
  const call = async (text) => { calls.push(text); return JSON.stringify({ questions }); };
  return { call, calls };
};
const expect422 = async (promise, code) => {
  const err = await promise.then(() => null, (e) => e);
  assert.ok(err, '실패해야 한다');
  assert.equal(err.status, 422);
  assert.equal(err.body.error, code);
  assert.equal(err.body.ok, false);
  return err.body;
};

test('check: 운영 안내 문항은 거르고 교과 내용은 날짜·시간을 다뤄도 통과한다 (수정 전 실패 재현)', () => {
  const pageText = new Map([[1, squash(NOTICE + ' ' + LECTURE)]]);
  for (const n of NOTICES) assert.equal(check(n, pageText, new Set()), '수업 운영 안내 문항', n.body);
  for (const l of LEARNING) assert.equal(typeof check(l, pageText, new Set()), 'object', l.body);
  // 기존 형식·근거 검사는 그대로
  assert.equal(check({ ...LEARNING[0], evidence: { page: 1, quote: '교안에 없는 문장입니다' } }, pageText, new Set()), '근거 문장이 교안에 없음');
  assert.equal(check({ ...LEARNING[0], choices: ['가', '가', '나', '다'] }, pageText, new Set()), '선택지 중복');
  const seen = new Set();
  check(LEARNING[0], pageText, seen);
  assert.equal(check(LEARNING[0], pageText, seen), '중복 문제');
});

test('isLogistics: 낱말 하나로 거르지 않는다', () => {
  assert.equal(isLogistics('이진 탐색의 최악 시간 복잡도는 O(log n)이다'), false);
  assert.equal(isLogistics('1945년 8월 15일 광복은 한국 현대사의 출발점이다'), false);
  assert.equal(isLogistics('실험 일정은 배양 3일과 측정 2일을 더해 총 5일로 계산한다'), false);
  assert.equal(isLogistics('인장 시험에서 항복점은 어떻게 정의하는가'), false);
  assert.equal(isLogistics('중간고사는 언제 실시하는가'), true);
  assert.equal(isLogistics('기말 시험 장소는 어디인가'), true);
  assert.equal(isLogistics('과제 제출 기한은 매주 일요일 밤 11시다'), true);
  assert.equal(isLogistics('성적 반영 비율은 중간 30%, 기말 40%다'), true);
  assert.equal(isLogistics('교수 연락처는 연구실 702호다'), true);
});

test('prompt: 출제 대상·제외 규칙과 kind 필드를 지시한다', () => {
  const text = prompt('자료구조', pages(LECTURE), 7, []);
  assert.match(text, /수업 운영 안내/);
  assert.match(text, /출석 규칙/);
  assert.match(text, /시간 복잡도/);
  assert.match(text, /"kind"/);
});

test('A. 시험 일정 공지만 있는 자료 → 일정 암기 문항 대신 명확한 실패', async () => {
  const { call, calls } = mock(NOTICES);
  const body = await expect422(generate({ title: '공지', pages: pages(NOTICE) }, call), 'not_enough_study_content');
  assert.equal(body.validCount, 0);
  assert.equal(body.logisticsCount >= 5, true);
  assert.match(body.message, /학습 내용이 부족/);
  assert.equal(calls.length, 2); // 추가 호출은 최대 한 번
});

test('B. 공지+학습 혼합 자료 → 학습 내용에서만 5문항', async () => {
  const { call, calls } = mock([...NOTICES.slice(0, 3), ...LEARNING]);
  const out = await generate({ title: '혼합', pages: pages(NOTICE + ' ' + LECTURE) }, call);
  assert.equal(out.ok, true);
  assert.equal(out.questions.length, 5);
  assert.equal(out.questions.some((x) => /중간고사|연구실|출석/.test(x.body)), false);
  assert.equal(out.rejectedCount >= 3, true);
  assert.equal(out.rulesVersion, 2);
  assert.equal(calls.length, 1);
});

test('C·D. 정상 교안 → 정상 5문항. 역사 연도·시간 복잡도·실험 일정은 제외되지 않는다', async () => {
  const { call } = mock(LEARNING);
  const out = await generate({ title: '자료구조', pages: pages(LECTURE) }, call);
  assert.equal(out.questions.length, 5);
  assert.deepEqual(out.questions.map((x) => x.id), ['q1', 'q2', 'q3', 'q4', 'q5']);
  assert.ok(out.questions.some((x) => /광복/.test(x.body)));
  assert.ok(out.questions.some((x) => /시간 복잡도/.test(x.body)));
  assert.ok(out.questions.some((x) => /실험 일정/.test(x.body)));
  assert.ok(out.questions.every((x) => x.kind));
});

test('E. 조건에 맞는 문항 부족 → 가짜 성공 없이 실패와 사유', async () => {
  const { call, calls } = mock([...NOTICES, ...LEARNING.slice(0, 2)]);
  const body = await expect422(generate({ title: '혼합', pages: pages(NOTICE + ' ' + LECTURE) }, call), 'not_enough_study_content');
  assert.equal(body.validCount, 2);
  assert.equal(calls.length, 2);
  // 운영 안내가 아닌 이유(근거 없음)만으로 모자라면 기존 사유를 유지한다
  const broken = LEARNING.slice(0, 2).concat(LEARNING.slice(2).map((x) => ({ ...x, evidence: { page: 1, quote: '없는 문장' } })));
  const body2 = await expect422(generate({ title: '자료구조', pages: pages(LECTURE) }, mock(broken).call), 'not_enough_valid');
  assert.equal(body2.logisticsCount, 0);
});
