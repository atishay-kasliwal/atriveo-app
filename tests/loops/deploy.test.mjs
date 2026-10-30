import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importClosure } from '../../scripts/import-closure.mjs';
import { plistFor, paths } from '../../scripts/install-loops-worker-service.mjs';

const root = path.resolve(import.meta.dirname, '../..');

test('each Loops process ships exactly the files it imports', () => {
  const worker = importClosure('scripts/loops-mac-worker.mjs', root);
  assert.deepEqual(worker, ['scripts/loops-mac-worker.mjs', 'scripts/loops-schema.mjs', 'scripts/resume-ai-provider.mjs']);
  const transcriber = importClosure('scripts/loops-transcriber.mjs', root);
  for (const f of ['scripts/loops.mjs', 'scripts/loops-transcribe.mjs', 'scripts/mongo-client.mjs', 'scripts/web-push.mjs']) assert.ok(transcriber.includes(f), f);
  assert.ok(!transcriber.some((f) => /tailor-server|resume-builder/.test(f)), 'not the whole server');
});

test('the Mac worker LaunchAgent restarts itself, runs the copied worker, and puts the Codex CLI on its PATH', () => {
  const p = paths('/Users/test');
  const plist = plistFor({ node: '/opt/homebrew/bin/node', entry: `${p.dir}/scripts/loops-mac-worker.mjs`, log: p.log, pathEnv: '/opt/homebrew/bin:/Users/test/.local/bin:/usr/bin:/bin' });
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  assert.match(plist, /com\.atriveo\.loops-worker/);
  assert.match(plist, /\/Users\/test\/\.playatriveo\/loops-worker\/scripts\/loops-mac-worker\.mjs/);
  assert.match(plist, /\.local\/bin/);
  assert.equal(p.plist, '/Users/test/Library/LaunchAgents/com.atriveo.loops-worker.plist');
});

test('the transcriber image is pinned and builds gently', () => {
  const docker = fs.readFileSync(path.join(root, 'deploy/loops-transcriber/Dockerfile'), 'utf8');
  assert.match(docker, /ARG WHISPER_REF=v\d+\.\d+\.\d+/);
  assert.match(docker, /ARG JOBS=1/);
  assert.match(docker, /MODEL_SHA256=[0-9a-f]{64}/);
  assert.match(docker, /sha256sum -c/);
  assert.match(docker, /USER 1001:1001/);
  const ship = fs.readFileSync(path.join(root, 'scripts/ship-loops-transcriber.sh'), 'utf8');
  assert.match(ship, /nice -n 19 docker build/);
  assert.match(ship, /--cpus 1/);
  assert.match(ship, /require_main/);
  assert.ok(!/echo .*MONGO/.test(ship), 'the database address is never printed');
});
