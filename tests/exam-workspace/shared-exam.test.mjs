// 공유 시험 저장·출제·서버 채점·결과 비교·풀이 참고 (FR-13~15) HTTP 통합 검사.
// 기본은 로컬 JSON 저장. SHARED_EXAM_TEST_STORAGE=supabase 로 실행하면 현재 환경변수의 Supabase에 실제로 쓴다
// (supabase/shared-exams.sql 적용 뒤). 제목이 '[검사]'로 시작하는 행이 남는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const port = process.env.SHARED_EXAM_TEST_PORT || '3494';
const origin = `http://127.0.0.1:${port}`;
const useSupabase = process.env.SHARED_EXAM_TEST_STORAGE === 'supabase';

function startServer(temp) {
  const blank = useSupabase
    ? {}
    : { SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_SECRET_KEY: '', SUPABASE_KEY: '' };
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: port, NODE_ENV: 'test', VERCEL: '1', TMPDIR: temp, TEMP: temp, TMP: temp, ...blank },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  const ready = (async () => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !output.includes('공유 시험 저장 모드')) {
      if (child.exitCode !== null) throw new Error(output);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.match(output, /server running/);
    assert.match(output, useSupabase ? /공유 시험 저장 모드: supabase/ : /공유 시험 저장 모드: local/);
  })();
  const stop = () => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill();
  });
  return { ready, stop };
}

async function api(method, url, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['X-Participant-Token'] = token;
  const res = await fetch(origin + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

const QUESTIONS = ['q1', 'q2', 'q3', 'q4', 'q5'].map((id, i) => ({
  id, body: `문항 ${i + 1}`, choices: ['가', '나', '다', '라'], answerIndex: i % 4,
  explanation: `해설 ${i + 1}`, evidence: { page: i + 1, quote: `근거 ${i + 1}` }
}));
const correct = Object.fromEntries(QUESTIONS.map((q) => [q.id, q.answerIndex]));
const wrong = (ids) => ({ ...correct, ...Object.fromEntries(ids.map((id) => [id, (correct[id] + 1) % 4])) });
const SECRET = /answerIndex|explanation|"evidence"/;

test('shared exam: two participants, server grading, comparison, solutions, restart persistence', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'alttab-shared-exam-'));
  let server = startServer(temp);
  try {
    await server.ready;

    // 참가자 발급. 토큰은 서버가 만든다.
    const issue = async () => {
      const r = await api('POST', '/api/participants');
      assert.equal(r.status, 201);
      assert.match(r.json.participantToken, /^[A-Za-z0-9_-]{43}$/);
      return r.json;
    };
    const [author, b, c, d, e, f] = await Promise.all([issue(), issue(), issue(), issue(), issue(), issue()]);

    // FR-13 세트 저장(작성자 토큰) → examId·버전·공유 코드
    const saved = await api('POST', '/api/question-sets', { token: author.participantToken, body: { title: '[검사] 공유 시험', questions: QUESTIONS } });
    assert.equal(saved.status, 201);
    assert.equal(saved.json.examVersion, 1);
    assert.equal(saved.json.examId, `set:${saved.json.setId}`);
    assert.match(saved.json.shareCode, /^[a-z2-9]{8}$/);
    assert.equal(saved.json.isAuthor, true);
    assert.equal(saved.json.maxScore, 50);
    const code = saved.json.shareCode;

    // 공유 조회: 같은 문항·보기, 정답·해설·근거 비노출
    const shared = await api('GET', `/api/shared-exams/${code}`);
    assert.equal(shared.status, 200);
    assert.equal(shared.json.questionCount, 5);
    assert.deepEqual(shared.json.questions.map((q) => q.choices), QUESTIONS.map((q) => q.choices));
    assert.doesNotMatch(JSON.stringify(shared.json), SECRET);
    assert.equal((await api('GET', '/api/shared-exams/zzzzzzzz')).status, 404);

    // 출제: 토큰 없으면 401, 있으면 정답 없는 문항과 집계 예정 표시
    assert.equal((await api('POST', `/api/shared-exams/${code}/attempts`, { body: {} })).json.code, 'participant_required');
    const bAttempt = await api('POST', `/api/shared-exams/${code}/attempts`, { token: b.participantToken, body: { nickname: '  비  ' } });
    assert.equal(bAttempt.status, 201);
    assert.equal(bAttempt.json.resumed, false);
    assert.equal(bAttempt.json.willCount, true);
    assert.equal(bAttempt.json.willCountReason, 'first_completion');
    assert.doesNotMatch(JSON.stringify(bAttempt.json), SECRET);
    // 같은 참가자가 다시 출제 요청 → 미완료 응시 재사용(중복 응시 생성 없음)
    const bAgain = await api('POST', `/api/shared-exams/${code}/attempts`, { token: b.participantToken, body: {} });
    assert.equal(bAgain.json.attemptId, bAttempt.json.attemptId);
    assert.equal(bAgain.json.resumed, true);

    // 대리 제출·무토큰·미응답 차단
    const hijack = await api('POST', `/api/attempts/${bAttempt.json.attemptId}/answers`, { token: c.participantToken, body: { answers: correct } });
    assert.equal(hijack.status, 403);
    assert.equal(hijack.json.code, 'not_owner');
    assert.equal((await api('POST', `/api/attempts/${bAttempt.json.attemptId}/answers`, { body: { answers: correct } })).status, 401);
    const partial = { ...correct };
    delete partial.q5;
    const incomplete = await api('POST', `/api/attempts/${bAttempt.json.attemptId}/answers`, { token: b.participantToken, body: { answers: partial } });
    assert.equal(incomplete.status, 400);
    assert.equal(incomplete.json.code, 'answers_incomplete');

    // B 제출 5/5. 본문의 임의 점수·타인 식별값은 무시된다.
    const bResult = await api('POST', `/api/attempts/${bAttempt.json.attemptId}/answers`, {
      token: b.participantToken, body: { answers: correct, score: 999, participantId: c.participantId }
    });
    assert.equal(bResult.status, 200);
    assert.equal(bResult.json.score, 50);
    assert.equal(bResult.json.counted, true);
    assert.equal(bResult.json.countedReason, 'first_completion');
    assert.equal(bResult.json.alreadyGraded, false);
    assert.equal(bResult.json.explanationSource, 'ai');
    assert.equal(bResult.json.details.length, 5);
    assert.equal(bResult.json.details[0].explanation, '해설 1');
    assert.equal(bResult.json.details[0].evidence.quote, '근거 1');
    // 재전송(응답 유실 후 재시도) → 저장된 결과 그대로, 점수 바뀌지 않음
    const bRetry = await api('POST', `/api/attempts/${bAttempt.json.attemptId}/answers`, { token: b.participantToken, body: { answers: wrong(['q1', 'q2']) } });
    assert.equal(bRetry.json.alreadyGraded, true);
    assert.equal(bRetry.json.score, 50);

    // C 제출 3/5 (setId 경로)
    const cAttempt = await api('POST', `/api/question-sets/${saved.json.setId}/attempts`, { token: c.participantToken, body: { nickname: '씨' } });
    assert.equal(cAttempt.status, 201);
    const cResult = await api('POST', `/api/attempts/${cAttempt.json.attemptId}/answers`, { token: c.participantToken, body: { answers: wrong(['q1', 'q2']) } });
    assert.equal(cResult.json.score, 30);
    assert.equal(cResult.json.counted, true);

    // 작성자 응시 → 집계 제외(author)
    const aAttempt = await api('POST', `/api/shared-exams/${code}/attempts`, { token: author.participantToken, body: {} });
    assert.equal(aAttempt.json.willCount, false);
    assert.equal(aAttempt.json.willCountReason, 'author');
    const aResult = await api('POST', `/api/attempts/${aAttempt.json.attemptId}/answers`, { token: author.participantToken, body: { answers: correct } });
    assert.equal(aResult.json.counted, false);
    assert.equal(aResult.json.countedReason, 'author');

    // FR-14 결과 비교: 참가 2명, 평균 40, B 1위, C 2위, 문항별 정답률, 정답 비노출
    let results = await api('GET', `/api/shared-exams/${code}/results`, { token: b.participantToken });
    assert.equal(results.status, 200);
    assert.equal(results.json.state, 'ready');
    assert.equal(results.json.participantCount, 2);
    assert.equal(results.json.averageScore, 40);
    assert.equal(results.json.basis, 'anonymous_participants');
    assert.deepEqual(results.json.me, { attemptId: bAttempt.json.attemptId, score: 50, correctCount: 5, rank: 1, tiedCount: 1, counted: true });
    assert.deepEqual(results.json.questionStats.find((s) => s.questionId === 'q1'), { questionId: 'q1', answeredCount: 2, correctCount: 1, correctPercent: 50 });
    assert.deepEqual(results.json.questionStats.find((s) => s.questionId === 'q3'), { questionId: 'q3', answeredCount: 2, correctCount: 2, correctPercent: 100 });
    assert.doesNotMatch(JSON.stringify(results.json), /answerIndex/);
    assert.equal((await api('GET', `/api/shared-exams/${code}/results`, { token: c.participantToken })).json.me.rank, 2);
    const aView = await api('GET', `/api/shared-exams/${code}/results`, { token: author.participantToken });
    assert.equal(aView.json.participantCount, 2);
    assert.deepEqual(aView.json.me, { counted: false, reason: 'author', score: 50, correctCount: 5 });
    assert.equal((await api('GET', `/api/shared-exams/${code}/results`)).json.me, null);
    assert.deepEqual((await api('GET', `/api/shared-exams/${code}/results`, { token: d.participantToken })).json.me, { counted: false, reason: 'not_submitted', score: null, correctCount: null });

    // C 재응시 → 연습(practice). 참가 수·점수 변하지 않음
    const cPractice = await api('POST', `/api/shared-exams/${code}/attempts`, { token: c.participantToken, body: {} });
    assert.notEqual(cPractice.json.attemptId, cAttempt.json.attemptId);
    assert.equal(cPractice.json.willCountReason, 'practice');
    const cPracticeResult = await api('POST', `/api/attempts/${cPractice.json.attemptId}/answers`, { token: c.participantToken, body: { answers: correct } });
    assert.equal(cPracticeResult.json.score, 50);
    assert.equal(cPracticeResult.json.counted, false);
    assert.equal(cPracticeResult.json.countedReason, 'practice');
    results = await api('GET', `/api/shared-exams/${code}/results`, { token: c.participantToken });
    assert.equal(results.json.participantCount, 2);
    assert.equal(results.json.me.score, 30);

    // 동점: E 3/5 → C·E 공동 2위, 평균 36.7
    const eAttempt = await api('POST', `/api/shared-exams/${code}/attempts`, { token: e.participantToken, body: {} });
    await api('POST', `/api/attempts/${eAttempt.json.attemptId}/answers`, { token: e.participantToken, body: { answers: wrong(['q3', 'q4']) } });
    results = await api('GET', `/api/shared-exams/${code}/results`, { token: e.participantToken });
    assert.equal(results.json.participantCount, 3);
    assert.equal(results.json.averageScore, 36.7);
    assert.equal(results.json.me.rank, 2);
    assert.equal(results.json.me.tiedCount, 2);
    assert.equal((await api('GET', `/api/shared-exams/${code}/results`, { token: c.participantToken })).json.me.rank, 2);

    // FR-15 풀이 참고: 제출자만 조회, 본인 채점 완료 응시만 저장, 300자 제한, 수정·취소
    const dAttempt = await api('POST', `/api/shared-exams/${code}/attempts`, { token: d.participantToken, body: {} });
    assert.equal((await api('GET', `/api/shared-exams/${code}/solutions`)).status, 401);
    assert.equal((await api('GET', `/api/shared-exams/${code}/solutions`, { token: d.participantToken })).json.code, 'not_submitted');
    assert.equal((await api('PUT', `/api/attempts/${dAttempt.json.attemptId}/solution`, { token: d.participantToken, body: { text: '아직' } })).json.code, 'not_submitted');
    assert.equal((await api('PUT', `/api/attempts/${bAttempt.json.attemptId}/solution`, { token: c.participantToken, body: { text: '남의 응시' } })).json.code, 'not_owner');
    assert.equal((await api('PUT', `/api/attempts/${bAttempt.json.attemptId}/solution`, { token: b.participantToken, body: { text: '가'.repeat(301) } })).json.code, 'solution_too_long');
    assert.equal((await api('PUT', `/api/attempts/${bAttempt.json.attemptId}/solution`, { token: b.participantToken, body: { text: '   ' } })).json.code, 'solution_empty');
    const text300 = '<b>스택</b>은 LIFO ' + '가'.repeat(300 - '<b>스택</b>은 LIFO '.length);
    const bSolution = await api('PUT', `/api/attempts/${bAttempt.json.attemptId}/solution`, { token: b.participantToken, body: { text: `  ${text300}\u0007 ` } });
    assert.equal(bSolution.status, 200);
    assert.equal(bSolution.json.solution.text, text300); // 일반 텍스트 그대로(HTML 해석은 화면이 하지 않는다)
    assert.equal(bSolution.json.solution.format, 'plain_text');
    const cSolutions = await api('GET', `/api/shared-exams/${code}/solutions`, { token: c.participantToken });
    assert.equal(cSolutions.status, 200);
    assert.equal(cSolutions.json.ai.label, 'AI 공통 해설');
    assert.equal(cSolutions.json.ai.items.length, 5);
    assert.equal(cSolutions.json.ai.items[1].answerIndex, 1);
    assert.equal(cSolutions.json.students.format, 'plain_text');
    assert.deepEqual(cSolutions.json.students.items.map((s) => [s.nickname, s.mine, s.attemptId]), [['비', false, undefined]]);
    assert.equal(cSolutions.json.students.items[0].text, text300);
    const bSolutions = await api('GET', `/api/shared-exams/${code}/solutions`, { token: b.participantToken });
    assert.deepEqual(bSolutions.json.students.items.map((s) => [s.mine, s.attemptId]), [[true, bAttempt.json.attemptId]]);
    // 작성자도 제출했으면 읽을 수 있고, 익명 닉네임 없는 참가자는 '익명'
    await api('PUT', `/api/attempts/${aAttempt.json.attemptId}/solution`, { token: author.participantToken, body: { text: '작성자 풀이' } });
    const aSolutions = await api('GET', `/api/shared-exams/${code}/solutions`, { token: author.participantToken });
    assert.deepEqual(aSolutions.json.students.items.map((s) => s.nickname).sort(), ['비', '익명']);
    // 수정 → 취소
    assert.equal((await api('PUT', `/api/attempts/${bAttempt.json.attemptId}/solution`, { token: b.participantToken, body: { text: '수정본' } })).json.solution.text, '수정본');
    const removed = await api('DELETE', `/api/attempts/${bAttempt.json.attemptId}/solution`, { token: b.participantToken });
    assert.equal(removed.status, 200);
    assert.equal(removed.json.solution, null);
    assert.deepEqual((await api('GET', `/api/shared-exams/${code}/solutions`, { token: c.participantToken })).json.students.items.map((s) => s.text), ['작성자 풀이']);

    // 같은 세트 재전송(연타) → 같은 setId, 중복 저장 없음
    const again = await api('POST', '/api/question-sets', { token: author.participantToken, body: { title: '[검사] 공유 시험', questions: QUESTIONS } });
    assert.equal(again.status, 201);
    assert.equal(again.json.setId, saved.json.setId);
    assert.equal(again.json.reused, true);
    assert.equal(saved.json.reused, false);

    // 다른 버전·다른 시험은 섞이지 않는다. 새 버전은 작성자만.
    const changed = QUESTIONS.map((q) => ({ ...q, answerIndex: (q.answerIndex + 1) % 4 }));
    assert.equal((await api('POST', '/api/question-sets', { token: b.participantToken, body: { examId: saved.json.examId, questions: changed } })).json.code, 'not_author');
    const v2 = await api('POST', '/api/question-sets', { token: author.participantToken, body: { title: '[검사] 공유 시험 v2', examId: saved.json.examId, questions: changed } });
    assert.equal(v2.status, 201);
    assert.equal(v2.json.examId, saved.json.examId);
    assert.equal(v2.json.examVersion, 2);
    assert.notEqual(v2.json.shareCode, code);
    const v2Empty = await api('GET', `/api/shared-exams/${v2.json.shareCode}/results`, { token: b.participantToken });
    assert.equal(v2Empty.json.state, 'empty');
    assert.equal(v2Empty.json.participantCount, 0);
    assert.equal(v2Empty.json.averageScore, null);
    assert.equal(v2Empty.json.questionStats[0].correctPercent, null);
    assert.equal(v2Empty.json.me.reason, 'not_submitted');
    // v2에 1명만 제출 → insufficient. v1은 그대로 3명
    const fAttempt = await api('POST', `/api/shared-exams/${v2.json.shareCode}/attempts`, { token: f.participantToken, body: {} });
    const fResult = await api('POST', `/api/attempts/${fAttempt.json.attemptId}/answers`, { token: f.participantToken, body: { answers: correct } });
    assert.equal(fResult.json.score, 0); // v2의 정답은 모두 바뀌었다
    const v2One = await api('GET', `/api/shared-exams/${v2.json.shareCode}/results`, { token: f.participantToken });
    assert.equal(v2One.json.state, 'insufficient');
    assert.equal(v2One.json.participantCount, 1);
    assert.equal(v2One.json.me.rank, 1);
    assert.equal((await api('GET', `/api/shared-exams/${code}/results`)).json.participantCount, 3);
    const other = await api('POST', '/api/question-sets', { token: b.participantToken, body: { title: '[검사] 다른 시험', questions: QUESTIONS } });
    assert.equal(other.json.examVersion, 1);
    assert.equal((await api('GET', `/api/shared-exams/${other.json.shareCode}/results`)).json.participantCount, 0);

    // 내 시험지 목록: 만든 시험과 푼 시험(세트당 최근 응시 1개), 정답 없음
    assert.equal((await api('GET', '/api/question-sets')).status, 401);
    const authorList = await api('GET', '/api/question-sets', { token: author.participantToken });
    assert.equal(authorList.status, 200);
    assert.deepEqual(authorList.json.authored.map((x) => x.examVersion).sort(), [1, 2]);
    assert.equal(authorList.json.attempted.find((x) => x.shareCode === code).isAuthor, true);
    const bList = await api('GET', '/api/question-sets', { token: b.participantToken });
    assert.deepEqual(bList.json.authored.map((x) => x.title), ['[검사] 다른 시험']);
    const bEntry = bList.json.attempted.find((x) => x.shareCode === code);
    assert.equal(bEntry.status, 'graded');
    assert.equal(bEntry.score, 50);
    assert.equal(bEntry.attemptId, bAttempt.json.attemptId);
    assert.equal(bEntry.isAuthor, false);
    const cList = await api('GET', '/api/question-sets', { token: c.participantToken });
    assert.equal(cList.json.attempted.filter((x) => x.shareCode === code).length, 1);
    assert.equal(cList.json.attempted.find((x) => x.shareCode === code).attemptId, cPractice.json.attemptId);
    assert.doesNotMatch(JSON.stringify(bList.json), SECRET);

    // 재접속: 본인 응시 상태(채점 전은 정답 없음, 채점 후는 결과)
    const graded = await api('GET', `/api/attempts/${bAttempt.json.attemptId}`, { token: b.participantToken });
    assert.equal(graded.json.status, 'graded');
    assert.equal(graded.json.score, 50);
    const open = await api('GET', `/api/attempts/${dAttempt.json.attemptId}`, { token: d.participantToken });
    assert.equal(open.json.status, 'open');
    assert.equal(open.json.questions.length, 5);
    assert.doesNotMatch(JSON.stringify(open.json), SECRET);
    assert.equal((await api('GET', `/api/attempts/${bAttempt.json.attemptId}`, { token: c.participantToken })).status, 403);

    if (!useSupabase) {
      // 정답이 든 저장 파일은 /uploads에서 내려받을 수 없다
      for (const name of ['shared-exams.json', 'shared-attempts.json']) {
        assert.equal((await fetch(`${origin}/uploads/${name}`)).status, 404);
      }
    }

    // 서버 재시작 뒤에도 시험·결과를 저장소에서 읽는다
    await server.stop();
    server = startServer(temp);
    await server.ready;
    assert.equal((await api('GET', `/api/shared-exams/${code}`)).status, 200);
    const after = await api('GET', `/api/shared-exams/${code}/results`, { token: b.participantToken });
    assert.equal(after.json.participantCount, 3);
    assert.equal(after.json.me.rank, 1);
    assert.equal((await api('GET', `/api/attempts/${bAttempt.json.attemptId}`, { token: b.participantToken })).json.score, 50);
    assert.deepEqual((await api('GET', `/api/shared-exams/${code}/solutions`, { token: c.participantToken })).json.students.items.map((s) => s.text), ['작성자 풀이']);

    // 기존 스테이지 출제·채점 회귀(토큰 없이, XP 포함)
    const stage = await api('POST', '/api/stages/stage-1/attempts', { body: { userId: 'u1' } });
    assert.equal(stage.status, 201);
    const stageResult = await api('POST', `/api/attempts/${stage.json.attemptId}/answers`, { body: { answers: Object.fromEntries(stage.json.questions.map((q) => [q.id, 0])) } });
    assert.equal(stageResult.status, 200);
    assert.equal(typeof stageResult.json.xpAwarded, 'number');
    assert.equal((await api('POST', `/api/attempts/${stage.json.attemptId}/answers`, { body: { answers: Object.fromEntries(stage.json.questions.map((q) => [q.id, 0])) } })).json.alreadyGraded, true);
  } finally {
    await server.stop();
    await rm(temp, { recursive: true, force: true });
  }
});
