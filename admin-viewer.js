'use strict';

const express = require('express');
const path = require('node:path');

const SUPABASE_ORIGIN = 'https://ltxuvtunctrayeewbwyd.supabase.co';
const TABLE_NAME = 'alttab_connection_test';
const TABLE_URL = `${SUPABASE_ORIGIN}/rest/v1/${TABLE_NAME}`;
const PAGE_SIZE = 25;
const MAX_PAGE = 100;
const MAX_RESPONSE_BYTES = 16384;
// This is an intentionally public, read-only viewer, not a Supabase admin proxy.
// New tables/columns/text values must be reviewed before adding to this allowlist.
// Unknown free text is fully hidden: regex-based PII detection is not sufficient.
const PUBLIC_TEST_VALUES = new Set(['안녕 AltTab! DB 연결 테스트']);
const TABLE = Object.freeze({
  name: TABLE_NAME,
  schema: 'public',
  label: 'DB 연결 테스트',
  description: '연결 테스트 화면에서 저장한 단일 테스트 행',
  columns: [
    { name: 'id', type: 'boolean', description: '항상 true인 고정 테스트 행 ID' },
    { name: 'value', type: 'text', description: '공개 검토된 샘플만 표시. 그 외 자유 입력은 가림' },
    { name: 'updated_at', type: 'timestamptz', description: 'DB에 마지막으로 저장한 시각' },
  ],
});

class ViewerError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function fail(status, code, message) { throw new ViewerError(status, code, message); }
function readPage(query) {
  if (Object.keys(query).some(key => key !== 'page')) fail(400, 'invalid_query', '페이지 번호만 지정할 수 있어요.');
  const raw = query.page === undefined ? '1' : query.page;
  if (typeof raw !== 'string' || !/^[1-9]\d{0,2}$/.test(raw) || Number(raw) > MAX_PAGE) {
    fail(400, 'invalid_page', '페이지는 1~100 사이 정수여야 해요.');
  }
  return Number(raw);
}
async function readBoundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) fail(502, 'invalid_response', 'DB 응답을 확인하지 못했어요.');
  let size = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); fail(502, 'invalid_response', 'DB 응답이 조회 범위를 넘었어요.'); }
    chunks.push(Buffer.from(value));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail(502, 'invalid_response', 'DB 응답 형식을 확인하지 못했어요.'); }
}
function publicRow(row) {
  if (!row || row.id !== true || typeof row.value !== 'string' || [...row.value].length > 200 ||
      typeof row.updated_at !== 'string' || row.updated_at.length > 40 || !Number.isFinite(Date.parse(row.updated_at))) {
    fail(502, 'invalid_response', '테스트 테이블의 데이터 형식을 확인해 주세요.');
  }
  const valueRedacted = !PUBLIC_TEST_VALUES.has(row.value);
  return {
    id: true,
    value: valueRedacted ? null : row.value,
    updated_at: new Date(row.updated_at).toISOString(),
    valueRedacted,
  };
}

function makeService({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  return {
    catalog: () => ({ ok: true, readOnly: true, public: true, tables: [TABLE] }),
    async rows(page = 1) {
      readPage({ page: String(page) });
      if (!env.SUPABASE_KEY) fail(503, 'db_not_configured', '서버의 SUPABASE_KEY 설정을 확인해 주세요.');
      if (env.SUPABASE_URL && env.SUPABASE_URL.replace(/\/$/, '') !== SUPABASE_ORIGIN) {
        fail(503, 'db_target_mismatch', '설정된 DB가 이 화면의 대상 프로젝트와 달라요.');
      }
      const headers = { apikey: env.SUPABASE_KEY, Accept: 'application/json', 'Accept-Profile': 'public', Prefer: 'count=exact' };
      if (env.SUPABASE_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${env.SUPABASE_KEY}`;
      const url = new URL(TABLE_URL);
      url.search = new URLSearchParams({ select: 'id,value,updated_at', order: 'updated_at.desc,id.asc', limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) }).toString();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetchImpl(url.toString(), { method: 'GET', headers, signal: controller.signal, redirect: 'error', cache: 'no-store' });
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 401 || response.status === 403) fail(502, 'db_auth_failed', '서버 DB 키의 인증·조회 권한을 확인해 주세요.');
          if (response.status === 404) fail(503, 'db_table_missing', '연결 테스트 테이블을 찾지 못했어요.');
          fail(502, 'db_failed', 'DB 조회를 완료하지 못했어요. 잠시 후 새로고침해 주세요.');
        }
        const rows = await readBoundedJson(response);
        // The inspected schema permits only one row (id = true). Fail closed on drift.
        if (!Array.isArray(rows) || rows.length > 1) fail(502, 'invalid_response', '테스트 테이블의 행 수가 예상과 달라요.');
        const match = /\/(\d+)$/.exec(response.headers.get('content-range') || '');
        const totalRows = match ? Number(match[1]) : null;
        if (totalRows !== null && (!Number.isSafeInteger(totalRows) || totalRows > 1)) fail(502, 'invalid_response', '테스트 테이블의 행 수가 예상과 달라요.');
        return { ok: true, source: 'supabase', readOnly: true, table: TABLE, rows: rows.map(publicRow),
          pagination: { page, pageSize: PAGE_SIZE, totalRows, hasNextPage: false }, fetchedAt: new Date(now()).toISOString() };
      } catch (error) {
        if (error instanceof ViewerError) throw error;
        if (controller.signal.aborted) fail(504, 'db_timeout', 'DB 응답 시간이 초과됐어요. 새로고침으로 다시 확인해 주세요.');
        fail(502, 'db_unreachable', 'DB에 연결하지 못했어요. 서버 설정을 확인해 주세요.');
      } finally { clearTimeout(timer); }
    },
  };
}

function registerAdminViewer(app, options = {}) {
  const service = makeService(options);
  const router = express.Router();
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' });
    if (!['GET', 'HEAD'].includes(req.method)) return res.set('Allow', 'GET, HEAD').status(405).json({ ok: false, error: 'read_only', message: '읽기 전용 화면이에요.' });
    next();
  });
  router.get('/tables', (req, res, next) => {
    try {
      if (Object.keys(req.query).length) fail(400, 'invalid_query', '테이블 목록에는 추가 옵션을 지정할 수 없어요.');
      res.json(service.catalog());
    } catch (error) { next(error); }
  });
  router.get(`/tables/${TABLE_NAME}`, async (req, res, next) => {
    try { res.json(await service.rows(readPage(req.query))); } catch (error) { next(error); }
  });
  router.use((req, res) => res.status(404).json({ ok: false, error: 'not_available', message: '공개 조회가 허용되지 않은 경로예요.' }));
  router.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
    if (error instanceof ViewerError) return res.status(error.status).json({ ok: false, error: error.code, message: error.message });
    res.status(500).json({ ok: false, error: 'request_failed', message: '조회 요청을 처리하지 못했어요.' });
  });
  app.use('/api/admin', router);
  app.use('/admin', (req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
    next();
  }, express.static(path.join(__dirname, 'public', 'admin')));
}

module.exports = registerAdminViewer;
module.exports.makeService = makeService;
module.exports.readPage = readPage;
module.exports.constants = { TABLE_NAME, TABLE_URL, PAGE_SIZE, MAX_PAGE };
