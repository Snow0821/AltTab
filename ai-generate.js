// FR-12: 교안 범위로 객관식 5문제를 서버에서 학교 AI로 만든다(docs/exam-workspace-ui.md 참고).
// 학생은 개인 AI·키·MCP가 필요 없다. 키는 서버 환경 변수 KOOKMIN_KEY로만 읽고 응답·로그에 넣지 않는다.
const crypto = require('crypto');

const AI_BASE = process.env.KOOKMIN_BASE_URL || 'https://ai.cs.kookmin.ac.kr';
const MODEL = process.env.KOOKMIN_MODEL || 'claude-sonnet-5';
const MAX_PAGES = 20;
const MAX_CHARS = 40000;
const COUNT = 5;
const CALL_TIMEOUT_MS = 55000;

// 같은 내용의 동시 요청은 학교 AI를 한 번만 부른다(같은 서버 인스턴스 안).
const inflight = new Map();

const squash = (s) => String(s || '').replace(/\s+/g, '');
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function fail(status, error, message, extra = {}) {
  const err = new Error(message);
  Object.assign(err, { status, body: { ok: false, error, message, ...extra } });
  return err;
}

function readInput(body) {
  const pages = Array.isArray(body && body.pages) ? body.pages : null;
  if (!pages || pages.length === 0) throw fail(400, 'invalid_input', '문제를 만들 쪽을 골라 주세요');
  if (pages.length > MAX_PAGES) throw fail(400, 'invalid_input', `한 번에 ${MAX_PAGES}쪽까지 고를 수 있어요. 범위를 줄여 주세요`);
  const clean = pages.map((p) => ({ page: Number(p && p.page), text: String((p && p.text) || '') }))
    .filter((p) => Number.isInteger(p.page) && p.page > 0);
  const total = clean.reduce((n, p) => n + p.text.length, 0);
  if (squash(clean.map((p) => p.text).join('')).length < 200) throw fail(400, 'invalid_input', '고른 범위에 글자가 너무 적어요. 다른 쪽을 골라 주세요');
  if (total > MAX_CHARS) throw fail(400, 'invalid_input', '고른 범위의 글자가 너무 많아요. 쪽 범위를 줄여 주세요');
  return { title: norm(body.title).slice(0, 120) || '교안', pages: clean };
}

function prompt(title, pages, want, avoid) {
  const source = pages.map((p) => `<page number="${p.page}">\n${p.text}\n</page>`).join('\n');
  return [
    `아래는 대학 강의 교안 "${title}"의 일부다. 이 내용만 근거로 시험 대비 객관식 문제 ${want}개를 만들어라.`,
    '규칙:',
    '- 문제마다 선택지 정확히 4개, 정답 1개. 오답도 그럴듯하되 교안 기준으로 분명히 틀려야 한다.',
    '- evidence.quote에는 정답의 근거가 되는 문장을 교안에서 글자 그대로 복사해 넣는다(10자 이상, 고치거나 요약하지 않는다). evidence.page는 그 문장이 있는 쪽 번호다.',
    '- 교안에 없는 지식으로 묻지 않는다. 같은 내용을 두 번 묻지 않는다.',
    avoid.length ? `- 다음 문제와 겹치지 않게 한다: ${avoid.map((b) => `"${b}"`).join(', ')}` : '',
    '출력은 JSON 하나만. 설명 문장이나 코드 블록 표시 없이:',
    '{"questions":[{"body":"문제","choices":["보기1","보기2","보기3","보기4"],"answer_index":0,"explanation":"해설","evidence":{"page":1,"quote":"교안 원문 문장"}}]}',
    '',
    source,
  ].filter(Boolean).join('\n');
}

async function callAI(text) {
  const key = process.env.KOOKMIN_KEY;
  if (!key) throw fail(503, 'ai_not_configured', 'AI 연결이 아직 안 됐어요. 운영자가 서버 설정을 마치면 다시 시도해 주세요');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
  try {
    const r = await fetch(`${AI_BASE}/v1/messages`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: 'user', content: text }] }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const reason = (data && data.error && data.error.message) || `HTTP ${r.status}`;
      console.error('[ai-generate] 학교 AI 오류', r.status, String(reason).slice(0, 200));
      throw fail(502, 'ai_failed', r.status === 403 ? '학교 AI 크레딧이 부족해요. 운영자에게 알려 주세요' : '학교 AI가 응답하지 못했어요. 잠시 후 다시 시도해 주세요');
    }
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  } catch (e) {
    if (e.name === 'AbortError') throw fail(504, 'ai_timeout', '문제 만들기가 너무 오래 걸렸어요. 범위를 줄여 다시 시도해 주세요');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function parseQuestions(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(obj.questions) ? obj.questions : [];
  } catch {
    return [];
  }
}

// 통과하면 정리된 문항, 아니면 거절 사유 문자열.
function check(q, pageText, seen) {
  if (!q || typeof q !== 'object') return '형식 오류';
  const body = norm(q.body);
  if (body.length < 8) return '문제 문장 없음';
  if (seen.has(squash(body))) return '중복 문제';
  const choices = Array.isArray(q.choices) ? q.choices.map(norm) : [];
  if (choices.length !== 4 || choices.some((c) => !c)) return '선택지 4개 아님';
  if (new Set(choices.map(squash)).size !== 4) return '선택지 중복';
  const answerIndex = Number(q.answer_index);
  if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) return '정답 번호 오류';
  const explanation = norm(q.explanation);
  if (explanation.length < 5) return '해설 없음';
  const page = Number(q.evidence && q.evidence.page);
  const quote = norm(q.evidence && q.evidence.quote);
  if (!pageText.has(page)) return '근거 쪽이 범위 밖';
  if (squash(quote).length < 10 || !pageText.get(page).includes(squash(quote))) return '근거 문장이 교안에 없음';
  seen.add(squash(body));
  return { body, choices, answerIndex, explanation, evidence: { page, quote } };
}

async function generate({ title, pages }) {
  const pageText = new Map(pages.map((p) => [p.page, squash(p.text)]));
  const seen = new Set();
  const valid = [];
  const rejected = [];
  for (const want of [COUNT + 2, null]) {
    const ask = want || COUNT - valid.length + 2;
    const raw = await callAI(prompt(title, pages, ask, valid.map((q) => q.body)));
    for (const q of parseQuestions(raw)) {
      const r = check(q, pageText, seen);
      if (typeof r === 'string') rejected.push(r);
      else if (valid.length < COUNT) valid.push(r);
    }
    if (valid.length >= COUNT) break;
  }
  if (valid.length < COUNT) {
    throw fail(422, 'not_enough_valid', `검사를 통과한 문제가 ${valid.length}개뿐이에요. 다시 시도하거나 범위를 바꿔 주세요`, {
      validCount: valid.length,
      rejectedReasons: rejected.slice(0, 10),
    });
  }
  return {
    ok: true,
    source: 'school-ai',
    model: MODEL,
    generatedAt: new Date().toISOString(),
    questions: valid.map((q, i) => ({ id: `q${i + 1}`, ...q })),
    rejectedCount: rejected.length,
  };
}

module.exports = function registerAiGenerate(app) {
  app.post('/api/generate', async (req, res) => {
    try {
      const input = readInput(req.body);
      const key = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
      if (!inflight.has(key)) {
        inflight.set(key, generate(input).finally(() => inflight.delete(key)));
      }
      res.json(await inflight.get(key));
    } catch (e) {
      if (e.status) return res.status(e.status).json(e.body);
      console.error('[ai-generate] 처리 오류', e.message);
      res.status(500).json({ ok: false, error: 'server_error', message: '문제를 만들지 못했어요. 다시 시도해 주세요' });
    }
  });
};

module.exports.check = check;
module.exports.squash = squash;
