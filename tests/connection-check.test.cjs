'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const register = require('../connection-check');
const { makeService, constants } = register;
const NOW = () => Date.parse('2026-10-03T06:00:00Z');
const ENV = { SUPABASE_KEY: 'test-db-secret-not-real', KOOKMIN_KEY: 'test-school-secret-not-real' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function fakeProvider(options = {}) {
  let row = options.row || null;
  const calls = [];
  const fetchImpl = async (url, request) => {
    calls.push({ url, request });
    assert.equal(request.redirect, 'error');
    assert.equal(request.cache, 'no-store');
    if (url === constants.LLM_URL) {
      if (options.llmError) return json({ error: { message: ENV.KOOKMIN_KEY } }, 500);
      if (options.throwSecret) throw new Error(ENV.KOOKMIN_KEY);
      return json({ content: [{ type: 'thinking', text: 'hidden' }, { type: 'text', text: '안녕하세요!' }], usage: { input_tokens: 10, output_tokens: 6 }, stop_reason: 'end_turn' });
    }
    assert.ok(url.startsWith(constants.TABLE_URL));
    if (request.method === 'POST') {
      const input = JSON.parse(request.body);
      assert.deepEqual(Object.keys(input).sort(), ['id', 'updated_at', 'value']);
      row = { llm_claimed_at: null, ...row, ...input };
      return new Response(null, { status: 204 });
    }
    if (request.method === 'PATCH') {
      if (!row || row.llm_claimed_at) return json([]);
      row.llm_claimed_at = JSON.parse(request.body).llm_claimed_at;
      return json([{ id: true }]);
    }
    return json(row ? [{ value: options.mismatch ? 'different' : row.value }] : []);
  };
  return { fetchImpl, calls, getRow: () => row };
}

async function httpServer(t, options = {}) {
  const app = express();
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const env = { ...ENV, PORT: String(port), ...(options.env || {}) };
  register(app, { env, now: NOW, ...options });
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    post: (route, body, headers = {}) => fetch(`${origin}/api/mock/${route}`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    }),
  };
}

test('DB performs an actual write followed by a separate exact-match read with secrets only in outbound headers', async () => {
  const fake = fakeProvider();
  const service = makeService({ env: ENV, now: NOW, fetchImpl: fake.fetchImpl });
  const result = await service.saveAndRead(' 한글 <script>test</script> ');
  assert.equal(result.exactMatch, true);
  assert.equal(result.value, ' 한글 <script>test</script> ');
  assert.deepEqual(fake.calls.map(c => c.request.method), ['POST', 'GET']);
  assert.equal(fake.calls[0].request.headers.apikey, ENV.SUPABASE_KEY);
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('DB mismatch never returns a successful fake response', async () => {
  const fake = fakeProvider({ mismatch: true });
  await assert.rejects(makeService({ env: ENV, now: NOW, fetchImpl: fake.fetchImpl }).saveAndRead('test'), { code: 'db_value_mismatch' });
});

test('missing key or wrong project prevents outbound requests', async () => {
  const neverFetch = () => { throw new Error('should not fetch'); };
  await assert.rejects(makeService({ env: {}, fetchImpl: neverFetch }).saveAndRead('test'), { code: 'db_not_configured' });
  await assert.rejects(makeService({ env: { ...ENV, SUPABASE_URL: 'https://evil.example' }, fetchImpl: neverFetch }).saveAndRead('test'), { code: 'db_target_mismatch' });
});

test('LLM is one global atomic call across concurrent server instances and DB saves never reset it', async () => {
  const fake = fakeProvider({ row: { id: true, value: 'test', llm_claimed_at: null } });
  const a = makeService({ env: ENV, now: NOW, fetchImpl: fake.fetchImpl });
  const b = makeService({ env: ENV, now: NOW, fetchImpl: fake.fetchImpl });
  const results = await Promise.allSettled([a.chat('안녕'), b.chat('안녕')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const result = results.find(r => r.status === 'fulfilled').value;
  assert.equal(result.reply, '안녕하세요!');
  assert.equal(result.source, 'school-ai');
  const llm = fake.calls.filter(c => c.url === constants.LLM_URL);
  assert.equal(llm.length, 1);
  assert.equal(llm[0].request.headers['x-api-key'], ENV.KOOKMIN_KEY);
  assert.deepEqual(JSON.parse(llm[0].request.body), { model: 'claude-haiku-4-5', max_tokens: 32, stream: false, messages: [{ role: 'user', content: '안녕' }] });
  await a.saveAndRead('next input');
  await assert.rejects(b.chat('again'), { code: 'llm_allowance_unavailable' });
  assert.equal(fake.calls.filter(c => c.url === constants.LLM_URL).length, 1);
});

test('uncertain provider failure consumes the claim and redacts upstream error/secret', async () => {
  for (const mode of ['llmError', 'throwSecret']) {
    const fake = fakeProvider({ row: { id: true, value: 'test', llm_claimed_at: null }, [mode]: true });
    const service = makeService({ env: ENV, now: NOW, fetchImpl: fake.fetchImpl });
    await assert.rejects(service.chat('test'), (error) => !error.message.includes('secret'));
    assert.ok(fake.getRow().llm_claimed_at);
    await assert.rejects(service.chat('retry'), { code: 'llm_allowance_unavailable' });
    assert.equal(fake.calls.filter(c => c.url === constants.LLM_URL).length, 1);
  }
});

test('chat requires the DB row and a school key before it can make a paid call', async () => {
  const fake = fakeProvider();
  await assert.rejects(makeService({ env: ENV, fetchImpl: fake.fetchImpl }).chat('test'), { code: 'llm_allowance_unavailable' });
  await assert.rejects(makeService({ env: { SUPABASE_KEY: ENV.SUPABASE_KEY }, fetchImpl: fake.fetchImpl }).chat('test'), { code: 'llm_not_configured' });
  assert.equal(fake.calls.filter(c => c.url === constants.LLM_URL).length, 0);
});

test('a DB claim finishing after the cutoff cannot start a paid call', async () => {
  let time = Date.parse(constants.DEMO_END) - 1;
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    time += 2;
    return json([{ id: true }]);
  };
  const service = makeService({ env: ENV, now: () => time, fetchImpl });
  await assert.rejects(service.chat('test'), { code: 'demo_expired' });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith(constants.TABLE_URL));
});

test('HTTP rejects cross-origin, absent-origin, non-POST, non-JSON, query, oversized and arbitrary fields before provider calls', async (t) => {
  const fake = fakeProvider();
  const server = await httpServer(t, { fetchImpl: fake.fetchImpl });
  assert.equal((await server.post('db', { value: 'test' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await server.post('db', { value: 'test' }, { Origin: '' })).status, 403);
  assert.equal((await server.post('db', { value: 'test' }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await fetch(`${server.origin}/api/mock/db`)).status, 405);
  assert.equal((await server.post('db', { value: 'test' }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await server.post('db?url=https://evil.example', { value: 'test' })).status, 400);
  assert.equal((await server.post('db', { value: 'x'.repeat(3000) })).status, 413);
  for (const payload of [{}, { value: '' }, { value: '  ' }, { value: 5 }, { value: 'x'.repeat(201) }, { value: 'ok', url: 'https://evil.example' }]) {
    assert.equal((await server.post('db', payload)).status, 400);
  }
  assert.equal(fake.calls.length, 0);
});

test('HTTP returns precise live DB result and safely serves mock assets', async (t) => {
  const fake = fakeProvider();
  const server = await httpServer(t, { fetchImpl: fake.fetchImpl });
  const status = await (await server.post('status', {})).json();
  assert.equal(status.db.tested, false);
  assert.equal(status.llm.maxCalls, 1);
  const result = await server.post('db', { value: '<b>synthetic</b>' });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await result.json()).value, '<b>synthetic</b>');
  const page = await fetch(`${server.origin}/mock/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await page.text(), /연결 테스트/);
  const script = await (await fetch(`${server.origin}/mock/app.js`)).text();
  assert.ok(!script.includes('innerHTML'));
  assert.ok(!script.includes(ENV.SUPABASE_KEY));
});

test('after demo cutoff status remains truthful but every write and paid request stops', async (t) => {
  const fake = fakeProvider();
  const server = await httpServer(t, { now: () => Date.parse(constants.DEMO_END), fetchImpl: fake.fetchImpl });
  assert.equal((await (await server.post('status', {})).json()).expired, true);
  assert.equal((await server.post('db', { value: 'test' })).status, 410);
  assert.equal((await server.post('chat', { message: 'test' })).status, 410);
  assert.equal(fake.calls.length, 0);
});

test('parser errors and database/provider errors never reflect request or provider secrets', async (t) => {
  const fakeFetch = async () => json({ message: ENV.SUPABASE_KEY }, 401);
  const server = await httpServer(t, { fetchImpl: fakeFetch });
  const response = await server.post('db', { value: 'test' });
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.ok(!body.includes('test-db-secret'));
  const malformed = await fetch(`${server.origin}/api/mock/db`, { method: 'POST', headers: { Origin: server.origin, 'Content-Type': 'application/json' }, body: '{"value":"secret-malformed' });
  assert.equal(malformed.status, 400);
  assert.ok(!(await malformed.text()).includes('secret-malformed'));
});
