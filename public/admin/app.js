'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  let page = 1;
  let busy = false;
  let hasNext = false;
  const formatTime = (value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date) : '—';
  };
  function controls() {
    $('refresh').disabled = busy;
    $('table-select').disabled = busy;
    $('previous').disabled = busy || page <= 1;
    $('next').disabled = busy || !hasNext;
    $('refresh').textContent = busy ? '읽는 중…' : '새로고침';
  }
  function empty(message) {
    $('rows').replaceChildren();
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.className = 'empty';
    cell.textContent = message;
    row.append(cell); $('rows').append(row);
  }
  async function load(nextPage = page) {
    if (busy) return;
    busy = true; hasNext = false; controls();
    $('connection-state').textContent = '확인 중';
    $('connection-state').dataset.state = 'loading';
    $('row-count').textContent = '—'; $('fetched-at').textContent = '—';
    $('status').textContent = 'DB에서 최신 데이터를 읽고 있어요…';
    $('status').dataset.state = 'loading';
    empty('불러오는 중…');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`/api/admin/tables/alttab_connection_test?page=${nextPage}`, { method: 'GET', cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || '데이터를 읽지 못했어요. 새로고침으로 다시 확인해 주세요.');
      if (data.source !== 'supabase' || !Array.isArray(data.rows) || !data.pagination) throw new Error('조회 응답을 확인하지 못했어요.');
      page = nextPage; hasNext = data.pagination.hasNextPage === true;
      $('connection-state').textContent = 'Supabase 연결됨';
      $('connection-state').dataset.state = 'success';
      $('row-count').textContent = data.pagination.totalRows === null ? '확인 불가' : `${data.pagination.totalRows}행`;
      $('fetched-at').textContent = formatTime(data.fetchedAt);
      $('page-info').textContent = `페이지 ${page} · 현재 ${data.rows.length}행 · 최대 25행`;
      $('rows').replaceChildren();
      for (const record of data.rows) {
        const row = document.createElement('tr');
        const id = document.createElement('td'); id.textContent = String(record.id);
        const value = document.createElement('td'); value.textContent = record.valueRedacted ? '가려진 텍스트 · 공개 검토가 필요해요' : record.value;
        if (record.valueRedacted) value.className = 'redacted';
        const updated = document.createElement('td'); updated.textContent = formatTime(record.updated_at);
        row.append(id, value, updated); $('rows').append(row);
      }
      if (!data.rows.length) empty(page > 1 ? '이 페이지에 저장된 행이 없어요.' : '아직 저장된 데이터가 없어요. 연결 테스트에서 먼저 저장해 주세요.');
      $('status').textContent = data.rows.some(row => row.valueRedacted) ? 'DB 조회 완료 · 자유 입력 텍스트는 공개 화면에서 가렸어요.' : 'DB에서 최신 저장 값을 읽었어요. 새로고침하면 다시 조회해요.';
      $('status').dataset.state = 'success';
    } catch (error) {
      $('connection-state').textContent = '조회 실패';
      $('connection-state').dataset.state = 'error';
      $('status').textContent = controller.signal.aborted ? '조회 시간이 초과됐어요. 연결을 확인하고 새로고침해 주세요.' : error.message || '연결을 확인한 뒤 새로고침해 주세요.';
      $('status').dataset.state = 'error';
      $('page-info').textContent = `페이지 ${page} · 조회 실패`;
      empty('데이터를 불러오지 못했어요.');
    } finally { clearTimeout(timer); busy = false; controls(); }
  }
  $('refresh').addEventListener('click', () => load());
  $('table-select').addEventListener('click', () => load(1));
  $('previous').addEventListener('click', () => { if (page > 1) load(page - 1); });
  $('next').addEventListener('click', () => { if (hasNext) load(page + 1); });
  load();
})();
