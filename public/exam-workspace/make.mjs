// FR-12 교안으로 객관식 5문제 만들기(설계: docs/exam-workspace-ui.md).
// 글자는 브라우저에서 뽑고, 고른 쪽의 글자만 /api/generate로 보낸다. 결과와 풀이 기록은 이 브라우저(localStorage)에 남긴다.
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
const courseScope = new URL(import.meta.url).searchParams.get('course');
const KEYS = { materials: 'pf.make.materials', sets: 'pf.make.sets', attempts: 'pf.make.attempts', last: 'pf.make.last' };
if (courseScope) Object.keys(KEYS).forEach(key => KEYS[key] += '.' + courseScope);
const MAX_RANGE = 20;

const SAMPLE = {
  title: '샘플: 자료구조 기초',
  source: 'sample',
  questions: [
    { id: 's1', body: '먼저 넣은 자료가 나중에 나오는(LIFO) 자료구조는?', choices: ['큐', '스택', '힙', '해시 테이블'], answerIndex: 1, explanation: '스택은 마지막에 넣은 자료를 먼저 꺼낸다.', evidence: { page: 1, quote: '샘플 문제는 교안 근거가 없습니다' } },
    { id: 's2', body: '먼저 넣은 자료가 먼저 나오는(FIFO) 자료구조는?', choices: ['큐', '스택', '트리', '그래프'], answerIndex: 0, explanation: '큐는 들어온 순서대로 꺼낸다.', evidence: { page: 1, quote: '샘플 문제는 교안 근거가 없습니다' } },
    { id: 's3', body: '이진 탐색의 전제 조건은?', choices: ['자료가 정렬돼 있다', '자료가 연결 리스트다', '중복이 없다', '자료가 100개 이하다'], answerIndex: 0, explanation: '정렬된 자료에서 가운데 값과 비교해 범위를 절반씩 줄인다.', evidence: { page: 1, quote: '샘플 문제는 교안 근거가 없습니다' } },
    { id: 's4', body: '해시 테이블에서 서로 다른 키가 같은 위치를 가리키는 현상은?', choices: ['오버플로', '충돌', '재귀', '정렬'], answerIndex: 1, explanation: '같은 해시 값이 나오는 것을 충돌이라고 한다.', evidence: { page: 1, quote: '샘플 문제는 교안 근거가 없습니다' } },
    { id: 's5', body: '루트에서 시작해 자식으로 내려가는 계층 구조는?', choices: ['배열', '스택', '트리', '큐'], answerIndex: 2, explanation: '트리는 부모와 자식으로 이어진 계층 구조다.', evidence: { page: 1, quote: '샘플 문제는 교안 근거가 없습니다' } },
  ],
};

let app;
let initialized = false;
const state = { material: null, from: 1, to: 1, status: 'idle', error: null, setKey: null, set: null, mode: 'all', answers: {}, result: null };
const inflight = new Map();

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const timeText = (iso) => { try { return new Date(iso).toLocaleString('ko-KR'); } catch { return iso; } };

async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function readPdf(file) {
  const pdfjs = await import(PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').trim());
  }
  return pages;
}

function currentKey() {
  return state.material ? `${state.material.id}:${state.from}-${state.to}` : null;
}

function rangeError() {
  const n = state.material?.pages.length || 0;
  if (!Number.isInteger(state.from) || !Number.isInteger(state.to) || state.from < 1 || state.to > n || state.from > state.to) return `1~${n}쪽 안에서 시작 쪽이 끝 쪽보다 크지 않게 골라 주세요`;
  if (state.to - state.from + 1 > MAX_RANGE) return `한 번에 ${MAX_RANGE}쪽까지 고를 수 있어요`;
  return null;
}

async function onFile(file) {
  state.error = null; state.set = null; state.result = null;
  if (!file) return;
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { state.error = 'PDF 파일만 고를 수 있어요'; return render(); }
  state.status = 'reading'; render();
  try {
    const pages = await readPdf(file);
    if (pages.join('').replace(/\s/g, '').length < 200) throw new Error('글자를 읽을 수 없어요. 스캔한 PDF는 지원하지 않아요');
    const id = await sha(pages.join('\f'));
    state.material = { id, title: file.name.replace(/\.pdf$/i, ''), pages };
    const materials = load(KEYS.materials, {});
    materials[id] = { title: state.material.title, pages, savedAt: new Date().toISOString() };
    if (!save(KEYS.materials, materials)) save(KEYS.materials, { [id]: materials[id] });
    state.from = 1; state.to = Math.min(5, pages.length); state.status = 'ready';
  } catch (e) {
    state.status = 'idle'; state.error = e.message.startsWith('글자를') ? e.message : 'PDF를 열 수 없어요. 암호가 걸렸거나 손상된 파일인지 확인해 주세요';
  }
  render();
}

async function generate() {
  const bad = rangeError();
  if (bad) { state.error = bad; return render(); }
  const key = currentKey();
  const stored = load(KEYS.sets, {})[key];
  if (stored) return openSet(key, stored);
  if (inflight.has(key)) return;
  state.status = 'generating'; state.error = null; render();
  const pages = state.material.pages.slice(state.from - 1, state.to).map((text, i) => ({ page: state.from + i, text }));
  const job = fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: state.material.title, range: { from: state.from, to: state.to }, pages, count: 5 }),
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) throw new Error(data.message || '문제를 만들지 못했어요. 다시 시도해 주세요');
    return data;
  });
  inflight.set(key, job);
  try {
    const data = await job;
    const set = { title: state.material.title, range: { from: state.from, to: state.to }, source: data.source, model: data.model, generatedAt: data.generatedAt, questions: data.questions };
    const sets = load(KEYS.sets, {}); sets[key] = set; save(KEYS.sets, sets);
    openSet(key, set);
  } catch (e) {
    state.status = 'ready'; state.error = e.message; render();
  } finally {
    inflight.delete(key);
  }
}

function openSet(key, set, mode = 'all') {
  state.cursor = 0; state.checked = false;
  state.playIds = mode === 'review' ? (lastAttempt(key)?.wrongIds || []) : null;
  state.setKey = key; state.set = set; state.mode = mode; state.answers = {}; state.result = null; state.status = 'solving'; state.error = null;
  save(KEYS.last, { key, mode, playIds: state.playIds });
  render();
}

function questionsInPlay() {
  // 결과 화면은 그 풀이에 나온 문항, 복습은 연 시점의 오답, 그 외는 전체.
  const ids = state.result ? state.result.details.map((d) => d.id) : state.mode === 'review' ? state.playIds : null;
  return ids ? state.set.questions.filter((q) => ids.includes(q.id)) : state.set.questions;
}

function lastAttempt(key) {
  return load(KEYS.attempts, []).filter((a) => a.key === key).at(-1) || null;
}

function submit() {
  if (state.status === 'result') return;
  const qs = questionsInPlay();
  if (qs.some((q) => state.answers[q.id] === undefined)) return;
  const details = qs.map((q) => ({ id: q.id, picked: state.answers[q.id], correct: state.answers[q.id] === q.answerIndex }));
  const result = { key: state.setKey, kind: state.mode, at: new Date().toISOString(), total: qs.length, correct: details.filter((d) => d.correct).length, details, wrongIds: details.filter((d) => !d.correct).map((d) => d.id) };
  const attempts = load(KEYS.attempts, []); attempts.push(result); save(KEYS.attempts, attempts);
  state.result = result; state.status = 'result';
  save(KEYS.last, { key: state.setKey, mode: state.mode, playIds: state.playIds, showResult: true });
  render();
}

function sourceBadge(set) {
  return set.source === 'sample'
    ? '<span class="badge sample">샘플(AI 호출 없음)</span>'
    : `<span class="badge">학교 AI 생성 · ${esc(set.model)} · ${esc(timeText(set.generatedAt))}</span>`;
}

function savedList() {
  const sets = load(KEYS.sets, {});
  const keys = Object.keys(sets);
  if (!keys.length) return '';
  return `<section class="card saved"><h2>저장된 문제 묶음</h2><ul>${keys.map((k) => {
    const s = sets[k]; const a = lastAttempt(k);
    return `<li><button class="ghost" data-open="${esc(k)}">${esc(s.title)} ${s.range ? `${s.range.from}~${s.range.to}쪽` : ''}</button> ${sourceBadge(s)} ${a ? `· 최근 ${a.correct}/${a.total}` : '· 아직 안 풂'}</li>`;
  }).join('')}</ul></section>`;
}

function render() {
  const s = state;
  const err = s.error ? `<p class="msg error" role="alert">${esc(s.error)}</p>` : '';
  if (s.status === 'solving' || s.status === 'result') return renderQuiz(err);
  const n = s.material?.pages.length || 0;
  const stored = s.material && load(KEYS.sets, {})[currentKey()];
  app.innerHTML = `
    <section class="card">
      <h2>1. 교안 PDF 고르기</h2>
      <div class="row"><input type="file" id="file" accept="application/pdf"> <button class="ghost" id="sample">샘플로 체험</button></div>
      ${s.status === 'reading' ? '<p class="msg">PDF에서 글자를 읽는 중…</p>' : ''}
      ${s.material ? `<p>${esc(s.material.title)} · ${n}쪽</p>` : ''}
    </section>
    ${s.material ? `
    <section class="card">
      <h2>2. 범위 고르고 문제 만들기</h2>
      <div class="row"><label>시작 <input type="number" id="from" min="1" max="${n}" value="${s.from}"></label><label>끝 <input type="number" id="to" min="1" max="${n}" value="${s.to}"></label><span>쪽 (한 번에 ${MAX_RANGE}쪽까지)</span></div>
      <p class="row" style="margin-top:12px"><button id="gen" ${s.status === 'generating' ? 'disabled' : ''}>${s.status === 'generating' ? '학교 AI가 문제를 만드는 중이에요(최대 1분)…' : stored ? '저장된 문제 열기' : '문제 5개 만들기'}</button>
      ${s.error && s.status === 'ready' ? '<button class="ghost" id="retry">다시 시도</button>' : ''}</p>
      ${err}
    </section>` : err}
    ${savedList()}`;
  app.querySelector('#file')?.addEventListener('change', (e) => onFile(e.target.files[0]));
  app.querySelector('#sample')?.addEventListener('click', () => openSet('sample', SAMPLE));
  app.querySelector('#from')?.addEventListener('change', (e) => { s.from = Number(e.target.value); s.error = null; render(); });
  app.querySelector('#to')?.addEventListener('change', (e) => { s.to = Number(e.target.value); s.error = null; render(); });
  app.querySelector('#gen')?.addEventListener('click', generate);
  app.querySelector('#retry')?.addEventListener('click', generate);
  app.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openSet(b.dataset.open, load(KEYS.sets, {})[b.dataset.open])));
}

function renderQuiz(err) {
  const s = state; const qs = questionsInPlay(); const done = s.status === 'result';
  if (!done) return renderStep(err);
  const answered = qs.filter((q) => s.answers[q.id] !== undefined).length;
  const detail = (q) => done ? s.result.details.find((d) => d.id === q.id) : null;
  app.innerHTML = `
    <section class="card">
      <div class="row"><strong>${esc(s.set.title)} ${s.set.range ? `${s.set.range.from}~${s.set.range.to}쪽` : ''}</strong>${sourceBadge(s.set)}${s.mode === 'review' ? '<span class="badge">오답 복습</span>' : ''}</div>
      ${done ? `<p class="score">${s.result.correct} / ${s.result.total} 정답</p><p>${timeText(s.result.at)} 저장됨 · 새로고침해도 남아요</p>` : `<p>${answered} / ${qs.length}문항 답함</p>`}
    </section>
    <section class="card">${qs.map((q, i) => {
      const d = detail(q);
      return `<fieldset class="q"><legend>Q${i + 1}. ${esc(q.body)}</legend>${q.choices.map((c, ci) => {
        const cls = done ? (ci === q.answerIndex ? 'right' : d && d.picked === ci ? 'wrong' : '') : '';
        return `<label class="${cls}"><input type="radio" name="${q.id}" value="${ci}" ${s.answers[q.id] === ci || (d && d.picked === ci) ? 'checked' : ''} ${done ? 'disabled' : ''}> ${esc(c)}</label>`;
      }).join('')}${done ? `<p>${d.correct ? '정답' : `오답 · 정답은 "${esc(q.choices[q.answerIndex])}"`}</p><p>${esc(q.explanation)}</p><p class="evidence">근거 ${q.evidence.page}쪽: “${esc(q.evidence.quote)}”</p>` : ''}</fieldset>`;
    }).join('')}</section>
    ${err}
    <p class="row">${done
      ? `${s.result.wrongIds.length ? '<button id="review">오답 복습</button>' : '<span class="msg">모두 맞혔어요!</span>'}<button class="ghost" id="again">처음부터 다시 풀기</button><button class="ghost" id="home">다른 자료·범위</button>`
      : `<button id="submit" ${answered < qs.length ? 'disabled' : ''}>제출하고 채점하기</button><button class="ghost" id="home">다른 자료·범위</button>`}</p>`;
  if (courseScope && done) {
    const back = document.createElement('button'); back.className = 'ghost'; back.textContent = '학습 단계로 돌아가기';
    back.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('pf:stage-home',{detail:{courseId:courseScope}}))); app.append(back);
  }
  app.querySelectorAll('input[type=radio]').forEach((r) => r.addEventListener('change', () => { s.answers[r.name] = Number(r.value); renderQuiz(''); }));
  app.querySelector('#submit')?.addEventListener('click', submit);
  app.querySelector('#review')?.addEventListener('click', () => openSet(s.setKey, s.set, 'review'));
  app.querySelector('#again')?.addEventListener('click', () => openSet(s.setKey, s.set, 'all'));
  app.querySelector('#home')?.addEventListener('click', () => { s.status = s.material ? 'ready' : 'idle'; s.set = null; s.result = null; save(KEYS.last, null); render(); });
}

// 새로고침 뒤 마지막으로 보던 문제·결과를 되살린다.
function restore() {
  const last = load(KEYS.last, null);
  const set = last && (last.key === 'sample' ? SAMPLE : load(KEYS.sets, {})[last.key]);
  if (set) {
    state.setKey = last.key; state.set = set; state.result = null; state.mode = last.mode || 'all'; state.playIds = last.playIds || null;
    state.answers = last.answers || {}; state.cursor = Math.max(0, Math.min(Number(last.cursor) || 0, Math.max(0, questionsInPlay().length - 1)));
    state.checked = !!last.checked;
    const a = last.showResult && lastAttempt(last.key);
    if (a && a.kind === state.mode) { state.result = a; state.status = 'result'; } else state.status = 'solving';
  }
  render();
}


export function getStages() {
  const sets = load(KEYS.sets, {});
  return Object.entries(sets).filter(([,set]) => set && Array.isArray(set.questions) && set.questions.length).map(([key,set],index) => {
    const attempt = load(KEYS.attempts, []).filter(a => a.key === key && a.kind === 'all').at(-1);
    return {key,number:index+1,title:set.title,range:set.range,count:set.questions.length,completed:!!attempt,correct:attempt?.correct,total:attempt?.total};
  });
}

function saveStep() {
  save(KEYS.last, {key:state.setKey,mode:state.mode,playIds:state.playIds,answers:state.answers,cursor:state.cursor,checked:state.checked});
}

function renderStep(err = '') {
  const qs = questionsInPlay();
  if (!qs.length) { app.innerHTML = '<section class="card"><h2>복습할 문제가 없어요.</h2></section>'; return; }
  const q = qs[state.cursor || 0];
  const picked = state.answers[q.id];
  const checked = !!state.checked;
  const good = picked === q.answerIndex;
  app.innerHTML = `<section class="card step-quiz">
    <div class="row between"><span class="badge">${state.mode === 'review' ? '오답 복습' : '단계별 학습'}</span><strong>${state.cursor+1} / ${qs.length}</strong></div>
    <p class="muted small">${esc(state.set.title)}</p>
    <div class="progress"><i style="width:${(state.cursor + (checked ? 1 : 0))/qs.length*100}%"></i></div>
    <h2 style="margin:28px 0 20px">${esc(q.body)}</h2>
    <div class="step-options">${q.choices.map((choice,i)=>`<button class="step-option ${picked === i ? 'selected' : ''} ${checked && i === q.answerIndex ? 'right' : ''} ${checked && picked === i && !good ? 'wrong' : ''}" data-choice="${i}" aria-pressed="${picked===i}" ${checked ? 'disabled' : ''}><span>${i+1}</span>${esc(choice)}</button>`).join('')}</div>
    ${checked ? `<div class="step-feedback ${good ? '' : 'incorrect'}" role="status"><h3>${good ? '정답이에요!' : '함께 확인해 볼까요?'}</h3><p>${esc(q.explanation)}</p><p class="small muted">정답: ${esc(q.choices[q.answerIndex])}</p>${q.evidence ? `<p class="small muted">근거 ${Number(q.evidence.page)}쪽 · ${esc(q.evidence.quote)}</p>` : ''}</div>` : ''}
    ${err}<button id="step-action" class="primary wide" style="margin-top:24px" ${picked === undefined ? 'disabled' : ''}>${checked ? state.cursor === qs.length-1 ? '학습 결과 보기' : '다음 문제 →' : '정답 확인'}</button>
    <button id="step-back" class="ghost wide" style="margin-top:12px">학습 단계로 돌아가기</button>
  </section>`;
  app.querySelectorAll('[data-choice]').forEach(button=>button.addEventListener('click',()=>{
    if (state.checked) return;
    state.answers[q.id] = Number(button.dataset.choice); saveStep(); renderStep();
  }));
  app.querySelector('#step-action').addEventListener('click',()=>{
    if (state.answers[q.id] === undefined) return;
    if (!state.checked) {state.checked = true; saveStep(); renderStep();}
    else if (state.cursor === qs.length-1) submit();
    else {state.cursor++; state.checked = false; saveStep(); renderStep();}
  });
  app.querySelector('#step-back').addEventListener('click',()=>{
    if (courseScope) document.dispatchEvent(new CustomEvent('pf:stage-home', {detail:{courseId:courseScope}}));
    else {state.status = state.material ? 'ready' : 'idle'; render();}
  });
}

export function mount(target, options = {}) {
  app = target;
  if (options.setup) {
    initialized = true;
    Object.assign(state, { material: null, from: 1, to: 1, status: 'idle', error: null, setKey: null, set: null, mode: 'all', answers: {}, result: null, cursor: 0, checked: false });
    return render();
  }
  if (options.stageKey) {
    initialized = true;
    const last = load(KEYS.last, null);
    if (last?.key === options.stageKey && last.mode === 'all' && !last.showResult) return restore();
    const set = load(KEYS.sets, {})[options.stageKey];
    if (set && Array.isArray(set.questions) && set.questions.length) return openSet(options.stageKey, set);
    state.status = 'idle'; state.set = null;
  }
  if (!initialized) { initialized = true; restore(); } else render();
}

if (!courseScope) mount(document.getElementById('app'));
