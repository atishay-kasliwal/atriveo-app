import { test } from 'node:test';
import assert from 'node:assert/strict';

// The apply site's front door: signed-out visitors to "/" get the landing page, console deep links still go to login, and
// the landing page itself is public. Runs the Pages Functions guard directly.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'front-door-')), 'middleware.mjs');
await build({ entryPoints: [path.join(import.meta.dirname, '..', '..', 'functions', '_middleware.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const { onRequest } = await import(pathToFileURL(out).href);
const env = { SITE: 'apply', JWT_SECRET: 'test-secret', ADMIN_EMAILS: 'a@example.test', ASSETS: { fetch: async () => new Response('console') } };
const run = (path, headers = {}) => onRequest({ request: new Request(`https://apply.atriveo.com${path}`, { headers }), env, next: async () => new Response('public') });

test('signed out: "/" shows the landing page', async () => {
  const r = await run('/');
  assert.equal(r.status, 302);
  assert.equal(new URL(r.headers.get('location')).pathname, '/landing/');
});

test('signed out: a console link goes to login, not the landing page', async () => {
  for (const p of ['/job-matching', '/bank', '/resume_builder', '/today']) {
    const r = await run(p);
    assert.equal(r.status, 302, p);
    assert.equal(new URL(r.headers.get('location')).pathname, '/login', p);
  }
});

test('the landing page, its detail page and login stay public', async () => {
  for (const p of ['/landing/', '/landing/workflow/', '/login']) assert.equal(await (await run(p)).text(), 'public', p);
});

test('APIs still answer 401 when signed out', async () => {
  assert.equal((await run('/api/jobs?type=today')).status, 401);
});
