import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const legacyRoot = path.join(root, 'mvp-express');

test('study assets serve correctly and existing PDF upload flow is preserved', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'alttab-ui-test-'));
  const port = process.env.UI_TEST_PORT || '3493';
  const child = spawn(process.execPath, ['server.js'], { cwd: legacyRoot, env: { ...process.env, PORT: port, VERCEL: '1', TMPDIR: temp, TEMP: temp, TMP: temp, SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  try {
    for (let i = 0; i < 100 && !output.includes('server running'); i++) {
      if (child.exitCode !== null) throw new Error(output);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.match(output, /server running/);
    const origin = `http://127.0.0.1:${port}`;
    const home = await fetch(origin); assert.equal(home.status, 200); assert.match(await home.text(), /교안 PDF 업로드/);
    const redirect = await fetch(`${origin}/study`, { redirect: 'manual' }); assert.equal(redirect.status, 301); assert.equal(redirect.headers.get('location'), '/study/');
    const page = await fetch(`${origin}/study/`); assert.equal(page.status, 200); assert.match(await page.text(), /샘플 데이터로 체험/);
    for (const asset of ['styles.css', 'app.mjs', 'domain.mjs', 'demo-data.mjs']) {
      const response = await fetch(`${origin}/study/${asset}`); assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), asset.endsWith('.css') ? /text\/css/ : /javascript/);
      assert.equal(await response.text(), await readFile(path.join(root, 'public/exam-workspace', asset), 'utf8'));
    }
    assert.equal((await fetch(`${origin}/study/missing.mjs`)).status, 404);
    const pdf = '%PDF-1.4\npublic smoke-test fixture\n%%EOF';
    const form = new FormData(); form.append('pdf', new Blob([pdf], { type: 'application/pdf' }), 'ui-smoke.pdf');
    const upload = await fetch(`${origin}/upload`, { method: 'POST', body: form, redirect: 'manual' });
    assert.equal(upload.status, 302); assert.equal(upload.headers.get('location'), '/');
    const updated = await (await fetch(origin)).text(); assert.match(updated, /ui-smoke\.pdf/);
    const file = updated.match(/href="(\/uploads\/[^\"]+)"/)[1];
    assert.equal(await (await fetch(origin + file)).text(), pdf);
    const invalid = new FormData(); invalid.append('pdf', new Blob(['not a pdf'], { type: 'text/plain' }), 'invalid.txt');
    assert.equal((await fetch(`${origin}/upload`, { method: 'POST', body: invalid })).status, 400);
    assert.equal((await fetch(`${origin}/upload`, { method: 'POST', body: new FormData() })).status, 400);
  } finally {
    if (child.exitCode === null) await new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
    await rm(temp, { recursive: true, force: true });
  }
});
