import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, createFetchMock } from 'miniflare';
import { build } from 'esbuild';
import { SignJWT } from 'jose';

// Run the real Pages route in workerd: Node's fetch supports options that
// Cloudflare rejects, so mocking global fetch alone cannot cover this boundary.
test('push config and health traverse the actual Workers runtime', async () => {
  const bundle = await build({ stdin: { contents: `import { onRequest } from './functions/api/push/[[path]].ts'; export default { fetch(request, env) { return onRequest({request, env}); } };`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', write: false });
  const fetchMock = createFetchMock(); fetchMock.disableNetConnect();
  const origin = fetchMock.get('https://relay.test');
  origin.intercept({ path: '/push/config' }).reply(200, JSON.stringify({ publicKey: 'test-key' }), { headers: { 'Content-Type': 'application/json' } }).times(2);
  const env = { JWT_SECRET: 'test-secret', TAILOR_ORIGIN: 'https://relay.test', TAILOR_TOKEN: 'backend-secret' };
  const runtime = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2024-01-01', bindings: env, fetchMock });
  try {
    const token = await new SignJWT({ email: 'owner@example.com' }).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(env.JWT_SECRET));
    const headers = { Cookie: `atriveo_token=${token}` };
    const config = await runtime.dispatchFetch('https://apply.test/api/push/config', { headers });
    assert.equal(config.status, 200, await config.clone().text());
    assert.deepEqual(await config.json(), { publicKey: 'test-key' });
    const health = await runtime.dispatchFetch('https://apply.test/api/push/health', { headers: { Authorization: 'Bearer backend-secret' } });
    assert.equal(health.status, 200); assert.deepEqual(await health.json(), { publicKey: 'test-key' });
  } finally { await runtime.dispose(); await fetchMock.close(); }
});
