import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handleStaffing } from '../../scripts/staffing-routes.mjs';

test('staffing routes proxy only fixed private endpoints and retain authentication', async () => {
  const calls = [];
  const response = { headers: {}, setHeader(k,v){this.headers[k]=v;}, writeHead(s){this.status=s;}, end(b){this.body=JSON.parse(b);} };
  const fetcher = async (url, options) => { calls.push({ url, options }); return { status: 202, text: async () => JSON.stringify({ ok: true, runId: 'test' }) }; };
  const req = Object.assign(Readable.from([Buffer.from('{"sourceIds":["kforce"]}')]), { method: 'POST' });
  assert.equal(await handleStaffing(req, response, new URL('http://localhost/staffing/run'), { base: 'http://private:8791', token: 'fixture', fetcher }), true);
  assert.equal(response.status, 202);
  assert.equal(calls[0].url, 'http://private:8791/run');
  assert.equal(calls[0].options.headers['X-Tailor-Token'], 'fixture');
  assert.equal(await handleStaffing({ method: 'POST' }, response, new URL('http://localhost/staffing/arbitrary'), { fetcher }), true);
  assert.equal(response.status, 404);
  assert.equal(calls.length, 1);
});
