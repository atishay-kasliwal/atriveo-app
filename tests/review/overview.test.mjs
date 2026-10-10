import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';
import { applicationsAnalytics, overviewHistory, overviewSummary, markJobApplied } from '../../scripts/applications-analytics.mjs';

// The Overview per view (summary + history pages) against the full response it replaces, on a real
// (in-memory) Mongo: same numbers, light rows, history paged and filtered on the server.
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');

const day = (n, h = 15) => new Date(Date.now() - n * 86_400_000 + (h - new Date().getUTCHours()) * 3_600_000).toISOString();
const STATUSES = ['APPLIED', 'NEEDS_REVIEW', 'FAILED', 'SKIPPED', 'READY_TO_APPLY', 'APPLYING'];
function seedApps() {
  return Array.from({ length: 64 }, (_, i) => {
    const status = STATUSES[i % STATUSES.length];
    const at = day(i % 20, 3 + (i % 20));
    const lifecycle = { queuedAt: day((i % 20) + 1), ...(status === 'APPLIED' ? { appliedAt: at } : status === 'NEEDS_REVIEW' ? { reviewAt: at } : status === 'FAILED' ? { failedAt: at } : status === 'SKIPPED' ? { skippedAt: at } : {}) };
    return {
      _id: `app-${String(i).padStart(2, '0')}`, company: i % 3 ? `Acme ${i}` : `Orbit ${i}`, title: i % 2 ? 'Software Engineer' : 'Data Analyst', location: 'NY',
      ats: ['greenhouse', 'lever', 'ashby'][i % 3], status, priority: 16000 + i, applyUrl: `https://example.test/${i}`, attemptCount: 1,
      createdAt: day(30 - (i % 20)), updatedAt: new Date(Date.now() - i * 60_000).toISOString(), lifecycle,
      attempts: [{ n: 1, startedAt: day(i % 20, 3), endedAt: new Date(new Date(day(i % 20, 3)).getTime() + 90_000 + i * 1000).toISOString() }],
      review: status === 'NEEDS_REVIEW' ? { reason: 'UNKNOWN_QUESTION', detail: 'questions', pending: [
        { fingerprint: `q${i}`, label: 'How did you hear about us?', type: 'select', required: false, options: Array.from({ length: 300 }, (_, k) => `Source ${k}`), reason: 'OPTION_NOT_FOUND' },
        { fingerprint: `r${i}`, label: 'Why us?', type: 'textarea', required: true, reason: 'UNKNOWN_QUESTION' },
      ] } : null,
      failure: status === 'FAILED' ? { code: 'TIMEOUT', message: 'took too long\nstack' } : null,
      submission: status === 'APPLIED' ? { by: 'engine', submittedAt: at, attemptedAt: at } : {},
      ...(i === 1 ? { outcome: { status: 'confirmed', confirmedAt: day(0), subject: 'Thanks' } } : {}),
    };
  });
}

test('the Overview summary has the full response\'s numbers; history pages, filters and searches on the server', async () => {
  const mongod = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongod.getUri());
  try {
    const db = client.db('job_pipeline');
    await db.collection('applications').insertMany(seedApps());
    await db.collection('jobs').insertMany(Array.from({ length: 40 }, (_, i) => ({ job_url: `https://jobs.test/${i % 30}`, site: i % 2 ? 'linkedin' : 'greenhouse', created_at: day(i % 10),
      ...(i % 3 ? { resume: { status: 'success', updated_at: day(i % 5) } } : {}) })));
    await db.collection('ats_boards').insertMany([{ ats: 'ashby', last_polled_at: day(1) }, { ats: 'greenhouse', last_polled_at: day(1), last_matched_at: day(1) }]);
    await db.collection('engine_control').insertMany([{ _id: 'submissions', enabled: true, reason: null, updatedAt: day(1), updatedBy: 'test' }, { _id: 'worker:mac', online: true, updatedAt: new Date().toISOString() }]);
    await db.collection('inbox_events').insertMany([
      { _id: 'm1', receivedAt: day(1), kind: 'applied', subject: 'Thanks for applying', companies: ['Acme 1'], state: 'updated' },
      { _id: 'm2', receivedAt: day(2), kind: 'rejected', subject: 'Update', companies: ['Orbit 3'], state: 'needs_confirm', match: { reason: 'two candidates', candidates: ['app-03', 'app-63'] } },
    ]);

    const full = await applicationsAnalytics(db, { days: 30 });
    const summary = await overviewSummary(db, { days: 30 });
    const sorted = (rows, key) => [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
    for (const k of ['kpis', 'funnel', 'byStatus', 'daily', 'reviewReasons', 'failureCodes', 'formTrust', 'killSwitch', 'current', 'lastActivityAt', 'lastAt', 'worker'])
      assert.deepEqual(summary[k], full[k], k);
    assert.deepEqual(sorted(summary.byAts, 'ats'), sorted(full.byAts, 'ats'));
    // A date range: the daily series and the range totals cover exactly those days; the 30-day totals equal the series.
    const sumOf = (rows, key) => rows.reduce((n, d) => n + d[key], 0);
    assert.equal(summary.range.applied, sumOf(summary.daily, 'applied'));
    assert.equal(summary.range.failed, sumOf(summary.daily, 'failed'));
    const lastWeek = summary.daily.slice(-7);
    const week = await overviewSummary(db, { from: lastWeek[0].day, to: lastWeek[6].day });
    assert.equal(week.daily.length, 7);
    assert.deepEqual(week.daily.map((d) => d.day), lastWeek.map((d) => d.day));
    assert.equal(week.range.applied, sumOf(lastWeek, 'applied'));
    assert.equal(week.range.needsReview, sumOf(lastWeek, 'needsReview'));
    assert.ok(week.range.discovered <= summary.range.discovered && week.range.matched <= summary.range.matched);
    assert.deepEqual(sorted(summary.discovery.boards, 'ats'), sorted(full.discovery.boards, 'ats'));
    assert.deepEqual(sorted(summary.discovery.jobsBySite, 'site'), sorted(full.discovery.jobsBySite, 'site'));
    // Ties in question counts come back in any order from the full response; the summary breaks them by label.
    assert.deepEqual(summary.topPendingQuestions, sorted(full.topPendingQuestions, 'label').sort((a, b) => b.n - a.n));
    assert.ok(summary.daily.some((d) => d.applied || d.needsReview), 'the window has outcomes');
    assert.equal(summary.funnel[0].n, 30, 'distinct job URLs, counted in Mongo');
    // Unsure mails still name the applications they might belong to.
    assert.deepEqual(summary.inbox.confirm[0].candidates.map((c) => c.label), ['Orbit 3 · Software Engineer', 'Orbit 63 · Software Engineer']);
    assert.equal(summary.history, undefined, 'no history in the summary');

    // Attention: a preview plus the total; queue: every waiting row. Light: no question bodies or options.
    const attention = full.history.filter((h) => h.status === 'NEEDS_REVIEW' || h.status === 'FAILED');
    assert.equal(summary.attentionTotal, attention.length);
    assert.deepEqual(summary.attention.map((h) => h.id), attention.slice(0, 20).map((h) => h.id));
    assert.deepEqual(summary.queue.map((h) => h.id).sort(), full.history.filter((h) => ['READY_TO_APPLY', 'APPLYING', 'SUBMITTING'].includes(h.status)).map((h) => h.id).sort());
    const review = summary.attention.find((h) => h.status === 'NEEDS_REVIEW');
    assert.equal(review.pendingCount, 2);
    assert.deepEqual(review.questions, []);
    assert.ok(JSON.stringify(summary).length < JSON.stringify(full).length / 3, 'the summary is a fraction of the full response');

    // History: pages in the full response's order, same rows minus the questions.
    const light = ({ questions, pending, ...h }) => h;
    const p1 = await overviewHistory(db, { limit: 25 });
    const p2 = await overviewHistory(db, { skip: 25, limit: 25 });
    assert.equal(p1.total, 64);
    assert.deepEqual([...p1.rows, ...p2.rows].map(light).map(({ pendingCount, ...h }) => h), full.history.slice(0, 50).map(light));
    const applied = await overviewHistory(db, { status: 'APPLIED' });
    assert.ok(applied.total > 0 && applied.rows.every((r) => r.status === 'APPLIED'));
    const both = await overviewHistory(db, { status: 'NEEDS_REVIEW,FAILED', limit: 500 });
    assert.equal(both.total, attention.length);
    const search = await overviewHistory(db, { q: 'orbit' });
    assert.ok(search.total > 0 && search.rows.every((r) => /orbit/i.test(r.company)));
    assert.equal((await overviewHistory(db, { q: 'a.b(c' })).total, 0, 'search text is matched literally');
  } finally {
    await client.close();
    await mongod.stop();
  }
});


test("Staffing applied marks contribute to Today’s total and repeated marks count once", async () => {
  const mongod = await MongoMemoryServer.create();
  const client = new MongoClient(mongod.getUri());
  try {
    await client.connect();
    const db = client.db('staffing-counter');
    const day = new Date().toLocaleString('sv-SE', {timeZone:'America/New_York'}).slice(0,10);
    const url = 'https://staffing.example/jobs/full-stack-engineer';
    await markJobApplied(db, url);
    await markJobApplied(db, url);
    const result = await overviewSummary(db, {from:day,to:day});
    assert.equal(result.range.applied + result.range.linkedinApplied, 1);
  } finally { await client.close(); await mongod.stop(); }
});
