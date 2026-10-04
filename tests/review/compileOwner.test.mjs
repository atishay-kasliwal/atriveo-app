import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Who builds what the dashboard queues. On Oracle the dashboard and the resume compiler are separate containers:
// the compiler runs with WORKER_ID=oracle-atriveo and claims only jobs owned by it; the dashboard has no worker
// id (and HOME=/tmp), so before this fix every job it queued got a random owner and was never built.
// Each case runs as its own process with exactly the deployed environment shape, on an in-memory Mongo.

const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** One process as a container: queue a job as the dashboard, then try to claim it as the Oracle compiler. */
function dashboardThenCompiler(uri, env) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'container-home-'));
  const script = `
    import { MongoClient } from "mongodb";
    import { enqueueJob, claimNextJob, countActiveCompileJobs } from "./scripts/resume-queue.mjs";
    import { compileOwner } from "./scripts/worker-id.mjs";
    const client = await MongoClient.connect(${JSON.stringify(uri)});
    const db = client.db("owner_" + Date.now() + Math.random().toString(36).slice(2));
    await db.collection("jobs").insertOne({ job_url: "https://x.test/job", company: "Example Corp", title: "Engineer" });
    await enqueueJob(db, { job_url: "https://x.test/job", company: "Example Corp", title: "Engineer" });
    const queued = (await db.collection("jobs").findOne({ job_url: "https://x.test/job" })).resume;
    const visible = await countActiveCompileJobs(db, { owner: compileOwner() });
    const claimed = await claimNextJob(db, "oracle-atriveo", 60);
    console.log(JSON.stringify({ owner: queued.owner, visibleToDashboard: visible, claimedByOracle: Boolean(claimed) }));
    await client.close();`;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, ...env },
  });
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout.trim().split('\n').pop());
}

test('the deployed dashboard shape: without RESUME_WORKER_ID its jobs are never built; with it the Oracle compiler builds them', async () => {
  const mongod = await MongoMemoryServer.create();
  try {
    const before = dashboardThenCompiler(mongod.getUri(), {});
    assert.notEqual(before.owner, 'oracle-atriveo');
    assert.equal(before.claimedByOracle, false, 'the inconsistency: queued, but no compiler ever claims it');

    const after = dashboardThenCompiler(mongod.getUri(), { RESUME_WORKER_ID: 'oracle-atriveo' });
    assert.equal(after.owner, 'oracle-atriveo');
    assert.equal(after.claimedByOracle, true, 'the Oracle compiler claims it');
    assert.equal(after.visibleToDashboard.queued, 1, "and the dashboard's own queue view shows it");
    assert.equal(before.visibleToDashboard.queued, 1, 'before: shown as queued, but never built');
  } finally { await mongod.stop(); }
});

test('one machine (the Mac, or a worker with WORKER_ID): unchanged, queued and built by the same id', async () => {
  const mongod = await MongoMemoryServer.create();
  try {
    const same = dashboardThenCompiler(mongod.getUri(), { WORKER_ID: 'oracle-atriveo' });
    assert.equal(same.owner, 'oracle-atriveo');
    assert.equal(same.claimedByOracle, true);
    const mac = dashboardThenCompiler(mongod.getUri(), { WORKER_ID: 'atishays-macbook-air-8-local-fa3e9bb6' });
    assert.equal(mac.owner, 'atishays-macbook-air-8-local-fa3e9bb6', 'without RESUME_WORKER_ID the owner is this machine, as before');
    assert.equal(mac.claimedByOracle, false);
  } finally { await mongod.stop(); }
});
