// FR-12: 교안 범위로 객관식 5문제를 서버에서 학교 AI로 만든다(docs/exam-workspace-ui.md 참고).
// 학생은 개인 AI·키·MCP가 필요 없다. 키는 서버 환경 변수 KOOKMIN_KEY로만 읽고 응답·로그에 넣지 않는다.
const crypto = require('crypto');

const AI_BASE = process.env.KOOKMIN_BASE_URL || 'https://ai.cs.kookmin.ac.kr';
const MODEL = process.env.KOOKMIN_MODEL || 'claude-sonnet-5';
const MAX_PAGES = 20;
const MAX_CHARS = 40000;
const COUNT = 5;
const CALL_TIMEOUT_MS = 55000;
// 출제 규칙 판. 규칙이 바뀌면 올린다. 화면은 이 값이 낮은 저장 결과를 옛 규칙으로 만든 문항으로 다룰 수 있다.
const RULES_VERSION = 2;

// 같은 내용의 동시 요청은 학교 AI를 한 번만 부른다(같은 서버 인스턴스 안).
const inflight = new Map();

const squash = (s) => String(s || '').replace(/\s+/g, '');
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// 출제 대상 종류. 모델이 각 문제에 적어 보내고, 서버는 이 밖의 값(공지·운영 안내 등)을 거른다.
const KINDS = new Set(['concept', 'definition', 'principle', 'calculation', 'algorithm', 'comparison', 'application']);

// 수업 운영 안내 판별. 낱말 하나(시험·날짜·시간)가 아니라 "운영 대상 + 운영 속성"이 함께 있을 때만 걸러서
// 역사 연도, 알고리즘 시간 복잡도, 실험 일정 계산 같은 교과 내용은 남긴다.
const LOGISTICS = [
  // 시험 일정·장소
  /(중간|기말|쪽지|재)\s*(고사|시험)[^.\n]{0,20}(언제|며칠|몇\s*월|몇\s*일|날짜|일자|일시|일정|기간|장소|어디|요일|교시|고사장|강의실|\d+\s*월\s*\d+\s*일)/,
  /(시험|퀴즈)\s*(일정|날짜|일자|일시|기간|장소|고사장|시간표)/,
  // 연락처·상담
  /(교수|강사|조교|담당자)[^.\n]{0,12}(연락처|이메일|e-?mail|전화|연구실|사무실|상담\s*시간)/i,
  /(오피스\s*아워|office\s*hours?)/i,
  // 출석·과제·성적 규칙
  /(출석|결석|지각)[^.\n]{0,12}(규칙|인정|점수|반영|처리|체크|감점|횟수|기준)/,
  /(과제|레포트|리포트|보고서|프로젝트|제출물)[^.\n]{0,12}(제출\s*(기한|마감|기간|일|날짜)|마감|기한|due)/i,
  /(성적|평가|학점)[^.\n]{0,12}(반영\s*비율|반영\s*비중|비율|배점|산출|구성|평가\s*방법)/,
  /(강의실|수업\s*장소|강의\s*장소|수업\s*시간표|강의\s*시간표)/,
];

function isLogistics(text) {
  const t = norm(text);
  return LOGISTICS.some((re) => re.test(t));
}

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
    '- 출제 대상은 교안의 개념, 원리, 정의, 계산, 알고리즘, 개념 비교, 적용 사례처럼 시험 공부에 필요한 학습 내용만이다.',
    '- 출제 제외: 중간·기말고사 날짜와 장소, 강의실, 교수 연락처·오피스아워, 출석 규칙, 과제 제출 기한, 성적 반영 비율 같은 수업 운영 안내. 교안에 적혀 있어도 묻지 않는다. 운영 안내와 학습 내용이 섞인 쪽에서는 학습 내용에서만 출제한다.',
    '- 역사적 사건의 연도, 알고리즘의 시간 복잡도, 실험 일정 계산처럼 교과 내용이면 날짜·시간을 다뤄도 된다.',
    '- 학습 내용이 부족하면 억지로 채우지 말고 만들 수 있는 만큼만 돌려준다.',
    '- 문제마다 선택지 정확히 4개, 정답 1개. 오답도 그럴듯하되 교안 기준으로 분명히 틀려야 한다.',
    '- evidence.quote에는 정답의 근거가 되는 문장을 교안에서 글자 그대로 복사해 넣는다(10자 이상, 고치거나 요약하지 않는다). evidence.page는 그 문장이 있는 쪽 번호다.',
    '- kind에는 문제 종류를 concept(개념·정의), principle(원리), calculation(계산), algorithm(알고리즘), comparison(개념 비교), application(적용 사례) 중 하나로 적는다.',
    '- 교안에 없는 지식으로 묻지 않는다. 같은 내용을 두 번 묻지 않는다.',
    avoid.length ? `- 다음 문제와 겹치지 않게 한다: ${avoid.map((b) => `"${b}"`).join(', ')}` : '',
    '출력은 JSON 하나만. 설명 문장이나 코드 블록 표시 없이:',
    '{"questions":[{"kind":"concept","body":"문제","choices":["보기1","보기2","보기3","보기4"],"answer_index":0,"explanation":"해설","evidence":{"page":1,"quote":"교안 원문 문장"}}]}',
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

const REASON_LOGISTICS = '수업 운영 안내 문항';

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
  // 학습 내용 검사: 모델이 적은 종류가 출제 대상 밖이거나, 문제·근거 문장이 수업 운영 안내면 거른다.
  const kind = q.kind == null ? null : String(q.kind).trim().toLowerCase();
  if (kind !== null && !KINDS.has(kind)) return REASON_LOGISTICS;
  if (isLogistics(body) || isLogistics(quote)) return REASON_LOGISTICS;
  seen.add(squash(body));
  return { body, choices, answerIndex, explanation, evidence: { page, quote }, kind: kind || null };
}

// call: 모델 호출 함수. 검사에서는 모의 응답을 넣는다.
async function generate({ title, pages }, call = callAI) {
  const pageText = new Map(pages.map((p) => [p.page, squash(p.text)]));
  const seen = new Set();
  const valid = [];
  const rejected = [];
  for (const want of [COUNT + 2, null]) {
    const ask = want || COUNT - valid.length + 2;
    const raw = await call(prompt(title, pages, ask, valid.map((q) => q.body)));
    for (const q of parseQuestions(raw)) {
      const r = check(q, pageText, seen);
      if (typeof r === 'string') rejected.push(r);
      else if (valid.length < COUNT) valid.push(r);
    }
    if (valid.length >= COUNT) break;
  }
  if (valid.length < COUNT) {
    const logisticsCount = rejected.filter((r) => r === REASON_LOGISTICS).length;
    const extra = { validCount: valid.length, rejectedReasons: rejected.slice(0, 10), logisticsCount };
    // 운영 안내 때문에 모자라면 억지로 채우지 않고 학습 내용이 있는 범위를 다시 고르게 안내한다.
    if (logisticsCount > 0) {
      throw fail(422, 'not_enough_study_content', `고른 범위에는 시험 공부할 학습 내용이 부족해요(운영 안내 문항 ${logisticsCount}개 제외). 강의 내용이 있는 쪽을 다시 골라 주세요`, extra);
    }
    throw fail(422, 'not_enough_valid', `검사를 통과한 문제가 ${valid.length}개뿐이에요. 다시 시도하거나 범위를 바꿔 주세요`, extra);
  }
  return {
    ok: true,
    source: 'school-ai',
    model: MODEL,
    rulesVersion: RULES_VERSION,
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
module.exports.generate = generate;
module.exports.prompt = prompt;
module.exports.isLogistics = isLogistics;
module.exports.RULES_VERSION = RULES_VERSION;
