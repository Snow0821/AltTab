const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const register = require('../v2');
const ai = require('../v2-ai');
const { memoryStore, questions } = require('./v2-fixture.cjs');

test('shared exam: server grading, private answer keys, cookie isolation, immutable first result, ties, and reload', async () => {
  const app = express(), store = memoryStore(), env = { KOOKMIN_KEY: 'fixture-not-a-key' }; let calls = 0;
  register(app, { store, env, generate: async () => { calls++; return questions; } });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  env.PORT = String(server.address().port); const base = `http://127.0.0.1:${env.PORT}`;
  async function user() {
    const init = await fetch(`${base}/api/v2/exams`);
    const cookie = init.headers.get('set-cookie').split(';')[0];
    assert.match(init.headers.get('set-cookie'), /HttpOnly/);
    return async (route, body, origin = base) => {
      const response = await fetch(`${base}/api/v2${route}`, { headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
      return { status: response.status, data: await response.json() };
    };
  }
  try {
    const a = await user(), b = await user(), c = await user(), id = store.sample.id;
    const view = await a(`/exams/${id}`);
    assert.equal(view.status, 200); assert.equal(view.data.attempt, null);
    assert.equal(JSON.stringify(view).includes('answerIndex'), false); assert.equal(JSON.stringify(view).includes('explanation'), false);
    assert.equal((await a(`/exams/${id}/start`, { nickname: 'A' }, 'https://evil.invalid')).status, 403);
    assert.equal((await a('/exams/not-an-id')).status, 404);
    assert.equal((await a(`/exams/${id}/submit`, { answers: {} })).status, 409);
    await Promise.all([a(`/exams/${id}/start`, { nickname: 'A' }), a(`/exams/${id}/start`, { nickname: 'A' })]);
    assert.equal(store.attempts.size, 1);
    assert.equal((await b(`/exams/${id}`)).data.attempt, null);
    assert.equal((await a(`/exams/${id}/submit`, { answers: { q1: 1 } })).status, 400);
    const allRight = Object.fromEntries(questions.map(q => [q.id, q.answerIndex]));
    const lower = { ...allRight, q1: 0 };
    const first = await a(`/exams/${id}/submit`, { answers: lower, score: 9999 });
    assert.equal(first.data.result.score, 80); assert.equal(first.data.result.correct, 4);
    const repeated = await a(`/exams/${id}/submit`, { answers: allRight });
    assert.deepEqual(repeated.data.result, first.data.result);
    assert.deepEqual((await a(`/exams/${id}`)).data.attempt.result, first.data.result);
    for (const [client, name] of [[b, 'B'], [c, 'C']]) {
      await client(`/exams/${id}/start`, { nickname: name });
      await client(`/exams/${id}/submit`, { answers: allRight });
    }
    const board = (await a(`/exams/${id}/ranking`)).data;
    assert.equal(board.participants, 3); assert.deepEqual(board.rows.map(r => r.position), [1, 1, 3]);
    assert.equal(board.mine.position, 3); assert.equal(JSON.stringify(board).includes('participant_key'), false);
    const source = { title: '공유 시험', pages: [{ page: 1, text: '교안 내용과 근거 문장입니다. '.repeat(30) }] };
    const created = await a('/exams', source); assert.equal(created.status, 201);
    assert.equal((await a('/exams', source)).data.id, created.data.id); assert.equal(calls, 1);
    assert.equal((await b(`/exams/${created.data.id}`)).data.exam.title, source.title);
    assert.equal((await b(`/exams/${created.data.id}/ranking`)).data.participants, 0);
    const html = await fetch(`${base}/v2/`); assert.equal(html.status, 200);
    assert.match(await html.text(), /PassFinder/); assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('generation validates range and source evidence; provider errors cannot expose keys or raw responses', async () => {
  assert.throws(() => ai.input({ title: '시험', pages: [] }));
  assert.throws(() => ai.input({ title: '시험', pages: [{ page: 1, text: '짧음' }] }));
  assert.throws(() => ai.input({ title: '시험', pages: [{ page: 1, text: 'a'.repeat(300) }, { page: 1, text: 'b'.repeat(300) }] }));
  const quote = '스택은 마지막에 넣은 자료를 가장 먼저 꺼내는 자료구조입니다.';
  const source = ai.input({ title: '자료구조', pages: [{ page: 1, text: quote.repeat(12) }] });
  const generated = questions.map(q => ({ ...q, answer_index: q.answerIndex, evidence: { page: 1, quote } }));
  let request;
  const fetchImpl = async (url, options) => { request = { url, options }; return Response.json({ content: [{ type: 'text', text: JSON.stringify({ questions: generated }) }] }); };
  const data = await ai.generate(source, { env: { KOOKMIN_KEY: 'private-test-key' }, fetchImpl });
  assert.equal(data.length, 5); assert.equal(JSON.parse(request.options.body).max_tokens, 3000);
  assert.equal(request.options.headers['x-api-key'], 'private-test-key');
  assert.equal(JSON.stringify(data).includes('private-test-key'), false);
  generated[0].evidence.quote = '교안에 없는 근거 문장이니 거부해야 합니다.';
  await assert.rejects(ai.generate(source, { env: { KOOKMIN_KEY: 'private-test-key' }, fetchImpl }), /근거/);
  await assert.rejects(ai.generate(source, { env: { KOOKMIN_KEY: 'private-test-key' }, fetchImpl: async () => new Response('private-test-key', { status: 401 }) }), error => error.status === 502 && !error.message.includes('private-test-key'));
});
