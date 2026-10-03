import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { JSDOM } = await import(process.env.JSDOM_MODULE || 'jsdom');
const source = fs.readFileSync(new URL('../../public/exam-workspace/make.mjs', import.meta.url), 'utf8');

function open(store = new Map(), { course = '', blocked = new Set() } = {}) {
  const url = `https://study.test/make.mjs${course ? `?course=${course}` : ''}`;
  const dom = new JSDOM('<div id="app"></div>', { url, runScripts: 'outside-only' });
  Object.defineProperty(dom.window, 'localStorage', { value: {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => {
      if (blocked.has('*') || blocked.has(key)) throw new Error('Storage unavailable');
      store.set(key, value);
    },
  } });
  dom.window.eval(source.replaceAll('import.meta.url', JSON.stringify(url)).replace('export function mount', 'function mount') + '\nmount(document.getElementById("app"));');
  const q = selector => dom.window.document.querySelector(selector);
  return { dom, store, blocked, q, text: () => q('#app').textContent,
    answer: (id, value) => {
      const radio = q(`input[name="${id}"][value="${value}"]`);
      assert.ok(radio, `Missing answer ${id}:${value}`);
      radio.checked = true;
      radio.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    },
  };
}
const answers = { s1: 1, s2: 0, s3: 0, s4: 1, s5: 2 };
function complete(c, wrong = false) {
  for (const [id, value] of Object.entries(answers)) c.answer(id, wrong && id === 's5' ? 0 : value);
  c.q('#submit').click();
}

test('partial answers including choice zero survive reload and courses stay isolated', () => {
  const a = open(new Map(), { course: 'course-a' });
  a.q('#sample').click(); a.answer('s1', 1); a.answer('s2', 0); a.dom.window.close();
  const b = open(a.store, { course: 'course-a' });
  assert.equal(b.q('input[name="s1"][value="1"]').checked, true);
  assert.equal(b.q('input[name="s2"][value="0"]').checked, true);
  assert.equal(b.q('#submit').disabled, true);
  const other = open(a.store, { course: 'course-b' });
  assert.ok(other.q('#sample')); assert.equal(other.q('#submit'), null);
  b.dom.window.close(); other.dom.window.close();
});

test('review reload keeps only the wrong question and its pending answer', () => {
  const a = open(); a.q('#sample').click(); complete(a, true); a.q('#review').click();
  a.answer('s5', 2); a.dom.window.close();
  const b = open(a.store);
  assert.equal(b.dom.window.document.querySelectorAll('fieldset').length, 1);
  assert.equal(b.q('input[name="s5"][value="2"]').checked, true);
  assert.equal(b.q('#submit').disabled, false);
  b.dom.window.close();
});

test('saved result reload does not append attempts and restart clears answers', () => {
  const a = open(); a.q('#sample').click(); complete(a); a.dom.window.close();
  const b = open(a.store);
  assert.match(b.text(), /5 \/ 5 정답/);
  assert.equal(JSON.parse(a.store.get('pf.make.attempts')).length, 1);
  b.q('#again').click(); b.dom.window.close();
  const c = open(a.store);
  assert.equal(c.dom.window.document.querySelectorAll('input:checked').length, 0);
  assert.equal(c.q('#submit').disabled, true); c.dom.window.close();
});

test('invalid stored choices and unknown question IDs cannot count as answered', () => {
  const store = new Map([['pf.make.last', JSON.stringify({ key: 'sample', mode: 'all', answers: { s1: -1, s2: 4, s3: '0', s4: null, s5: 2, unknown: 0 } })]]);
  const a = open(store);
  assert.match(a.text(), /1 \/ 5문항 답함/);
  assert.equal(a.q('input[name="s5"][value="2"]').checked, true);
  assert.equal(a.q('#submit').disabled, true); a.dom.window.close();
});

test('older last-screen records without answers still open', () => {
  const a = open(new Map([['pf.make.last', JSON.stringify({ key: 'sample', mode: 'all' })]]));
  assert.match(a.text(), /0 \/ 5문항 답함/); a.dom.window.close();
});

test('draft storage failure preserves the visible answer and warns the learner', () => {
  const a = open(); a.q('#sample').click(); a.blocked.add('*'); a.answer('s2', 0);
  assert.equal(a.q('input[name="s2"][value="0"]').checked, true);
  assert.match(a.q('[role="alert"]')?.textContent || '', /저장하지 못/);
  a.dom.window.close();
});

test('failed result save cannot restore an older result or review its wrong answers', () => {
  const a = open(); a.q('#sample').click(); complete(a);
  a.q('#again').click(); a.blocked.add('pf.make.attempts'); complete(a, true);
  assert.match(a.text(), /4 \/ 5 정답/);
  const b = open(a.store);
  assert.ok(b.q('#submit')); assert.equal(b.q('.score'), null);
  a.q('#review').click();
  assert.equal(a.dom.window.document.querySelectorAll('fieldset').length, 1);
  assert.ok(a.q('input[name="s5"]'));
  a.dom.window.close(); b.dom.window.close();
});

for (const key of ['pf.make.attempts', 'pf.make.last']) {
  test(`failed ${key} write must not claim result was saved`, () => {
    const a = open(); a.q('#sample').click();
    for (const [id, value] of Object.entries(answers)) a.answer(id, value);
    a.blocked.add(key); a.q('#submit').click();
    assert.match(a.text(), /5 \/ 5 정답/);
    assert.doesNotMatch(a.text(), /저장됨 · 새로고침해도 남아요/);
    assert.match(a.q('[role="alert"]')?.textContent || '', /저장하지 못/);
    a.dom.window.close();
  });
}
