import test from 'node:test';
import assert from 'node:assert/strict';
import { keywordCoverage, keywordHighlights, pageSpace, analyzeMatchingResume } from '../scripts/job-matching-analysis.mjs';
import { shapeJd, recordDecision } from '../scripts/job-matching.mjs';
import { loadAtsConfig } from '../scripts/ats/config.mjs';
const config = loadAtsConfig();

test('keywords use exact terms or known equivalents, never related technology or substrings', () => {
  const jd = 'Required Skills\nReact.js, Java, Spring Boot, Python, Kubernetes, SQL, HTML, CSS, Go. We go fast.';
  const keywords = keywordCoverage(jd, 'Technical Skills: React, JavaScript, Python, Docker, MySQL, HTML5, CSS3, Go', config);
  const byName = new Map(keywords.map(k => [k.name, k.matched]));
  assert.equal(byName.get('React'), true);
  assert.equal(byName.get('Java'), false);
  assert.equal(byName.get('Kubernetes'), false);
  assert.equal(byName.get('SQL'), false);
  assert.equal(byName.get('Python'), true);
  assert.equal(byName.get('HTML'), true);
  assert.equal(byName.get('CSS'), true);
  const highlights = keywordHighlights(jd, keywords, config).map(r => jd.slice(r.start, r.end));
  assert.ok(highlights.includes('React.js'));
  assert.ok(highlights.includes('Go'));
  assert.ok(!highlights.includes('go'));
  assert.ok(!highlights.includes('Java'));
});

test('overlapping terms produce disjoint highlight ranges', () => {
  const jd = 'Required: Spring Boot and Java';
  const ranges = keywordHighlights(jd, [{ matched: true, terms: ['Spring', 'Spring Boot', 'Java'] }], config);
  assert.deepEqual(ranges.map(r => jd.slice(r.start, r.end)), ['Spring Boot', 'Java']);
});

test('the full description is retained beyond the old 12KB cutoff', () => {
  const jd = 'Overview   ' + 'Detailed description. '.repeat(900) + '\nRequired Skills\nPython and React';
  const shaped = shapeJd(jd);
  assert.ok(shaped.full.endsWith('Python and React'));
  assert.ok(shaped.full.length > 12000);
});

test('space accounts for the bottom margin and never offers room on a multipage resume', () => {
  assert.deepEqual(pageSpace('<page width="612" height="792"><word yMax="720">skills</word></page>'), {pages: 1, roomLines: 3});
  assert.deepEqual(pageSpace('<page height="792"><word yMax="755">skills</word></page>'), {pages: 1, roomLines: 0});
  assert.equal(pageSpace('<page height="792"></page><page height="792"></page>').roomLines, null);
});

test('unreadable or absent PDFs have no fabricated score', async () => {
  assert.equal(await analyzeMatchingResume('/nonexistent/job-matching.pdf', 'Required: Python', 'Engineer'), null);
});

test('Closed is kept as a left swipe marked closed, never feeds the learning signal, and undo removes it', async () => {
  const swipes = [], events = [], deleted = [];
  const db = { collection: (name) => ({
    updateOne: async (q, u) => { swipes.push({ q, set: u.$set }); },
    deleteOne: async (q) => { deleted.push(q); return { deletedCount: 1 }; },
    deleteMany: async () => ({}),
    insertOne: async (d) => { events.push(d); },
    createIndex: async () => ({}),
    findOne: async () => (name === 'jobs' ? { company: 'Acme', title: 'Software Engineer' } : null),
  }) };
  const url = 'https://jobs.example.test/1';
  await recordDecision(db, { jobUrl: url, decision: 'closed' });
  assert.equal(swipes[0].set.direction, 'left');
  assert.equal(swipes[0].set.closed, true);
  assert.equal(events.length, 0, 'a closed posting says nothing about taste, so no matching event is recorded');
  await recordDecision(db, { jobUrl: url, decision: 'skip' });
  assert.equal(swipes[1].set.direction, 'left');
  assert.equal(swipes[1].set.closed, false);
  assert.equal(events.length, 1, 'a plain skip still teaches the ranking');
  assert.equal((await recordDecision(db, { jobUrl: url, decision: 'undo' })).undone, true);
  assert.equal(deleted[0].job_url, url);
  await assert.rejects(() => recordDecision(db, { jobUrl: url, decision: 'gone' }), /Unknown decision/);
});
