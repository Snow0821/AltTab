import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { JSDOM } = await import(process.env.JSDOM_MODULE || 'jsdom');
const html = fs.readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../public/admin/app.js', import.meta.url), 'utf8');
const waitFor = async (fn) => { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 5)); } assert.ok(fn()); };
const payload = (rows = [{ id: true, value: '안녕 AltTab! DB 연결 테스트', valueRedacted: false, updated_at: '2026-10-03T06:02:55.959Z' }]) => ({ ok: true, source: 'supabase', rows, pagination: { page: 1, pageSize: 25, totalRows: rows.length, hasNextPage: false }, fetchedAt: '2026-10-03T06:20:00.000Z' });
const response = (data, ok = true) => ({ ok, json: async () => data });
function setup(t, fetchImpl, fastTimeout = false) {
  const dom = new JSDOM(html, { url: 'https://alt-tab-mu.vercel.app/admin/', runScripts: 'outside-only' });
  if (fastTimeout) {
    const original = dom.window.setTimeout.bind(dom.window);
    dom.window.setTimeout = (fn, delay) => original(fn, delay === 12000 ? 1 : delay);
  }
  dom.window.fetch = fetchImpl; dom.window.eval(source);
  t.after(() => dom.window.close());
  return { q: (id) => dom.window.document.getElementById(id), click: (id) => dom.window.document.getElementById(id).click(), dom };
}

test('loads actual API once, displays KST/count/value and refresh ignores repeated clicks', async (t) => {
  let calls = 0; let finish;
  const ctx = setup(t, async (url, options) => {
    calls++; assert.equal(url, '/api/admin/tables/alttab_connection_test?page=1'); assert.equal(options.method, 'GET');
    if (calls === 2) return new Promise(resolve => { finish = () => resolve(response(payload())); });
    return response(payload());
  });
  await waitFor(() => !ctx.q('refresh').disabled);
  assert.equal(calls, 1); assert.equal(ctx.q('connection-state').textContent, 'Supabase 연결됨');
  assert.equal(ctx.q('row-count').textContent, '1행');
  assert.match(ctx.q('rows').textContent, /안녕 AltTab!/); assert.match(ctx.q('rows').textContent, /15:02:55/);
  assert.equal(ctx.q('next').disabled, true); assert.equal(ctx.q('previous').disabled, true);
  ctx.click('refresh'); ctx.click('refresh'); ctx.click('table-select');
  assert.equal(calls, 2); assert.equal(ctx.q('refresh').disabled, true);
  assert.ok(!ctx.q('rows').textContent.includes('안녕 AltTab!'));
  finish(); await waitFor(() => !ctx.q('refresh').disabled); assert.equal(calls, 2);
});

test('renders ordinary markup as text and displays server-masked portions without hiding the whole value', async (t) => {
  const ctx = setup(t, async () => response(payload([{ id: true, value: '<img src=x onerror=alert(1)>', valueRedacted: false, updated_at: '2026-10-03T06:00:00Z' }])));
  await waitFor(() => !ctx.q('refresh').disabled);
  assert.equal(ctx.q('rows').querySelector('img'), null); assert.match(ctx.q('rows').textContent, /<img/);
  ctx.dom.window.fetch = async () => response(payload([{ id: true, value: '테스트 문장 password=[비밀값 숨김] 끝', valueRedacted: true, updated_at: '2026-10-03T06:00:00Z' }]));
  ctx.click('refresh'); await waitFor(() => !ctx.q('refresh').disabled);
  assert.match(ctx.q('rows').textContent, /테스트 문장 password=\[비밀값 숨김\] 끝/);
  assert.match(ctx.q('status').textContent, /감지된 키·비밀번호만/);
});

test('empty data, provider error, network error and successful manual retry are distinct', async (t) => {
  const ctx = setup(t, async () => response(payload([])));
  await waitFor(() => !ctx.q('refresh').disabled);
  assert.equal(ctx.q('row-count').textContent, '0행'); assert.match(ctx.q('rows').textContent, /아직 저장된 데이터가 없어요/);
  ctx.dom.window.fetch = async () => response({ ok: false, message: '서버 DB 키의 인증·조회 권한을 확인해 주세요.' }, false);
  ctx.click('refresh'); await waitFor(() => !ctx.q('refresh').disabled);
  assert.equal(ctx.q('connection-state').textContent, '조회 실패'); assert.equal(ctx.q('row-count').textContent, '—');
  assert.match(ctx.q('status').textContent, /인증·조회 권한/);
  ctx.dom.window.fetch = async () => { throw new Error('Network unavailable'); };
  ctx.click('refresh'); await waitFor(() => !ctx.q('refresh').disabled); assert.match(ctx.q('status').textContent, /Network unavailable/);
  ctx.dom.window.fetch = async () => response(payload());
  ctx.click('refresh'); await waitFor(() => !ctx.q('refresh').disabled); assert.equal(ctx.q('connection-state').textContent, 'Supabase 연결됨');
});

test('pagination disables during requests and returns to first page without duplicated requests', async (t) => {
  const calls = [];
  const ctx = setup(t, async (url) => {
    calls.push(url);
    const data = payload();
    data.pagination.hasNextPage = url.endsWith('page=1');
    return response(data);
  });
  await waitFor(() => !ctx.q('refresh').disabled);
  ctx.click('next'); ctx.click('next'); await waitFor(() => !ctx.q('refresh').disabled);
  assert.match(ctx.q('page-info').textContent, /페이지 2/); assert.equal(ctx.q('next').disabled, true);
  ctx.click('previous'); await waitFor(() => !ctx.q('refresh').disabled);
  assert.match(ctx.q('page-info').textContent, /페이지 1/); assert.equal(ctx.q('previous').disabled, true);
  assert.deepEqual(calls, ['/api/admin/tables/alttab_connection_test?page=1', '/api/admin/tables/alttab_connection_test?page=2', '/api/admin/tables/alttab_connection_test?page=1']);
});

test('stalled browser request times out, unlocks controls and does not retry automatically', async (t) => {
  let calls = 0;
  const ctx = setup(t, (url, options) => {
    calls++;
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  }, true);
  await waitFor(() => !ctx.q('refresh').disabled);
  assert.equal(calls, 1); assert.match(ctx.q('status').textContent, /조회 시간이 초과/);
  assert.equal(ctx.q('connection-state').textContent, '조회 실패');
});
