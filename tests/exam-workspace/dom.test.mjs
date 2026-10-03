// Optional DOM regression suite. Install jsdom separately; no production dependency is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as helpers from '../../public/exam-workspace/domain.mjs';
import * as fixtures from '../../public/exam-workspace/demo-data.mjs';
const { JSDOM } = await import(process.env.JSDOM_MODULE || 'jsdom');
const html = fs.readFileSync(new URL('../../public/exam-workspace/index.html', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../../public/exam-workspace/app.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/^/, 'const { DEMO_COURSE, DEMO_QUESTIONS: questions } = globalThis.__fixtures;\nconst { filterQuestions, selectedQuestions, gradeDemo, insufficientRanking, rankingView, escapeHtml: esc } = globalThis.__helpers;\n');
const tick = () => new Promise((resolve) => setTimeout(resolve, 12));
function setup(hash = '') {
  const dom = new JSDOM(html, { url: `http://localhost/study/${hash}`, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.__fixtures = fixtures; dom.window.__helpers = helpers;
  dom.window.scrollTo = () => {}; // No layout engine in jsdom.
  dom.window.eval(source);
  return { dom, window: dom.window, document: dom.window.document, q: (s) => dom.window.document.querySelector(s) };
}
function input(ctx, selector, value) {
  const el = ctx.q(selector); el.value = value;
  el.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
}
function change(ctx, selector, value) {
  const el = ctx.q(selector); el.value = value;
  el.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
}
async function navigate(ctx, hash) { const changed = new Promise(resolve => ctx.window.addEventListener('hashchange', resolve, { once: true })); ctx.window.location.hash = hash; await changed; }
async function createPaper(ctx, title = '중간고사 연습') {
  ctx.q('#pick-demo-q1').click(); ctx.q('#pick-demo-q2').click();
  input(ctx, '#paper-title', title);
  const form = ctx.q('#create-paper');
  form.dispatchEvent(new ctx.window.Event('submit', { bubbles: true, cancelable: true }));
  // Rapid repeated submission cannot create a duplicate paper.
  form.dispatchEvent(new ctx.window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
}

test('initial empty states, search filters, IME, and selection remain coherent', async () => {
  const c = setup();
  try {
    assert.equal(c.document.querySelectorAll('.question-card').length, 8);
    assert.equal(c.q('#create-paper button').disabled, true);
    c.q('#pick-demo-q1').click();
    input(c, '#search', '이진 탐색');
    assert.equal(c.document.querySelectorAll('.question-card').length, 1);
    assert.match(c.q('.builder-count').textContent, /1/);
    input(c, '#search', '없는문제'); assert.match(c.q('.question-list').textContent, /검색 결과가 없어요/);
    c.q('[data-action="clear-filters"]').click();
    assert.equal(c.q('#pick-demo-q1').checked, true);
    change(c, '#difficulty', '3'); assert.equal(c.document.querySelectorAll('.question-card').length, 2);
    change(c, '#concept', '스택과 큐'); assert.equal(c.document.querySelectorAll('.question-card').length, 0);
    c.q('[data-action="clear-filters"]').click();
    const field = c.q('#search'); field.value = '스';
    field.dispatchEvent(new c.window.InputEvent('input', { bubbles: true, isComposing: true }));
    assert.equal(c.q('#search'), field); // composition input is not destroyed
    field.value = '스택'; field.dispatchEvent(new c.window.CompositionEvent('compositionend', { bubbles: true }));
    assert.equal(c.document.querySelectorAll('.question-card').length, 2);
    await navigate(c, 'results'); assert.match(c.q('main').textContent, /아직 풀이 결과가 없어요/);
    await navigate(c, 'ranking'); assert.match(c.q('.ranking-card').textContent, /표본 부족/);
    assert.match(c.q('.rank-facts').textContent, /실제 비교 표본0명/);
  } finally { c.window.close(); }
});
test('paper title is escaped, create is idempotent, and answer keys are not in exam DOM', async () => {
  const c = setup();
  try {
    await createPaper(c, '<img src=x onerror=alert(1)>');
    assert.equal(c.document.querySelectorAll('.paper-card').length, 1);
    assert.equal(c.document.querySelectorAll('main img').length, 0);
    assert.equal(c.q('.paper-card h2').textContent, '<img src=x onerror=alert(1)>');
    c.q('[data-start]').click(); await tick();
    assert.equal(c.document.querySelectorAll('.exam-question').length, 2);
    assert.equal(c.q('#submit-attempt button').disabled, true);
    assert.equal(c.q('main').textContent.includes('스택은 LIFO'), false);
    assert.equal(c.document.querySelectorAll('.explanation').length, 0);
  } finally { c.window.close(); }
});
test('interrupted exam resumes, incomplete submission is blocked, repeated submission has one result', async () => {
  const c = setup();
  try {
    await createPaper(c);
    c.q('[data-start]').click(); await tick();
    c.q('#answer-demo-q1-1').click();
    c.q('#submit-attempt').dispatchEvent(new c.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.match(c.q('#toast').textContent, /모든 문항/);
    await navigate(c, 'papers');
    assert.match(c.q('[data-start]').textContent, /이어서 풀기/);
    c.q('[data-start]').click(); await tick();
    assert.equal(c.q('#answer-demo-q1-1').checked, true);
    c.q('#answer-demo-q2-2').click();
    assert.equal(c.q('#submit-attempt button').disabled, false);
    const form = c.q('#submit-attempt');
    form.dispatchEvent(new c.window.Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new c.window.Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    assert.match(c.q('.score-card').textContent, /20점/);
    assert.match(c.q('.score-card').textContent, /2문항 정답 \/ 2문항/);
    assert.equal(c.document.querySelectorAll('.history-item').length, 1);
    assert.match(c.q('.rank-facts').textContent, /실제 비교 표본0명/);
    assert.equal(c.document.querySelectorAll('.explanation').length, 2);
    c.q('[data-start]').click(); await tick();
    assert.equal(c.document.querySelectorAll('input[type="radio"]:checked').length, 0);
    await navigate(c, 'ranking'); await navigate(c, 'papers');
    c.q('[data-start]').click(); await tick();
    assert.equal(c.q('h1').textContent, '중간고사 연습');
  } finally { c.window.close(); }
});
test('new browser session does not pretend to restore saved data and unknown routes remain safe', () => {
  const results = setup('#results'); const take = setup('#take'); const unknown = setup('#unknown');
  try {
    assert.match(results.q('main').textContent, /아직 풀이 결과가 없어요/);
    assert.match(take.q('main').textContent, /진행 중인 풀이가 없어요/);
    assert.equal(unknown.document.querySelectorAll('.question-card').length, 8);
    assert.match(results.q('.demo-banner').textContent, /서버에 저장되지 않으며/);
  } finally { results.window.close(); take.window.close(); unknown.window.close(); }
});
