'use strict';

const express = require('express');
const path = require('node:path');

const SUPABASE_ORIGIN = 'https://ltxuvtunctrayeewbwyd.supabase.co';
const TABLE_URL = `${SUPABASE_ORIGIN}/rest/v1/alttab_connection_test`;
const LLM_URL = 'https://ai.cs.kookmin.ac.kr/v1/messages';
const MODEL = 'claude-haiku-4-5';
// The public demonstration remains short-lived; repeated manual AI tests are
// allowed. Provider billing is not calculated or capped by this module.
const DEMO_END = '2026-10-03T11:00:00.000Z'; // 20:00 KST
const MAX_TEXT_CHARS = 200;
const MAX_INPUT_BYTES = 800;
const MAX_OUTPUT_TOKENS = 32;

class CheckError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new CheckError(status, code, message);
}

function publicStatus(env, now) {
  return {
    ok: true,
    mode: 'live-demo',
    db: { configured: Boolean(env.SUPABASE_KEY), tested: false },
    llm: { configured: Boolean(env.KOOKMIN_KEY), tested: false, model: MODEL, maxOutputTokens: MAX_OUTPUT_TOKENS },
    expired: now() >= Date.parse(DEMO_END),
    expiresAt: DEMO_END,
    publicDemo: true,
  };
}

function allowedOrigins(env) {
  const origins = new Set(['https://alt-tab-mu.vercel.app']);
  // These are platform-set hostnames, never request headers or user input.
  for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (host && /^[a-z0-9.-]+\.vercel\.app$/i.test(host)) origins.add(`https://${host}`);
  }
  if (!env.VERCEL && env.NODE_ENV !== 'production') {
    const port = /^\d{1,5}$/.test(env.PORT || '') ? env.PORT : '3000';
    origins.add(`http://127.0.0.1:${port}`);
    origins.add(`http://localhost:${port}`);
  }
  return origins;
}

function readText(body, field) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body[field] !== 'string') {
    fail(400, 'invalid_input', '텍스트 한 개만 보내 주세요.');
  }
  const value = body[field];
  if (!value.trim() || [...value].length > MAX_TEXT_CHARS || Buffer.byteLength(value, 'utf8') > MAX_INPUT_BYTES || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    fail(400, 'invalid_input', '비어 있지 않은 테스트 문장을 200자 이내로 입력해 주세요.');
  }
  return value;
}

async function readBoundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) fail(502, 'invalid_response', '연결 대상의 응답 형식을 확인하지 못했어요.');
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) {
      await reader.cancel();
      fail(502, 'invalid_response', '연결 대상의 응답이 예상 범위를 넘었어요.');
    }
    chunks.push(Buffer.from(value));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail(502, 'invalid_response', '연결 대상의 응답 형식을 확인하지 못했어요.'); }
}

function makeService({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const dbHeaders = () => {
    if (!env.SUPABASE_KEY) fail(503, 'db_not_configured', '서버에 SUPABASE_KEY가 설정되지 않았어요.');
    if (env.SUPABASE_URL && env.SUPABASE_URL.replace(/\/$/, '') !== SUPABASE_ORIGIN) {
      fail(503, 'db_target_mismatch', 'SUPABASE_URL이 이 테스트의 DB와 달라요. 운영자에게 확인해 주세요.');
    }
    const headers = { apikey: env.SUPABASE_KEY, 'Content-Type': 'application/json' };
    // Legacy service_role JWTs need Authorization; opaque sb_secret keys do not.
    if (env.SUPABASE_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${env.SUPABASE_KEY}`;
    return headers;
  };

  async function request(url, options, kind) {
    // A preceding DB request may finish after the window closed. Recheck at
    // every outbound boundary, including immediately before the AI request.
    if (now() >= Date.parse(DEMO_END)) fail(410, 'demo_expired', '오늘의 연결 시연 시간이 끝났어요. 추가 실행은 운영자 확인이 필요해요.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), kind === 'llm' ? 25000 : 8000);
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal, redirect: 'error', cache: 'no-store' });
      if (!response.ok) {
        await response.body?.cancel(); // Never return/log provider bodies or credentials.
        if (kind === 'db' && response.status === 404) fail(503, 'db_table_missing', '테스트 테이블이 아직 없거나 REST API에서 확인되지 않아요.');
        if (response.status === 401 || response.status === 403) fail(502, `${kind}_auth_failed`, '서버 키의 인증 또는 권한을 확인해 주세요.');
        fail(502, `${kind}_failed`, kind === 'llm' ? '학교 AI가 요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.' : 'DB 요청을 완료하지 못했어요.');
      }
      if (response.status === 204 || options.headers?.Prefer?.includes('return=minimal')) return null;
      return await readBoundedJson(response);
    } catch (error) {
      if (error instanceof CheckError) throw error;
      if (controller.signal.aborted) fail(504, `${kind}_timeout`, '응답 시간이 초과됐어요. LLM 요청은 자동 재시도하지 않아요.');
      fail(502, `${kind}_unreachable`, '연결 대상에 닿지 못했어요. 서버 설정을 확인해 주세요.');
    } finally { clearTimeout(timer); }
  }

  return {
    status: () => publicStatus(env, now),
    async saveAndRead(value) {
      const headers = dbHeaders();
      // Only one synthetic row exists. Keep prior call-history fields unchanged.
      await request(`${TABLE_URL}?on_conflict=id`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ id: true, value, updated_at: new Date(now()).toISOString() }),
      }, 'db');
      const rows = await request(`${TABLE_URL}?id=eq.true&select=value&limit=1`, { method: 'GET', headers }, 'db');
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0].value !== value) {
        fail(409, 'db_value_mismatch', '저장 후 읽은 값이 일치하지 않아요. 다른 시연 요청과 겹쳤을 수 있어요. 다시 확인해 주세요.');
      }
      return { ok: true, source: 'supabase', saved: true, read: true, exactMatch: true, value: rows[0].value };
    },
    async chat(message) {
      if (!env.KOOKMIN_KEY) fail(503, 'llm_not_configured', '서버에 KOOKMIN_KEY가 설정되지 않았어요.');
      const headers = dbHeaders();
      // Check the DB step without consuming or resetting a one-shot allowance.
      const rows = await request(`${TABLE_URL}?id=eq.true&select=id&limit=1`, { method: 'GET', headers }, 'db');
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== true) {
        fail(409, 'db_test_required', '먼저 DB 저장·읽기를 완료해 주세요.');
      }
      const data = await request(LLM_URL, {
        method: 'POST',
        headers: { 'x-api-key': env.KOOKMIN_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: MAX_OUTPUT_TOKENS, stream: false, messages: [{ role: 'user', content: message }] }),
      }, 'llm');
      const reply = Array.isArray(data.content) ? data.content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('').slice(0, 4000) : '';
      if (!reply.trim()) fail(502, 'llm_empty_response', '학교 AI에 요청했지만 텍스트 답변을 받지 못했어요.');
      const usage = data.usage && Number.isInteger(data.usage.input_tokens) && Number.isInteger(data.usage.output_tokens)
        ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens } : null;
      return { ok: true, source: 'school-ai', model: MODEL, reply, usage, truncated: data.stop_reason === 'max_tokens' };
    },
  };
}

function registerConnectionCheck(app, options = {}) {
  const env = options.env || process.env;
  const now = options.now || Date.now;
  const service = makeService({ ...options, env, now });
  const origins = allowedOrigins(env);
  const router = express.Router();

  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (req.method !== 'POST') { res.set('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method_not_allowed', message: 'POST 요청만 허용해요.' }); }
    // CSRF/drive-by protection, NOT authentication. The user approved a public
    // repeatable demo; non-browser clients can also supply this Origin header.
    if (!origins.has(req.get('origin')) || (req.get('sec-fetch-site') && !['same-origin', 'none'].includes(req.get('sec-fetch-site')))) {
      return res.status(403).json({ ok: false, error: 'origin_rejected', message: '같은 사이트의 테스트 화면에서 요청해 주세요.' });
    }
    if (!req.is('application/json')) return res.status(415).json({ ok: false, error: 'json_required', message: 'JSON 요청만 허용해요.' });
    if (req.originalUrl.includes('?')) return res.status(400).json({ ok: false, error: 'query_not_allowed', message: '추가 요청 옵션은 허용하지 않아요.' });
    next();
  });
  router.use(express.json({ limit: '2kb', strict: true }));
  router.post('/status', (req, res) => res.json(service.status()));
  router.use((req, res, next) => {
    if (now() >= Date.parse(DEMO_END)) return res.status(410).json({ ok: false, error: 'demo_expired', message: '오늘의 연결 시연 시간이 끝났어요. 추가 실행은 운영자 확인이 필요해요.' });
    next();
  });
  router.post('/db', async (req, res, next) => {
    try { res.json(await service.saveAndRead(readText(req.body, 'value'))); } catch (error) { next(error); }
  });
  router.post('/chat', async (req, res, next) => {
    try { res.json(await service.chat(readText(req.body, 'message'))); } catch (error) { next(error); }
  });
  router.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
    if (error instanceof CheckError) return res.status(error.status).json({ ok: false, error: error.code, message: error.message });
    const status = error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500;
    res.status(status).json({ ok: false, error: 'invalid_request', message: '요청을 처리하지 못했어요. 짧은 테스트 문장으로 다시 확인해 주세요.' });
  });
  app.use('/api/mock', router);
  app.use('/mock', (req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    next();
  }, express.static(path.join(__dirname, 'public', 'connection-check')));
}

module.exports = registerConnectionCheck;
module.exports.makeService = makeService;
module.exports.readText = readText;
module.exports.constants = { DEMO_END, MODEL, LLM_URL, TABLE_URL };
