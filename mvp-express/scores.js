'use strict';

/**
 * 점수 저장/조회 모듈.
 *
 * 설계 원칙
 * - Supabase 연결은 "되어 있다고 가정"하되, 환경변수가 없으면 서버가 죽지 않고
 *   로컬 JSON 파일 폴백으로 동작한다(로컬 개발/검증용).
 * - 점수 쓰기는 서버에서만 수행한다. 서비스 롤 키는 서버 환경변수로만 사용하고
 *   절대 프런트로 노출하지 않는다.
 *
 * 환경변수 (PRD 기준)
 * - SUPABASE_URL 또는 NEXT_PUBLIC_SUPABASE_URL : 프로젝트 URL
 * - SUPABASE_SERVICE_ROLE_KEY                   : 서버 전용 서비스 롤 키
 *
 * 테이블 가정: public.scores
 *   id          bigint (identity, PK)
 *   player_name text    not null
 *   score       integer not null
 *   quiz_id     text    null
 *   created_at  timestamptz default now()
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TABLE = process.env.SUPABASE_SCORES_TABLE || 'scores';
const TOP_LIMIT = 20;

let supabase = null;
let mode = 'local'; // 'supabase' | 'local'

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  try {
    // 선택적 의존성: 설치되어 있고 환경변수가 있을 때만 로드한다.
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });
    mode = 'supabase';
  } catch (err) {
    console.warn(
      '[scores] @supabase/supabase-js 로드 실패, 로컬 폴백으로 동작합니다:',
      err.message
    );
    mode = 'local';
  }
} else {
  console.warn(
    '[scores] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정 → 로컬 JSON 폴백으로 동작합니다.'
  );
}

// ----- 로컬 폴백 저장소 -----
const dataRoot = process.env.VERCEL ? os.tmpdir() : __dirname;
const scoresFile = path.join(dataRoot, 'uploads', 'scores.json');

function ensureLocalStore() {
  const dir = path.dirname(scoresFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(scoresFile)) fs.writeFileSync(scoresFile, '[]');
}

function readLocal() {
  ensureLocalStore();
  try {
    return JSON.parse(fs.readFileSync(scoresFile, 'utf-8'));
  } catch {
    return [];
  }
}

function writeLocal(list) {
  ensureLocalStore();
  fs.writeFileSync(scoresFile, JSON.stringify(list, null, 2));
}

// ----- 입력 검증 -----
function validateScoreInput(input) {
  const errors = [];
  const name = typeof input.playerName === 'string' ? input.playerName.trim() : '';
  const scoreNum = Number(input.score);

  if (!name) errors.push('playerName은 비어 있을 수 없습니다.');
  if (name.length > 40) errors.push('playerName은 40자 이하여야 합니다.');
  if (!Number.isFinite(scoreNum)) errors.push('score는 숫자여야 합니다.');
  if (Number.isFinite(scoreNum) && (scoreNum < 0 || scoreNum > 1000000))
    errors.push('score는 0 이상 1000000 이하여야 합니다.');

  const quizId =
    typeof input.quizId === 'string' ? input.quizId.trim().slice(0, 100) : null;

  return {
    valid: errors.length === 0,
    errors,
    value: { playerName: name, score: Math.round(scoreNum), quizId: quizId || null }
  };
}

// ----- 공개 API -----

/**
 * 점수 1건 저장. 저장된 레코드를 반환.
 */
async function saveScore(input) {
  const { valid, errors, value } = validateScoreInput(input);
  if (!valid) {
    const err = new Error(errors.join(' '));
    err.statusCode = 400;
    throw err;
  }

  if (mode === 'supabase') {
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        player_name: value.playerName,
        score: value.score,
        quiz_id: value.quizId
      })
      .select()
      .single();
    if (error) {
      const err = new Error(`Supabase insert 실패: ${error.message}`);
      err.statusCode = 502;
      throw err;
    }
    return data;
  }

  // 로컬 폴백
  const list = readLocal();
  const record = {
    id: Date.now(),
    player_name: value.playerName,
    score: value.score,
    quiz_id: value.quizId,
    created_at: new Date().toISOString()
  };
  list.push(record);
  writeLocal(list);
  return record;
}

/**
 * 상위 랭킹 조회. 점수 내림차순, 동점이면 먼저 기록한 순.
 */
async function getLeaderboard(limit = TOP_LIMIT) {
  const safeLimit = Math.min(Math.max(1, Number(limit) || TOP_LIMIT), 100);

  if (mode === 'supabase') {
    const { data, error } = await supabase
      .from(TABLE)
      .select('id, player_name, score, quiz_id, created_at')
      .order('score', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(safeLimit);
    if (error) {
      const err = new Error(`Supabase select 실패: ${error.message}`);
      err.statusCode = 502;
      throw err;
    }
    return data || [];
  }

  // 로컬 폴백
  const list = readLocal();
  return list
    .slice()
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(a.created_at) - new Date(b.created_at);
    })
    .slice(0, safeLimit);
}

function getMode() {
  return mode;
}

module.exports = { saveScore, getLeaderboard, getMode, validateScoreInput };
