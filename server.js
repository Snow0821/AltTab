const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { PDFParse } = require('pdf-parse');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

const MAX_TEXT_CHARS = 100000;

const QUIZ_STYLE_GUIDANCE = {
  concept: '개념/정의/용어를 정확히 아는지 확인하는 문제를 중심으로 만든다. 계산이나 응용 비중은 낮춘다.',
  applied: '개념을 실제 상황, 예시, 계산에 적용하는 문제를 중심으로 만든다. 단순 정의를 묻는 문제는 1개 이하로 줄인다.',
  mixed: '개념 확인 문제와 응용 문제를 절반씩 섞는다.'
};

function buildQuizCriteriaLines(style) {
  const key = QUIZ_STYLE_GUIDANCE[style] ? style : 'mixed';
  return [
    '- 모든 문제와 정답은 반드시 제공된 자료 본문에 근거해야 한다. 자료에 없는 내용을 지어내지 않는다.',
    '- 자료 전체 범위를 균형 있게 다룬다. 앞부분 내용에만 몰리지 않게 한다.',
    `- 문항 스타일: ${QUIZ_STYLE_GUIDANCE[key]}`,
    '- 난이도는 쉬운 것부터 어려운 순서로 배치한다:',
    '  - 앞쪽 1~2개: 핵심 용어/정의를 묻는 쉬운 확인 문제',
    '  - 중간: 개념 간 관계나 적용을 묻는 문제',
    '  - 뒤쪽: 종합적 이해나 헷갈리기 쉬운 지점을 짚는 문제',
    '- 선택지는 4개. 오답 3개는 그럴듯해야 한다(무관한 보기나 말장난 금지). 자료에 등장하는 비슷한 용어/흔히 헷갈리는 개념을 오답으로 활용한다.',
    '- 질문 문장은 중의적이지 않고 명확하게 쓴다.',
    '- 해설(explanation)에는 정답인 이유와, 헷갈릴 수 있는 오답이 왜 틀렸는지를 1~2문장으로 포함한다.',
    '- 단순 암기보다 이해를 확인하는 문제를 우선한다.'
  ];
}

const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          answer_index: { type: 'integer' },
          explanation: { type: 'string' }
        },
        required: ['question', 'options', 'answer_index', 'explanation'],
        additionalProperties: false
      }
    }
  },
  required: ['questions'],
  additionalProperties: false
};

const uploadDir = path.join(__dirname, 'uploads');
const metadataFile = path.join(uploadDir, 'metadata.json');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
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

function textFilePath(storedName) {
  return path.join(uploadDir, `${storedName}.txt`);
}

async function extractAndCacheText(storedName) {
  const pdfPath = path.join(uploadDir, storedName);
  const parser = new PDFParse({ data: fs.readFileSync(pdfPath) });
  try {
    const result = await parser.getText();
    fs.writeFileSync(textFilePath(storedName), result.text || '');
  } finally {
    await parser.destroy();
  }
}

function fixMulterFilenameEncoding(originalname) {
  // multer/busboy read multipart filename headers as latin1; browsers send UTF-8.
  return Buffer.from(originalname, 'latin1').toString('utf8');
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const fixedName = fixMulterFilenameEncoding(file.originalname);
    const safeBase = path.basename(fixedName, path.extname(fixedName))
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

app.use('/uploads', express.static(uploadDir, { index: false }));

function pageShell(title, bodyHtml) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; max-width: 680px; margin: 0 auto; padding: 24px 16px; background: #f7f7fb; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.1rem; margin-top: 28px; }
  h3 { font-size: 1rem; margin: 0 0 6px; }
  form { display: flex; flex-direction: column; gap: 12px; background: #fff; padding: 16px; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  input[type=file] { padding: 8px; border: 1px solid #ddd; border-radius: 8px; width: 100%; }
  button { padding: 10px 16px; border: none; border-radius: 8px; background: #4f46e5; color: #fff; font-size: 1rem; cursor: pointer; }
  button:hover { background: #4338ca; }
  button.secondary { background: #0ea5e9; }
  button.secondary:hover { background: #0284c7; }
  ul { list-style: none; padding: 0; margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
  .file-item { background: #fff; padding: 12px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .file-item a { color: #4f46e5; text-decoration: none; font-weight: 600; word-break: break-all; }
  .file-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .file-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .meta { font-size: 0.8rem; color: #777; white-space: nowrap; }
  .id-tag { font-size: 0.75rem; color: #555; background: #f1f1f6; padding: 2px 6px; border-radius: 6px; word-break: break-all; }
  .message { margin-top: 12px; padding: 10px; border-radius: 8px; background: #e0f2fe; color: #075985; font-size: 0.9rem; }
  .error { background: #fee2e2; color: #991b1b; }
  .empty { color: #777; font-size: 0.9rem; }
  .question-card { background: #fff; padding: 16px; border-radius: 10px; margin-top: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .question-card p.q { font-weight: 600; margin: 0 0 8px; }
  .question-card ol { margin: 0 0 8px 20px; padding: 0; }
  .question-card details { margin-top: 8px; font-size: 0.9rem; color: #444; }
  .question-card summary { cursor: pointer; color: #4f46e5; font-weight: 600; }
  .back-link { display: inline-block; margin-top: 16px; color: #4f46e5; text-decoration: none; }
  .mcp-box { background: #fff; padding: 16px; border-radius: 12px; margin-top: 16px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); font-size: 0.9rem; line-height: 1.5; }
  .mcp-box code, .mcp-box input[readonly] { background: #f1f1f6; padding: 2px 6px; border-radius: 6px; font-size: 0.85rem; }
  .mcp-box input[readonly] { border: 1px solid #ddd; width: 100%; margin-top: 4px; font-family: monospace; }
  .mcp-box ol { margin: 8px 0 0 18px; padding: 0; }
  .course-tag { font-size: 0.75rem; color: #0369a1; background: #e0f2fe; padding: 2px 6px; border-radius: 6px; }
  .course-folder { margin-top: 10px; }
  .course-folder > summary { font-size: 1.02rem; font-weight: 700; cursor: pointer; padding: 10px 12px; background: #eef2ff; border-radius: 8px; list-style: none; }
  .course-folder > summary::-webkit-details-marker { display: none; }
  .course-folder > summary::before { content: '▸ '; }
  .course-folder[open] > summary::before { content: '▾ '; }
  .week-folder { margin: 8px 0 8px 20px; }
  .week-folder > summary { font-weight: 600; cursor: pointer; padding: 6px 10px; background: #f8fafc; border-radius: 6px; font-size: 0.88rem; color: #333; list-style: none; }
  .week-folder > summary::-webkit-details-marker { display: none; }
  .week-folder > summary::before { content: '▸ '; }
  .week-folder[open] > summary::before { content: '▾ '; }
  .week-folder ul { margin: 8px 0 0 8px; }
  input[type=text].course-input { padding: 8px; border: 1px solid #ddd; border-radius: 8px; width: 100%; }
  .share-section { margin-top: 24px; }
  .share-section h2 { margin-bottom: 4px; }
  .share-section .sub { color: #777; font-size: 0.85rem; margin: 0 0 10px; }
  .share-group { margin-top: 12px; }
  .share-group h4 { margin: 0 0 4px; font-size: 0.9rem; color: #333; }
  .generate-form { flex-direction: row; flex-wrap: wrap; padding: 0; background: none; box-shadow: none; gap: 6px; align-items: center; }
  .generate-form input[type=password], .generate-form select, .generate-form input[type=number] { padding: 6px 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 0.82rem; }
  .generate-form input[type=password] { width: 150px; }
  .generate-form input[type=number] { width: 55px; }
  .generate-form button { padding: 6px 10px; font-size: 0.85rem; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function mcpInstructionsHtml(req) {
  const origin = `${req.protocol}://${req.get('host')}`;
  const streamableUrl = `${origin}/mcp`;
  const sseUrl = `${origin}/sse`;
  const promptText = 'list_materials로 업로드된 자료를 확인하고, get_material_text로 내용을 가져와서 4지선다 문제 5개를 만든 다음 submit_questions로 제출해줘.';

  return `
  <div class="mcp-box">
    <h3>Claude 사용자</h3>
    <ol>
      <li>아래 주소를 복사하세요.<br>
        <input type="text" readonly value="${escapeHtml(streamableUrl)}" onclick="this.select()"></li>
      <li>Claude Desktop(또는 claude.ai)에서 <strong>설정 → Connectors → Add custom connector</strong>를 누르고 방금 복사한 주소를 붙여넣으세요.</li>
    </ol>

    <h3 style="margin-top:18px;">ChatGPT 사용자</h3>
    <ol>
      <li>아래 주소를 복사하세요.<br>
        <input type="text" readonly value="${escapeHtml(sseUrl)}" onclick="this.select()"></li>
      <li>ChatGPT에서 <strong>설정 → Security and login → Developer mode</strong>를 켠 다음, 커넥터 추가 화면에서 방금 복사한 주소를 붙여넣으세요.</li>
    </ol>

    <h3 style="margin-top:18px;">Gemini 사용자</h3>
    <ol>
      <li>아래 주소를 복사하세요.<br>
        <input type="text" readonly value="${escapeHtml(streamableUrl)}" onclick="this.select()"></li>
      <li>Gemini 앱의 <strong>Spark</strong> 기능 안에서 Connected Apps(커스텀 앱 연결)을 열고 방금 복사한 주소를 추가하세요.</li>
      <li>개인 Google 계정(학교/회사 계정 불가), 18세 이상, 미국 리전, Keep Activity 설정이 켜져 있어야 동작합니다. 이 서버가 <code>localhost</code>인 동안에는 Gemini에서 연결되지 않으니, 공개 배포 후 그 주소로 다시 시도하세요.</li>
    </ol>

    <h3 style="margin-top:18px;">연결 후 공통</h3>
    <p>연결이 끝나면 AI에게 아래처럼 요청하세요:<br>
      <code>${escapeHtml(promptText)}</code></p>
    <p>제출이 끝나면 이 페이지에서 "생성된 문제 보기"로 확인할 수 있습니다.</p>
  </div>`;
}

function renderFileItem(f) {
  const actions = f.questions
    ? `<a href="/questions/${encodeURIComponent(f.storedName)}"><button type="button" class="secondary">생성된 문제 보기</button></a>`
    : `
      <form class="generate-form" action="/generate/${encodeURIComponent(f.storedName)}" method="post"
            onsubmit="localStorage.setItem('passfinder_api_key', this.apiKey.value)">
        <input type="password" name="apiKey" class="apikey-input" placeholder="Anthropic API 키" autocomplete="off" required>
        <select name="style">
          <option value="mixed">혼합</option>
          <option value="concept">개념확인</option>
          <option value="applied">응용</option>
        </select>
        <input type="number" name="count" min="1" max="20" value="5">
        <button type="submit" class="secondary">문제 생성</button>
      </form>
    `;

  return `
    <li class="file-item">
      <div class="file-main">
        <a href="/uploads/${encodeURIComponent(f.storedName)}" target="_blank" rel="noopener">${escapeHtml(f.originalName)}</a>
        <span class="meta">${escapeHtml(f.size)} · ${escapeHtml(f.uploadedAt)}</span>
        <span class="id-tag">자료 ID: ${escapeHtml(f.storedName)}</span>
      </div>
      <div class="file-actions">
        ${actions}
      </div>
    </li>
  `;
}

function groupMaterialsByCourseAndWeek(fileList) {
  const groups = new Map();
  for (const f of fileList) {
    const groupKey = `${f.course}|||${f.professor}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { course: f.course, professor: f.professor, weeks: new Map() });
    }
    const group = groups.get(groupKey);
    const weekKey = String(f.week);
    if (!group.weeks.has(weekKey)) group.weeks.set(weekKey, []);
    group.weeks.get(weekKey).push(f);
  }

  const sortedGroups = Array.from(groups.values()).sort((a, b) =>
    a.course.localeCompare(b.course, 'ko') || a.professor.localeCompare(b.professor, 'ko')
  );
  for (const group of sortedGroups) {
    group.weeks = new Map(Array.from(group.weeks.entries()).sort((a, b) => Number(a[0]) - Number(b[0])));
  }
  return sortedGroups;
}

function renderFileTree(fileList) {
  if (!fileList.length) return '<p class="empty">아직 업로드된 파일이 없습니다.</p>';

  const groups = groupMaterialsByCourseAndWeek(fileList);
  return groups.map((group) => {
    const weekSections = Array.from(group.weeks.entries()).map(([week, files]) => `
      <details class="week-folder" open>
        <summary>${escapeHtml(week)}주차 (${files.length})</summary>
        <ul>${files.map(renderFileItem).join('')}</ul>
      </details>
    `).join('');

    return `
      <details class="course-folder" open>
        <summary>${escapeHtml(group.course)} · ${escapeHtml(group.professor)} 교수</summary>
        ${weekSections}
      </details>
    `;
  }).join('');
}

function renderPage(fileList, message, req) {
  const body = `
  <h1>교안 PDF 업로드</h1>
  <form action="/upload" method="post" enctype="multipart/form-data">
    <input type="text" name="course" class="course-input" placeholder="과목명 (예: 알고리즘)" required>
    <input type="text" name="professor" class="course-input" placeholder="교수명 (예: 이현기)" required>
    <input type="number" name="week" class="course-input" placeholder="몇 주차 수업인가요? (예: 4)" min="1" max="20" required>
    <input type="file" name="pdf" accept="application/pdf" required>
    <button type="submit">업로드</button>
  </form>
  ${message ? `<div class="message ${message.type === 'error' ? 'error' : ''}">${escapeHtml(message.text)}</div>` : ''}
  <h2>업로드된 교안</h2>
  ${renderFileTree(fileList)}
  ${mcpInstructionsHtml(req)}
  <script>
    (function() {
      var saved = localStorage.getItem('passfinder_api_key') || '';
      document.querySelectorAll('.apikey-input').forEach(function(el) { el.value = saved; });
    })();
  </script>
  `;

  return pageShell('PassFinder - 교안 업로드', body);
}

function renderQuestionCards(questions) {
  return questions.map((q, i) => {
    const options = q.options.map((opt) => `<li>${escapeHtml(opt)}</li>`).join('');
    const answerText = q.options[q.answer_index] !== undefined ? q.options[q.answer_index] : '?';
    return `
    <div class="question-card">
      <p class="q">${i + 1}. ${escapeHtml(q.question)}</p>
      <ol type="1">${options}</ol>
      <details>
        <summary>정답 및 해설 보기</summary>
        <p><strong>정답:</strong> ${escapeHtml(answerText)}</p>
        <p>${escapeHtml(q.explanation)}</p>
      </details>
    </div>
  `;
  }).join('');
}

function renderSharedGroup(entries) {
  return entries.map((f) => `
    <div class="share-group">
      <h4>${escapeHtml(f.originalName)} · ${escapeHtml(f.professor)} 교수 · ${escapeHtml(f.week)}주차</h4>
      ${renderQuestionCards(f.questions)}
    </div>
  `).join('');
}

function renderQuestionsPage(entry, allList) {
  // Only surface questions from materials covering the exact same week —
  // otherwise "more practice" silently mixes in a different lecture's scope.
  const sameWeek = (f) =>
    f.storedName !== entry.storedName && f.course === entry.course && String(f.week) === String(entry.week) && f.questions && f.questions.length;

  const sameProfessor = allList.filter((f) => sameWeek(f) && f.professor === entry.professor);
  const otherProfessor = allList.filter((f) => sameWeek(f) && f.professor !== entry.professor);

  const body = `
  <h1>${escapeHtml(entry.originalName)} - 생성된 문제</h1>
  <p class="meta">${escapeHtml(entry.course)} · ${escapeHtml(entry.professor)} 교수 · ${escapeHtml(entry.week)}주차</p>
  ${renderQuestionCards(entry.questions)}

  <div class="share-section">
    <h2>같은 주차 · 같은 교수님 문제 더 풀어보기</h2>
    <p class="sub">다른 사람이 이 교수님의 "${escapeHtml(entry.course)}" ${escapeHtml(entry.week)}주차 자료로 만든 문제입니다.</p>
    ${sameProfessor.length ? renderSharedGroup(sameProfessor) : '<p class="empty">아직 없습니다.</p>'}
  </div>

  <div class="share-section">
    <h2>같은 주차 · 다른 교수님 문제 더 풀어보기</h2>
    <p class="sub">다른 교수님의 "${escapeHtml(entry.course)}" ${escapeHtml(entry.week)}주차 자료로 만든 문제입니다.</p>
    ${otherProfessor.length ? renderSharedGroup(otherProfessor) : '<p class="empty">아직 없습니다.</p>'}
  </div>

  <a class="back-link" href="/">&larr; 목록으로 돌아가기</a>
  `;

  return pageShell('PassFinder - 생성된 문제', body);
}

app.get('/', (req, res) => {
  res.send(renderPage(readMetadata(), null, req));
});

app.post('/upload', (req, res) => {
  upload.single('pdf')(req, res, async (err) => {
    if (err) {
      return res.status(400).send(renderPage(readMetadata(), { type: 'error', text: err.message }, req));
    }
    if (!req.file) {
      return res.status(400).send(renderPage(readMetadata(), { type: 'error', text: '파일을 선택해주세요.' }, req));
    }

    const course = (req.body.course || '').trim();
    const professor = (req.body.professor || '').trim();
    const week = (req.body.week || '').trim();
    if (!course || !professor || !week || !Number.isInteger(Number(week)) || Number(week) < 1) {
      fs.unlinkSync(path.join(uploadDir, req.file.filename));
      return res.status(400).send(renderPage(readMetadata(), { type: 'error', text: '과목명, 교수명, 주차(숫자)를 모두 입력해주세요.' }, req));
    }

    try {
      await extractAndCacheText(req.file.filename);
    } catch (extractErr) {
      console.error('PDF 텍스트 추출 실패:', extractErr);
    }

    const list = readMetadata();
    list.unshift({
      originalName: fixMulterFilenameEncoding(req.file.originalname),
      storedName: req.file.filename,
      size: formatSize(req.file.size),
      uploadedAt: new Date().toLocaleString('ko-KR'),
      course,
      professor,
      week: Number(week)
    });
    writeMetadata(list);
    res.redirect('/');
  });
});

app.get('/questions/:storedName', (req, res) => {
  const list = readMetadata();
  const entry = list.find((f) => f.storedName === req.params.storedName);
  if (!entry || !entry.questions) {
    return res.redirect('/');
  }
  res.send(renderQuestionsPage(entry, list));
});

// --- Server-proxied generation: user supplies their own Anthropic API key per request.
// The key is never written to disk or logged; it is used only for this one call. ---

app.post('/generate/:storedName', express.urlencoded({ extended: false }), async (req, res) => {
  const list = readMetadata();
  const entry = list.find((f) => f.storedName === req.params.storedName);
  if (!entry) {
    return res.status(404).send(renderPage(list, { type: 'error', text: '자료를 찾을 수 없습니다.' }, req));
  }

  const apiKey = (req.body.apiKey || '').trim();
  if (!apiKey) {
    return res.status(400).send(renderPage(list, { type: 'error', text: 'Anthropic API 키를 입력해주세요.' }, req));
  }

  const count = Math.min(Math.max(Number(req.body.count) || 5, 1), 20);
  const style = req.body.style || 'mixed';

  const txtPath = textFilePath(entry.storedName);
  if (!fs.existsSync(txtPath)) {
    return res.status(400).send(renderPage(list, { type: 'error', text: '이 자료는 아직 텍스트 추출이 끝나지 않았습니다. 잠시 후 다시 시도해주세요.' }, req));
  }
  let materialText = fs.readFileSync(txtPath, 'utf-8');
  if (materialText.length > MAX_TEXT_CHARS) {
    materialText = materialText.slice(0, MAX_TEXT_CHARS) + '\n\n[내용이 길어 일부만 제공됩니다]';
  }

  const promptText = [
    `너는 대학생의 시험 대비를 돕는 문제 출제자야. 아래 자료를 바탕으로 객관식 문제 ${count}개를 만들어줘.`,
    '',
    '[출제 기준]',
    ...buildQuizCriteriaLines(style),
    '',
    '[자료 본문]',
    materialText
  ].join('\n');

  try {
    const anthropic = new Anthropic({ apiKey });
    const message = await anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 8000,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: QUESTION_SCHEMA }
      },
      messages: [{ role: 'user', content: promptText }]
    });

    if (message.stop_reason === 'refusal') {
      throw new Error('모델이 요청을 거부했습니다. 다른 자료로 다시 시도해주세요.');
    }
    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock) {
      throw new Error('모델 응답에서 텍스트를 찾을 수 없습니다.');
    }

    const parsed = JSON.parse(textBlock.text);
    entry.questions = parsed.questions;
    writeMetadata(list);
    res.redirect(`/questions/${encodeURIComponent(entry.storedName)}`);
  } catch (err) {
    console.error('문제 생성 오류:', err.message);
    res.status(500).send(renderPage(list, { type: 'error', text: '문제 생성 중 오류가 발생했습니다: ' + err.message }, req));
  }
});

// --- MCP server: exposes uploaded materials to the user's own AI client ---

function buildMcpServer() {
  const server = new McpServer({ name: 'passfinder-mcp', version: '0.1.0' });

  server.registerTool('list_materials', {
    description: '업로드된 교안 자료 목록을 반환합니다. 각 자료는 id(=자료 ID), title, course, professor, week(주차), uploadedAt, hasQuestions를 포함합니다.'
  }, async () => {
    const list = readMetadata();
    const materials = list.map((f) => ({
      id: f.storedName,
      title: f.originalName,
      course: f.course,
      professor: f.professor,
      week: f.week,
      uploadedAt: f.uploadedAt,
      hasQuestions: Boolean(f.questions)
    }));
    return { content: [{ type: 'text', text: JSON.stringify({ materials }, null, 2) }] };
  });

  server.registerTool('get_material_text', {
    description: 'list_materials로 얻은 자료 ID를 이용해 해당 교안 PDF에서 추출한 텍스트 내용을 가져옵니다.',
    inputSchema: {
      id: z.string().describe('자료 ID (list_materials의 id 값)')
    }
  }, async ({ id }) => {
    const list = readMetadata();
    const entry = list.find((f) => f.storedName === id);
    if (!entry) {
      return { content: [{ type: 'text', text: `자료 ID "${id}"를 찾을 수 없습니다.` }], isError: true };
    }
    const txtPath = textFilePath(id);
    if (!fs.existsSync(txtPath)) {
      return { content: [{ type: 'text', text: '이 자료는 아직 텍스트 추출이 끝나지 않았습니다. 잠시 후 다시 시도해주세요.' }], isError: true };
    }
    let text = fs.readFileSync(txtPath, 'utf-8');
    if (text.length > MAX_TEXT_CHARS) {
      text = text.slice(0, MAX_TEXT_CHARS) + '\n\n[내용이 길어 일부만 제공됩니다]';
    }
    return { content: [{ type: 'text', text }] };
  });

  server.registerTool('submit_questions', {
    description: '생성한 객관식 문제를 자료 ID에 저장합니다. 저장 후 사용자는 웹 페이지에서 바로 확인할 수 있습니다.',
    inputSchema: {
      id: z.string().describe('문제를 생성한 자료의 ID'),
      questions: z.array(z.object({
        question: z.string().describe('문제 질문'),
        options: z.array(z.string()).length(4).describe('선택지 4개'),
        answer_index: z.number().int().min(0).max(3).describe('정답 선택지의 0부터 시작하는 인덱스'),
        explanation: z.string().describe('정답에 대한 간단한 해설')
      })).min(1).describe('생성된 객관식 문제 목록')
    }
  }, async ({ id, questions }) => {
    const list = readMetadata();
    const entry = list.find((f) => f.storedName === id);
    if (!entry) {
      return { content: [{ type: 'text', text: `자료 ID "${id}"를 찾을 수 없습니다.` }], isError: true };
    }
    entry.questions = questions;
    writeMetadata(list);
    return { content: [{ type: 'text', text: `${questions.length}개의 문제가 저장되었습니다. 자료 ID: ${id}` }] };
  });

  server.registerPrompt('generate_quiz', {
    title: '출제 기준에 맞춰 문제 생성',
    description: '자료 ID를 지정하면, 출제 기준(난이도 배분/오답 품질/근거 기반 등)을 포함한 전체 지시문을 생성합니다.',
    argsSchema: {
      materialId: z.string().describe('문제를 생성할 자료 ID (list_materials 결과의 id 값)'),
      count: z.string().optional().describe('생성할 문제 개수 (기본값 5)'),
      style: z.string().optional().describe('문항 스타일: concept(개념확인 중심) / applied(응용·사례 중심) / mixed(혼합, 기본값)')
    }
  }, async ({ materialId, count, style }) => {
    const n = count && Number.isFinite(Number(count)) ? Number(count) : 5;
    const text = [
      '너는 대학생의 시험 대비를 돕는 문제 출제자야. 아래 절차와 출제 기준을 반드시 지켜서 문제를 만들어줘.',
      '',
      '[절차]',
      `1. get_material_text 도구로 자료 ID "${materialId}"의 내용을 가져온다.`,
      `2. 아래 출제 기준에 따라 객관식 문제 ${n}개를 만든다.`,
      `3. submit_questions 도구로 자료 ID "${materialId}"에 제출한다.`,
      '',
      '[출제 기준]',
      ...buildQuizCriteriaLines(style)
    ].join('\n');
    return { messages: [{ role: 'user', content: { type: 'text', text } }] };
  });

  return server;
}

app.post('/mcp', express.json(), async (req, res) => {
  const server = buildMcpServer();
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      transport.close();
      server.close();
    });
  } catch (err) {
    console.error('MCP 요청 처리 오류:', err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
});

app.get('/mcp', (req, res) => {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
});

app.delete('/mcp', (req, res) => {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
});

// --- Legacy HTTP+SSE transport: some clients (e.g. ChatGPT custom connectors) require this instead of Streamable HTTP ---

const sseSessions = new Map();
const SSE_IDLE_MS = 30 * 60000;

setInterval(() => {
  const cutoff = Date.now() - SSE_IDLE_MS;
  for (const [sessionId, session] of sseSessions) {
    if (session.lastActive < cutoff) {
      session.transport.close().catch(() => {});
      sseSessions.delete(sessionId);
    }
  }
}, 60000).unref();

app.get('/sse', async (req, res) => {
  const server = buildMcpServer();
  const transport = new SSEServerTransport('/messages', res);
  sseSessions.set(transport.sessionId, { transport, lastActive: Date.now() });
  transport.onclose = () => {
    sseSessions.delete(transport.sessionId);
    server.close();
  };
  await server.connect(transport);
});

app.post('/messages', express.json(), async (req, res) => {
  const sessionId = req.query.sessionId;
  const session = sseSessions.get(sessionId);
  if (!session) {
    return res.status(400).send('알 수 없는 세션입니다. GET /sse로 먼저 연결하세요.');
  }
  session.lastActive = Date.now();
  await session.transport.handlePostMessage(req, res, req.body);
});

app.listen(PORT, () => {
  console.log(`PassFinder MVP server running on http://localhost:${PORT}`);
});
