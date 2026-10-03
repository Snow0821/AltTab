const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { PDFParse } = require('pdf-parse');

const app = express();
const PORT = process.env.PORT || 3000;

const MAX_TEXT_CHARS = 100000;

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
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function mcpInstructionsHtml(req) {
  const mcpUrl = `${req.protocol}://${req.get('host')}/mcp`;
  return `
  <div class="mcp-box">
    <h3>내 AI로 문제 만들기 (MCP 연동)</h3>
    <p>이 서버는 자료 제공과 결과 저장만 담당합니다. 실제 문제 생성은 여러분이 이미 쓰고 있는 Claude Desktop, Cursor 같은 AI 클라이언트가 직접 수행합니다.</p>
    <ol>
      <li>아래 MCP 서버 주소를 AI 클라이언트의 MCP(커넥터) 설정에 추가하세요.<br>
        <input type="text" readonly value="${escapeHtml(mcpUrl)}" onclick="this.select()"></li>
      <li>연결되면 AI에게 아래처럼 요청하세요:<br>
        <code>list_materials로 업로드된 자료를 확인하고, get_material_text로 내용을 가져와서 4지선다 문제 5개를 만든 다음 submit_questions로 제출해줘.</code></li>
      <li>제출이 끝나면 이 페이지에서 "생성된 문제 보기"로 확인할 수 있습니다.</li>
    </ol>
  </div>`;
}

function renderPage(fileList, message, req) {
  const items = fileList.map((f) => `
    <li class="file-item">
      <div class="file-main">
        <a href="/uploads/${encodeURIComponent(f.storedName)}" target="_blank" rel="noopener">${escapeHtml(f.originalName)}</a>
        <span class="meta">${escapeHtml(f.size)} · ${escapeHtml(f.uploadedAt)}</span>
        <span class="id-tag">자료 ID: ${escapeHtml(f.storedName)}</span>
      </div>
      <div class="file-actions">
        ${f.questions ? `<a href="/questions/${encodeURIComponent(f.storedName)}"><button type="button" class="secondary">생성된 문제 보기</button></a>` : '<span class="meta">아직 문제 없음</span>'}
      </div>
    </li>
  `).join('');

  const body = `
  <h1>교안 PDF 업로드</h1>
  <form action="/upload" method="post" enctype="multipart/form-data">
    <input type="file" name="pdf" accept="application/pdf" required>
    <button type="submit">업로드</button>
  </form>
  ${message ? `<div class="message ${message.type === 'error' ? 'error' : ''}">${escapeHtml(message.text)}</div>` : ''}
  <h2>업로드된 교안</h2>
  ${items ? `<ul>${items}</ul>` : '<p class="empty">아직 업로드된 파일이 없습니다.</p>'}
  ${mcpInstructionsHtml(req)}
  `;

  return pageShell('PassFinder - 교안 업로드', body);
}

function renderQuestionsPage(entry) {
  const cards = entry.questions.map((q, i) => {
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

  const body = `
  <h1>${escapeHtml(entry.originalName)} - 생성된 문제</h1>
  ${cards}
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

    try {
      await extractAndCacheText(req.file.filename);
    } catch (extractErr) {
      console.error('PDF 텍스트 추출 실패:', extractErr);
    }

    const list = readMetadata();
    list.unshift({
      originalName: req.file.originalname,
      storedName: req.file.filename,
      size: formatSize(req.file.size),
      uploadedAt: new Date().toLocaleString('ko-KR')
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
  res.send(renderQuestionsPage(entry));
});

// --- MCP server: exposes uploaded materials to the user's own AI client ---

function buildMcpServer() {
  const server = new McpServer({ name: 'passfinder-mcp', version: '0.1.0' });

  server.registerTool('list_materials', {
    description: '업로드된 교안 자료 목록을 반환합니다. 각 자료는 id(=자료 ID), title, uploadedAt, hasQuestions를 포함합니다.'
  }, async () => {
    const list = readMetadata();
    const materials = list.map((f) => ({
      id: f.storedName,
      title: f.originalName,
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

app.listen(PORT, () => {
  console.log(`PassFinder MVP server running on http://localhost:${PORT}`);
});
