'use strict';

/**
 * 공유 시험·응시 저장소 (FR-13~15).
 *
 * - Supabase 서비스 키가 있으면 shared_exams / shared_attempts 테이블에 저장한다(정의: supabase/shared-exams.sql).
 *   두 테이블은 RLS가 켜져 있고 정책이 없어 서버의 서비스 키만 접근한다. 테이블은 코드가 만들지 않는다.
 * - 키가 없으면 개발·검사용 로컬 JSON(uploads/shared-*.json)에 저장한다. Vercel에서는 /tmp라
 *   재배포·인스턴스 교체 시 사라지므로 운영 저장소로 보지 않는다.
 * - Supabase 모드에서 DB 오류는 502(db_error)로 올린다. 로컬로 몰래 폴백해 성공으로 꾸미지 않는다.
 *
 * 환경변수
 * - 주소: SUPABASE_URL 또는 NEXT_PUBLIC_SUPABASE_URL. 둘 다 없으면 연결 시연(connection-check.js)과 같은 팀 DB.
 * - 키:   SUPABASE_SERVICE_ROLE_KEY 또는 SUPABASE_SECRET_KEY 또는 SUPABASE_KEY(현재 Vercel 설정 이름). 서버 전용.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const TEAM_SUPABASE_URL = 'https://ltxuvtunctrayeewbwyd.supabase.co';
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || TEAM_SUPABASE_URL).replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY || '';
const EXAMS_TABLE = 'shared_exams';
const ATTEMPTS_TABLE = 'shared_attempts';

let supabase = null;
let mode = 'local'; // 'supabase' | 'local'

if (SUPABASE_KEY) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  mode = 'supabase';
} else {
  console.warn('[shared-store] Supabase 키 미설정 → 로컬 JSON(개발용)으로 동작합니다. 재배포 시 데이터가 남지 않습니다.');
}

function dbError(action, error) {
  const err = new Error(`DB ${action} 실패: ${error && error.message ? error.message : '알 수 없는 오류'}`);
  err.statusCode = 502;
  err.code = 'db_error';
  if (error && error.code === '23505') {
    err.statusCode = 409;
    err.code = 'duplicate';
  }
  return err;
}

// ----- 행 ↔ 객체 변환 (DB는 snake_case, 서버 코드는 camelCase) -----
function examToRow(e) {
  return {
    set_id: e.setId, exam_id: e.examId, exam_version: e.examVersion, share_code: e.shareCode,
    title: e.title, course_id: e.courseId, source: e.source, author_participant_id: e.authorParticipantId,
    fingerprint: e.fingerprint, questions: e.questions, created_at: e.createdAt
  };
}

function rowToExam(r) {
  if (!r) return null;
  return {
    setId: r.set_id, examId: r.exam_id, examVersion: r.exam_version, shareCode: r.share_code,
    title: r.title, courseId: r.course_id, source: r.source, authorParticipantId: r.author_participant_id,
    fingerprint: r.fingerprint, questions: r.questions, createdAt: r.created_at
  };
}

function attemptToRow(a) {
  const row = {
    attempt_id: a.attemptId, set_id: a.setId, exam_id: a.examId, exam_version: a.examVersion,
    participant_id: a.participantId, nickname: a.nickname, answers: a.answers,
    score: a.score, max_score: a.maxScore, correct_count: a.correctCount, question_count: a.questionCount,
    graded: a.graded, counted: a.counted, counted_reason: a.countedReason,
    solution_text: a.solutionText, solution_shared_at: a.solutionSharedAt,
    created_at: a.createdAt, graded_at: a.gradedAt
  };
  for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key];
  return row;
}

function rowToAttempt(r) {
  if (!r) return null;
  return {
    attemptId: r.attempt_id, setId: r.set_id, examId: r.exam_id, examVersion: r.exam_version,
    participantId: r.participant_id, nickname: r.nickname, answers: r.answers,
    score: r.score, maxScore: r.max_score, correctCount: r.correct_count, questionCount: r.question_count,
    graded: !!r.graded, counted: !!r.counted, countedReason: r.counted_reason,
    solutionText: r.solution_text, solutionSharedAt: r.solution_shared_at,
    createdAt: r.created_at, gradedAt: r.graded_at
  };
}

// ----- 로컬 JSON (개발·검사용) -----
const dataRoot = process.env.VERCEL ? os.tmpdir() : __dirname;
const examsFile = path.join(dataRoot, 'uploads', 'shared-exams.json');
const attemptsFile = path.join(dataRoot, 'uploads', 'shared-attempts.json');

function readMap(file) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, '{}');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

function writeMap(file, map) {
  fs.writeFileSync(file, JSON.stringify(map, null, 2));
}

function byCreatedAt(a, b) {
  return new Date(a.createdAt) - new Date(b.createdAt);
}

async function selectOne(table, filters) {
  let query = supabase.from(table).select('*');
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw dbError(`${table} 조회`, error);
  return data;
}

async function selectMany(table, filters, order) {
  let query = supabase.from(table).select('*');
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  if (order) query = query.order(order.column, { ascending: order.ascending !== false });
  const { data, error } = await query;
  if (error) throw dbError(`${table} 조회`, error);
  return data || [];
}

// ----- 시험 -----
async function insertExam(exam) {
  if (mode === 'supabase') {
    const { error } = await supabase.from(EXAMS_TABLE).insert(examToRow(exam));
    if (error) throw dbError('시험 저장', error);
    return exam;
  }
  const map = readMap(examsFile);
  const clash = Object.values(map).some(
    (e) => e.shareCode === exam.shareCode ||
      (e.examId === exam.examId && e.examVersion === exam.examVersion) ||
      (exam.authorParticipantId && exam.fingerprint &&
        e.authorParticipantId === exam.authorParticipantId && e.fingerprint === exam.fingerprint)
  );
  if (clash) throw dbError('시험 저장', { code: '23505', message: '이미 있는 공유 코드·버전 또는 같은 세트입니다.' });
  map[exam.setId] = exam;
  writeMap(examsFile, map);
  return exam;
}

async function getExamBySetId(setId) {
  if (mode === 'supabase') return rowToExam(await selectOne(EXAMS_TABLE, { set_id: setId }));
  return readMap(examsFile)[setId] || null;
}

async function getExamsBySetIds(setIds) {
  const ids = Array.from(new Set(setIds)).filter(Boolean);
  if (!ids.length) return [];
  if (mode === 'supabase') {
    const { data, error } = await supabase.from(EXAMS_TABLE).select('*').in('set_id', ids);
    if (error) throw dbError('시험 조회', error);
    return (data || []).map(rowToExam);
  }
  const map = readMap(examsFile);
  return ids.map((id) => map[id]).filter(Boolean);
}

// 같은 작성자가 같은 내용(fingerprint)으로 이미 저장한 시험. 연타·재전송 중복 저장 방지에 쓴다.
async function findExamByFingerprint(authorParticipantId, fingerprint) {
  if (!authorParticipantId || !fingerprint) return null;
  if (mode === 'supabase') {
    return rowToExam(await selectOne(EXAMS_TABLE, { author_participant_id: authorParticipantId, fingerprint }));
  }
  return Object.values(readMap(examsFile))
    .find((e) => e.authorParticipantId === authorParticipantId && e.fingerprint === fingerprint) || null;
}

// 참가자가 만든 시험(최근 순).
async function listExamsByAuthor(participantId) {
  if (mode === 'supabase') {
    const rows = await selectMany(EXAMS_TABLE, { author_participant_id: participantId }, { column: 'created_at', ascending: false });
    return rows.map(rowToExam);
  }
  return Object.values(readMap(examsFile))
    .filter((e) => e.authorParticipantId === participantId)
    .sort((a, b) => byCreatedAt(b, a));
}

async function getExamByShareCode(shareCode) {
  if (mode === 'supabase') return rowToExam(await selectOne(EXAMS_TABLE, { share_code: shareCode }));
  return Object.values(readMap(examsFile)).find((e) => e.shareCode === shareCode) || null;
}

// 같은 examId의 가장 높은 버전. 없으면 null.
async function getLatestExam(examId) {
  if (mode === 'supabase') {
    const rows = await selectMany(EXAMS_TABLE, { exam_id: examId }, { column: 'exam_version', ascending: false });
    return rowToExam(rows[0]);
  }
  const versions = Object.values(readMap(examsFile)).filter((e) => e.examId === examId);
  versions.sort((a, b) => b.examVersion - a.examVersion);
  return versions[0] || null;
}

// ----- 응시 -----
async function insertAttempt(attempt) {
  if (mode === 'supabase') {
    const { error } = await supabase.from(ATTEMPTS_TABLE).insert(attemptToRow(attempt));
    if (error) throw dbError('응시 저장', error);
    return attempt;
  }
  const map = readMap(attemptsFile);
  map[attempt.attemptId] = attempt;
  writeMap(attemptsFile, map);
  return attempt;
}

async function getAttempt(attemptId) {
  if (mode === 'supabase') return rowToAttempt(await selectOne(ATTEMPTS_TABLE, { attempt_id: attemptId }));
  return readMap(attemptsFile)[attemptId] || null;
}

// 한 참가자가 같은 시험·버전에 남긴 응시 전부(오래된 순).
async function listParticipantAttempts(participantId, examId, examVersion) {
  if (mode === 'supabase') {
    const rows = await selectMany(
      ATTEMPTS_TABLE,
      { participant_id: participantId, exam_id: examId, exam_version: examVersion },
      { column: 'created_at' }
    );
    return rows.map(rowToAttempt);
  }
  return Object.values(readMap(attemptsFile))
    .filter((a) => a.participantId === participantId && a.examId === examId && a.examVersion === examVersion)
    .sort(byCreatedAt);
}

// 참가자의 모든 응시(최근 순). 내 시험지 목록에 쓴다.
async function listAttemptsByParticipant(participantId) {
  if (mode === 'supabase') {
    const rows = await selectMany(ATTEMPTS_TABLE, { participant_id: participantId }, { column: 'created_at', ascending: false });
    return rows.map(rowToAttempt);
  }
  return Object.values(readMap(attemptsFile))
    .filter((a) => a.participantId === participantId)
    .sort((a, b) => byCreatedAt(b, a));
}

// 같은 시험·버전의 집계 대상(참가자별 첫 완료) 응시.
async function listCountedAttempts(examId, examVersion) {
  if (mode === 'supabase') {
    const rows = await selectMany(
      ATTEMPTS_TABLE,
      { exam_id: examId, exam_version: examVersion, counted: true },
      { column: 'graded_at' }
    );
    return rows.map(rowToAttempt);
  }
  return Object.values(readMap(attemptsFile))
    .filter((a) => a.examId === examId && a.examVersion === examVersion && a.counted)
    .sort((a, b) => new Date(a.gradedAt) - new Date(b.gradedAt));
}

/**
 * 채점 결과를 한 번만 기록한다.
 * - 이미 채점된 응시면 applied=false와 저장된 값을 돌려준다(재전송·동시 요청 보호).
 * - counted=true 요청이 "참가자·시험·버전당 집계 응시 하나" 제약에 걸리면 연습(practice)으로 기록한다.
 */
async function completeAttempt(attemptId, patch) {
  if (mode === 'supabase') {
    let row = attemptToRow(patch);
    for (let tries = 0; tries < 2; tries++) {
      const { data, error } = await supabase
        .from(ATTEMPTS_TABLE)
        .update(row)
        .eq('attempt_id', attemptId)
        .eq('graded', false)
        .select();
      if (error && error.code === '23505' && row.counted) {
        row = { ...row, counted: false, counted_reason: 'practice' };
        continue;
      }
      if (error) throw dbError('채점 저장', error);
      if (data && data.length) return { applied: true, attempt: rowToAttempt(data[0]) };
      return { applied: false, attempt: await getAttempt(attemptId) };
    }
    throw dbError('채점 저장', { message: '집계 제약 재시도에 실패했습니다.' });
  }

  const map = readMap(attemptsFile);
  const current = map[attemptId];
  if (!current) return { applied: false, attempt: null };
  if (current.graded) return { applied: false, attempt: current };
  let next = { ...current, ...patch };
  if (next.counted) {
    const taken = Object.values(map).some(
      (a) => a.attemptId !== attemptId && a.counted &&
        a.participantId === next.participantId && a.examId === next.examId && a.examVersion === next.examVersion
    );
    if (taken) next = { ...next, counted: false, countedReason: 'practice' };
  }
  map[attemptId] = next;
  writeMap(attemptsFile, map);
  return { applied: true, attempt: next };
}

// 풀이 저장(text) 또는 공유 취소(null).
async function updateSolution(attemptId, text) {
  const sharedAt = text ? new Date().toISOString() : null;
  if (mode === 'supabase') {
    const { data, error } = await supabase
      .from(ATTEMPTS_TABLE)
      .update({ solution_text: text, solution_shared_at: sharedAt })
      .eq('attempt_id', attemptId)
      .select()
      .maybeSingle();
    if (error) throw dbError('풀이 저장', error);
    return rowToAttempt(data);
  }
  const map = readMap(attemptsFile);
  if (!map[attemptId]) return null;
  map[attemptId] = { ...map[attemptId], solutionText: text, solutionSharedAt: sharedAt };
  writeMap(attemptsFile, map);
  return map[attemptId];
}

// 같은 시험·버전에서 공유된 풀이(최근 순).
async function listSharedSolutions(examId, examVersion) {
  if (mode === 'supabase') {
    const { data, error } = await supabase
      .from(ATTEMPTS_TABLE)
      .select('*')
      .eq('exam_id', examId)
      .eq('exam_version', examVersion)
      .not('solution_text', 'is', null)
      .order('solution_shared_at', { ascending: false });
    if (error) throw dbError('풀이 조회', error);
    return (data || []).map(rowToAttempt);
  }
  return Object.values(readMap(attemptsFile))
    .filter((a) => a.examId === examId && a.examVersion === examVersion && a.solutionText)
    .sort((a, b) => new Date(b.solutionSharedAt) - new Date(a.solutionSharedAt));
}

function getMode() {
  return mode;
}

module.exports = {
  insertExam,
  getExamBySetId,
  getExamsBySetIds,
  getExamByShareCode,
  getLatestExam,
  findExamByFingerprint,
  listExamsByAuthor,
  insertAttempt,
  getAttempt,
  listParticipantAttempts,
  listAttemptsByParticipant,
  listCountedAttempts,
  completeAttempt,
  updateSolution,
  listSharedSolutions,
  getMode
};
