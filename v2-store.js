'use strict';

const { createClient } = require('@supabase/supabase-js');
const ORIGIN = 'https://ltxuvtunctrayeewbwyd.supabase.co';
const EXAMS = 'alttab_v2_exams';
const ATTEMPTS = 'alttab_v2_attempts';
const JOBS = 'alttab_v2_generations';

function database(env = process.env) {
  const key = env.SUPABASE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw Object.assign(new Error('시험 저장소 연결을 준비 중이에요. 잠시 후 다시 열어 주세요.'), { status: 503 });
  if (env.SUPABASE_URL && env.SUPABASE_URL.replace(/\/$/, '') !== ORIGIN) {
    throw Object.assign(new Error('시험 저장소 설정을 확인 중이에요.'), { status: 503 });
  }
  return createClient(ORIGIN, key, { auth: { persistSession: false, autoRefreshToken: false }, global: {
    fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) }),
  } });
}

function createStore(env = process.env) {
  let client;
  const db = () => client || (client = database(env));
  async function read(query) {
    const { data, error } = await query;
    if (error) throw Object.assign(new Error('시험 정보를 저장하거나 읽지 못했어요. 잠시 후 다시 시도해 주세요.'), { status: 503 });
    return data;
  }
  return {
    list: () => read(db().from(EXAMS).select('id,title,source,created_at').order('created_at', { ascending: false }).limit(100)),
    get: id => read(db().from(EXAMS).select('*').eq('id', id).maybeSingle()),
    complete: (id, exam) => read(db().rpc('alttab_v2_complete_generation', { p_job: id, p_title: exam.title, p_questions: exam.questions })),
    attempt: (exam, participant) => read(db().from(ATTEMPTS).select('*').eq('exam_id', exam).eq('participant_key', participant).maybeSingle()),
    async begin(exam, participant, nickname) {
      // The unique pair makes retries and simultaneous tabs share one first attempt.
      await read(db().from(ATTEMPTS).upsert({ exam_id: exam, participant_key: participant, nickname }, { onConflict: 'exam_id,participant_key', ignoreDuplicates: true }));
      return this.attempt(exam, participant);
    },
    async submit(exam, participant, result) {
      const rows = await read(db().from(ATTEMPTS).update({ result, score: result.score, submitted_at: new Date().toISOString() })
        .eq('exam_id', exam).eq('participant_key', participant).is('result', null).select());
      return rows[0] || this.attempt(exam, participant);
    },
    ranking: (exam, participant) => read(db().rpc('alttab_v2_ranking', { p_exam: exam, p_participant: participant })),
    claim: (participant, fingerprint) => read(db().rpc('alttab_v2_claim_generation', { p_participant: participant, p_fingerprint: fingerprint })),
    fail: id => read(db().from(JOBS).update({ state: 'failed' }).eq('id', id).eq('state', 'pending')),
  };
}

module.exports = { createStore };
