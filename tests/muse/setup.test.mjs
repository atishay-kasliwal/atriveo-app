import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

test('credential setup preserves unrelated configuration, hides the token, restricts permissions and supports rotation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-credential-test-'));
  const script = path.resolve('scripts/setup-muse.mjs');
  fs.writeFileSync(path.join(dir, '.env.tailor'), 'TAILOR_TOKEN=unrelated-test-secret\nOTHER=value\n');
  const run = args => {
    const result = spawnSync(process.execPath, [script, ...args], { cwd: dir, env: { ...process.env, PLAYATRIVEO_HOME: dir }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const file = path.join(dir, 'integrations/muse.env');
    const token = fs.readFileSync(file, 'utf8').match(/^MUSE_API_TOKEN=(.*)$/m)[1];
    assert.ok(!result.stdout.includes(token));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
    const env = fs.readFileSync(path.join(dir, '.env.tailor'), 'utf8');
    assert.ok(env.includes('TAILOR_TOKEN=unrelated-test-secret\nOTHER=value'));
    assert.ok(env.includes(`MUSE_TOKEN_SHA256=${createHash('sha256').update(token).digest('hex')}`));
    assert.ok(!env.includes(token));
    return token;
  };
  try { const first = run([]); assert.equal(run([]), first); assert.notEqual(run(['--rotate']), first); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
