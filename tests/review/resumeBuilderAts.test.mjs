import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';

// The builder's ATS score (docs/resume-builder.md, "ATS score"): the saved resume's Job Match and Resume Ready at load,
// the draft's in the render result (before → after, scored against the same posting by scripts/ats), and Save keeps
// the draft's ats-score.json with its PDF, so Job matching and Today read the new score. A track's general resume has
// no posting: Resume Ready only. Real renders (tectonic) of the fixture run, in-memory Mongo.
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-ats-'));
process.env.TAILOR_OUT_ROOT = out;
const { loadResume, renderDraft, saveDraft, revertResume } = await import('../../scripts/resume-builder.mjs');
const { resumeMatchOf } = await import('../../scripts/applications-analytics.mjs');
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');
const FIX = path.join(import.meta.dirname, 'fixtures', 'builder-run');
const PDF = 'Atishay Kasliwal.pdf';
const READY = ['Ready', 'Review', 'Needs Work'];

// The fixture's bullets in the bank's current wording (the fixture keeps older wordings, which the builder refuses).
// A bullet the bank no longer offers this track gives way to another of the same section with an unused opening verb.
const verb = (t) => t.split(' ')[0].toLowerCase();
function current(r) {
  const sections = r.sections.map((s) => ({ ...s, bullets: s.bullets.map((b) => r.options[s.role]?.find((o) => o.ac_id === b.ac_id && o.facet === b.facet) ?? r.options[s.role]?.find((o) => o.ac_id === b.ac_id) ?? null) }));
  const used = new Set(sections.flatMap((s) => s.bullets.filter(Boolean).map((b) => verb(b.text))));
  for (const s of sections) s.bullets = s.bullets.map((b) => {
    if (b) return b;
    const o = r.options[s.role].find((x) => !s.bullets.some((y) => y?.ac_id === x.ac_id) && !used.has(verb(x.text)));
    used.add(verb(o.text));
    return o;
  });
  return sections;
}
const editOf = (r, sections) => ({ source: r.source, headerTitle: r.headerTitle, skills: r.skills, sections });

test('ATS score: at load, in the render result (before → after), saved with the PDF; none for a general resume', { timeout: 300_000 }, async () => {
  const run = path.join(out, '2026-10-06', 'Example (6thOctober)');
  fs.mkdirSync(run, { recursive: true });
  fs.copyFileSync(path.join(FIX, 'composition.json'), path.join(run, 'composition.json'));
  fs.writeFileSync(path.join(run, PDF), '%PDF-1.4 generated');
  const generated = path.join(run, PDF);
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db('t');
    const jobUrl = 'https://www.linkedin.com/jobs/view/1';
    await db.collection('jobs').insertOne({ job_url: jobUrl, company: 'Example', title: 'Senior Software Engineer (Back-End)', location: 'Charlotte, NC', resume: { status: 'success', pdf_path: generated } });
    await db.collection('descriptions').insertOne({ job_url: jobUrl, description: fs.readFileSync(path.join(FIX, 'jd.txt'), 'utf8') });

    // A PDF the scorer can't read: the builder still opens, and says so instead of a number.
    const stub = await loadResume(db, { jobUrl });
    assert.equal(stub.ats.match, null);
    assert.ok(stub.ats.error, 'an unreadable PDF reports why it has no score');
    assert.equal(stub.posting, undefined, 'the posting stays on the server');

    // The draft is scored against the job's posting: Job Match with its required/preferred counts, and Resume Ready.
    const first = await renderDraft(db, editOf(stub, current(stub)));
    assert.deepEqual(first.problems, []);
    const a = first.ats.after;
    assert.equal(a.posting, true);
    assert.ok(Number.isInteger(a.match.score) && a.match.score >= 0 && a.match.score <= 100, `a Job Match score: ${JSON.stringify(a)}`);
    assert.ok(a.match.required.total > 0 && a.match.required.matched <= a.match.required.total);
    assert.ok(READY.includes(a.ready.status) && Array.isArray(a.ready.reasons));
    assert.ok(first.ats.ms < 5000, `scoring adds little to a render (${first.ats.ms} ms)`);
    for (const f of ['ats-score.json', 'jd.txt', 'meta.json', 'page-fill.json']) assert.ok(fs.existsSync(path.join(path.dirname(first.pdfPath), f)), `${f} in the draft folder`);

    // That PDF as the job's resume: load reports the same score as the draft had (same scorer, same posting).
    fs.copyFileSync(first.pdfPath, generated);
    const r = await loadResume(db, { jobUrl });
    assert.equal(r.ats.match.score, a.match.score);
    assert.equal(r.ats.ready.status, a.ready.status);
    assert.ok(fs.existsSync(path.join(run, 'ats-score.json')), 'the saved resume\'s score is kept beside it (Job matching reads it)');
    assert.equal(resumeMatchOf(generated).score, a.match.score);

    // Swap a bullet: the render reports before (the saved resume) → after (this draft).
    const sections = current(r);
    const acc = sections.find((s) => s.role === 'accolite');
    const used = new Set(sections.flatMap((s) => s.bullets.map((b) => b.text.split(' ')[0].toLowerCase())));
    acc.bullets[acc.bullets.length - 1] = r.options.accolite.find((o) => !acc.bullets.some((b) => b.ac_id === o.ac_id) && !used.has(o.text.split(' ')[0].toLowerCase()));
    const draft = await renderDraft(db, editOf(r, sections));
    assert.deepEqual(draft.problems, []);
    assert.equal(draft.ats.before.match.score, a.match.score);
    assert.ok(Number.isInteger(draft.ats.after.match.score));

    // Save: the edit's folder has the draft's score, current for its PDF, so Job matching and Today show it.
    const saved = await saveDraft(db, { source: r.source, draftId: draft.draftId });
    assert.equal(saved.pdfPath, path.join(run, 'edits', '1', PDF));
    assert.equal(resumeMatchOf(saved.pdfPath).score, draft.ats.after.match.score);
    const again = await loadResume(db, { jobUrl });
    assert.equal(again.ats.match.score, draft.ats.after.match.score);
    await revertResume(db, r.source);

    // A track's general resume: no posting, so no Job Match; Resume Ready still checks the page.
    const general = path.join(out, 'general', 'Software Engineer');
    fs.mkdirSync(general, { recursive: true });
    fs.copyFileSync(path.join(FIX, 'composition.json'), path.join(general, 'composition.json'));
    fs.copyFileSync(first.pdfPath, path.join(general, PDF));
    const g = await loadResume(db, { track: 'software-engineer' });
    assert.equal(g.ats.posting, false);
    assert.equal(g.ats.match, null);
    assert.equal(g.ats.note, 'No posting to score against');
    assert.ok(READY.includes(g.ats.ready.status));
    assert.ok(!fs.existsSync(path.join(general, 'jd.txt')));
    const gd = await renderDraft(db, editOf(g, current(g)));
    assert.equal(gd.ats.after.match, null);
    assert.equal(gd.ats.after.posting, false);
  } finally { await client.close(); await mongo.stop(); fs.rmSync(out, { recursive: true, force: true }); }
});
