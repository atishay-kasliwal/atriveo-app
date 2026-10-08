import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

// Exporting your builder bullets into the git bank (scripts/export-bank-overlay.mjs) on a copy of data/ac-bank:
// a new bullet becomes its own YAML, a reword replaces that variant's text and keeps the old one in earlier_texts,
// the rest of the file is untouched, the bank lint still passes, and a second run writes nothing.
process.env.AC_BANK_OVERLAY = path.join(os.tmpdir(), 'no-overlay-export-test.json');
const { planExport, inGit, lintBank, rewordYaml } = await import('../../scripts/export-bank-overlay.mjs');
const { loadBank } = await import('../../scripts/ac-bank.mjs');
const { checkText, freeVerbs } = await import('../../scripts/resume-builder.mjs');
const BANK = path.join(import.meta.dirname, '..', '..', 'data', 'ac-bank');

test('export a new bullet and a reword: YAML in git, lint passes, idempotent', { timeout: 240_000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-export-'));
  fs.cpSync(BANK, dir, { recursive: true });
  const bank = loadBank(dir);
  // Verbs nothing in the bank opens with, so both bullets pass the bank's own rules (as the builder requires).
  const [v1, v2] = freeVerbs(bank);
  const ac1 = bank.acs.find((a) => a.id === 'AC-001');
  const oldText = ac1.variants[0].text.replace(/\s+/g, ' ').trim();
  const reworded = oldText.replace(/^\S+/, v1);
  const fresh = `${v2} 4 junior engineers on Java code reviews and testing practices, cutting review turnaround from 3 days to 1 day across the team.`;
  assert.deepEqual(checkText('stony-brook', reworded, bank, { acId: 'AC-001' }), []);
  assert.deepEqual(checkText('accolite', fresh, bank), []);
  const entries = [
    { _id: 'AC-001:default', type: 'reword', ac_id: 'AC-001', facet: ac1.variants[0].facet ?? 'default', text: reworded, previous: oldText },
    { _id: 'AC-U001', type: 'new', createdAt: '2026-10-08T12:00:00Z', ac: { id: 'AC-U001', role: 'accolite', slot_kind: 'experience', engineering_identity: 'platform', achievement_theme: 'your-bullet', display_order: 900, wow_score: 0.7, metrics_claimed: [], concepts_claimed: [], signature_technologies: ['Java'], fact: fresh, capabilities: { ai: 40, backend: 80, frontend: 50, data: 40, cloud: 60, ml: 30 }, strength: { recruiter: 7 }, ats_keywords: ['Java'], facets: { default: { phrase: 'your-bullet', keywords: ['java'] } }, variants: [{ facet: 'default', emphasis: 'default', strength: 8, text: fresh }], source: 'resume-builder' } },
  ];
  const before = fs.readFileSync(path.join(dir, 'AC-001.yaml'), 'utf8');
  const plan = planExport(entries, dir);
  assert.deepEqual(plan.map((p) => [p.kind, path.basename(p.file)]).sort(), [['new', 'AC-U001.yaml'], ['reword', 'AC-001.yaml']]);
  for (const p of plan) fs.writeFileSync(p.file, `${p.after}\n`);

  // Only the variant's text changed in AC-001.yaml (plus earlier_texts); every other line is as it was.
  const after = fs.readFileSync(path.join(dir, 'AC-001.yaml'), 'utf8');
  const removed = before.split('\n').filter((l) => !after.split('\n').includes(l));
  assert.ok(removed.every((l) => oldText.includes(l.trim()) || /^\s*text: >-$/.test(l)), `unexpected lines removed: ${removed.join(' | ')}`);
  const exported = loadBank(dir);
  const v = exported.acs.find((a) => a.id === 'AC-001').variants[0];
  assert.equal(v.text.replace(/\s+/g, ' ').trim(), reworded);
  assert.deepEqual(v.earlier_texts, [oldText]);
  assert.equal(exported.acs.find((a) => a.id === 'AC-U001')?.variants[0].text, fresh);
  assert.equal(yaml.load(fs.readFileSync(path.join(dir, 'AC-U001.yaml'), 'utf8')).provenance.level, 'USER_WRITTEN');

  const lint = lintBank(dir);
  assert.ok(lint.ok, lint.output.split('\n').filter((l) => /✗/.test(l)).join('\n'));
  assert.deepEqual(planExport(entries, dir), [], 'a second run writes nothing');
  assert.equal(inGit(entries, dir).length, 2, 'both are in git now (what --prune deletes)');
  // A reword of a variant that isn't there is reported, not written.
  assert.equal(rewordYaml(before, 'no-such-facet', reworded), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
