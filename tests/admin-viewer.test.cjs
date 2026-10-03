'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const register = require('../admin-viewer');
const { makeService, constants } = register;
const ENV = { SUPABASE_KEY: 'test-server-key-not-real' };
const NOW = () => Date.parse('2026-10-03T06:00:00Z');
const SAMPLE = '안녕 AltTab! DB 연결 테스트';
const row = (value = SAMPLE) => ({ id: true, value, updated_at: '2026-10-03T06:02:55.959+00:00' });
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/1', ...headers } });

async function httpServer(t, options = {}) {
  const app = express();
  register(app, { env: ENV, now: NOW, ...options });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('one fixed GET selects only allowed columns with bounded pagination and server-only key', async () => {
  const calls = [];
  const service = makeService({ env: ENV, now: NOW, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return json([{ ...row(), email: 'private@example.test', llm_claimed_at: 'hidden', password: 'hidden' }]);
  } });
  const result = await service.rows();
  const { url, options } = calls[0];
  assert.equal(calls.length, 1);
  assert.equal(options.method, 'GET');
  assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
  assert.equal(options.headers.apikey, ENV.SUPABASE_KEY);
  assert.equal(options.headers['Accept-Profile'], 'public');
  assert.equal(new URL(url).origin + new URL(url).pathname, constants.TABLE_URL);
  assert.equal(new URL(url).searchParams.get('select'), 'id,value,updated_at');
  assert.equal(new URL(url).searchParams.get('limit'), '25');
  assert.equal(new URL(url).searchParams.get('offset'), '0');
  assert.equal(new URL(url).searchParams.get('order'), 'updated_at.desc,id.asc');
  assert.deepEqual(result.rows, [{ id: true, value: SAMPLE, updated_at: '2026-10-03T06:02:55.959Z', valueRedacted: false }]);
  assert.equal(result.pagination.totalRows, 1);
  assert.equal(result.pagination.hasNextPage, false);
  for (const hidden of ['private@example.test', 'password', 'llm_claimed_at', ENV.SUPABASE_KEY]) assert.ok(!JSON.stringify(result).includes(hidden));
});

test('every unreviewed value is redacted, including credentials, PII, answers and markup', async () => {
  for (const value of ['ordinary new text', 'private@example.test', '010-1234-5678', 'API_KEY=super-secret', '<img src=x onerror=alert(1)>', '내 정답은 3번', '홍길동']) {
    const service = makeService({ env: ENV, now: NOW, fetchImpl: async () => json([row(value)]) });
    const result = await service.rows();
    assert.equal(result.rows[0].value, null);
    assert.equal(result.rows[0].valueRedacted, true);
    assert.ok(!JSON.stringify(result).includes(value));
  }
});

test('pagination is bounded and no raw query or table is forwarded', async (t) => {
  let calls = 0;
  const origin = await httpServer(t, { fetchImpl: async (url) => { calls++; assert.equal(new URL(url).searchParams.get('offset'), '2475'); return json([], 200, { 'Content-Range': '*/1' }); } });
  for (const query of ['page=0', 'page=-1', 'page=101', 'page=1.2', 'page=1&page=2', 'page[]=1', 'page=1e2', 'page=1&select=*', 'table=auth.users', 'sql=select+*', 'url=https://example.test']) {
    assert.equal((await fetch(`${origin}/api/admin/tables/${constants.TABLE_NAME}?${query}`)).status, 400, query);
  }
  for (const route of ['tables/auth.users', 'tables/users', 'sql', 'tables/__proto__']) assert.equal((await fetch(`${origin}/api/admin/${route}`)).status, 404);
  assert.equal(calls, 0);
  assert.equal((await fetch(`${origin}/api/admin/tables/${constants.TABLE_NAME}?page=100`)).status, 200);
  assert.equal(calls, 1);
});

test('all mutation methods are refused before any DB request', async (t) => {
  let calls = 0;
  const origin = await httpServer(t, { fetchImpl: async () => { calls++; return json([row()]); } });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await fetch(`${origin}/api/admin/tables/${constants.TABLE_NAME}`, { method });
    assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET, HEAD');
  }
  assert.equal(calls, 0);
});

test('missing key or mismatched target never sends a request', async () => {
  const fetchImpl = () => { assert.fail('must not send'); };
  await assert.rejects(makeService({ env: {}, fetchImpl }).rows(), { code: 'db_not_configured' });
  await assert.rejects(makeService({ env: { ...ENV, SUPABASE_URL: 'https://wrong-project.test' }, fetchImpl }).rows(), { code: 'db_target_mismatch' });
});

test('legacy JWT uses server-only Authorization; opaque key does not', async () => {
  for (const key of ['eyJ.test-fake-jwt', ENV.SUPABASE_KEY]) {
    const service = makeService({ env: { SUPABASE_KEY: key }, fetchImpl: async (url, options) => {
      assert.equal(options.headers.Authorization, key.startsWith('eyJ') ? `Bearer ${key}` : undefined);
      return json([row()]);
    } });
    assert.ok(!JSON.stringify(await service.rows()).includes(key));
  }
});

test('upstream errors and unexpected exceptions never disclose provider bodies or secrets', async (t) => {
  for (const status of [401, 403, 404, 500]) {
    const origin = await httpServer(t, { fetchImpl: async () => json({ secret: ENV.SUPABASE_KEY }, status) });
    const response = await fetch(`${origin}/api/admin/tables/${constants.TABLE_NAME}`);
    assert.ok(response.status >= 500);
    assert.ok(!(await response.text()).includes(ENV.SUPABASE_KEY));
  }
  const service = makeService({ env: ENV, fetchImpl: () => { throw new Error(ENV.SUPABASE_KEY); } });
  await assert.rejects(service.rows(), error => error.code === 'db_unreachable' && !error.message.includes(ENV.SUPABASE_KEY));
});

test('malformed, oversized or schema-drift responses fail closed', async () => {
  for (const fetchImpl of [
    async () => json({ secret: ENV.SUPABASE_KEY }),
    async () => json([row(), row()]),
    async () => json([{ ...row(), id: 'private-id' }]),
    async () => json([{ ...row(), updated_at: 'a secret instead of a timestamp' }]),
    async () => json([row('x'.repeat(201))]),
    async () => json([row()], 200, { 'Content-Range': '0-0/42' }),
    async () => new Response('not json'),
    async () => new Response('x'.repeat(16385)),
  ]) {
    await assert.rejects(makeService({ env: ENV, fetchImpl }).rows(), { code: 'invalid_response' });
  }
});

test('empty DB remains empty and status/catalog do not claim connectivity', async (t) => {
  let calls = 0;
  const origin = await httpServer(t, { fetchImpl: async () => { calls++; return json([], 200, { 'Content-Range': '*/0' }); } });
  const catalog = await (await fetch(`${origin}/api/admin/tables`)).json();
  assert.equal(calls, 0); assert.equal(catalog.tables.length, 1);
  assert.equal(catalog.source, undefined);
  assert.deepEqual(catalog.tables[0].columns.map(c => c.name), ['id', 'value', 'updated_at']);
  assert.equal((await fetch(`${origin}/api/admin/tables?select=*`)).status, 400);
  const result = await (await fetch(`${origin}/api/admin/tables/${constants.TABLE_NAME}`)).json();
  assert.deepEqual(result.rows, []); assert.equal(result.pagination.totalRows, 0);
});

test('public page/assets have CSP, no cache, no indexing and no secret or HTML insertion', async (t) => {
  const origin = await httpServer(t, { fetchImpl: async () => json([row()]) });
  const response = await fetch(`${origin}/admin/`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await response.text(), /저장된 데이터 보기/);
  const script = await (await fetch(`${origin}/admin/app.js`)).text();
  assert.ok(!script.includes('innerHTML')); assert.ok(!script.includes('SUPABASE_KEY'));
  assert.equal((await fetch(`${origin}/admin/admin-viewer.js`)).status, 404);
  const api = await fetch(`${origin}/api/admin/tables`);
  assert.equal(api.headers.get('cache-control'), 'no-store');
  assert.equal(api.headers.get('access-control-allow-origin'), null);
});
