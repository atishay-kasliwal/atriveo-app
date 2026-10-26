// The Matching queue answer on a fake database: what it reads, what it reuses between pages, and that a request never
// waits for every missing Fit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { matchingQueue, recordDecision, invalidateMatchingQueue, fitsFilled, hiddenCompanies, setCompanyHidden, recentScrapeRuns } from '../scripts/job-matching.mjs';
import { computeFit, fitIsCurrent } from '../scripts/fit-store.mjs';

const JD = 'Backend Engineer\nRequirements:\n- Python and Java experience.\n- Kubernetes experience.\nResponsibilities:\n- Build backend services in Python.\n';
const NOW = new Date('2026-10-25T12:00:00Z');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matching-queue-'));

/** A resume folder with a PDF and a page image newer than it, so no image is made. */
function resume(name) {
  const folder = path.join(dir, name);
  fs.mkdirSync(folder, { recursive: true });
  const pdf = path.join(folder, 'resume.pdf');
  fs.writeFileSync(pdf, `%PDF-1.4 ${name}`);
  const png = path.join(folder, 'resume-page.png');
  fs.writeFileSync(png, 'png');
  const later = new Date(Date.now() + 60_000);
  fs.utimesSync(png, later, later);
  return pdf;
}

// Mongo's dotted projections, as far as the queue uses them.
function project(doc, projection) {
  if (!projection || !doc.fit || projection.fit) return doc;
  const { fit, ...rest } = doc;
  if (!Object.keys(projection).some((k) => k.startsWith('fit.'))) return rest;
  const out = {};
  for (const k of ['score', 'confidence', 'config_hash', 'master_hash', 'candidate_hash', 'shape', 'as_of']) if (k in fit) out[k] = fit[k];
  if (fit.knockouts) out.knockouts = { verdict: fit.knockouts.verdict };
  if (fit.ledger) out.ledger = { skills: (fit.ledger.skills ?? []).map((s) => ({ alternatives: s.alternatives })) };
  return { ...rest, fit: out };
}

function fakeDb(jobs, { descriptions = {}, swipes = [], hidden = [], sessions = [], staffingRuns = [] } = {}) {
  const calls = { rankReads: 0, wholeFitReads: 0, writes: [] };
  const cursor = (rows) => ({ sort: () => cursor(rows), limit: (n) => cursor(rows.slice(0, n)), toArray: async () => structuredClone(rows) });
  const db = {
    calls,
    collection(name) {
      if (name === 'jobs') return {
        find(filter, { projection } = {}) {
          const urls = filter.job_url?.$in;
          if (urls) calls.wholeFitReads++; else calls.rankReads++;
          return cursor(jobs.filter((j) => !urls || urls.includes(j.job_url)).map((j) => project(j, projection)));
        },
        bulkWrite: async (ops) => { calls.writes.push(...ops); for (const op of ops) { const j = jobs.find((x) => x.job_url === op.updateOne.filter.job_url); if (j) j.fit = op.updateOne.update.$set.fit; } },
        findOne: async () => null,
      };
      if (name === 'applications') return { distinct: async () => [], find: () => ({ toArray: async () => [] }) };
      if (name === 'job_swipes') return {
        find: () => cursor(swipes),
        updateOne: async (f, u) => { swipes.push(u.$set); },
        deleteOne: async (f) => { const i = swipes.findIndex((s) => s.job_url === f.job_url && s.source === f.source); if (i >= 0) swipes.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; },
      };
      if (name === 'matching_hidden_companies') return {
        find: () => cursor(hidden),
        updateOne: async (f, u) => { const i = hidden.findIndex((h) => h.key === f.key); if (i >= 0) hidden[i] = u.$set; else hidden.push(u.$set); },
        deleteOne: async (f) => { const i = hidden.findIndex((h) => h.key === f.key); if (i >= 0) hidden.splice(i, 1); },
      };
      if (name === 'sessions') return { find: () => cursor(sessions) };
      if (name === 'staffing_runs') return { find: () => cursor(staffingRuns) };
      if (name === 'descriptions') {
        const rows = (urls) => urls.filter((u) => descriptions[u]).map((u) => ({ job_url: u, description: descriptions[u] }));
        return { find: (f) => cursor(rows(f.job_url.$in)), aggregate: (p) => cursor(rows(p[0].$match.job_url.$in)) };
      }
      return { find: () => cursor([]), insertOne: async () => ({}), deleteMany: async () => ({}), createIndex: async () => ({}) };
    },
  };
  return db;
}

const job = (i, fit) => ({ job_url: `https://jobs.example/${i}`, company: `Company ${i % 3}`, title: 'Backend Engineer', location: 'Remote', score_pct: 50, run_at: new Date(NOW.getTime() - i * 60_000), site: 'linkedin', resume: { pdf_path: resume(`job-${i}`) }, fit });

test('the queue reads the jobs once for several pages, sends each shown job its whole Fit, and a decision refreshes it', async () => {
  invalidateMatchingQueue();
  const fit = computeFit(JD, 'Backend Engineer');
  const jobs = [0, 1, 2, 3].map((i) => job(i, { ...structuredClone(fit), score: 90 - i }));
  const db = fakeDb(jobs, { descriptions: Object.fromEntries(jobs.map((j) => [j.job_url, JD])) });
  const first = await matchingQueue(db, { limit: 2, now: NOW, learn: false });
  assert.deepEqual(first.jobs.map((j) => j.id), [jobs[0].job_url, jobs[1].job_url], 'best Fit first');
  assert.equal(first.total, 4);
  const shown = first.jobs[0];
  assert.deepEqual(shown.fit.ledger.skills, fit.ledger.skills, 'the whole skill ledger (with its evidence) for a shown job');
  assert.deepEqual(shown.fit.knockouts, fit.knockouts);
  for (const k of ['config_hash', 'master_hash', 'as_of', 'lost']) assert.equal(k in shown.fit, false, `${k} stays on the server`);
  assert.deepEqual(Object.keys(shown.jd).sort(), ['flags', 'full', 'kind', 'salary', 'work']);
  assert.ok(shown.jd.full.includes('Kubernetes'));
  assert.equal(db.calls.rankReads, 1);
  // The next page: same snapshot, no second read of every job.
  const next = await matchingQueue(db, { limit: 2, now: new Date(NOW.getTime() + 5_000), learn: false, exclude: first.jobs.map((j) => j.key) });
  assert.deepEqual(next.jobs.map((j) => j.id), [jobs[2].job_url, jobs[3].job_url]);
  assert.equal(db.calls.rankReads, 1, 'the next page reuses the ranked jobs');
  assert.equal(db.calls.writes.length, 0, 'current Fits are not recomputed');
  // A decision here is seen at once.
  await recordDecision(db, { jobUrl: jobs[0].job_url, decision: 'skip', now: NOW });
  const after = await matchingQueue(db, { limit: 2, now: new Date(NOW.getTime() + 6_000), learn: false });
  assert.equal(db.calls.rankReads, 2);
  assert.deepEqual(after.jobs.map((j) => j.id), [jobs[1].job_url, jobs[2].job_url]);
  assert.equal(after.total, 3);
  // And the snapshot expires on its own.
  await matchingQueue(db, { limit: 2, now: new Date(NOW.getTime() + 60_000), learn: false });
  assert.equal(db.calls.rankReads, 3);
});

test('a request computes missing Fits only for a short while; the rest are computed after it answers, then ranked', async () => {
  invalidateMatchingQueue();
  const jobs = Array.from({ length: 60 }, (_, i) => job(100 + i, null));
  const db = fakeDb(jobs, { descriptions: Object.fromEntries(jobs.map((j) => [j.job_url, JD])) });
  const first = await matchingQueue(db, { limit: 3, now: NOW, learn: false });
  assert.equal(first.jobs.length, 3);
  assert.ok(db.calls.writes.length <= 40, `at most 40 Fits in the request (got ${db.calls.writes.length})`);
  await fitsFilled();
  assert.equal(new Set(db.calls.writes.map((w) => w.updateOne.filter.job_url)).size, 60, 'every missing Fit is saved afterwards');
  assert.ok(jobs.every((j) => fitIsCurrent(j.fit)));
  const writes = db.calls.writes.length;
  const again = await matchingQueue(db, { limit: 60, now: new Date(NOW.getTime() + 1_000), learn: false });
  assert.equal(db.calls.writes.length, writes, 'nothing left to compute');
  assert.ok(again.jobs.every((j) => typeof j.fit?.score === 'number' || j.fit?.score === null));
  assert.equal(again.jobs.length, 60);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('a hidden company leaves the queue, the company list and the counts at once, and comes back when restored', async () => {
  invalidateMatchingQueue();
  const fit = computeFit(JD, 'Backend Engineer');
  const jobs = [0, 1, 2, 3, 4, 5].map((i) => job(200 + i, { ...structuredClone(fit), score: 90 - i }));
  const db = fakeDb(jobs, { descriptions: Object.fromEntries(jobs.map((j) => [j.job_url, JD])) });
  const all = await matchingQueue(db, { limit: 8, now: NOW, learn: false });
  assert.equal(all.total, 6);
  const hide = all.companies[0];
  const out = await setCompanyHidden(db, { company: `  ${hide.name.toUpperCase()} `, hidden: true, now: NOW });
  assert.deepEqual(out.hidden.map((h) => h.key), [hide.key], 'matched by the same company key, any case or spacing');
  const after = await matchingQueue(db, { limit: 8, now: new Date(NOW.getTime() + 1000), learn: false });
  assert.equal(after.total, 6 - hide.count, 'the queue cache is cleared, so the change shows at once');
  assert.equal(after.stats.remaining, 6 - hide.count);
  assert.ok(after.companies.every((c) => c.key !== hide.key));
  assert.ok(after.jobs.every((j) => j.company.toLowerCase() !== hide.key));
  assert.deepEqual((await hiddenCompanies(db)).map((h) => h.name), [hide.name.toUpperCase().trim()]);
  await setCompanyHidden(db, { company: hide.name, hidden: false });
  assert.deepEqual(await hiddenCompanies(db), []);
  const back = await matchingQueue(db, { limit: 8, now: new Date(NOW.getTime() + 2000), learn: false });
  assert.equal(back.total, 6);
  await assert.rejects(() => setCompanyHidden(db, { company: '  ' }), /company is required/);
});

test('recent scrape runs group the pipelines of one run, add the staffing runs, and keep the newest five', async () => {
  const at = (m) => new Date(NOW.getTime() - m * 60_000);
  const sessions = [];
  for (let i = 0; i < 6; i++) for (const [p, n] of [['standard', 20], ['keywords', 5]]) sessions.push({ session_id: `s${i}`, pipeline: p, job_count: n, run_at: at(i * 60 + (p === 'keywords' ? -1 : 0)) });
  const db = fakeDb([], { sessions, staffingRuns: [{ started_at: at(30), finished_at: at(25), new_jobs: 15, status: 'partial' }, { started_at: at(1), status: 'running' }] });
  const { runs } = await recentScrapeRuns(db);
  assert.equal(runs.length, 5);
  assert.deepEqual(runs.map((r) => r.kind), ['Job search', 'Staffing', 'Job search', 'Job search', 'Job search']);
  assert.equal(runs[0].added, 25, 'both pipelines of the run are added together');
  assert.equal(runs[1].added, 15);
  assert.equal(runs[1].status, 'partial');
  assert.ok(runs.every((r, i) => i === 0 || runs[i - 1].finishedAt >= r.finishedAt), 'newest first');
});

test('pipeline stages of one scrape cycle have their own session ids seconds apart: they are one run, and the newest five runs are listed', async () => {
  const at = (m, s = 0) => new Date(NOW.getTime() - m * 60_000 + s * 1000);
  const sessions = [];
  // Seven cycles an hour apart, each with four stages 1 s apart (as on the live pipeline).
  for (let c = 0; c < 7; c++) [30, 5, 8, 23].forEach((n, k) => sessions.push({ session_id: `c${c}-${k}`, job_count: n, run_at: at(c * 60, k) }));
  const { runs } = await recentScrapeRuns(fakeDb([], { sessions, staffingRuns: [] }));
  assert.equal(runs.length, 5);
  assert.ok(runs.every((r) => r.kind === 'Job search'));
  assert.deepEqual(runs.map((r) => r.added), [66, 66, 66, 66, 66], 'four stages add up to one run');
  assert.equal(new Set(runs.map((r) => r.finishedAt.slice(0, 13))).size, 5, 'five different hours, not five stages of one hour');
});

test('a page is prepared in parallel but still taken in ranked order: jobs without a resume file are skipped and the page fills from later ones', async () => {
  invalidateMatchingQueue();
  const fit = computeFit(JD, 'Backend Engineer');
  const jobs = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => job(i, { ...structuredClone(fit), score: 99 - i }));
  for (const i of [0, 2]) jobs[i].resume.pdf_path = path.join(dir, `missing-${i}`, 'resume.pdf'); // no file on this server
  const db = fakeDb(jobs, { descriptions: Object.fromEntries(jobs.map((j) => [j.job_url, JD])) });
  const first = await matchingQueue(db, { limit: 3, now: NOW, learn: false });
  assert.deepEqual(first.jobs.map((j) => j.id), [1, 3, 4].map((i) => jobs[i].job_url), 'ranked order, the two without files skipped');
  const second = await matchingQueue(db, { limit: 3, now: NOW, learn: false, exclude: first.jobs.map((j) => j.key) });
  assert.deepEqual(second.jobs.map((j) => j.id), [5, 6, 7].map((i) => jobs[i].job_url), 'the next page continues from there');
});
