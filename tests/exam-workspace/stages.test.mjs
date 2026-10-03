import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { JSDOM } = await import(process.env.JSDOM_MODULE || 'jsdom');
const source = fs.readFileSync(new URL('../../public/exam-workspace/make.mjs', import.meta.url),'utf8').replaceAll('import.meta.url',JSON.stringify('https://example.test/study/make.mjs?course=course-a')).replaceAll('export function ','function ');
const fixture = {title:'교안 1',range:{from:1,to:2},source:'sample',questions:[0,1,2].map(i=>({id:`q${i}`,body:`문제 ${i}`,choices:['가','나','다','라'],answerIndex:i,explanation:'해설',evidence:{page:1,quote:'교안 근거'}}))};
function setup(storage={}) {
  const dom = new JSDOM('<div id="app"></div>',{url:'https://example.test/',runScripts:'outside-only'});
  for(const [key,value] of Object.entries(storage))dom.window.localStorage.setItem(key,value);
  dom.window.localStorage.setItem('pf.make.sets.course-a',JSON.stringify({set1:fixture}));
  dom.window.localStorage.setItem('pf.make.sets.course-b',JSON.stringify({other:fixture}));
  dom.window.eval(source);
  dom.window.mount(dom.window.document.querySelector('#app'),{stageKey:'set1'});
  return dom;
}
test('saved sets are course-specific stages and show only one question',()=>{
  const dom=setup();assert.equal(dom.window.getStages().length,1);assert.equal(dom.window.getStages()[0].key,'set1');assert.equal(dom.window.document.querySelectorAll('[data-choice]').length,4);assert.equal(dom.window.document.querySelector('#step-action').disabled,true);dom.window.close();
});
test('each question requires confirmation, saves result once, and marks stage complete',()=>{
  const dom=setup(),w=dom.window,d=w.document;
  for(let i=0;i<3;i++) {
    d.querySelector(`[data-choice="${i}"]`).click();
    assert.equal(d.querySelector('#step-action').textContent,'정답 확인');
    d.querySelector('#step-action').click();assert(d.querySelector('.step-feedback'));assert(d.querySelector('[data-choice]').disabled);
    d.querySelector('#step-action').click();
  }
  const attempts=JSON.parse(w.localStorage.getItem('pf.make.attempts.course-a'));assert.equal(attempts.length,1);assert.equal(attempts[0].correct,3);w.submit();assert.equal(JSON.parse(w.localStorage.getItem('pf.make.attempts.course-a')).length,1);assert.equal(w.getStages()[0].completed,true);assert.equal(w.localStorage.getItem('pf.make.attempts.course-b'),null);dom.window.close();
});
test('partial question state restores without losing the answer or confirmation',()=>{
  const dom=setup(),w=dom.window,d=w.document;d.querySelector('[data-choice="0"]').click();d.querySelector('#step-action').click();
  const saved=w.localStorage.getItem('pf.make.last.course-a');dom.window.close();
  const resumed=setup({'pf.make.last.course-a':saved});
  resumed.window.restore();assert(resumed.window.document.querySelector('.step-feedback'));assert.equal(resumed.window.document.querySelector('[data-choice="0"]').getAttribute('aria-pressed'),'true');resumed.window.close();
});

test('material setup opens file picker while preserving saved stages and progress',()=>{
  const dom=setup(),w=dom.window,d=w.document;
  d.querySelector('[data-choice="0"]').click();d.querySelector('#step-action').click();
  const saved=w.localStorage.getItem('pf.make.last.course-a');
  w.mount(d.querySelector('#app'),{setup:true});
  assert(d.querySelector('#file'));assert.equal(d.querySelector('#step-action'),null);
  assert.equal(w.getStages().length,1);assert.equal(w.localStorage.getItem('pf.make.last.course-a'),saved);
  w.mount(d.querySelector('#app'),{stageKey:'set1'});assert(d.querySelector('.step-feedback'));
  dom.window.close();
});
