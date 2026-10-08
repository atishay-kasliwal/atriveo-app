import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';

// Your own bullets in the resume builder (docs/resume-builder.md): checked by the bank's rules, saved to the bank
// (Mongo bank_overlay, merged by loadBank), offered to future resumes, and composable by the real pipeline.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-bullets-'));
process.env.TAILOR_OUT_ROOT = tmp;
process.env.AC_BANK_OVERLAY = path.join(tmp, 'overlay.json');
const { checkText, saveBullet, renderDraft, loadResume, freeVerbs } = await import('../../scripts/resume-builder.mjs');
const { loadBank } = await import('../../scripts/ac-bank.mjs');
const { generateResume } = await import('../../scripts/ac-pipeline.mjs');
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');
const FIX = path.join(import.meta.dirname, 'fixtures', 'builder-run');

test('check, reword for the bank, write a new one, edit for one resume only; the pipeline composes with them', { timeout: 300_000 }, async () => {
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db('t');
    const before = loadBank();
    const verb = freeVerbs(before)[0];
    assert.ok(verb, 'there is an approved verb nobody uses yet');

    // The rules: length, an approved verb, a verb of its own for the bank.
    assert.ok(checkText('accolite', 'Built stuff').some((i) => /too short/.test(i)));
    assert.ok(checkText('accolite', 'Streamlined Jenkins and Docker pipelines for 20 engineers, cutting release time from 6 hours to 15 minutes across 3 teams.').some((i) => /already opens/.test(i)));
    const mine = `${verb} Jenkins and Docker release pipelines for 20 engineers, cutting deployment time from 6 hours to 15 minutes across 3 product teams.`;
    assert.deepEqual(checkText('accolite', mine), []);

    // New: a bank entry for Accolite, merged into the bank and offered by the builder.
    const added = await saveBullet(db, { role: 'accolite', text: mine, mode: 'new' });
    assert.match(added.bullet.ac_id, /^AC-U\d{3}$/);
    const after = loadBank();
    const entry = after.acs.find((a) => a.id === added.bullet.ac_id);
    assert.equal(entry.role, 'accolite');
    assert.deepEqual([...entry.signature_technologies].sort(), ['Docker', 'Jenkins']);
    assert.notEqual(String(after.bank_version), String(before.bank_version), 'the bank version moves, so cached resumes rebuild');
    await assert.rejects(saveBullet(db, { role: 'accolite', text: mine, mode: 'new' }), /already opens/, 'the same verb twice is refused');

    // Reword: your wording replaces that bank bullet's for future resumes; the old wording is kept in Mongo.
    const target = after.acs.find((a) => a.role === 'stony-brook' && a.id === 'AC-003');
    const reworded = target.variants[0].text.replace(/^\w+/, 'Programmed').replace('validated schemas', 'validated JSON schemas');
    const rw = await saveBullet(db, { role: 'stony-brook', text: reworded, mode: 'reword', acId: 'AC-003', facet: target.variants[0].facet ?? 'default' });
    assert.equal(loadBank().acs.find((a) => a.id === 'AC-003').variants[0].text, reworded);
    assert.equal((await db.collection('bank_overlay').findOne({ _id: `AC-003:${rw.bullet.facet}` })).previous, target.variants[0].text);

    // The real pipeline composes a resume with the bank as it now is.
    const jd = fs.readFileSync(path.join(FIX, 'jd.txt'), 'utf8');
    const result = generateResume({ jd, meta: { title: 'Software Engineer' } });
    const composed = [...result.result.compact.experience, ...result.result.compact.projects].flatMap((r) => r.bullets);
    assert.ok(composed.length > 5 && result.result.tex.includes('\\begin{document}'), 'the pipeline still composes a resume');

    // A job's resume: your new bullet is offered for Accolite; a this-resume-only edit renders, a bad one is refused.
    const run = path.join(tmp, '2026-10-08', 'Example (8thOctober)');
    fs.mkdirSync(run, { recursive: true });
    fs.copyFileSync(path.join(FIX, 'composition.json'), path.join(run, 'composition.json'));
    fs.writeFileSync(path.join(run, 'Atishay Kasliwal.pdf'), '%PDF-1.4');
    await db.collection('jobs').insertOne({ job_url: 'j1', company: 'Example', title: 'Software Engineer', resume: { status: 'success', pdf_path: path.join(run, 'Atishay Kasliwal.pdf') } });
    const r = await loadResume(db, { jobUrl: 'j1' });
    assert.ok(r.options.accolite.some((o) => o.ac_id === added.bullet.ac_id));
    const acc = r.sections.find((s) => s.role === 'accolite');
    const original = acc.bullets[0];
    acc.bullets[0] = { ...original, text: original.text.replace(/\d+ (years|employees)/, '4 $1'), custom: true };
    const ok = await renderDraft(db, { source: r.source, headerTitle: r.headerTitle, skills: r.skills, sections: r.sections });
    assert.deepEqual(ok.problems, []);
    acc.bullets[0] = { ...original, text: 'Did things', custom: true };
    const bad = await renderDraft(db, { source: r.source, headerTitle: r.headerTitle, skills: r.skills, sections: r.sections });
    assert.ok(bad.problems.some((p) => /too short/.test(p)));
  } finally { await client.close(); await mongo.stop(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
