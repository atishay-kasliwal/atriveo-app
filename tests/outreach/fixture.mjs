import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const engine = process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo');
export const requireEngine = createRequire(path.join(engine, 'package.json'));
const { tsImport } = requireEngine('tsx/esm/api');
const imp = file => tsImport(path.join(engine, file), import.meta.url);
const [{ outreachWeb }, { OutreachStore }, { MemoryApplicationRepository }, { parseEngineConfig, resolvePaths }, { DEFAULT_TEMPLATE }, { exampleProfile }] = await Promise.all([
  imp('src/outreach/web.ts'), imp('src/outreach/store.ts'), imp('src/persistence/memoryRepository.ts'), imp('src/config.ts'), imp('src/outreach/draft.ts'), imp('tests/helpers/testData.ts'),
]);
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');
const { MongoClient } = requireEngine('mongodb');
export async function backendFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-web-'));
  const mongod = await MongoMemoryServer.create(); const client = new MongoClient(mongod.getUri()); await client.connect();
  const db = client.db('outreach_web'); const store = new OutreachStore(db); await store.ensureIndexes();
  const sent = []; const paths = resolvePaths({ PLAYATRIVEO_HOME: directory });
  const config = parseEngineConfig({});
  const service = outreachWeb({ repo: new MemoryApplicationRepository(), db, store, config, paths, profile: exampleProfile, template: DEFAULT_TEMPLATE, sender: { send: async mail => { sent.push(mail); return { state: 'sent', messageId: `fake-${sent.length}` }; } } });
  const job = { jobUrl: 'https://www.linkedin.com/jobs/view/1234', company: 'Example Robotics', title: 'Forward Deployed Engineer', appliedAt: null };
  await db.collection('jobs').insertOne({ job_url: job.jobUrl, company: job.company, title: job.title });
  const applied = async () => { job.appliedAt = new Date().toISOString(); await db.collection('job_swipes').updateOne({ job_url: job.jobUrl }, { $set: { direction: 'applied', applied_at: job.appliedAt } }, { upsert: true }); };
  const run = async (op, input = {}) => {
    if (op === 'list') return { drafts: await service.list() };
    if (op === 'settings') return { settings: service.settings() };
    if (op === 'saveSettings') return { settings: await service.saveSettings(input) };
    if (op === 'test') return { settings: await service.test() };
    if (op === 'detail' || op === 'attachment') return service[op](input.id);
    return service[op](input);
  };
  t.after(async () => { await client.close(); await mongod.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, db, store, service, sent, job, applied, run, config, mongoUri: mongod.getUri() };
}
