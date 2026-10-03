const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

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

app.use('/uploads', express.static(uploadDir, { index: false }));

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
  body { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px 16px; background: #f7f7fb; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.1rem; margin-top: 28px; }
  form { display: flex; flex-direction: column; gap: 12px; background: #fff; padding: 16px; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  input[type=file] { padding: 8px; border: 1px solid #ddd; border-radius: 8px; width: 100%; }
  button { padding: 10px 16px; border: none; border-radius: 8px; background: #4f46e5; color: #fff; font-size: 1rem; cursor: pointer; }
  button:hover { background: #4338ca; }
  ul { list-style: none; padding: 0; margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
  .file-item { background: #fff; padding: 12px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .file-item a { color: #4f46e5; text-decoration: none; font-weight: 600; word-break: break-all; }
  .meta { font-size: 0.8rem; color: #777; white-space: nowrap; }
  .message { margin-top: 12px; padding: 10px; border-radius: 8px; background: #e0f2fe; color: #075985; font-size: 0.9rem; }
  .error { background: #fee2e2; color: #991b1b; }
  .empty { color: #777; font-size: 0.9rem; }
</style>
</head>
<body>
  <h1>교안 PDF 업로드</h1>
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

app.get('/', (req, res) => {
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
    res.redirect('/');
  });
});

app.listen(PORT, () => {
  console.log(`PassFinder MVP server running on http://localhost:${PORT}`);
});
