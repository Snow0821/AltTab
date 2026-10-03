import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { JSDOM } = await import(process.env.JSDOM_MODULE || 'jsdom');
const source = fs.readFileSync(new URL('../../public/exam-workspace/make.mjs', import.meta.url), 'utf8');
const token = 'a'.repeat(43);
const question = { id: 'q1', body: '서버 저장 검사', choices: ['정답', '오답'], answerIndex: 0, explanation: '검사용 해설', evidence: { page: 1, quote: '검사용 근거' } };
const set = { title: '[검사] 저장', source: 'school-ai', questions: [question] };
const metadata = { setId: 'set-1', shareCode: 'abcd2345', title: set.title, source: set.source, questionCount: 1 };
const result = { ok: true, status: 'graded', attemptId: 'attempt-1', gradedAt: new Date().toISOString(), questionCount: 1, correctCount: 0, details: [{ questionId: 'q1', answer: 1, correct: false, answerIndex: 0, explanation: question.explanation, evidence: question.evidence }] };

function open(store = new Map([['pf.make.sets', JSON.stringify({ fixture: set })]]), fail = {}) {
  const dom = new JSDOM('<main id="app"></main>', { url: 'https://study.test/make.mjs', runScripts: 'outside-only' });
  const calls = [];
  Object.defineProperty(dom.window, 'localStorage', { value: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) } });
  dom.window.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (fail[url]) return { ok: false, json: async () => ({ ok: false, message: '저장 연결 실패' }) };
    let body;
    if (url === '/api/participants') body = { participantToken: token };
    else if (url === '/api/question-sets' && options.method === 'POST') body = metadata;
    else if (url === '/api/question-sets') body = { authored: [metadata], attempted: [{ ...metadata, attemptId: 'attempt-1', status: 'graded', correctCount: 0 }] };
    else if (url === '/api/question-sets/set-1/attempts') body = { attemptId: 'attempt-1', storage: 'supabase' };
    else if (url === '/api/shared-exams/abcd2345') body = { ...metadata, storage: 'supabase', questions: [{ id: question.id, body: question.body, choices: question.choices }] };
    else if (url === '/api/attempts/attempt-1/answers' || url === '/api/attempts/attempt-1') body = result;
    else throw new Error(`Unexpected request: ${url}`);
    return { ok: true, json: async () => ({ ok: true, ...body }) };
  };
  dom.window.eval(source.replaceAll('import.meta.url', JSON.stringify('https://study.test/make.mjs')).replaceAll('export function ', 'function '));
  const q = s => dom.window.document.querySelector(s);
  return { dom, q, calls, store, text: () => q('#app').textContent,
    async settle() { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); },
    answer() { const radio = q('input[value="1"]'); radio.checked = true; radio.dispatchEvent(new dom.window.Event('change')); },
  };
}

test('generated set saves once; failed grading preserves answers and retries the same attempt', async () => {
  const fail = { '/api/attempts/attempt-1/answers': true };
  const c = open(undefined, fail);
  c.q('[data-open]').click(); await c.settle();
  assert.match(c.text(), /문제가 서버에 저장됐어요/);
  assert.equal(c.store.get('pf.participant'), JSON.stringify(token));
  c.answer(); c.q('#submit').click(); await c.settle();
  assert.match(c.text(), /답안은 그대로/);
  assert.equal(c.q('input[value="1"]').checked, true);
  assert.equal(c.q('.score'), null);
  fail['/api/attempts/attempt-1/answers'] = false;
  c.q('#submit').click(); await c.settle();
  assert.match(c.text(), /0 \/ 1 정답/);
  assert.match(c.text(), /서버에 저장됨/);
  assert.equal(c.calls.filter(x => x.url === '/api/question-sets' && x.options.method === 'POST').length, 1);
  assert.equal(c.calls.filter(x => x.url.endsWith('/attempts')).length, 1);
  assert.deepEqual(JSON.parse(c.calls.find(x => x.url.endsWith('/answers')).options.body), { answers: { q1: 1 } });
  assert.ok(c.calls.filter(x => x.url !== '/api/participants').every(x => x.options.headers['X-Participant-Token'] === token));
  c.dom.window.close();
  const reopened = open(c.store); await reopened.settle();
  assert.match(reopened.text(), /0 \/ 1 정답/);
  assert.ok(reopened.calls.some(x => x.url === '/api/attempts/attempt-1'));
  reopened.dom.window.close();
});

test('failed set save retries without another AI call or losing questions', async () => {
  const fail = { '/api/question-sets': true };
  const c = open(undefined, fail);
  c.q('[data-open]').click(); await c.settle();
  assert.ok(c.q('#retry-save'));
  assert.match(c.text(), /문제가 서버에 저장되지 않았어요/);
  fail['/api/question-sets'] = false;
  c.q('#retry-save').click(); await c.settle();
  assert.match(c.text(), /문제가 서버에 저장됐어요/);
  assert.ok(c.q('input[name="q1"]'));
  assert.equal(c.calls.some(x => x.url === '/api/generate'), false);
  c.dom.window.close();
});

test('server list restores graded result with only participant token left in browser', async () => {
  const c = open(new Map([['pf.participant', JSON.stringify(token)]]));
  await c.settle();
  c.q('[data-remote]').click(); await c.settle();
  assert.match(c.text(), /0 \/ 1 정답/);
  assert.match(c.text(), /서버에 저장됨/);
  assert.match(c.text(), /검사용 해설/);
  c.q('#review').click(); c.answer(); c.q('#submit').click(); await c.settle();
  assert.match(c.text(), /이 브라우저에 저장됨/);
  assert.equal(c.calls.some(x => x.url.endsWith('/answers')), false);
  c.dom.window.close();
});
