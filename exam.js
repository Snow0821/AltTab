'use strict';

/**
 * 서버 측 시험 출제/채점 모듈.
 *
 * 설계 원칙 (team-work-plan.md API 계약 §4 기준)
 * - 정답(answerIndex)과 해설은 서버에만 둔다. 출제(attempt) 응답에는 절대 포함하지 않는다.
 * - 채점은 서버에서만 한다. 프런트의 gradeDemo는 데모용이며 운영에서는 이 모듈이 대체한다.
 * - 같은 attempt를 다시 제출해도 XP/별 보상이 중복 지급되지 않는다(중복 보상 방지).
 * - 저장은 로컬 JSON 폴백을 사용한다(Supabase 미설정 환경에서도 자족적으로 동작).
 *
 * API 계약
 * - createAttempt(stageId, userId) -> { attemptId, stageId, examId, examVersion, questions[], questionCount }
 *     questions[] 각 항목: { id, concept, difficulty, body, choices } (정답/해설 제외)
 * - gradeAttempt(attemptId, answers) ->
 *     { attemptId, examId, examVersion, score, maxScore, correctCount, questionCount,
 *       passed, stars, xpAwarded, alreadyGraded, details[{questionId, answer, correct, answerIndex, explanation}] }
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ----- 문제 뱅크 (정답 포함, 서버 전용) -----
// demo-data.mjs와 같은 공개 샘플 문항. 정답/해설은 서버에만 둔다.
const COURSE = { id: 'demo-data-structures', name: '자료구조' };

const QUESTION_BANK = [
  { id: 'demo-q1', concept: '스택과 큐', difficulty: 1, body: '가장 나중에 들어온 데이터를 가장 먼저 꺼내는 자료구조는 무엇일까요?', choices: ['큐 (Queue)', '스택 (Stack)', '힙 (Heap)', '배열 (Array)'], answerIndex: 1, explanation: '스택은 LIFO(Last In, First Out) 순서로 데이터를 꺼냅니다.' },
  { id: 'demo-q2', concept: '스택과 큐', difficulty: 1, body: '먼저 들어온 데이터가 먼저 나가는 큐의 처리 방식을 고르세요.', choices: ['LIFO', '무작위 접근', 'FIFO', '이진 탐색'], answerIndex: 2, explanation: '큐는 FIFO(First In, First Out) 순서로 데이터를 처리합니다.' },
  { id: 'demo-q3', concept: '시간 복잡도', difficulty: 2, body: '길이가 n인 정렬된 배열에서 이진 탐색의 최악 시간 복잡도는 무엇일까요?', choices: ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'], answerIndex: 1, explanation: '비교할 때마다 탐색 범위를 절반으로 줄이므로 최악 시간 복잡도는 O(log n)입니다.' },
  { id: 'demo-q4', concept: '배열과 연결 리스트', difficulty: 1, body: '연속 메모리에 저장된 배열에서 인덱스로 원소 하나에 접근할 때의 시간 복잡도는 무엇일까요?', choices: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'], answerIndex: 0, explanation: '시작 주소와 인덱스로 원소의 위치를 직접 계산하므로 O(1)입니다.' },
  { id: 'demo-q5', concept: '트리와 그래프', difficulty: 2, body: '간선의 가중치가 모두 같은 그래프에서 시작 정점으로부터 최단 거리 탐색에 알맞은 방법은 무엇일까요?', choices: ['깊이 우선 탐색 (DFS)', '너비 우선 탐색 (BFS)', '선택 정렬', '이진 탐색'], answerIndex: 1, explanation: 'BFS는 시작 정점에서 가까운 정점부터 차례로 방문합니다.' },
  { id: 'demo-q6', concept: '배열과 연결 리스트', difficulty: 2, body: '단일 연결 리스트에서 첫 번째 노드를 삭제할 때, 헤드 포인터만 가지고 있다면 시간 복잡도는 무엇일까요?', choices: ['O(n²)', 'O(n)', 'O(log n)', 'O(1)'], answerIndex: 3, explanation: '헤드 포인터를 다음 노드로 바꾸면 되므로 O(1)입니다.' },
  { id: 'demo-q7', concept: '트리와 그래프', difficulty: 3, body: '정점이 n개인 연결된 무방향 트리의 간선 수는 얼마일까요? (n ≥ 1)', choices: ['n − 1', 'n', 'n + 1', '2n'], answerIndex: 0, explanation: '트리는 연결되어 있고 사이클이 없으므로 간선 수는 정점 수보다 하나 적습니다.' },
  { id: 'demo-q8', concept: '시간 복잡도', difficulty: 3, body: '서로 중첩된 두 반복문이 각각 n번 실행된다면 전체 실행 횟수의 증가율은 무엇일까요?', choices: ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'], answerIndex: 3, explanation: '바깥 반복 n번마다 안쪽 반복이 n번 실행되어 총 n²번 실행됩니다.' }
].map((q) => ({ ...q, courseId: COURSE.id, qtype: 'choice' }));

const EXAM_VERSION = 1;
const UNIT_SIZE = 5; // 한 스테이지(유닛)당 5문제
const PASS_THRESHOLD = 4; // 5문제 중 4개 이상 정답이면 클리어
const POINTS_PER_QUESTION = 10;

// 스테이지별 문항 구성. UNIT_SIZE(5)개마다 유닛 하나.
// 유닛1 = stage-1~5(무료), stage-6부터 유닛2(이용권 필요).
const STAGES = {
  'stage-1': ['demo-q1', 'demo-q2', 'demo-q3', 'demo-q4', 'demo-q5'],
  'stage-2': ['demo-q4', 'demo-q5', 'demo-q6', 'demo-q7', 'demo-q8'],
  'stage-3': ['demo-q1', 'demo-q3', 'demo-q5', 'demo-q7', 'demo-q2'],
  'stage-4': ['demo-q2', 'demo-q4', 'demo-q6', 'demo-q8', 'demo-q1'],
  'stage-5': ['demo-q3', 'demo-q5', 'demo-q7', 'demo-q1', 'demo-q4'],
  'stage-6': ['demo-q5', 'demo-q6', 'demo-q7', 'demo-q8', 'demo-q2']
};

function getBankQuestion(id) {
  return QUESTION_BANK.find((q) => q.id === id) || null;
}

// ----- 저장소 (로컬 JSON 폴백) -----
const dataRoot = process.env.VERCEL ? os.tmpdir() : __dirname;
const attemptsFile = path.join(dataRoot, 'uploads', 'attempts.json');

function ensureStore() {
  const dir = path.dirname(attemptsFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(attemptsFile)) fs.writeFileSync(attemptsFile, '{}');
}

function readAttempts() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(attemptsFile, 'utf-8'));
  } catch {
    return {};
  }
}

function writeAttempts(map) {
  ensureStore();
  fs.writeFileSync(attemptsFile, JSON.stringify(map, null, 2));
}

// ----- 생성 문제 세트 저장소 (로컬 JSON 폴백) -----
// 팀원의 /api/generate(ai-generate.js)가 만든 문제를 저장해 두고,
// 그 세트로 출제/채점한다. Supabase 담당이 테이블을 켜면 같은 패턴으로 전환 가능.
const questionSetsFile = path.join(dataRoot, 'uploads', 'question-sets.json');

function ensureSetStore() {
  const dir = path.dirname(questionSetsFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(questionSetsFile)) fs.writeFileSync(questionSetsFile, '{}');
}

function readSets() {
  ensureSetStore();
  try {
    return JSON.parse(fs.readFileSync(questionSetsFile, 'utf-8'));
  } catch {
    return {};
  }
}

function writeSets(map) {
  ensureSetStore();
  fs.writeFileSync(questionSetsFile, JSON.stringify(map, null, 2));
}

// 생성 문제 1건을 서버 내부 표준형으로 정규화/검증.
// ai-generate.js 출력({ body, choices, answerIndex, explanation, evidence }) 및
// 유사 형태(answer_index)도 수용한다.
function normalizeQuestion(raw, idx) {
  if (!raw || typeof raw !== 'object') return null;
  const body = String(raw.body || '').trim();
  const choices = Array.isArray(raw.choices) ? raw.choices.map((c) => String(c)) : [];
  const answerIndex = Number.isInteger(raw.answerIndex)
    ? raw.answerIndex
    : Number(raw.answer_index);
  const explanation = String(raw.explanation || '').trim();
  if (body.length < 1) return null;
  if (choices.length < 2 || choices.some((c) => !c)) return null;
  if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= choices.length) return null;
  return {
    id: String(raw.id || `q${idx + 1}`),
    concept: raw.concept ? String(raw.concept) : null,
    difficulty: Number.isInteger(raw.difficulty) ? raw.difficulty : null,
    body,
    choices,
    answerIndex,
    explanation,
    evidence: raw.evidence && typeof raw.evidence === 'object'
      ? { page: Number(raw.evidence.page) || null, quote: String(raw.evidence.quote || '') }
      : null,
    qtype: 'choice'
  };
}

/**
 * 생성된 문제 세트를 저장. payload: { title?, courseId?, source?, questions:[...] }
 * 반환: { setId, title, courseId, source, questionCount, createdAt }
 */
function saveQuestionSet(payload = {}) {
  const rawList = Array.isArray(payload.questions) ? payload.questions : [];
  if (!rawList.length) {
    const err = new Error('저장할 문제가 없습니다.');
    err.statusCode = 400;
    throw err;
  }
  const questions = rawList.map(normalizeQuestion).filter(Boolean);
  if (questions.length !== rawList.length) {
    const err = new Error('문제 형식이 올바르지 않은 항목이 있습니다.');
    err.statusCode = 400;
    err.code = 'invalid_question';
    throw err;
  }
  // 세트 내 문항 id 중복 제거(동일 id면 뒤에 번호 부여)
  const seen = new Set();
  questions.forEach((q, i) => {
    if (seen.has(q.id)) q.id = `${q.id}-${i + 1}`;
    seen.add(q.id);
  });

  const setId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const record = {
    setId,
    title: String(payload.title || '교안 문제 세트').slice(0, 120),
    courseId: payload.courseId ? String(payload.courseId) : COURSE.id,
    source: payload.source ? String(payload.source) : 'generated',
    createdAt,
    questions
  };

  const map = readSets();
  map[setId] = record;
  writeSets(map);

  return {
    setId,
    title: record.title,
    courseId: record.courseId,
    source: record.source,
    questionCount: questions.length,
    createdAt
  };
}

/** 저장된 세트 조회(정답 포함, 서버 내부용). */
function getQuestionSet(setId) {
  const map = readSets();
  return map[setId] || null;
}

/**
 * 저장된 문제 세트로 attempt를 생성. 정답/해설은 응답에서 제외한다.
 */
function createAttemptFromSet(setId, userId = 'anonymous') {
  const set = getQuestionSet(setId);
  if (!set) {
    const err = new Error('존재하지 않는 문제 세트입니다.');
    err.statusCode = 404;
    throw err;
  }

  const attemptId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const map = readAttempts();
  map[attemptId] = {
    attemptId,
    setId,
    stageId: null,
    userId: String(userId || 'anonymous'),
    examId: `set:${setId}`,
    examVersion: 1,
    // 정답 포함 문항을 attempt에 저장 → gradeAttempt가 이 items로 채점
    items: set.questions,
    questionIds: set.questions.map((q) => q.id),
    createdAt,
    graded: false,
    result: null
  };
  writeAttempts(map);

  const questions = set.questions.map((q) => ({
    id: q.id,
    concept: q.concept,
    difficulty: q.difficulty,
    body: q.body,
    choices: q.choices,
    qtype: q.qtype
  }));

  return {
    attemptId,
    setId,
    examId: `set:${setId}`,
    examVersion: 1,
    title: set.title,
    questionCount: questions.length,
    questions
  };
}

// ----- 출제 -----
/**
 * 스테이지 출제: attempt를 생성하고 정답/해설을 제외한 문제를 반환.
 */
function createAttempt(stageId, userId = 'anonymous') {
  const questionIds = STAGES[stageId];
  if (!questionIds) {
    const err = new Error(`존재하지 않는 스테이지입니다: ${stageId}`);
    err.statusCode = 404;
    throw err;
  }

  const items = questionIds.map(getBankQuestion);
  if (items.some((q) => !q)) {
    const err = new Error('스테이지에 연결된 문항을 찾을 수 없습니다.');
    err.statusCode = 500;
    throw err;
  }
  if (items.length < UNIT_SIZE) {
    const err = new Error('출제할 문항이 부족합니다.');
    err.statusCode = 409;
    err.code = 'insufficient_questions';
    throw err;
  }

  const attemptId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const map = readAttempts();
  map[attemptId] = {
    attemptId,
    stageId,
    userId: String(userId || 'anonymous'),
    examId: `${COURSE.id}:${stageId}`,
    examVersion: EXAM_VERSION,
    questionIds,
    createdAt,
    graded: false,
    result: null
  };
  writeAttempts(map);

  // 정답/해설 제외하고 반환
  const questions = items.map((q) => ({
    id: q.id,
    concept: q.concept,
    difficulty: q.difficulty,
    body: q.body,
    choices: q.choices,
    qtype: q.qtype
  }));

  return {
    attemptId,
    stageId,
    examId: `${COURSE.id}:${stageId}`,
    examVersion: EXAM_VERSION,
    questionCount: questions.length,
    questions
  };
}

// ----- 별 계산 -----
function starsFor(correctCount, questionCount) {
  if (correctCount >= questionCount) return 3; // 만점
  if (correctCount >= PASS_THRESHOLD) return 2; // 통과
  if (correctCount >= Math.ceil(questionCount / 2)) return 1; // 절반 이상
  return 0;
}

// ----- 채점 -----
/**
 * 서버 측 채점. answers는 { [questionId]: choiceIndex }.
 * 같은 attempt 재제출 시 보상(XP/별) 중복 지급을 막는다.
 */
function gradeAttempt(attemptId, answers) {
  const map = readAttempts();
  const attempt = map[attemptId];
  if (!attempt) {
    const err = new Error('존재하지 않는 시도(attempt)입니다.');
    err.statusCode = 404;
    throw err;
  }

  // 문항 소스: 커스텀 세트(attempt.items)가 있으면 우선 사용, 없으면 기본 뱅크.
  let items;
  if (Array.isArray(attempt.items) && attempt.items.length) {
    items = attempt.items;
  } else {
    items = attempt.questionIds.map(getBankQuestion);
    if (items.some((q) => !q)) {
      const err = new Error('시험지 문항을 찾을 수 없습니다.');
      err.statusCode = 500;
      throw err;
    }
  }

  const safeAnswers = answers && typeof answers === 'object' ? answers : {};
  // 모든 문항에 유효한 선택지가 있어야 제출 가능
  const invalid = items.some((q) => {
    const a = safeAnswers[q.id];
    return !Number.isInteger(a) || a < 0 || a >= q.choices.length;
  });
  if (invalid) {
    const err = new Error('모든 문항에 올바르게 답한 뒤 제출해 주세요.');
    err.statusCode = 400;
    throw err;
  }

  const details = items.map((q) => ({
    questionId: q.id,
    answer: safeAnswers[q.id],
    correct: safeAnswers[q.id] === q.answerIndex,
    answerIndex: q.answerIndex,
    explanation: q.explanation
  }));
  const correctCount = details.filter((d) => d.correct).length;
  const questionCount = items.length;
  const passed = correctCount >= PASS_THRESHOLD;
  const stars = starsFor(correctCount, questionCount);
  const score = correctCount * POINTS_PER_QUESTION;
  const maxScore = questionCount * POINTS_PER_QUESTION;

  // 중복 보상 방지: 이미 채점된 attempt면 저장된 결과를 그대로 반환하고 보상은 재지급하지 않는다.
  if (attempt.graded && attempt.result) {
    return { ...attempt.result, alreadyGraded: true, xpAwarded: 0, details };
  }

  const xpAwarded = score; // 최초 채점에서만 XP 지급
  const result = {
    attemptId,
    stageId: attempt.stageId,
    examId: attempt.examId,
    examVersion: attempt.examVersion,
    score,
    maxScore,
    correctCount,
    questionCount,
    passed,
    stars,
    xpAwarded,
    alreadyGraded: false,
    gradedAt: new Date().toISOString()
  };

  attempt.graded = true;
  attempt.result = { ...result };
  map[attemptId] = attempt;
  writeAttempts(map);

  return { ...result, details };
}

function listStages() {
  return Object.keys(STAGES);
}

// 스테이지의 1-based 순번(등록 순). 없으면 null.
function stageOrder(stageId) {
  const idx = Object.keys(STAGES).indexOf(stageId);
  return idx === -1 ? null : idx + 1;
}

// 스테이지가 속한 유닛 번호(1-based). UNIT_SIZE개마다 한 유닛.
function stageUnit(stageId) {
  const order = stageOrder(stageId);
  return order === null ? null : Math.ceil(order / UNIT_SIZE);
}

/**
 * 사용자의 과목 진행 상황 집계 (FR-04 일부, 이용권 잠금 제외).
 * attempts.json에서 user의 채점 결과를 읽어 스테이지별 최고 별/클리어 여부와
 * 누적 XP를 집계한다. 이용권에 따른 잠금은 호출부(server)에서 결합한다.
 *
 * 반환:
 *   { courseId, userId, totalXp, stages:[{ stageId, order, unit, cleared, stars, status }], summary }
 *   status: 'cleared' | 'open' | 'locked'  (잠금 규칙: 첫 스테이지 열림, 앞 스테이지 클리어 시 다음 열림)
 */
function getProgress(courseId = COURSE.id, userId = 'anonymous') {
  const uid = String(userId || 'anonymous');
  const attempts = Object.values(readAttempts());

  // 스테이지별 집계: 최고 별, 클리어 여부
  const byStage = {}; // stageId -> { stars, cleared }
  let totalXp = 0;

  for (const a of attempts) {
    if (!a || a.userId !== uid || !a.stageId) continue;
    if (!a.graded || !a.result) continue;
    const r = a.result;
    totalXp += Number(r.xpAwarded) || 0; // 최초 채점에서만 지급된 값이라 중복 없음
    const prev = byStage[a.stageId] || { stars: 0, cleared: false };
    byStage[a.stageId] = {
      stars: Math.max(prev.stars, Number(r.stars) || 0),
      cleared: prev.cleared || !!r.passed
    };
  }

  const stageIds = Object.keys(STAGES);
  const stages = [];
  let prevCleared = true; // 첫 스테이지는 앞이 "클리어된 것"으로 간주 → 열림

  for (let i = 0; i < stageIds.length; i++) {
    const stageId = stageIds[i];
    const agg = byStage[stageId] || { stars: 0, cleared: false };
    let status;
    if (agg.cleared) status = 'cleared';
    else if (prevCleared) status = 'open';
    else status = 'locked';

    stages.push({
      stageId,
      order: i + 1,
      unit: Math.ceil((i + 1) / UNIT_SIZE),
      cleared: agg.cleared,
      stars: agg.stars,
      status
    });
    // 다음 스테이지 열림 여부는 "이 스테이지 클리어"에 달림
    prevCleared = agg.cleared;
  }

  const clearedCount = stages.filter((s) => s.cleared).length;
  const totalStages = stages.length;
  const progressPercent = totalStages ? Math.round((clearedCount / totalStages) * 100) : 0;

  return {
    courseId,
    userId: uid,
    totalXp,
    stages,
    summary: { clearedCount, totalStages, progressPercent, totalXp }
  };
}

module.exports = {
  createAttempt,
  createAttemptFromSet,
  saveQuestionSet,
  getQuestionSet,
  gradeAttempt,
  getProgress,
  listStages,
  stageOrder,
  stageUnit,
  starsFor,
  COURSE,
  UNIT_SIZE,
  PASS_THRESHOLD
};
