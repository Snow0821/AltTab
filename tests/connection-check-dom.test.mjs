import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { JSDOM } = await import(process.env.JSDOM_MODULE || 'jsdom');
const html = fs.readFileSync(new URL('../public/connection-check/index.html', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../public/connection-check/app.js', import.meta.url), 'utf8');
const waitFor = async (fn) => { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 5)); } assert.ok(fn()); };
function setup(fetchImpl) {
  const dom = new JSDOM(html, { url: 'https://alt-tab-mu.vercel.app/mock/', runScripts: 'outside-only' });
  dom.window.fetch = fetchImpl;
  dom.window.eval(source);
  return { dom, q: (selector) => dom.window.document.querySelector(selector), submit: (id) => dom.window.document.getElementById(id).dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })) };
}
const status = { ok: true, db: { configured: true }, llm: { configured: true }, expired: false };
const response = (data, ok = true) => ({ ok, json: async () => data });

test('UI sequences DB then AI, prevents double submits, and renders values as text', async (t) => {
  const calls = [];
  let finishDb;
  const ctx = setup(async (url, options) => {
    calls.push(url);
    if (url.endsWith('/status')) return response(status);
    if (url.endsWith('/db')) return new Promise(resolve => { finishDb = () => resolve(response({ ok: true, source: 'supabase', exactMatch: true, value: JSON.parse(options.body).value })); });
    return response({ ok: true, source: 'school-ai', reply: '<img src=x onerror=alert(1)>', model: 'claude-haiku-4-5', usage: { inputTokens: 10, outputTokens: 8 } });
  });
  t.after(() => ctx.dom.window.close());
  await waitFor(() => !ctx.q('#db-submit').disabled);
  assert.equal(ctx.q('#llm-submit').disabled, true);
  ctx.q('#db-value').value = '<script>bad()</script>';
  ctx.submit('db-form'); ctx.submit('db-form');
  assert.equal(ctx.q('#db-submit').disabled, true);
  assert.equal(calls.filter(c => c.endsWith('/db')).length, 1);
  finishDb();
  await waitFor(() => !ctx.q('#llm-submit').disabled);
  assert.match(ctx.q('#db-result').textContent, /정확히 일치/);
  assert.equal(ctx.q('#db-result script'), null);
  ctx.submit('llm-form'); ctx.submit('llm-form');
  await waitFor(() => ctx.q('#llm-badge').textContent === '실제 AI 확인');
  assert.equal(calls.filter(c => c.endsWith('/chat')).length, 1);
  assert.equal(ctx.q('#llm-result img'), null);
  assert.match(ctx.q('#llm-result').textContent, /<img/);
  assert.equal(ctx.q('#llm-submit').disabled, true);
});

test('failed DB preserves input and keeps AI disabled; no made-up success', async (t) => {
  const ctx = setup(async url => url.endsWith('/status') ? response(status) : response({ ok: false, message: 'DB 테이블 없음' }, false));
  t.after(() => ctx.dom.window.close());
  await waitFor(() => !ctx.q('#db-submit').disabled);
  ctx.q('#db-value').value = 'keep this';
  ctx.submit('db-form');
  await waitFor(() => ctx.q('#db-badge').textContent === '확인 실패');
  assert.equal(ctx.q('#db-value').value, 'keep this');
  assert.equal(ctx.q('#llm-submit').disabled, true);
  assert.equal(ctx.q('#db-submit').disabled, false);
});

test('expired page and missing keys never enable outbound test buttons', async (t) => {
  for (const payload of [{ ...status, expired: true }, { ...status, db: { configured: false }, llm: { configured: false } }]) {
    const ctx = setup(async () => response(payload));
    t.after(() => ctx.dom.window.close());
    await waitFor(() => !ctx.q('#configuration').textContent.includes('확인 중'));
    assert.equal(ctx.q('#db-submit').disabled, true);
    assert.equal(ctx.q('#llm-submit').disabled, true);
  }
});

test('uncertain AI failure is shown and cannot be automatically or repeatedly retried', async (t) => {
  let chatCalls = 0;
  const ctx = setup(async (url, options) => {
    if (url.endsWith('/status')) return response(status);
    if (url.endsWith('/db')) return response({ ok: true, source: 'supabase', exactMatch: true, value: JSON.parse(options.body).value });
    chatCalls++;
    return response({ ok: false, message: '학교 AI에 닿지 못했어요' }, false);
  });
  t.after(() => ctx.dom.window.close());
  await waitFor(() => !ctx.q('#db-submit').disabled);
  ctx.submit('db-form');
  await waitFor(() => !ctx.q('#llm-submit').disabled);
  ctx.submit('llm-form');
  await waitFor(() => ctx.q('#llm-badge').textContent === '확인 실패');
  ctx.submit('llm-form');
  assert.equal(chatCalls, 1);
  assert.equal(ctx.q('#llm-submit').disabled, true);
  assert.match(ctx.q('#llm-result').textContent, /다시 보내지 않아요/);
});
