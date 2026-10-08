import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';

// The resume builder (docs/resume-builder.md) on a copy of a real run (bullets, title and skills only), a temporary
// resume folder and an in-memory Mongo: load, swap a bullet for another of the same employer, render with the
// pipeline's renderer and tectonic, save (job and applications point at the edit), revert.
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-'));
process.env.TAILOR_OUT_ROOT = out;
const { loadResume, renderDraft, saveDraft, revertResume } = await import('../../scripts/resume-builder.mjs');
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');
const FIX = path.join(import.meta.dirname, 'fixtures', 'builder-run');

test('load → swap a bullet → render one page → save repoints the job and its application → revert', { timeout: 240_000 }, async () => {
  const run = path.join(out, '2026-10-06', 'Example (6thOctober)');
  fs.mkdirSync(run, { recursive: true });
  fs.copyFileSync(path.join(FIX, 'composition.json'), path.join(run, 'composition.json'));
  fs.writeFileSync(path.join(run, 'Atishay Kasliwal.pdf'), '%PDF-1.4 generated');
  const generated = path.join(run, 'Atishay Kasliwal.pdf');
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db('t');
    const jobUrl = 'https://www.linkedin.com/jobs/view/1';
    await db.collection('jobs').insertOne({ job_url: jobUrl, company: 'Example', title: 'Software Engineer', location: 'Charlotte, NC', resume: { status: 'success', pdf_path: generated } });
    await db.collection('descriptions').insertOne({ job_url: jobUrl, description: fs.readFileSync(path.join(FIX, 'jd.txt'), 'utf8') });
    await db.collection('applications').insertOne({ _id: 'a1', jobUrls: [jobUrl], status: 'NEEDS_REVIEW', resume: { path: generated, sha256: 'x', fileName: 'Atishay Kasliwal.pdf' } });

    const r = await loadResume(db, { jobUrl });
    assert.equal(r.source.kind, 'job');
    assert.deepEqual(r.sections.map((s) => s.role), ['stony-brook', 'wake-forest', 'accolite', 'atriveo', 'insurance-platform']);
    assert.ok(r.options['accolite'].length > 4 && r.jd);

    // An unchanged edit renders and passes; then swap Accolite's last bullet for another Accolite one with a new verb.
    const acc = r.sections.find((s) => s.role === 'accolite');
    const used = new Set(r.sections.flatMap((s) => s.bullets.map((b) => b.text.split(' ')[0].toLowerCase())));
    const swap = r.options['accolite'].find((o) => !acc.bullets.some((b) => b.ac_id === o.ac_id) && !used.has(o.text.split(' ')[0].toLowerCase()));
    acc.bullets[acc.bullets.length - 1] = swap;
    const draft = await renderDraft(db, { source: r.source, headerTitle: r.headerTitle, skills: r.skills, sections: r.sections });
    assert.deepEqual(draft.problems, []);
    assert.equal(draft.pages, 1);
    assert.ok(typeof draft.jdMatch.before === 'number' && typeof draft.jdMatch.after === 'number');

    // The header's email and city, and a project's tools line, are yours to set; a bad email is refused.
    assert.ok(r.email !== undefined && r.city);
    const proj = structuredClone(r.sections);
    proj.find((s) => s.role === 'atriveo').stack = ['Go', 'Rust'];
    const custom = await renderDraft(db, { source: r.source, headerTitle: r.headerTitle, email: 'me@example.com', city: 'Charlotte, NC', skills: r.skills, sections: proj });
    assert.deepEqual(custom.problems, []);
    const tex = fs.readFileSync(path.join(path.dirname(custom.pdfPath), 'resume.tex'), 'utf8');
    assert.match(tex, /me@example\.com/);
    assert.match(tex, /Charlotte, NC/);
    assert.match(tex, /\\textbf\{Atriveo\} \$\|\$ \\emph\{Go, Rust\}/);
    assert.deepEqual(custom.stacks.atriveo, ['Go', 'Rust']);
    assert.ok(draft.stacks.atriveo.length > 0, 'without yours, the tools come from the bullets');
    const badEmail = await renderDraft(db, { source: r.source, headerTitle: r.headerTitle, email: 'not-an-email', skills: r.skills, sections: r.sections });
    assert.ok(badEmail.problems.some((p) => /isn't an email/.test(p)));

    // A repeated opening verb and a bullet from another employer are refused.
    const bad = structuredClone(r.sections);
    bad[0].bullets.push(r.options['accolite'][0]);
    const refused = await renderDraft(db, { source: r.source, headerTitle: r.headerTitle, skills: r.skills, sections: bad });
    assert.ok(refused.problems.some((p) => /belongs to Accolite/.test(p)));
    await assert.rejects(saveDraft(db, { source: r.source, draftId: refused.draftId }), /Not saved/);

    const saved = await saveDraft(db, { source: r.source, draftId: draft.draftId });
    assert.equal(saved.pdfPath, path.join(run, 'edits', '1', 'Atishay Kasliwal.pdf'));
    assert.ok(fs.existsSync(saved.pdfPath));
    const job = await db.collection('jobs').findOne({ job_url: jobUrl });
    assert.equal(job.resume.pdf_path, saved.pdfPath);
    assert.equal(job.resume.generated_pdf_path, generated);
    assert.deepEqual((await db.collection('applications').findOne({ _id: 'a1' })).resume, { path: saved.pdfPath, sha256: null, fileName: 'Atishay Kasliwal.pdf' });

    // The edit opens again as edited, with the swapped bullet; Revert goes back to the generated one.
    const again = await loadResume(db, { jobUrl });
    assert.equal(again.current.edited, true);
    assert.ok(again.sections.find((s) => s.role === 'accolite').bullets.some((b) => b.ac_id === swap.ac_id));
    await revertResume(db, r.source);
    assert.equal((await db.collection('jobs').findOne({ job_url: jobUrl })).resume.pdf_path, generated);
    assert.equal((await db.collection('applications').findOne({ _id: 'a1' })).resume.path, generated);
  } finally { await client.close(); await mongo.stop(); fs.rmSync(out, { recursive: true, force: true }); }
});
