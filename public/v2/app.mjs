const main = document.querySelector('main');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(`pf.v2.${key}`)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(`pf.v2.${key}`, JSON.stringify(value)); } catch { /* The server result remains authoritative. */ } };
const state = { exams: [], exam: null, attempt: null, result: null, ranking: null, answers: {}, step: 0, error: '', busy: false, source: 'pdf', material: null, title: '', text: '', from: 1, to: 1, aiAvailable: false };
let routeVersion = 0;
let noticeTimer;
function notice(text) {
  const node = document.querySelector('#notice'); node.textContent = text;
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { node.textContent = ''; }, 3500);
}
async function api(path, body) {
  const response = await fetch(`/api/v2${path}`, { credentials: 'same-origin',
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || '연결이 원활하지 않아요. 다시 시도해 주세요.');
  return data;
}
function url(view = '', exam = '') {
  const params = new URLSearchParams(); if (view) params.set('view', view); if (exam) params.set('exam', exam);
  return `/v2/${params.size ? `?${params}` : ''}`;
}
function navigate(view = '', exam = '') { history.pushState({}, '', url(view, exam)); route(); }
function errorBox() { return state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : ''; }
function badge(exam) { return `<span class="badge">${exam.source === 'sample' ? '샘플 시험' : '교안 기반'}</span>`; }
function date(iso) { return new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }); }
function back() { return `<a class="back" href="/v2/">← 문제 목록</a>`; }
function render() {
  const view = new URLSearchParams(location.search).get('view') || (state.exam ? 'exam' : '');
  document.querySelector('#nav-exams').toggleAttribute('aria-current', false);
  document.querySelector('#nav-ranking').toggleAttribute('aria-current', false);
  document.querySelector(view === 'ranking' ? '#nav-ranking' : '#nav-exams').setAttribute('aria-current', 'page');
  if (view === 'create') renderCreate();
  else if (view === 'ranking') renderRanking();
  else if (state.result && state.exam) renderResult();
  else if (state.attempt && state.exam) renderQuiz();
  else if (state.exam) renderStart();
  else renderList();
}
function renderList() {
  document.title = 'PassFinder · 문제';
  main.innerHTML = `<section class="hero"><div><div class="eyebrow">STUDY, SIMPLY.</div><h1>오늘의 공부,<br><em>다섯 문제</em>로 확인.</h1><p>교안으로 문제를 만들고, 같은 시험의 결과를 비교하세요.</p></div>
    <a class="primary" href="${url('create')}"><span aria-hidden="true">＋</span> 문제 만들기</a></section>
    ${errorBox()}<div class="section-head"><h2>함께 풀어볼 시험 <span>${state.exams.length}</span></h2><span>객관식 5문항 · 100점 만점</span></div>
    <div class="exam-list">${state.exams.map((exam, i) => `<a class="exam-card" href="${url('', exam.id)}"><span class="exam-icon" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><div class="exam-info"><h3>${esc(exam.title)}</h3><div class="meta">${badge(exam)}<span>5문항</span><span>·</span><span>${date(exam.created_at)}</span></div></div><span class="arrow" aria-hidden="true">↗</span></a>`).join('') || '<div class="empty"><h2>첫 시험을 만들어 보세요.</h2><p>교안만 있으면 다섯 문제로 시작할 수 있어요.</p></div>'}</div>
    <p class="list-help">로그인 없이 닉네임으로 참여해요. 같은 시험의 첫 제출 기록으로 순위를 매깁니다.</p>`;
}
function renderStart() {
  const exam = state.exam; document.title = `${exam.title} · PassFinder`;
  main.innerHTML = `<div class="narrow">${back()}<section class="panel">${badge(exam)}<div class="page-title"><h1>${esc(exam.title)}</h1><p>차근차근 풀고, 내 이해도를 확인해 보세요.</p></div>
    <div class="start-facts"><div class="fact"><span>문제</span><strong>5문항</strong></div><div class="fact"><span>만점</span><strong>100점</strong></div><div class="fact"><span>제한 시간</span><strong>없음</strong></div></div>
    <form id="start-form"><label class="field nickname"><span>닉네임</span><input name="nickname" type="text" maxlength="20" autocomplete="nickname" placeholder="랭킹에 표시할 이름" value="${esc(load('nickname', ''))}" required><small>닉네임과 점수는 이 시험의 랭킹에 공개돼요.</small></label>${errorBox()}<button class="primary full" ${state.busy ? 'disabled' : ''}>${state.busy ? '시험을 여는 중…' : '문제 풀기 →'}</button></form>
    <div class="actions spread"><a class="text-button" href="${url('ranking', exam.id)}">이 시험의 랭킹</a><button class="text-button" data-action="share">시험 링크 복사</button></div>
    <p class="rules">첫 제출 점수만 랭킹에 반영됩니다. 정답과 해설은 제출 후 확인할 수 있어요.</p></section></div>`;
  main.querySelector('#start-form').addEventListener('submit', async event => {
    event.preventDefault(); if (state.busy) return;
    const nickname = new FormData(event.target).get('nickname').trim(); save('nickname', nickname);
    await action(async () => {
      const data = await api(`/exams/${exam.id}/start`, { nickname });
      state.attempt = data.attempt; state.result = data.attempt.result;
      state.answers = load(`answers.${exam.id}`, {}); state.step = 0;
      if (state.result) await ranking();
    });
  });
}
function renderQuiz() {
  const exam = state.exam; const q = exam.questions[state.step];
  main.innerHTML = `<div class="narrow">${back()}<div class="quiz-head"><span>${esc(exam.title)}</span><strong>${state.step + 1} / 5</strong></div><div class="progress" aria-label="${state.step + 1}번째 문제">${exam.questions.map((_, i) => `<span class="${i <= state.step ? 'done' : ''}"></span>`).join('')}</div>
    <section class="panel"><div class="question-number">QUESTION ${String(state.step + 1).padStart(2, '0')}</div><h1 class="question-title" id="question-title">${esc(q.body)}</h1>
    <fieldset class="choices" aria-labelledby="question-title">${q.choices.map((choice, i) => `<label class="choice"><input type="radio" name="answer" value="${i}" ${state.answers[q.id] === i ? 'checked' : ''} ${state.busy ? 'disabled' : ''}><span class="choice-label">${esc(choice)}</span><span class="letter" aria-hidden="true">${'ABCD'[i]}</span></label>`).join('')}</fieldset>
    ${errorBox()}<div class="actions spread"><button class="secondary" data-action="previous" ${state.step === 0 || state.busy ? 'disabled' : ''}>이전</button>
    <button class="primary" data-action="${state.step === 4 ? 'submit' : 'next'}" ${state.answers[q.id] === undefined || state.busy ? 'disabled' : ''}>${state.busy ? '채점 중…' : state.step === 4 ? '제출하고 결과 보기' : '다음 문제 →'}</button></div></section>
    <p class="list-help">고른 답은 이 브라우저에 임시 저장돼요. 제출 전에는 바꿀 수 있어요.</p></div>`;
  main.querySelectorAll('input[name=answer]').forEach(input => input.addEventListener('change', () => {
    state.answers[q.id] = Number(input.value); save(`answers.${exam.id}`, state.answers);
    main.querySelector('[data-action=next], [data-action=submit]').disabled = false;
  }));
}
async function ranking() {
  state.ranking = null;
  try { state.ranking = await api(`/exams/${state.exam.id}/ranking`); }
  catch { state.ranking = { unavailable: true }; }
}
function renderResult() {
  const result = state.result; const board = state.ranking;
  main.innerHTML = `<div class="narrow">${back()}<div class="page-title"><div class="eyebrow">YOUR RESULT</div><h1>${esc(state.exam.title)}</h1></div><section class="panel"><div class="result-top"><div><div class="muted">${esc(state.attempt.nickname)}님의 결과</div><div class="score">${result.score}<small>점</small></div><p class="result-note">${result.total}문제 중 ${result.correct}문제 정답</p></div><div class="rank-callout"><span>이 시험의 내 순위</span><strong>${board?.mine ? `${board.mine.position}위` : '—'}</strong><span>${board?.participants ? `${board.participants}명 참여` : board?.unavailable ? '랭킹을 불러오지 못했어요' : '기록 확인 중'}</span></div></div>
    <div class="actions spread"><button class="secondary" data-action="share">시험 링크 복사</button><a class="primary" href="${url('ranking', state.exam.id)}">랭킹 보기 →</a></div><h2 class="review-title">정답과 해설</h2>
    ${result.details.map((q, i) => `<details class="review ${q.correct ? '' : 'wrong'}" ${q.correct ? '' : 'open'}><summary><span class="mark">${q.correct ? '정답' : '오답'}</span><span>${i + 1}. ${esc(q.body)}</span></summary><div class="review-content"><p>내 답 · ${esc(q.choices[q.picked])}</p><p class="correct-answer">정답 · ${esc(q.choices[q.answerIndex])}</p><p>${esc(q.explanation)}</p>${q.evidence ? `<blockquote class="evidence">${q.evidence.page}쪽 · “${esc(q.evidence.quote)}”</blockquote>` : ''}</div></details>`).join('')}
    <p class="rules">이 브라우저의 첫 제출 결과입니다. 다시 열어도 점수와 랭킹은 유지돼요.</p></section></div>`;
}
function renderRanking() {
  document.title = 'PassFinder · 랭킹';
  const selected = state.exam?.id || '';
  const board = state.ranking;
  main.innerHTML = `<div class="narrow"><div class="page-title"><div class="eyebrow">SAME EXAM. YOUR PLACE.</div><h1>같은 문제, 함께 비교.</h1><p>실제로 제출한 첫 점수로 순위를 확인해요.</p></div>
    <label class="ranking-picker">비교할 시험<select id="ranking-exam">${state.exams.map(exam => `<option value="${exam.id}" ${exam.id === selected ? 'selected' : ''}>${esc(exam.title)}</option>`).join('')}</select></label>
    ${errorBox()}${board?.unavailable ? `<div class="empty"><h2>랭킹을 불러오지 못했어요.</h2><button class="secondary" data-action="retry">다시 불러오기</button></div>` : board?.participants ? `<div class="ranking-summary"><span><strong>${board.participants}명</strong>이 이 시험을 풀었어요.</span><span>${board.mine ? `내 순위 <strong>${board.mine.position}위</strong>` : '첫 제출 기록 기준'}</span></div><div class="table-wrap"><table class="ranking-table"><thead><tr><th scope="col">순위</th><th scope="col">닉네임</th><th scope="col">점수</th></tr></thead><tbody>${board.rows.map(row => `<tr class="${row.mine ? 'mine' : ''}"><td class="position">${row.position}</td><td>${esc(row.nickname)}${row.mine ? '<span class="badge">나</span>' : ''}</td><td class="ranking-score">${row.score}<small> 점</small></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty"><h2>아직 제출된 기록이 없어요.</h2><p>첫 문제를 풀고 이 시험의 첫 기록을 남겨 보세요.</p>${selected ? `<a class="primary" href="${url('', selected)}">문제 풀기 →</a>` : '<a class="primary" href="/v2/?view=create">문제 만들기</a>'}</div>`}
    ${board?.participants ? `<div class="actions spread"><button class="text-button" data-action="share">시험 링크 복사</button><a class="secondary" href="${url('', selected)}">${board.mine ? '내 결과 보기' : '이 시험 풀기'}</a></div>` : ''}
    <p class="list-help">같은 점수는 공동 순위입니다. 브라우저별 첫 제출만 집계하며, 상위 50개 기록을 표시해요.</p></div>`;
  main.querySelector('#ranking-exam').addEventListener('change', event => navigate('ranking', event.target.value));
}
function renderCreate() {
  document.title = 'PassFinder · 문제 만들기';
  main.innerHTML = `<div class="narrow">${back()}<div class="page-title"><div class="eyebrow">FROM YOUR NOTES</div><h1>교안이 다섯 문제가 됩니다.</h1><p>공부할 범위를 넣으면 정답과 근거가 있는 문제를 만들어요.</p></div><section class="panel"><form id="create-form">
    <label class="field"><span>시험 이름</span><input id="title" type="text" maxlength="100" value="${esc(state.title)}" placeholder="예: 자료구조 중간고사 · 1주차" required ${state.busy ? 'disabled' : ''}></label>
    <div class="tabs" role="tablist" aria-label="교안 입력 방법"><button type="button" role="tab" aria-selected="${state.source === 'pdf'}" data-source="pdf" ${state.busy ? 'disabled' : ''}>PDF 선택</button><button type="button" role="tab" aria-selected="${state.source === 'text'}" data-source="text" ${state.busy ? 'disabled' : ''}>텍스트 붙여넣기</button></div>
    ${state.source === 'pdf' ? `<label class="file-zone"><strong>${state.material ? esc(state.material.name) : '공부할 교안을 선택하세요'}</strong><small>${state.material ? `${state.material.pages.length}쪽 · 범위를 골라 주세요` : '텍스트 PDF · 최대 20MB · 스캔본 제외'}</small><input id="pdf" type="file" accept="application/pdf,.pdf" aria-label="교안 PDF 선택" ${state.busy ? 'disabled' : ''}></label>
    ${state.material ? `<div class="range"><label class="field"><small>시작 쪽</small><input id="from" type="number" min="1" max="${state.material.pages.length}" value="${state.from}" ${state.busy ? 'disabled' : ''}></label><span>—</span><label class="field"><small>마지막 쪽</small><input id="to" type="number" min="1" max="${state.material.pages.length}" value="${state.to}" ${state.busy ? 'disabled' : ''}></label></div><p class="help">한 번에 최대 20쪽까지 선택할 수 있어요.</p>` : ''}` : `<label class="field"><span class="sr-label">교안 내용</span><textarea id="text" maxlength="40000" placeholder="공부할 교안이나 필기를 붙여넣어 주세요. 내용을 충분히 넣으면 더 좋은 문제를 만들 수 있어요." ${state.busy ? 'disabled' : ''}>${esc(state.text)}</textarea><small>공백 제외 200자 이상 · 최대 40,000자</small></label>`}
    ${errorBox()}${state.busy ? `<p class="status-row" role="status"><span class="spinner" aria-hidden="true"></span>${state.reading ? 'PDF에서 글자를 읽는 중이에요.' : '교안에서 문제와 정답 근거를 확인하고 있어요.'}</p>` : ''}
    <div class="actions"><button class="primary full" ${state.busy || !state.aiAvailable ? 'disabled' : ''}>${state.busy ? state.reading ? 'PDF 읽는 중…' : '문제 만드는 중…' : '문제 5개 만들기 →'}</button></div>
    ${!state.aiAvailable ? '<p class="help">문제 생성 연결을 준비 중이에요. 준비된 시험을 먼저 풀어 주세요.</p>' : ''}
    <p class="rules">선택한 텍스트를 AI에 보내 문제를 만듭니다. 생성한 문제는 이 목록과 공유 링크에서 함께 풀 수 있어요. 원본 PDF와 전체 교안은 서버에 보관하지 않습니다.</p></form></section></div>`;
  const on = (id, key) => main.querySelector(id)?.addEventListener('input', event => { state[key] = event.target.value; });
  on('#title', 'title'); on('#text', 'text'); on('#from', 'from'); on('#to', 'to');
  main.querySelectorAll('[data-source]').forEach(button => button.addEventListener('click', () => { state.source = button.dataset.source; state.error = ''; render(); }));
  main.querySelector('#pdf')?.addEventListener('change', event => readPdf(event.target.files[0]));
  main.querySelector('#create-form').addEventListener('submit', async event => {
    event.preventDefault(); if (state.busy) return;
    await action(async () => {
      let pages;
      if (state.source === 'pdf') {
        const from = Number(state.from), to = Number(state.to), total = state.material?.pages.length || 0;
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > total || from > to || to - from >= 20) throw new Error('교안을 선택하고 올바른 쪽 범위를 입력해 주세요. 한 번에 최대 20쪽입니다.');
        pages = state.material.pages.slice(from - 1, to).map((text, i) => ({ page: from + i, text }));
      } else pages = [{ page: 1, text: state.text }];
      const joined = pages.map(p => p.text).join('\n');
      if (joined.replace(/\s/g, '').length < 200 || joined.length > 40000) throw new Error('교안은 공백 제외 200자 이상, 전체 40,000자 이하로 입력해 주세요.');
      const created = await api('/exams', { title: state.title, pages });
      state.busy = false; state.material = null; state.text = ''; state.title = '';
      navigate('', created.id);
    }, false);
  });
}
async function readPdf(file) {
  if (!file || state.busy) return;
  state.reading = true;
  await action(async () => {
    if (!file.name.toLowerCase().endsWith('.pdf') || file.size > 20 * 1024 * 1024) throw new Error('20MB 이하의 PDF 파일을 선택해 주세요.');
    const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
    let doc;
    try {
      doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
      if (doc.numPages > 150) throw new Error('150쪽 이하의 PDF를 사용해 주세요.');
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const content = await (await doc.getPage(i)).getTextContent();
        pages.push(content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join(''));
      }
      if (!pages.join('').trim()) throw new Error('글자를 읽을 수 없는 스캔 PDF예요. 텍스트를 붙여넣어 주세요.');
      state.material = { name: file.name, pages }; state.from = 1; state.to = Math.min(5, pages.length);
      if (!state.title) state.title = file.name.replace(/\.pdf$/i, '').slice(0, 100);
    } catch (error) {
      throw new Error(/150쪽|스캔 PDF/.test(error.message) ? error.message : 'PDF를 읽지 못했어요. 암호나 파일 손상을 확인하거나 텍스트를 붙여넣어 주세요.');
    } finally { await doc?.destroy(); }
  });
  state.reading = false;
}
async function action(fn, finalRender = true) {
  if (state.busy) return;
  state.busy = true; state.error = ''; render();
  try { await fn(); }
  catch (error) { state.error = error.message || '연결을 확인한 뒤 다시 시도해 주세요.'; finalRender = true; }
  finally { state.busy = false; if (finalRender) render(); }
}
async function route() {
  const version = ++routeVersion; state.error = ''; state.busy = false; state.exam = null; state.attempt = null; state.result = null; state.ranking = null;
  const params = new URLSearchParams(location.search), view = params.get('view');
  main.innerHTML = '<p class="loading">시험을 불러오는 중이에요.</p>';
  try {
    const list = await api('/exams'); if (version !== routeVersion) return;
    state.exams = list.exams; state.aiAvailable = list.aiAvailable;
    const id = params.get('exam') || (view === 'ranking' ? state.exams[0]?.id : null);
    if (id) {
      const data = await api(`/exams/${encodeURIComponent(id)}`); if (version !== routeVersion) return;
      state.exam = data.exam; state.attempt = data.attempt; state.result = data.attempt?.result;
      state.answers = load(`answers.${id}`, {}); state.step = 0;
      if (view === 'ranking' || state.result) await ranking();
    }
    if (version !== routeVersion) return;
    render(); window.scrollTo(0, 0);
  } catch (error) {
    if (version !== routeVersion) return;
    main.innerHTML = `<div class="narrow">${back()}<div class="empty"><h2>시험을 열지 못했어요.</h2><p role="alert">${esc(error.message)}</p><button class="secondary" data-action="retry">다시 불러오기</button></div></div>`;
  }
}
document.addEventListener('click', async event => {
  const link = event.target.closest('a');
  if (link && !link.hash && link.origin === location.origin && link.pathname === '/v2/' && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
    if (state.busy) { event.preventDefault(); return; }
    event.preventDefault(); history.pushState({}, '', link.href); route(); return;
  }
  const button = event.target.closest('[data-action]'); if (!button || button.disabled || state.busy) return;
  const kind = button.dataset.action;
  if (kind === 'retry') return route();
  if (kind === 'next' || kind === 'previous') { state.step += kind === 'next' ? 1 : -1; state.error = ''; render(); main.querySelector('h1')?.scrollIntoView({ block: 'start' }); }
  if (kind === 'share') {
    const shareUrl = `${location.origin}${url('', state.exam.id)}`;
    try { await navigator.clipboard.writeText(shareUrl); notice('시험 링크를 복사했어요.'); }
    catch { notice(`공유 주소: ${shareUrl}`); }
  }
  if (kind === 'submit') await action(async () => {
    const data = await api(`/exams/${state.exam.id}/submit`, { answers: state.answers });
    state.result = data.result; state.attempt.result = data.result; save(`answers.${state.exam.id}`, {}); await ranking();
    window.scrollTo(0, 0);
  });
});
window.addEventListener('popstate', route);
route();
