import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';
import { blockingQuestion, readyBrief, reviewQueue } from '../../scripts/applications-analytics.mjs';

// Today loads its lists light (no Resume Match, Resume Ready or resume ETA) and asks for those per page with
// view=details. The light unanswered rows carry toAnswer, the console's blocking count. Real in-memory Mongo.
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');

const q = (label, extra = {}) => ({ fingerprint: label, label, type: 'text', required: true, ...extra });
// Each case: the pending question as the engine stores it, and whether src/apply/questionGroups.ts `blocking` holds it back.
const CASES = [
  [q('Why do you want to work here?'), true],
  [q('Anything else?', { required: false }), false, 'optional'],
  [q('Company name'), false, 'Fill copies resume fields'],
  [q('Start date year *'), false, 'Fill copies resume fields'],
  [q('Resume', { type: 'file' }), false, 'attachments are left to the page'],
  [q('Unlabeled field 3'), false, 'unreadable'],
  [q('Yes'), false, 'unreadable'],
  [q('Salary?', { answerProposal: { state: 'ready_for_review', answer: '$120k' } }), false, 'has a suggestion'],
  [q('Salary?', { answerProposal: { state: 'needs_input', answer: '$120k' } }), false, 'has an answer to start from'],
  [q('Salary?', { answerProposal: { state: 'needs_input' } }), true],
  [q('Why us?', { openEndedSuggestion: { suggestedAnswer: 'Because' } }), false, 'has a suggestion'],
  [q('Why us?', { openEndedUserReview: { status: 'rejected' } }), true, 'suggestion rejected, nothing left'],
  [q('Why us?', { openEndedUserReview: { status: 'rejected', draftAnswer: 'My draft' } }), false, 'your draft'],
  [q('Why us?', { openEndedUserReview: { status: 'rejected' }, openEndedSuggestion: { suggestedAnswer: 'Old' } }), false, 'a suggestion is still there'],
];
// The console's pendingQuestion shape (scripts/applications-analytics.mjs) that blocking reads.
const asConsole = (p) => ({ ...p, required: Boolean(p.required), suggestedAnswer: p.answerProposal?.answer ?? p.openEndedSuggestion?.suggestedAnswer,
  userDraft: p.openEndedUserReview?.draftAnswer ?? null, reviewStatus: p.openEndedUserReview?.status ?? (p.answerProposal?.answer || p.openEndedSuggestion ? 'suggested' : 'none') });

test('blockingQuestion matches the console rule', () => {
  for (const [p, want, why] of CASES) assert.equal(blockingQuestion(asConsole(p)), want, `${p.label}${why ? ` (${why})` : ''}`);
});

test('readyBrief keeps what a card shows', () => {
  assert.deepEqual(readyBrief({ status: 'Review', reasons: ['Skills missing'], notes: ['n'], checks: [{ id: 'x' }], skills_checked: true }),
    { status: 'Review', reasons: ['Skills missing'], skills_checked: true });
  assert.equal(readyBrief(null), null);
});

test('light lists leave out the resume facts, which view=details brings for the cards asked for', async () => {
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'today-light-'));
  try {
    const db = client.db('t');
    const now = new Date('2026-10-05T12:00:00.000Z');
    // a1's resume is here with its Job Match; a2's isn't built yet (queued), so it gets an ETA.
    fs.mkdirSync(path.join(dir, 'a1'));
    const pdf = path.join(dir, 'a1', 'A.pdf');
    fs.writeFileSync(pdf, '%PDF');
    fs.writeFileSync(path.join(dir, 'a1', 'ats-score.json'), JSON.stringify({ job_match: { score: 81.4, requirement_counts: { required: { matched: 4, total: 5 } } } }));
    const app = (id, extra) => ({ _id: id, company: `Co ${id}`, title: 'Software Engineer', location: 'Raleigh, NC', ats: 'greenhouse', applyUrl: `https://job-boards.greenhouse.io/co/jobs/${id}`,
      status: 'NEEDS_REVIEW', jobUrls: [`https://job-boards.greenhouse.io/co/jobs/${id}`], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', submission: { attemptedAt: null }, ...extra });
    await db.collection('applications').insertMany([
      app('a1', { finalUrl: 'https://job-boards.greenhouse.io/co/jobs/a1?final', resume: { path: pdf }, review: { reason: 'QUESTIONS', pending: CASES.map(([p]) => p) } }),
      app('a2', { resume: { path: path.join(dir, 'missing', 'A.pdf') }, review: { reason: 'QUESTIONS', pending: [q('Company name')] } }),
    ]);
    await db.collection('jobs').insertMany([
      { job_url: 'https://job-boards.greenhouse.io/co/jobs/a2', score_pct: 50, resume: { status: 'queued', owner: 'w', priority: 0 } },
      { job_url: 'https://www.linkedin.com/jobs/view/9', company: 'Li', title: 'AI Engineer', score_pct: 60, run_at: new Date('2026-10-05T08:00:00Z'), resume: { status: 'success', pdf_path: pdf } },
    ]);

    const full = await reviewQueue(db, { view: 'unanswered', now });
    const light = await reviewQueue(db, { view: 'unanswered', light: true, now });
    assert.deepEqual(light.unanswered.map((r) => r.id), full.unanswered.map((r) => r.id), 'same rows, same order');
    assert.deepEqual(light.counts, full.counts);
    const [l1, l2] = ['a1', 'a2'].map((id) => light.unanswered.find((r) => r.id === id));
    assert.equal(l1.toAnswer, CASES.filter(([, want]) => want).length, 'the blocking questions');
    assert.equal(l2.toAnswer, 0, 'a resume field only');
    assert.equal(l1.ats, 'greenhouse');
    assert.equal(l1.url, 'https://job-boards.greenhouse.io/co/jobs/a1?final', 'the final URL when there is one');
    assert.equal(l2.url, 'https://job-boards.greenhouse.io/co/jobs/a2');
    assert.equal(l1.resumeReady, true);
    assert.equal(l2.resumeReady, false, 'still sorted by whether the resume is here');
    for (const r of light.unanswered) for (const k of ['resumeMatch', 'readyState', 'resumeEta', 'pendingLite', '_jobUrls']) assert.equal(k in r, false, `${r.id} has no ${k}`);
    assert.deepEqual(full.unanswered.find((r) => r.id === 'a1').resumeMatch, { score: 81, required: { matched: 4, total: 5 }, preferred: null });

    const li = await reviewQueue(db, { view: 'linkedin', light: true, now });
    assert.equal(li.linkedin.length, 1);
    assert.equal('resumeMatch' in li.linkedin[0], false);
    assert.equal('readyState' in li.linkedin[0], false);
    assert.equal(li.linkedin[0].resumeReady, true);

    const { details } = await reviewQueue(db, { view: 'details', ids: ['a1', 'a2', 'https://www.linkedin.com/jobs/view/9', 'nope'], now });
    assert.deepEqual(Object.keys(details).sort(), ['a1', 'a2', 'https://www.linkedin.com/jobs/view/9'], 'unknown ids are left out');
    assert.deepEqual(details.a1.resumeMatch, full.unanswered.find((r) => r.id === 'a1').resumeMatch, 'the same Job Match the full list sends');
    assert.deepEqual(details.a2.resumeEta, full.unanswered.find((r) => r.id === 'a2').resumeEta, 'the same ETA the full list sends');
    assert.equal(details.a2.resumeEta.state, 'queued');
    assert.equal(details['https://www.linkedin.com/jobs/view/9'].resumeMatch.score, 81);
  } finally { await client.close(); await mongo.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
