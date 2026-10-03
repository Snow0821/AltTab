import { DEMO_COURSE, DEMO_QUESTIONS as questions } from './demo-data.mjs';
import { filterQuestions, selectedQuestions, gradeDemo, insufficientRanking, rankingView, escapeHtml as esc } from './domain.mjs';

const main = document.querySelector('#main');
const state = { selected: new Set(), filters: { search: '', difficulty: '', concept: '' }, title: '', papers: [], results: [], attempt: null, activeResult: null };
const labels = { bank: '문제은행', papers: '시험지', take: '시험 풀이', results: '점수', ranking: '예상 등수' };
let toastTimer;
const uid = () => crypto.randomUUID();
const route = () => Object.hasOwn(labels, location.hash.slice(1)) ? location.hash.slice(1) : 'bank';
const selected = () => selectedQuestions(questions, state.selected);
const dateText = (value) => new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const paperFor = (id) => state.papers.find((paper) => paper.id === id);
const difficulty = (level) => `<span class="tag level-${level}">${['', '기초', '응용', '심화'][level]}</span>`;
const pageHeading = (eyebrow, title, description, aside = '') => `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="description">${description}</p></div>${aside}</div>`;
const empty = (icon, title, text, action) => `<div class="empty-state"><div class="empty-icon" aria-hidden="true">${icon}</div><h2>${title}</h2><p>${text}</p>${action || ''}</div>`;

function notify(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message; toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
}

function bankPage() {
  const visible = filterQuestions(questions, state.filters);
  const picked = selected();
  const concepts = [...new Set(questions.map((q) => q.concept))];
  return `${pageHeading('YOUR QUESTION BANK', '한 문제씩, 더 확실하게.', '필요한 문제를 모아 나만의 시험지를 만들어 보세요.', '<a class="button secondary" href="#papers">내 시험지 보기 <span aria-hidden="true">↗</span></a>')}
  <section class="stats-grid" aria-label="체험 현황">
    <div class="stat-card"><div><p>샘플 문제</p><strong>8<span>문항</span></strong><small>직접 작성한 체험용 문제</small></div><span class="stat-icon mint" aria-hidden="true">▦</span></div>
    <div class="stat-card"><div><p>이번 세션의 시험지</p><strong>${state.papers.length}<span>개</span></strong><small>새로고침 전까지 유지</small></div><span class="stat-icon violet" aria-hidden="true">▤</span></div>
    <div class="stat-card"><div><p>완료한 체험 풀이</p><strong>${state.results.length}<span>회</span></strong><small>실제 등수 표본에 포함 안 됨</small></div><span class="stat-icon blue" aria-hidden="true">✓</span></div>
  </section>
  <div class="bank-layout"><section aria-labelledby="bank-list-heading"><div class="section-heading"><h2 id="bank-list-heading">문제 둘러보기 <span>${visible.length}</span></h2><span class="muted small">자료구조 · 객관식</span></div>
    <div class="filters"><label class="search-box"><span aria-hidden="true">⌕</span><input id="search" type="search" placeholder="문제 내용이나 개념 검색" aria-label="문제 내용이나 개념 검색" value="${esc(state.filters.search)}"></label><div class="filter-row"><label>개념<select id="concept"><option value="">전체 개념</option>${concepts.map((c) => `<option${state.filters.concept === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label><label>난이도<select id="difficulty"><option value="">전체 난이도</option>${[1, 2, 3].map((d) => `<option value="${d}"${state.filters.difficulty === String(d) ? ' selected' : ''}>${['', '기초', '응용', '심화'][d]}</option>`).join('')}</select></label><button class="text-button" type="button" data-action="clear-filters">필터 초기화</button></div></div>
    <div class="list-toolbar"><span>${visible.length}개의 문제 <span class="muted">· ${state.selected.size}개 선택</span></span><button class="text-button" type="button" data-action="select-visible"${visible.length ? '' : ' disabled'}>검색된 문제 모두 선택</button></div>
    <div class="question-list">${visible.length ? visible.map((q, index) => `<article class="question-card${state.selected.has(q.id) ? ' selected' : ''}"><div class="question-select"><input id="pick-${q.id}" type="checkbox" data-question="${q.id}"${state.selected.has(q.id) ? ' checked' : ''} aria-label="${esc(q.body)} 선택"></div><div class="question-content"><div class="question-meta"><span class="question-number">Q${String(questions.indexOf(q) + 1).padStart(2, '0')}</span><span class="tag concept-tag">${q.concept}</span>${difficulty(q.difficulty)}<span class="sample-tag">샘플</span></div><h3><label for="pick-${q.id}">${esc(q.body)}</label></h3><details><summary>선택지 미리보기</summary><ol class="preview-choices">${q.choices.map((choice) => `<li>${esc(choice)}</li>`).join('')}</ol></details><p class="question-source">${q.source} <span>객관식 · 10점</span></p></div></article>`).join('') : empty('⌕', '검색 결과가 없어요', '다른 검색어나 필터로 다시 찾아보세요.', '<button class="button secondary" data-action="clear-filters">필터 초기화</button>')}</div>
  </section><aside class="builder" aria-labelledby="builder-heading"><div class="builder-top"><span class="mini-icon" aria-hidden="true">▤</span><span class="label-caps">EXAM BUILDER</span></div><h2 id="builder-heading">나만의 시험지</h2><p class="muted">풀고 싶은 문제를 골라 담으세요.</p><div class="builder-count"><strong>${picked.length}<small>문항 선택</small></strong><span>${picked.length * 10}점 만점</span></div>
    ${picked.length ? `<ol class="picked-list">${picked.map((q) => `<li><span>${esc(q.concept)}</span><button type="button" class="remove-button" data-remove="${q.id}" aria-label="${esc(q.body)} 선택 취소">×</button></li>`).join('')}</ol><button class="text-button" data-action="clear-selection">선택 모두 해제</button>` : '<div class="builder-empty"><span aria-hidden="true">＋</span><p>왼쪽 문제를 선택하면<br>이곳에 차곡차곡 모여요.</p></div>'}
    <form id="create-paper"><label for="paper-title">시험지 이름</label><input id="paper-title" maxlength="60" placeholder="예: 중간고사 핵심 개념" value="${esc(state.title)}"><button class="button primary full" type="submit"${picked.length ? '' : ' disabled'}>시험지 만들기 <span aria-hidden="true">→</span></button></form><p class="builder-footnote">이 브라우저 세션에서만 사용할 수 있어요.<br>서버 저장은 아직 연결되지 않았습니다.</p></aside></div>`;
}

function papersPage() {
  return `${pageHeading('YOUR EXAM PAPERS', '내가 고른 문제, 나만의 시험지.', '같은 시험지로 다시 풀며 이해도를 확인하세요.', '<a class="button primary" href="#bank">＋ 시험지 만들기</a>')}
    ${state.papers.length ? `<div class="paper-grid">${state.papers.map((paper) => `<article class="paper-card"><div class="paper-top"><span class="paper-icon" aria-hidden="true">▤</span><span class="tag">세션 내 초안</span></div><h2>${esc(paper.title)}</h2><p class="muted">${DEMO_COURSE.name} · 버전 ${paper.version}</p><div class="paper-specs"><span><strong>${paper.questionCount}</strong>문항</span><span><strong>${paper.maxScore}</strong>점 만점</span><span>시간 제한 없음</span></div><p class="small muted">${dateText(paper.createdAt)} 생성 · 서버 저장 안 됨</p><button class="button primary full" data-start="${paper.id}">${state.attempt?.paperId === paper.id ? '이어서 풀기' : '시험지 풀기'} <span aria-hidden="true">→</span></button></article>`).join('')}</div>` : empty('▤', '첫 시험지를 만들어 볼까요?', '문제은행에서 원하는 문제를 선택하면 시험지가 만들어져요.', '<a class="button primary" href="#bank">문제 고르러 가기 →</a>')}`;
}

function takePage() {
  const attempt = state.attempt;
  const paper = attempt && paperFor(attempt.paperId);
  if (!paper) return `${pageHeading('PRACTICE EXAM', '시험 풀이', '만든 시험지를 선택해 풀이를 시작하세요.')}${empty('▤', '진행 중인 풀이가 없어요', '시험지를 선택하거나 문제은행에서 새로 만들어 보세요.', '<a class="button primary" href="#papers">시험지 보기</a>')}`;
  const answered = Object.keys(attempt.answers).length;
  return `${pageHeading('PRACTICE EXAM · SAMPLE ONLY', esc(paper.title), '체험용 브라우저 채점입니다. 실제 시험 기록이나 등수에 반영되지 않아요.', '<a class="button secondary" href="#papers">나중에 이어 풀기</a>')}
    <div class="exam-progress"><span><strong>${answered}</strong> / ${paper.questionCount}문항 응답</span><span>${paper.maxScore}점 만점 · 시간 제한 없음</span></div><div class="progress-track"><span style="width:${answered / paper.questionCount * 100}%"></span></div>
    <form id="submit-attempt" class="exam-form">${paper.questionIds.map((id, index) => { const q = questions.find((item) => item.id === id); return `<fieldset class="exam-question"><legend><span class="question-number">Q${String(index + 1).padStart(2, '0')}</span> ${esc(q.body)}</legend><div class="question-meta"><span class="tag concept-tag">${q.concept}</span>${difficulty(q.difficulty)}<span class="muted small">10점</span></div><div class="answer-options">${q.choices.map((choice, option) => `<label class="answer-option${attempt.answers[id] === option ? ' chosen' : ''}"><input id="answer-${id}-${option}" type="radio" name="${id}" value="${option}" data-answer="${id}"${attempt.answers[id] === option ? ' checked' : ''}><span class="option-number">${option + 1}</span><span>${esc(choice)}</span></label>`).join('')}</div></fieldset>`; }).join('')}<div class="submit-bar"><p id="submit-help">${answered < paper.questionCount ? `아직 ${paper.questionCount - answered}문항이 남았어요. 모든 문항에 답해 주세요.` : '모든 문항에 답했어요. 제출하면 점수와 해설을 확인할 수 있어요.'}</p><button class="button primary" type="submit" aria-describedby="submit-help"${answered < paper.questionCount ? ' disabled' : ''}>제출하고 점수 보기 →</button></div></form>`;
}

function rankCard(result) {
  const view = rankingView(insufficientRanking());
  const paper = result && paperFor(result.examId);
  return `<section class="ranking-card"><div class="section-heading"><h2>예상 등수</h2><span class="tag warning">${view.estimated}</span></div><p class="muted">${paper ? `${esc(paper.title)} · 버전 ${result.examVersion}` : '시험지별 비교 집단이 필요해요.'}</p><div class="rank-columns"><div><p>동일 시험지 응시자 내 등수</p><strong>${view.observed}</strong><small>같은 시험지·버전의 비교 가능한 응시자만 집계</small></div><div><p>예상 등수</p><strong>—</strong><small>현재는 추정치를 계산하지 않습니다</small></div></div><dl class="rank-facts"><div><dt>실제 비교 표본</dt><dd>${view.sampleSize}명</dd></div><div><dt>비교 집단 크기</dt><dd>미연결</dd></div><div><dt>추정 방법</dt><dd>${view.method}</dd></div><div><dt>계산 시각</dt><dd>계산 전</dd></div></dl><div class="rank-notice"><span aria-hidden="true">ⓘ</span><p>점수만으로 등수를 만들지 않아요. 동일 시험지의 응시 데이터와 추정 방법이 연결되면 표본 수·비교 집단·예상 범위를 함께 표시합니다. 체험 풀이는 표본에 포함되지 않아요.</p></div></section>`;
}

function resultsPage() {
  const result = state.results.find((r) => r.attemptId === state.activeResult) || state.results[0];
  if (!result) return `${pageHeading('YOUR RESULTS', '풀어본 만큼, 알게 된 만큼.', '시험지를 풀면 점수와 문항별 해설을 확인할 수 있어요.')}${empty('▥', '아직 샘플 풀이 결과가 없어요', '교안으로 만든 문제의 실제 기록은 문제 만들기 화면에서 확인하세요.', '<a class="button primary" href="#papers">시험지 보기 →</a>')}`;
  const paper = paperFor(result.examId);
  const percent = Math.round(result.score / result.maxScore * 100);
  return `${pageHeading('YOUR RESULTS · SAMPLE ONLY', '풀이를 마쳤어요.', `${esc(paper.title)} · 버전 ${result.examVersion} · ${dateText(result.submittedAt)}`, `<button class="button secondary" data-start="${paper.id}">다시 풀기 ↻</button>`)}
    <div class="result-grid"><section class="score-card"><div class="score-ring" style="--score:${percent}%"><div><strong>${result.score}<small>점</small></strong><span>${result.maxScore}점 만점</span></div></div><div><span class="tag concept-tag">체험 채점 결과</span><h2>${result.correctCount}문항 정답 / ${result.questionCount}문항</h2><p class="muted">정답률 ${percent}% · 문항당 10점</p><p class="small muted">이번 브라우저 세션에만 표시됩니다.</p></div></section><section class="next-card"><span class="mini-icon" aria-hidden="true">↗</span><h2>해설로 한 번 더 짚어보기</h2><p>맞힌 문제도, 헷갈린 문제도<br>핵심 개념을 다시 확인해 보세요.</p><a href="#bank" class="text-button">다른 문제 고르기 →</a></section></div>
    ${rankCard(result)}<section class="review-section"><div class="section-heading"><h2>문항별 결과</h2><span class="muted small">제출 후 해설 공개</span></div>${result.details.map((detail, index) => { const q = questions.find((item) => item.id === detail.questionId); return `<details class="review-card"><summary><span class="result-mark ${detail.correct ? 'correct' : 'incorrect'}" aria-label="${detail.correct ? '정답' : '오답'}">${detail.correct ? '✓' : '×'}</span><span><span class="muted small">Q${index + 1} · ${q.concept}</span><strong>${esc(q.body)}</strong></span><span class="review-score">${detail.correct ? '10' : '0'} / 10점</span></summary><div class="explanation"><p>내 답: ${esc(q.choices[detail.answer])}</p><p><strong>정답: ${esc(q.choices[q.answerIndex])}</strong></p><p>${esc(q.explanation)}</p></div></details>`; }).join('')}</section>
    <section class="history-section"><div class="section-heading"><h2>이번 세션의 풀이 기록</h2><span class="muted small">새로고침 시 초기화</span></div><div class="history-list">${state.results.map((r) => `<button class="history-item${r.attemptId === result.attemptId ? ' active' : ''}" data-result="${r.attemptId}" aria-pressed="${r.attemptId === result.attemptId}"><span><strong>${esc(paperFor(r.examId).title)}</strong><small>${dateText(r.submittedAt)} · 버전 ${r.examVersion}</small></span><strong>${r.score}<small> / ${r.maxScore}점</small></strong></button>`).join('')}</div></section>`;
}

function rankingPage() {
  const result = state.results.find((r) => r.attemptId === state.activeResult) || state.results[0];
  return `${pageHeading('UNDERSTAND YOUR POSITION', '내 점수는 어디쯤일까요?', '비교 기준이 분명할 때만, 의미 있는 등수를 보여드릴게요.')}${rankCard(result)}<div class="explain-grid"><article><span>01</span><h2>같은 시험지끼리 비교</h2><p>문항과 배점이 같은 시험지 버전의 응시 결과만 비교합니다.</p></article><article><span>02</span><h2>실제 등수와 추정 구분</h2><p>참여자 내 관측 등수와 더 큰 집단의 예상 등수를 따로 표시합니다.</p></article><article><span>03</span><h2>근거와 불확실성 표시</h2><p>표본 수, 집단 크기, 방법과 예상 범위를 함께 제공해야 합니다.</p></article></div>`;
}

function render({ focusHeading = false } = {}) {
  const active = document.activeElement;
  const savedFocus = active?.id;
  const cursor = active instanceof HTMLInputElement && ['text', 'search'].includes(active.type) ? active.selectionStart : null;
  const page = route();
  document.querySelector('#page-crumb').textContent = labels[page];
  document.title = `PassFinder · ${labels[page]}`;
  document.querySelectorAll('[data-nav]').forEach((link) => {
    const current = link.dataset.nav === (page === 'take' ? 'papers' : page);
    if (current) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  main.innerHTML = ({ bank: bankPage, papers: papersPage, take: takePage, results: resultsPage, ranking: rankingPage })[page]();
  if (focusHeading) main.focus({ preventScroll: true });
  else if (savedFocus) {
    const target = document.getElementById(savedFocus);
    target?.focus({ preventScroll: true });
    if (cursor !== null && target instanceof HTMLInputElement) target.setSelectionRange(cursor, cursor);
  }
}

main.addEventListener('input', (event) => {
  const target = event.target;
  if (target.id === 'paper-title') state.title = target.value;
  if (target.id === 'search' && !event.isComposing) { state.filters.search = target.value; render(); }
});
main.addEventListener('compositionend', (event) => {
  if (event.target.id === 'search') { state.filters.search = event.target.value; render(); }
});
main.addEventListener('change', (event) => {
  const target = event.target;
  if (target.id === 'difficulty' || target.id === 'concept') { state.filters[target.id] = target.value; render(); }
  if (target.dataset.question) { target.checked ? state.selected.add(target.dataset.question) : state.selected.delete(target.dataset.question); render(); }
  if (target.dataset.answer && state.attempt) { state.attempt.answers[target.dataset.answer] = Number(target.value); render(); }
});
main.addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.action === 'clear-filters') { state.filters = { search: '', difficulty: '', concept: '' }; render(); }
  if (target.dataset.action === 'select-visible') { filterQuestions(questions, state.filters).forEach((q) => state.selected.add(q.id)); render(); notify('검색된 문제를 선택했어요.'); }
  if (target.dataset.action === 'clear-selection') { state.selected.clear(); render(); }
  if (target.dataset.remove) { state.selected.delete(target.dataset.remove); render(); }
  if (target.dataset.start) {
    if (state.attempt && state.attempt.paperId !== target.dataset.start) { notify('진행 중인 시험지를 먼저 마쳐 주세요. 시험지 목록에서 이어 풀 수 있어요.'); return; }
    if (!state.attempt) state.attempt = { id: uid(), paperId: target.dataset.start, answers: {} };
    location.hash = 'take';
  }
  if (target.dataset.result) { state.activeResult = target.dataset.result; render(); }
});
main.addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.target.id === 'create-paper') {
    const items = selected();
    if (!items.length) return;
    const paper = { id: uid(), title: state.title.trim() || `자료구조 연습 ${state.papers.length + 1}`, courseId: DEMO_COURSE.id, version: 1, status: 'draft', questionCount: items.length, maxScore: items.length * 10, durationMinutes: null, questionIds: items.map((q) => q.id), createdAt: new Date().toISOString() };
    state.papers.unshift(paper); state.selected.clear(); state.title = ''; location.hash = 'papers'; notify('체험 시험지를 만들었어요. 서버에는 저장되지 않습니다.');
  }
  if (event.target.id === 'submit-attempt' && state.attempt) {
    const attempt = state.attempt;
    try {
      const result = gradeDemo(paperFor(attempt.paperId), questions, attempt.answers, attempt.id, new Date().toISOString());
      if (!state.results.some((item) => item.attemptId === result.attemptId)) state.results.unshift(result);
      state.activeResult = result.attemptId; state.attempt = null; location.hash = 'results';
      notify('체험 채점을 마쳤어요. 실제 등수에는 반영되지 않습니다.');
    } catch (error) { notify(error.message); }
  }
});
window.addEventListener('hashchange', () => { render({ focusHeading: true }); window.scrollTo(0, 0); });
render();
