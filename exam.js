'use strict';

/**
 * 서버 측 시험 출제/채점 모듈.
 *
 * 설계 원칙 (team-work-plan.md API 계약 §4, passfinder-prd.md §5 기준)
 * - 정답(answerIndex)과 해설은 서버에만 둔다. 출제(attempt) 응답에는 절대 포함하지 않는다.
 * - 채점은 서버에서만 한다. 프런트의 gradeDemo는 데모용이며 운영에서는 이 모듈이 대체한다.
 * - 같은 attempt를 다시 제출해도 XP/별 보상이 중복 지급되지 않는다(중복 보상 방지).
 * - 샘플 스테이지 응시는 로컬 JSON(attempts.json)에 둔다(기존 동작 유지).
 * - 생성 문제 세트(공유 시험)와 그 응시는 shared-store.js(Supabase 또는 개발용 로컬 JSON)에 둔다.
 *   참가자는 participants.js의 토큰 해시로 식별하고, 참가자·시험·버전당 첫 완료 응시만 집계(counted)한다.
 *
 * API 계약
 * - createAttempt(stageId, userId) -> { attemptId, stageId, examId, examVersion, questions[], questionCount }
 *     questions[] 각 항목: { id, concept, difficulty, body, choices } (정답/해설 제외)
 * - gradeAttempt(attemptId, answers, participantId?) ->
 *     스테이지: { attemptId, examId, examVersion, score, maxScore, correctCount, questionCount,
 *       passed, stars, xpAwarded, alreadyGraded, details[{questionId, answer, correct, answerIndex, explanation}] }
 *     공유 시험: 위에서 xpAwarded 대신 shareCode·counted·countedReason·explanationSource를 더한다.
 * - saveQuestionSet / createAttemptFromSet / createAttemptFromShareCode / getSharedExam / getAttemptState /
 *   getExamResults / setSolution / clearSolution / listSolutions: docs/api-contract.md 참고.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const store = require('./shared-store');

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
const NICKNAME_MAX = 20;
const SOLUTION_MAX = 300;
const SHARE_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // 혼동되는 i·l·o·0·1 제외

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

function httpError(status, message, code) {
  const err = new Error(message);
  err.statusCode = status;
  if (code) err.code = code;
  return err;
}

// ----- 스테이지 응시 저장소 (로컬 JSON) -----
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

// ----- 생성 문제 세트 = 공유 시험 (shared-store) -----
// 팀원의 /api/generate(ai-generate.js)가 만든 문제를 저장해 두고 그 세트로 출제/채점한다.
// 저장은 shared-store.js가 맡는다(Supabase 또는 개발용 로컬 JSON).

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

// 제어 문자를 지운 일반 텍스트. 화면은 그대로 텍스트로 표시해야 한다(HTML로 해석하지 않음).
function plainText(value) {
  return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
}

function cleanNickname(value) {
  const text = Array.from(plainText(value)).slice(0, NICKNAME_MAX).join('').trim();
  return text || null;
}

function newShareCode(length = 8) {
  let code = '';
  for (let i = 0; i < length; i++) code += SHARE_CODE_ALPHABET[crypto.randomInt(SHARE_CODE_ALPHABET.length)];
  return code;
}

// 브라우저에 보내는 문항(정답·해설·근거 제외).
function publicQuestions(questions) {
  return questions.map((q) => ({
    id: q.id,
    concept: q.concept,
    difficulty: q.difficulty,
    body: q.body,
    choices: q.choices,
    qtype: q.qtype
  }));
}

function examSummary(exam) {
  return {
    setId: exam.setId,
    examId: exam.examId,
    examVersion: exam.examVersion,
    shareCode: exam.shareCode,
    title: exam.title,
    courseId: exam.courseId,
    source: exam.source,
    questionCount: exam.questions.length,
    maxScore: exam.questions.length * POINTS_PER_QUESTION,
    createdAt: exam.createdAt
  };
}

/**
 * 생성된 문제 세트를 공유 시험으로 저장.
 * payload: { title?, courseId?, source?, examId?, questions:[...] }
 * - examId를 주면 같은 시험의 새 버전(작성자만 가능). 없으면 새 시험(버전 1).
 * - authorParticipantId: 요청 토큰에서 계산한 작성자 식별값. 작성자는 이 시험의 집계에서 제외된다.
 * 반환: { setId, examId, examVersion, shareCode, title, courseId, source, questionCount, maxScore, createdAt, isAuthor }
 */
async function saveQuestionSet(payload = {}, { authorParticipantId = null } = {}) {
  const rawList = Array.isArray(payload.questions) ? payload.questions : [];
  if (!rawList.length) throw httpError(400, '저장할 문제가 없습니다.');
  const questions = rawList.map(normalizeQuestion).filter(Boolean);
  if (questions.length !== rawList.length) {
    throw httpError(400, '문제 형식이 올바르지 않은 항목이 있습니다.', 'invalid_question');
  }
  // 세트 내 문항 id 중복 제거(동일 id면 뒤에 번호 부여)
  const seen = new Set();
  questions.forEach((q, i) => {
    if (seen.has(q.id)) q.id = `${q.id}-${i + 1}`;
    seen.add(q.id);
  });

  let examId = null;
  let examVersion = 1;
  if (payload.examId) {
    const latest = await store.getLatestExam(String(payload.examId));
    if (!latest) throw httpError(404, '새 버전을 만들 시험을 찾을 수 없습니다.', 'exam_not_found');
    if (!authorParticipantId || latest.authorParticipantId !== authorParticipantId) {
      throw httpError(403, '시험 작성자만 새 버전을 만들 수 있습니다.', 'not_author');
    }
    examId = latest.examId;
    examVersion = latest.examVersion + 1;
  }

  const title = String(payload.title || '교안 문제 세트').slice(0, 120);
  const courseId = payload.courseId ? String(payload.courseId) : COURSE.id;
  // 같은 작성자가 같은 세트를 연타·재전송하면 새로 저장하지 않고 같은 setId를 돌려준다.
  const fingerprint = crypto.createHash('sha256')
    .update(JSON.stringify({ title, courseId, examId, questions }))
    .digest('hex');
  const existing = await store.findExamByFingerprint(authorParticipantId, fingerprint);
  if (existing) return { ...examSummary(existing), isAuthor: true, reused: true };

  const setId = crypto.randomUUID();
  if (!examId) examId = `set:${setId}`;
  const record = {
    setId,
    examId,
    examVersion,
    shareCode: null,
    title,
    courseId,
    source: payload.source ? String(payload.source) : 'generated',
    authorParticipantId: authorParticipantId || null,
    fingerprint,
    createdAt: new Date().toISOString(),
    questions
  };

  // 공유 코드가 겹치면 새 코드로 다시 시도한다. 동시에 들어온 같은 세트면 먼저 저장된 것을 돌려준다.
  let saved = null;
  for (let tries = 0; tries < 3 && !saved; tries++) {
    try {
      saved = await store.insertExam({ ...record, shareCode: newShareCode() });
    } catch (err) {
      if (err.code !== 'duplicate') throw err;
      const raced = await store.findExamByFingerprint(authorParticipantId, fingerprint);
      if (raced) return { ...examSummary(raced), isAuthor: true, reused: true };
      if (tries === 2) throw err;
    }
  }

  return { ...examSummary(saved), isAuthor: !!authorParticipantId, reused: false };
}

/** 내 시험지 목록: 내가 만든 시험과 내가 푼(또는 풀던) 시험. 정답은 포함하지 않는다. */
async function listMyExams(participantId) {
  const authored = (await store.listExamsByAuthor(participantId)).map(examSummary);
  const attempts = await store.listAttemptsByParticipant(participantId);
  const exams = new Map((await store.getExamsBySetIds(attempts.map((a) => a.setId))).map((e) => [e.setId, e]));
  const attempted = [];
  const seen = new Set();
  for (const a of attempts) {
    const exam = exams.get(a.setId);
    if (!exam || seen.has(a.setId)) continue; // 세트당 가장 최근 응시 하나만
    seen.add(a.setId);
    attempted.push({
      ...examSummary(exam),
      attemptId: a.attemptId,
      status: a.graded ? 'graded' : 'open',
      score: a.score,
      correctCount: a.correctCount,
      counted: !!a.counted,
      countedReason: a.countedReason,
      gradedAt: a.gradedAt,
      isAuthor: !!exam.authorParticipantId && exam.authorParticipantId === participantId
    });
  }
  return { authored, attempted, storage: store.getMode() };
}

/** 저장된 세트 조회(정답 포함, 서버 내부용). */
async function getQuestionSet(setId) {
  return store.getExamBySetId(setId);
}

/** 공유 코드로 시험 공개 정보 조회(정답·해설 제외). */
async function getSharedExam(shareCode) {
  const exam = await store.getExamByShareCode(String(shareCode || ''));
  if (!exam) throw httpError(404, '존재하지 않는 공유 시험입니다.', 'exam_not_found');
  return { ...examSummary(exam), questions: publicQuestions(exam.questions), storage: store.getMode() };
}

// 이 참가자의 다음 완료 응시가 집계되는지. 작성자는 author, 이미 집계된 완료가 있으면 practice.
async function countingPlan(exam, participantId) {
  if (exam.authorParticipantId && exam.authorParticipantId === participantId) {
    return { willCount: false, willCountReason: 'author' };
  }
  const mine = await store.listParticipantAttempts(participantId, exam.examId, exam.examVersion);
  if (mine.some((a) => a.counted)) return { willCount: false, willCountReason: 'practice' };
  return { willCount: true, willCountReason: 'first_completion' };
}

/**
 * 공유 시험 응시 시작. 같은 참가자의 미완료 응시가 있으면 그것을 돌려준다(resumed).
 * 정답/해설은 응답에서 제외한다.
 */
async function startAttempt(exam, participantId, { nickname } = {}) {
  const plan = await countingPlan(exam, participantId);
  const mine = await store.listParticipantAttempts(participantId, exam.examId, exam.examVersion);
  const open = mine.find((a) => !a.graded);
  const common = { ...examSummary(exam), ...plan, storage: store.getMode(), questions: publicQuestions(exam.questions) };
  if (open) return { attemptId: open.attemptId, resumed: true, ...common };

  const attempt = {
    attemptId: crypto.randomUUID(),
    setId: exam.setId,
    examId: exam.examId,
    examVersion: exam.examVersion,
    participantId,
    nickname: cleanNickname(nickname),
    answers: null,
    score: null,
    maxScore: null,
    correctCount: null,
    questionCount: null,
    graded: false,
    counted: false,
    countedReason: null,
    solutionText: null,
    solutionSharedAt: null,
    createdAt: new Date().toISOString(),
    gradedAt: null
  };
  await store.insertAttempt(attempt);
  return { attemptId: attempt.attemptId, resumed: false, ...common };
}

async function createAttemptFromSet(setId, participantId, options = {}) {
  const exam = await store.getExamBySetId(String(setId || ''));
  if (!exam) throw httpError(404, '존재하지 않는 문제 세트입니다.', 'exam_not_found');
  return startAttempt(exam, participantId, options);
}

async function createAttemptFromShareCode(shareCode, participantId, options = {}) {
  const exam = await store.getExamByShareCode(String(shareCode || ''));
  if (!exam) throw httpError(404, '존재하지 않는 공유 시험입니다.', 'exam_not_found');
  return startAttempt(exam, participantId, options);
}

// ----- 스테이지 출제 -----
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

  return {
    attemptId,
    stageId,
    examId: `${COURSE.id}:${stageId}`,
    examVersion: EXAM_VERSION,
    questionCount: items.length,
    questions: publicQuestions(items)
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
// 모든 문항에 유효한 선택지가 있어야 제출 가능. 알려진 문항의 답만 골라 돌려준다.
function pickAnswers(items, answers, code) {
  const safeAnswers = answers && typeof answers === 'object' ? answers : {};
  const picked = {};
  for (const q of items) {
    const a = safeAnswers[q.id];
    if (!Number.isInteger(a) || a < 0 || a >= q.choices.length) {
      throw httpError(400, '모든 문항에 올바르게 답한 뒤 제출해 주세요.', code);
    }
    picked[q.id] = a;
  }
  return picked;
}

/**
 * 서버 측 채점. answers는 { [questionId]: choiceIndex }.
 * - 스테이지 응시(attempts.json): 기존 동작. 같은 attempt 재제출 시 보상(XP/별) 중복 지급을 막는다.
 * - 공유 시험 응시(shared-store): participantId가 응시 주인과 같아야 한다. 첫 채점만 저장하고
 *   재전송은 저장된 결과를 돌려준다(alreadyGraded). 참가자별 첫 완료만 counted=true.
 */
async function gradeAttempt(attemptId, answers, participantId = null) {
  const legacy = readAttempts()[attemptId];
  if (legacy) return gradeStageAttempt(legacy, answers);

  const attempt = await store.getAttempt(String(attemptId || ''));
  if (!attempt) throw httpError(404, '존재하지 않는 시도(attempt)입니다.', 'attempt_not_found');
  if (!participantId) throw httpError(401, '참가자 토큰이 필요합니다.', 'participant_required');
  if (attempt.participantId !== participantId) throw httpError(403, '본인 응시만 제출할 수 있습니다.', 'not_owner');
  const exam = await store.getExamBySetId(attempt.setId);
  if (!exam) throw httpError(500, '응시에 연결된 시험을 찾을 수 없습니다.');
  if (attempt.graded) return sharedResult(attempt, exam, true);

  const picked = pickAnswers(exam.questions, answers, 'answers_incomplete');
  const correctCount = exam.questions.filter((q) => picked[q.id] === q.answerIndex).length;
  const questionCount = exam.questions.length;
  const isAuthor = !!exam.authorParticipantId && exam.authorParticipantId === participantId;
  const { applied, attempt: saved } = await store.completeAttempt(attempt.attemptId, {
    answers: picked,
    score: correctCount * POINTS_PER_QUESTION,
    maxScore: questionCount * POINTS_PER_QUESTION,
    correctCount,
    questionCount,
    graded: true,
    gradedAt: new Date().toISOString(),
    counted: !isAuthor,
    countedReason: isAuthor ? 'author' : 'first_completion'
  });
  if (!saved) throw httpError(404, '존재하지 않는 시도(attempt)입니다.', 'attempt_not_found');
  return sharedResult(saved, exam, !applied);
}

// 공유 시험 채점 결과(제출 후에만 정답·AI 해설 포함).
function sharedResult(attempt, exam, alreadyGraded) {
  const answers = attempt.answers || {};
  const details = exam.questions.map((q) => ({
    questionId: q.id,
    answer: answers[q.id],
    correct: answers[q.id] === q.answerIndex,
    answerIndex: q.answerIndex,
    explanation: q.explanation,
    evidence: q.evidence || null
  }));
  return {
    attemptId: attempt.attemptId,
    setId: attempt.setId,
    examId: attempt.examId,
    examVersion: attempt.examVersion,
    shareCode: exam.shareCode,
    score: attempt.score,
    maxScore: attempt.maxScore,
    correctCount: attempt.correctCount,
    questionCount: attempt.questionCount,
    passed: attempt.correctCount >= PASS_THRESHOLD,
    stars: starsFor(attempt.correctCount, attempt.questionCount),
    counted: !!attempt.counted,
    countedReason: attempt.countedReason,
    alreadyGraded: !!alreadyGraded,
    gradedAt: attempt.gradedAt,
    explanationSource: 'ai',
    details
  };
}

function gradeStageAttempt(attempt, answers) {
  const items = attempt.questionIds.map(getBankQuestion);
  if (items.some((q) => !q)) {
    const err = new Error('시험지 문항을 찾을 수 없습니다.');
    err.statusCode = 500;
    throw err;
  }

  const safeAnswers = pickAnswers(items, answers);

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
    attemptId: attempt.attemptId,
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

  const map = readAttempts();
  map[attempt.attemptId] = { ...attempt, graded: true, result: { ...result } };
  writeAttempts(map);

  return { ...result, details };
}

// ----- 재접속: 본인 응시 상태 -----
async function getAttemptState(attemptId, participantId) {
  const attempt = await store.getAttempt(String(attemptId || ''));
  if (!attempt) throw httpError(404, '존재하지 않는 시도(attempt)입니다.', 'attempt_not_found');
  if (attempt.participantId !== participantId) throw httpError(403, '본인 응시만 볼 수 있습니다.', 'not_owner');
  const exam = await store.getExamBySetId(attempt.setId);
  if (!exam) throw httpError(500, '응시에 연결된 시험을 찾을 수 없습니다.');
  if (attempt.graded) return { status: 'graded', ...sharedResult(attempt, exam, true) };
  const plan = await countingPlan(exam, participantId);
  return {
    status: 'open',
    attemptId: attempt.attemptId,
    resumed: true,
    ...examSummary(exam),
    ...plan,
    storage: store.getMode(),
    questions: publicQuestions(exam.questions)
  };
}

// ----- 결과 비교 (FR-14) -----
/**
 * 같은 시험·버전의 집계 응시(참가자별 첫 완료, 작성자 제외)로 참가 수·평균·문항별 정답률·내 공동 순위를 계산.
 * 순위 = 나보다 높은 점수의 참가자 수 + 1. 0명은 empty, 1명은 insufficient.
 */
async function getExamResults(shareCode, participantId = null) {
  const exam = await store.getExamByShareCode(String(shareCode || ''));
  if (!exam) throw httpError(404, '존재하지 않는 공유 시험입니다.', 'exam_not_found');
  const counted = await store.listCountedAttempts(exam.examId, exam.examVersion);
  const participantCount = counted.length;
  const averageScore = participantCount
    ? Math.round((counted.reduce((sum, a) => sum + a.score, 0) / participantCount) * 10) / 10
    : null;

  const questionStats = exam.questions.map((q) => {
    const answered = counted.filter((a) => a.answers && Number.isInteger(a.answers[q.id]));
    const correct = answered.filter((a) => a.answers[q.id] === q.answerIndex).length;
    return {
      questionId: q.id,
      answeredCount: answered.length,
      correctCount: correct,
      correctPercent: answered.length ? Math.round((correct / answered.length) * 100) : null
    };
  });

  let me = null;
  if (participantId) {
    const mine = counted.find((a) => a.participantId === participantId);
    if (mine) {
      me = {
        attemptId: mine.attemptId,
        score: mine.score,
        correctCount: mine.correctCount,
        rank: counted.filter((a) => a.score > mine.score).length + 1,
        tiedCount: counted.filter((a) => a.score === mine.score).length,
        counted: true
      };
    } else {
      const own = (await store.listParticipantAttempts(participantId, exam.examId, exam.examVersion)).filter((a) => a.graded);
      const isAuthor = !!exam.authorParticipantId && exam.authorParticipantId === participantId;
      me = {
        counted: false,
        reason: isAuthor ? 'author' : 'not_submitted',
        score: own.length ? own[0].score : null,
        correctCount: own.length ? own[0].correctCount : null
      };
    }
  }

  return {
    ...examSummary(exam),
    basis: 'anonymous_participants',
    state: participantCount === 0 ? 'empty' : participantCount === 1 ? 'insufficient' : 'ready',
    participantCount,
    averageScore,
    questionStats,
    me,
    storage: store.getMode()
  };
}

// ----- 풀이 참고 (FR-15) -----
async function ownGradedAttempt(attemptId, participantId) {
  const attempt = await store.getAttempt(String(attemptId || ''));
  if (!attempt) throw httpError(404, '존재하지 않는 시도(attempt)입니다.', 'attempt_not_found');
  if (attempt.participantId !== participantId) throw httpError(403, '본인 응시에만 풀이를 남길 수 있습니다.', 'not_owner');
  if (!attempt.graded) throw httpError(403, '제출을 마친 뒤에 풀이를 남길 수 있습니다.', 'not_submitted');
  return attempt;
}

function solutionView(attempt) {
  return attempt.solutionText
    ? { text: attempt.solutionText, sharedAt: attempt.solutionSharedAt, format: 'plain_text' }
    : null;
}

/** 본인 채점 완료 응시에 300자 이내 일반 텍스트 풀이를 저장(수정 포함). */
async function setSolution(attemptId, participantId, text) {
  const attempt = await ownGradedAttempt(attemptId, participantId);
  const clean = plainText(text);
  if (!clean) throw httpError(400, '풀이 내용을 입력해 주세요.', 'solution_empty');
  if (Array.from(clean).length > SOLUTION_MAX) {
    throw httpError(400, `풀이는 ${SOLUTION_MAX}자 이내로 적어 주세요.`, 'solution_too_long');
  }
  const saved = await store.updateSolution(attempt.attemptId, clean);
  return { attemptId: attempt.attemptId, solution: solutionView(saved) };
}

/** 풀이 공유 취소. */
async function clearSolution(attemptId, participantId) {
  const attempt = await ownGradedAttempt(attemptId, participantId);
  await store.updateSolution(attempt.attemptId, null);
  return { attemptId: attempt.attemptId, solution: null };
}

/**
 * 같은 시험 제출자에게 AI 공통 해설과 학생 풀이를 구분해 돌려준다.
 * 참가자별 최근 공유 풀이 1개만 보여주고, 다른 사람의 답안·식별값은 보내지 않는다.
 */
async function listSolutions(shareCode, participantId) {
  const exam = await store.getExamByShareCode(String(shareCode || ''));
  if (!exam) throw httpError(404, '존재하지 않는 공유 시험입니다.', 'exam_not_found');
  const mine = await store.listParticipantAttempts(participantId, exam.examId, exam.examVersion);
  if (!mine.some((a) => a.graded)) {
    throw httpError(403, '이 시험을 제출한 참가자만 풀이를 볼 수 있어요.', 'not_submitted');
  }

  const latestByParticipant = new Map();
  for (const a of await store.listSharedSolutions(exam.examId, exam.examVersion)) {
    if (!latestByParticipant.has(a.participantId)) latestByParticipant.set(a.participantId, a);
  }
  const students = Array.from(latestByParticipant.values()).map((a) => {
    const item = { nickname: a.nickname || '익명', text: a.solutionText, sharedAt: a.solutionSharedAt, mine: a.participantId === participantId };
    if (item.mine) item.attemptId = a.attemptId;
    return item;
  });

  return {
    ...examSummary(exam),
    ai: {
      source: 'ai',
      label: 'AI 공통 해설',
      items: exam.questions.map((q) => ({ questionId: q.id, answerIndex: q.answerIndex, explanation: q.explanation }))
    },
    students: { source: 'student', label: '학생 풀이', format: 'plain_text', maxLength: SOLUTION_MAX, items: students },
    storage: store.getMode()
  };
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
  createAttemptFromShareCode,
  saveQuestionSet,
  listMyExams,
  getQuestionSet,
  getSharedExam,
  getAttemptState,
  gradeAttempt,
  getExamResults,
  setSolution,
  clearSolution,
  listSolutions,
  getProgress,
  listStages,
  stageOrder,
  stageUnit,
  starsFor,
  COURSE,
  UNIT_SIZE,
  PASS_THRESHOLD
};
