'use strict';

const byId = (id) => document.getElementById(id);
const state = { configured: null, dbVerified: false, busy: false, llmAttempted: false };

function paint(target, text, kind = '') {
  const element = byId(target);
  element.textContent = text;
  element.className = target.endsWith('badge') ? `badge ${kind}` : `result ${kind}`;
}

function buttons() {
  const ready = state.configured && !state.configured.expired && !state.busy;
  byId('db-submit').disabled = !ready || !state.configured.db.configured;
  byId('llm-submit').disabled = !ready || !state.dbVerified || !state.configured.llm.configured || state.llmAttempted;
  byId('db-value').disabled = state.busy;
  byId('llm-input').disabled = state.busy;
}

async function post(route, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`/api/mock/${route}`, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok || result.ok !== true) {
      const error = new Error(result.message || '요청을 완료하지 못했어요.');
      error.code = result.error;
      throw error;
    }
    return result;
  } catch (error) {
    if (error instanceof TypeError || error.name === 'AbortError' || error instanceof SyntaxError) {
      throw new Error('서버 응답을 확인하지 못했어요. LLM은 비용 확인 전 재시도하지 마세요.');
    }
    throw error;
  } finally { clearTimeout(timer); }
}

byId('db-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy || byId('db-submit').disabled) return;
  state.busy = true;
  state.dbVerified = false;
  buttons();
  paint('db-badge', '확인 중');
  paint('db-result', 'Supabase에 저장한 뒤 별도 읽기 요청으로 확인하고 있어요…');
  try {
    const value = byId('db-value').value;
    const result = await post('db', { value });
    if (result.source !== 'supabase' || result.exactMatch !== true || result.value !== value) throw new Error('입력과 실제 DB 응답이 일치하지 않아요.');
    state.dbVerified = true;
    paint('db-badge', '실제 DB 확인', 'success');
    paint('db-result', `저장 ✓  읽기 ✓  정확히 일치 ✓\n\n돌아온 값: ${result.value}`, 'success');
    if (!state.llmAttempted) paint('llm-result', 'DB 연결이 확인됐어요. 이제 짧은 문장을 AI에 보낼 수 있어요.');
  } catch (error) {
    paint('db-badge', '확인 실패', 'error');
    paint('db-result', error.message, 'error');
  } finally { state.busy = false; buttons(); }
});

byId('llm-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy || byId('llm-submit').disabled) return;
  state.busy = true;
  state.llmAttempted = true; // Also enforced atomically in Postgres, not just here.
  buttons();
  paint('llm-badge', '응답 대기');
  paint('llm-result', '학교 AI에 1회 요청 중… 새로고침하거나 반복 전송하지 마세요.');
  try {
    const result = await post('chat', { message: byId('llm-input').value });
    if (result.source !== 'school-ai' || typeof result.reply !== 'string' || !result.reply.trim()) throw new Error('실제 AI 텍스트 응답을 확인하지 못했어요.');
    paint('llm-badge', '실제 AI 확인', 'success');
    const tokens = result.usage ? `\n입력 ${result.usage.inputTokens} / 출력 ${result.usage.outputTokens} 토큰` : '';
    paint('llm-result', `AI 답변\n${result.reply}\n\n${result.model}${tokens}${result.truncated ? '\n32토큰 제한으로 답변이 짧게 끝났어요.' : ''}\n전역 1회 호출권을 사용했어요.`, 'success');
  } catch (error) {
    paint('llm-badge', '확인 실패', 'error');
    paint('llm-result', `${error.message}\n추가 비용을 막기 위해 이 화면에서는 다시 보내지 않아요.`, 'error');
  } finally { state.busy = false; buttons(); }
});

post('status', {}).then((result) => {
  state.configured = result;
  byId('configuration').textContent = result.expired
    ? '시연 시간이 끝났어요. 화면은 볼 수 있지만 실제 DB·AI 호출은 중지됐어요.'
    : `서버 설정: DB ${result.db.configured ? '키 있음' : '키 없음'} · 학교 AI ${result.llm.configured ? '키 있음' : '키 없음'}\n키가 있다는 표시만으로 연결 성공을 뜻하지 않아요. 아래에서 직접 확인해 주세요.`;
  buttons();
}).catch((error) => {
  byId('configuration').textContent = `서버 설정을 확인하지 못했어요: ${error.message}`;
});
