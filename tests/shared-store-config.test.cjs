const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function start(extra) {
  return spawnSync(process.execPath, ['-e', "console.log(require('./shared-store').getMode())"], { cwd: root, encoding: 'utf8', env: { ...process.env, SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_KEY: '', NODE_ENV: '', VERCEL: '', ...extra } });
}
test('production without server key fails instead of temporary success', () => {
  for (const env of [{ NODE_ENV: 'production' }, { VERCEL: '1' }]) {
    const r = start(env); assert.notEqual(r.status, 0); assert.match(r.stderr, /db_not_configured/);
  }
});
test('wrong project is rejected even when the other URL is correct', () => {
  const own = 'https://nwatlpkwenucgyexeopz.supabase.co';
  for (const env of [{ SUPABASE_URL: 'https://wrong.test' }, { SUPABASE_URL: own, NEXT_PUBLIC_SUPABASE_URL: 'https://wrong.test' }]) {
    const r = start(env); assert.notEqual(r.status, 0); assert.match(r.stderr, /db_target_mismatch/);
  }
  const local = start({ NODE_ENV: 'test', VERCEL: '1' });
  assert.equal(local.status, 0); assert.match(local.stdout, /local/);
});
