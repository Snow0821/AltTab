const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const scores = require('./scores');
const exam = require('./exam');
const entitlements = require('./entitlements');

const app = express();
const PORT = process.env.PORT || 3000;

// Isolated, bounded DB/LLM demo. Secrets stay in this server module.
require('./connection-check')(app);
// Public, fixed-allowlist database viewer. No writes or generic DB access.
require('./admin-viewer')(app);

// FR-12 교안으로 문제 만들기 API. 고른 쪽의 글자를 받으므로 기본 100KB보다 큰 본문을 허용한다.
app.use('/api/generate', express.json({ limit: '600kb' }));
require('./ai-generate')(app);

// 점수 API용 JSON 바디 파서 (업로드 멀티파트와는 별개 경로에만 적용됨)
app.use(express.json());

// Vercel 서버는 코드 폴더가 읽기 전용(EROFS)이라 쓸 수 있는 임시 폴더(/tmp)에 저장한다.
// 임시 폴더는 서버 인스턴스가 바뀌면 비워지므로 Vercel에서는 업로드가 오래 남지 않는다.
const dataRoot = process.env.VERCEL ? os.tmpdir() : __dirname;
const uploadDir = path.join(dataRoot, 'uploads');
const metadataFile = path.join(uploadDir, 'metadata.json');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(metadataFile)) fs.writeFileSync(metadataFile, '[]');

function readMetadata() {
  return JSON.parse(fs.readFileSync(metadataFile, 'utf-8'));
}

function writeMetadata(data) {
  fs.writeFileSync(metadataFile, JSON.stringify(data, null, 2));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const safeBase = path.basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-zA-Z0-9가-힣_-]/g, '_')
      .slice(0, 60);
    cb(null, `${Date.now()}-${safeBase}.pdf`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('PDF 파일만 업로드할 수 있습니다.'));
  }
});

// Only uploaded PDFs are public; question sets and attempts contain private answers.
app.use('/uploads', (req, res, next) => {
  if (!req.path.toLowerCase().endsWith('.pdf')) return res.sendStatus(404);
  next();
}, express.static(uploadDir, { index: false }));
// Study screens are served independently of the main entry page.
// All primary entry URLs open the current login-first UI. Keep the legacy bank explicit.
app.get(['/study', '/study/', '/study/index.html'], (req, res) => res.redirect(302, '/'));
app.get('/study/bank.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'exam-workspace', 'index.html')));
app.use('/study', express.static(path.join(__dirname, 'public', 'exam-workspace')));
// Serve the integrated entry at both the site root and its explicit file URL.
app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

function renderPage(fileList, message) {
  const items = fileList.map((f) => `
    <li class="file-item">
      <a href="/uploads/${encodeURIComponent(f.storedName)}" target="_blank" rel="noopener">${escapeHtml(f.originalName)}</a>
      <span class="meta">${escapeHtml(f.size)} · ${escapeHtml(f.uploadedAt)}</span>
    </li>
  `).join('');

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PassFinder - 교안 업로드</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px 16px; background: #f6f8f7; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.1rem; margin-top: 28px; }
  form { display: flex; flex-direction: column; gap: 12px; background: #fff; padding: 16px; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  input[type=file] { padding: 8px; border: 1px solid #ddd; border-radius: 8px; width: 100%; }
  button { padding: 10px 16px; border: none; border-radius: 8px; background: #0d806c; color: #fff; font-size: 1rem; cursor: pointer; }
  button:hover { background: #086c5b; }
  ul { list-style: none; padding: 0; margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
  .file-item { background: #fff; padding: 12px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .file-item a { color: #0d806c; text-decoration: none; font-weight: 600; word-break: break-all; }
  .meta { font-size: 0.8rem; color: #777; white-space: nowrap; }
  .message { margin-top: 12px; padding: 10px; border-radius: 8px; background: #e0f2fe; color: #075985; font-size: 0.9rem; }
  .error { background: #fee2e2; color: #991b1b; }
  .empty { color: #777; font-size: 0.9rem; }
</style>
</head>
<body>
  <p><a href="/">← 내 과목</a></p>
  <h1>교안 PDF 업로드</h1>
  <p><a href="/study/make.html">교안으로 AI 문제 5개 만들고 공부하기 →</a></p>
  <p>개인 AI 계정 없이 이용할 수 있어요. 문제와 풀이 기록은 이 브라우저에 저장돼요.</p>
  <form action="/upload" method="post" enctype="multipart/form-data">
    <input type="file" name="pdf" accept="application/pdf" required>
    <button type="submit">업로드</button>
  </form>
  ${message ? `<div class="message ${message.type === 'error' ? 'error' : ''}">${escapeHtml(message.text)}</div>` : ''}
  <h2>업로드된 교안</h2>
  ${items ? `<ul>${items}</ul>` : '<p class="empty">아직 업로드된 파일이 없습니다.</p>'}
</body>
</html>`;
}

// Keep the original PDF upload screen available for later use.
app.get(['/upload', '/materials-upload'], (req, res) => {
  res.send(renderPage(readMetadata()));
});

app.post('/upload', (req, res) => {
  upload.single('pdf')(req, res, (err) => {
    if (err) {
      return res.status(400).send(renderPage(readMetadata(), { type: 'error', text: err.message }));
    }
    if (!req.file) {
      return res.status(400).send(renderPage(readMetadata(), { type: 'error', text: '파일을 선택해주세요.' }));
    }

    const list = readMetadata();
    list.unshift({
      originalName: req.file.originalname,
      storedName: req.file.filename,
      size: formatSize(req.file.size),
      uploadedAt: new Date().toLocaleString('ko-KR')
    });
    writeMetadata(list);
    res.redirect('/upload');
  });
});

// ===== 점수 저장 / 랭킹 (실시간) =====
// 화면(프런트)은 별도 작업 중이므로 서버는 JSON API + SSE 스트림만 제공한다.

// SSE 구독자 목록
const rankingClients = new Set();

// 현재 랭킹을 모든 SSE 구독자에게 전송
async function broadcastLeaderboard() {
  if (rankingClients.size === 0) return;
  let board;
  try {
    board = await scores.getLeaderboard();
  } catch (err) {
    console.error('[ranking] 랭킹 조회 실패:', err.message);
    return;
  }
  const payload = `data: ${JSON.stringify({ leaderboard: board })}\n\n`;
  for (const res of rankingClients) {
    res.write(payload);
  }
}

// 점수 저장: POST /api/scores  { playerName, score, quizId? }
app.post('/api/scores', async (req, res) => {
  try {
    const record = await scores.saveScore(req.body || {});
    // 저장 성공 → 실시간 랭킹 갱신 브로드캐스트
    broadcastLeaderboard();
    res.status(201).json({ ok: true, record });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ ok: false, error: err.message });
  }
});

// 랭킹 1회 조회: GET /api/leaderboard?limit=20
app.get('/api/leaderboard', async (req, res) => {
  try {
    const board = await scores.getLeaderboard(req.query.limit);
    res.json({ ok: true, mode: scores.getMode(), leaderboard: board });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ ok: false, error: err.message });
  }
});

// 실시간 랭킹 스트림: GET /api/leaderboard/stream (SSE)
app.get('/api/leaderboard/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write('retry: 3000\n\n');
  rankingClients.add(res);

  // 접속 즉시 현재 랭킹 1회 전송
  try {
    const board = await scores.getLeaderboard();
    res.write(`data: ${JSON.stringify({ leaderboard: board })}\n\n`);
  } catch (err) {
    console.error('[ranking] 초기 랭킹 전송 실패:', err.message);
  }

  // 연결 유지용 핑(프록시 타임아웃 방지)
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(ping);
    rankingClients.delete(res);
  });
});

// ===== 이용권 (FR-06) =====
// 과목 접근 판정: GET /api/courses/:courseId/access?userId=&stageUnit=
app.get('/api/courses/:courseId/access', (req, res) => {
  try {
    const userId = req.query.userId || 'anonymous';
    const stageUnit = req.query.stageUnit !== undefined ? Number(req.query.stageUnit) : undefined;
    const access = entitlements.getAccess(req.params.courseId, userId, { stageUnit });
    res.json({ ok: true, ...access });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ ok: false, error: err.message, code: err.code });
  }
});

// 테스트(모의) 결제: POST /api/courses/:courseId/entitlements  { userId?, plan, simulateFailure? }
app.post('/api/courses/:courseId/entitlements', (req, res) => {
  try {
    const body = req.body || {};
    const result = entitlements.purchase(req.params.courseId, body.userId || 'anonymous', body.plan, {
      simulateFailure: !!body.simulateFailure
    });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ ok: false, error: err.message, code: err.code });
  }
});

// ===== 시험 출제 / 서버 채점 =====
// 정답/해설은 서버에만 둔다. 출제 응답에는 정답을 포함하지 않고, 채점은 서버에서만 한다.

// 스테이지 출제: POST /api/stages/:stageId/attempts  { userId?, courseId? }
app.post('/api/stages/:stageId/attempts', (req, res) => {
  try {
    const body = req.body || {};
    const userId = body.userId || 'anonymous';
    const stageId = req.params.stageId;

    // 이용권 접근 제한: 무료 유닛을 넘는 스테이지는 이용권이 있어야 출제된다.
    const unit = exam.stageUnit(stageId);
    if (unit === null) {
      return res.status(404).json({ ok: false, error: `존재하지 않는 스테이지입니다: ${stageId}` });
    }
    const courseId = body.courseId || exam.COURSE.id;
    const access = entitlements.getAccess(courseId, userId, { stageUnit: unit });
    if (!access.canPlay) {
      return res.status(403).json({
        ok: false,
        error: '이용권이 필요합니다. 결제 후 이용할 수 있어요.',
        code: 'payment_required',
        access
      });
    }

    const attempt = exam.createAttempt(stageId, userId);
    res.status(201).json({ ok: true, ...attempt });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ ok: false, error: err.message, code: err.code });
  }
});

// 답안 제출/채점: POST /api/attempts/:attemptId/answers  { answers: { [questionId]: choiceIndex } }
app.post('/api/attempts/:attemptId/answers', (req, res) => {
  try {
    const answers = (req.body && req.body.answers) || {};
    const result = exam.gradeAttempt(req.params.attemptId, answers);
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ ok: false, error: err.message, code: err.code });
  }
});

// ===== 생성 문제 세트 저장 / 세트로 출제 =====
// 팀원의 /api/generate(ai-generate.js)로 만든 문제를 저장하고, 그 세트로 풀이를 연결한다.

// 세트 저장: POST /api/question-sets  { title?, courseId?, source?, questions:[...] }
app.post('/api/question-sets', (req, res) => {
  try {
    const summary = exam.saveQuestionSet(req.body || {});
    res.status(201).json({ ok: true, ...summary });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ ok: false, error: err.message, code: err.code });
  }
});

// 저장 세트로 출제: POST /api/question-sets/:setId/attempts  { userId? }
app.post('/api/question-sets/:setId/attempts', (req, res) => {
  try {
    const userId = (req.body && req.body.userId) || 'anonymous';
    const attempt = exam.createAttemptFromSet(req.params.setId, userId);
    res.status(201).json({ ok: true, ...attempt });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ ok: false, error: err.message, code: err.code });
  }
});

// ===== 진행률 / 스테이지 맵 (FR-04 일부) =====
// GET /api/courses/:courseId/progress?userId=
// 스테이지별 상태(잠금/열림/클리어)·별·요약(진행률/XP)을 반환한다.
// 선수 스테이지 잠금(exam)과 이용권 잠금(entitlements)을 결합한다.
app.get('/api/courses/:courseId/progress', (req, res) => {
  try {
    const userId = req.query.userId || 'anonymous';
    const courseId = req.params.courseId;
    const progress = exam.getProgress(courseId, userId);

    // 이용권 잠금 결합: 무료 유닛을 넘는 스테이지는 이용권 없으면 locked로 덮어쓴다.
    const stages = progress.stages.map((s) => {
      const access = entitlements.getAccess(courseId, userId, { stageUnit: s.unit });
      if (!access.canPlay && s.status !== 'cleared') {
        return { ...s, status: 'locked', lockReason: 'payment_required' };
      }
      return s;
    });

    const access = entitlements.getAccess(courseId, userId);
    res.json({
      ok: true,
      ...progress,
      stages,
      entitlement: {
        hasEntitlement: access.hasEntitlement,
        entitlementType: access.entitlementType,
        expiresAt: access.expiresAt,
        paymentMode: access.paymentMode,
        freeUnitLimit: access.freeUnitLimit
      }
    });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ ok: false, error: err.message, code: err.code });
  }
});

app.listen(PORT, () => {
  console.log(`passfinder MVP server running on http://localhost:${PORT}`);
  console.log(`[scores] 저장 모드: ${scores.getMode()}`);
});
