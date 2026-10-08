import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';

// A resume from a pasted job description (docs/resume-builder.md): the guess at company / title / location, the
// pipeline's own build (tailorOneAc) into OUT_ROOT/pasted/<id>/, edit → save → revert, list and delete. It stays
// standalone: no job, no application, nothing on Today.
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-pasted-'));
process.env.TAILOR_OUT_ROOT = out;
const { BuilderError, deletePasted, guessPosting, listPasted, loadResume, renderDraft, revertResume, saveDraft, startPasted } = await import('../../scripts/resume-builder.mjs');
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');
const FIX = path.join(import.meta.dirname, 'fixtures', 'builder-run');
// The pipeline appends each build to the snapshot log; the test puts it back.
const SNAPSHOTS = path.join(import.meta.dirname, '..', '..', 'data', 'snapshots', 'index.jsonl');

test('guess company, title and location from a pasted posting', () => {
  assert.deepEqual(guessPosting('Software Engineer II, Backend\nStripe\nSan Francisco, CA\n\nStripe is a financial infrastructure platform.\nStripe is an equal opportunity employer.'),
    { company: 'Stripe', title: 'Software Engineer II, Backend', location: 'San Francisco, CA' });
  assert.deepEqual(guessPosting('Job Title: Machine Learning Engineer\nLocation: Remote\nCompany: Databricks'), { company: 'Databricks', title: 'Machine Learning Engineer', location: 'Remote' });
  // Requirements and sentences are never taken for the title.
  assert.equal(guessPosting('4+ years of software engineering experience\nWe are hiring a full-stack engineer.').title, '');
});

test('paste → build → edit → save → revert → list → delete, never touching jobs or applications', { timeout: 300_000 }, async () => {
  const snapshots = fs.existsSync(SNAPSHOTS) ? fs.readFileSync(SNAPSHOTS) : null;
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db('t');
    const jd = fs.readFileSync(path.join(FIX, 'jd.txt'), 'utf8');
    await assert.rejects(startPasted(db, { jd: 'too short' }), BuilderError);

    const { source } = await startPasted(db, { jd, company: 'Example Co', title: 'Software Engineer', location: 'Austin, TX' });
    assert.equal(source.kind, 'pasted');
    assert.match(source.pasted, /^[a-f0-9]{10}$/);
    const dir = path.join(out, 'pasted', source.pasted);
    for (const f of ['Atishay Kasliwal.pdf', 'composition.json', 'resume.tex']) assert.ok(fs.existsSync(path.join(dir, f)), f);
    assert.deepEqual(fs.readdirSync(path.join(out, 'pasted', '.build')), [], 'the build folder is cleaned up');
    assert.equal(await db.collection('jobs').countDocuments(), 0);
    assert.equal(await db.collection('applications').countDocuments(), 0);

    const r = await loadResume(db, { pasted: source.pasted });
    assert.equal(r.source.company, 'Example Co');
    assert.ok(r.jd && r.sections.length > 0 && r.current.pages === 1);
    assert.equal(r.current.edited, false);

    // Drop one bullet: renders on one page and saves in place, keeping the generated one for Revert.
    const edit = structuredClone(r.sections);
    edit.find((s) => s.bullets.length > 1).bullets.pop();
    const draft = await renderDraft(db, { source: r.source, headerTitle: r.headerTitle, skills: r.skills, sections: edit });
    assert.deepEqual(draft.problems, []);
    assert.ok(typeof draft.jdMatch.after === 'number');
    await saveDraft(db, { source: r.source, draftId: draft.draftId });
    assert.ok(fs.existsSync(path.join(dir, 'generated', 'Atishay Kasliwal.pdf')));
    const again = await loadResume(db, { pasted: source.pasted });
    assert.equal(again.current.edited, true);
    assert.equal(again.sections.reduce((n, s) => n + s.bullets.length, 0), r.sections.reduce((n, s) => n + s.bullets.length, 0) - 1);
    assert.equal((await listPasted(db)).resumes[0].edited, true);

    await revertResume(db, r.source);
    assert.equal((await loadResume(db, { pasted: source.pasted })).current.edited, false);

    const { resumes } = await listPasted(db);
    assert.equal(resumes.length, 1);
    assert.equal(resumes[0].pdfPath, path.join(dir, 'Atishay Kasliwal.pdf'));
    assert.equal('jd' in resumes[0], false);

    await deletePasted(db, source.pasted);
    assert.equal((await listPasted(db)).resumes.length, 0);
    assert.equal(fs.existsSync(dir), false);
    await assert.rejects(loadResume(db, { pasted: source.pasted }), /deleted/);
    await assert.rejects(deletePasted(db, '../etc'), BuilderError);
  } finally {
    await client.close();
    await mongo.stop();
    if (snapshots) fs.writeFileSync(SNAPSHOTS, snapshots);
  }
});
