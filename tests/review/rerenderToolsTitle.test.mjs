import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';
import { convertTex, rerender } from '../../scripts/rerender-tools-title.mjs';

// Redrawing resumes built with tools on the company line (scripts/rerender-tools-title.mjs), on a real resume.tex.
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');
const OLD = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'tools-title', 'resume.tex'), 'utf8');

test('the heading lines move the tools after the title; every other line stays as built', () => {
  const next = convertTex(OLD);
  assert.match(next, /\\resumeSubheading\{Accolite Digital\}\{August 2021 -- August 2024\}\{Senior Software Developer \$\|\$ Python, Java, AWS, SQL, React, CI\/CD\}\{Hyderabad, TG\}/);
  assert.match(next, /\\resumeSubheading\{Stony Brook University\}\{November 2024 -- May 2026\}\{Software Engineer \$\|\$ Python, AWS, SQL, React, PostgreSQL, FastAPI\}/);
  assert.doesNotMatch(next, /resumeSubheadingTools/);
  const changed = (a, b) => a.split('\n').filter((l, i) => l !== b.split('\n')[i]);
  assert.equal(OLD.split('\n').length - next.split('\n').length, 1, 'only the macro definition line is removed');
  assert.equal(changed(OLD.replace(/^\\newcommand\{\\resumeSubheadingTools\}.*\n/m, ''), next).length, 3, 'three employer headings, nothing else');
  assert.equal(convertTex(next), null, 'already new: nothing to do');
  assert.equal(convertTex(OLD.replace('\\resumeSubheadingTools{\\textbf{Accolite', '\\resumeSubheadingTools{{Accolite')), null, 'an unknown shape is left alone');
});

test('dry run changes nothing; apply redraws one page, keeps a backup, leaves sent resumes as sent and re-verifies the rest', { timeout: 240_000, skip: spawnSync('tectonic', ['--version']).status !== 0 && 'no tectonic' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-title-'));
  const mk = (name) => {
    const dir = path.join(root, '2026-10-10', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'resume.tex'), OLD);
    fs.writeFileSync(path.join(dir, 'Atishay Kasliwal.pdf'), '%PDF-1.4 old');
    return path.join(dir, 'Atishay Kasliwal.pdf');
  };
  const open = mk('Open (10thOctober)');
  const sent = mk('Sent (10thOctober)');
  // No employer had tools: the macro is defined but unused, so the page already reads right.
  const unused = OLD.replace(/\\resumeSubheadingTools\{\\textbf\{([^{}]*)\} \$\|\$ \\emph\{\\small [^{}]*\}\}/g, '\\resumeSubheading{$1}');
  fs.mkdirSync(path.join(root, '2026-10-09', 'Plain'), { recursive: true });
  fs.writeFileSync(path.join(root, '2026-10-09', 'Plain', 'resume.tex'), unused);
  fs.writeFileSync(path.join(root, '2026-10-09', 'Plain', 'Atishay Kasliwal.pdf'), '%PDF-1.4 old');
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db('t');
    await db.collection('applications').insertMany([
      { _id: 'a1', status: 'NEEDS_REVIEW', resume: { path: open, sha256: 'old' }, extension: { resumeChoice: { path: open, sha256: 'old' } } },
      { _id: 'a2', status: 'APPLIED', resume: { path: sent, sha256: 'old' } },
    ]);
    const quiet = () => {};
    const dry = await rerender({ db, root, apply: false, log: quiet });
    assert.deepEqual([dry.looked, dry.alreadyNew, dry.unknownShape, dry.sent, dry.redrawn], [3, 1, 0, 1, 1]);
    assert.equal(fs.readFileSync(open, 'utf8'), '%PDF-1.4 old');

    const done = await rerender({ db, root, apply: true, log: quiet });
    assert.deepEqual([done.redrawn, done.notOnePage, done.failed, done.applicationsReset], [1, 0, 0, 1]);
    assert.match(fs.readFileSync(open, 'latin1').slice(0, 8), /^%PDF-/);
    assert.notEqual(fs.readFileSync(open, 'utf8'), '%PDF-1.4 old');
    assert.doesNotMatch(fs.readFileSync(path.join(path.dirname(open), 'resume.tex'), 'utf8'), /resumeSubheadingTools/);
    assert.equal(fs.readFileSync(path.join(root, '.backup-tools-title', '2026-10-10', 'Open (10thOctober)', 'Atishay Kasliwal.pdf'), 'utf8'), '%PDF-1.4 old');
    assert.equal(fs.readFileSync(sent, 'utf8'), '%PDF-1.4 old', 'the resume an application was sent with stays as sent');
    const [a1, a2] = await db.collection('applications').find().sort({ _id: 1 }).toArray();
    assert.equal(a1.resume.sha256, null);
    assert.equal(a1.extension.resumeChoice, undefined);
    assert.equal(a2.resume.sha256, 'old');

    const again = await rerender({ db, root, apply: true, log: quiet });
    assert.deepEqual([again.alreadyNew, again.redrawn], [2, 0], 'running it twice changes nothing more');
  } finally {
    await client.close();
    await mongo.stop();
  }
});
