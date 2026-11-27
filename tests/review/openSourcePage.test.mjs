import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';

// The open source page (/open-source, docs/open-source-page.md): rating, GitHub sync, the view and your edits.
// GitHub is a stub and Mongo is in memory; the bank is the real git bank, read only.
process.env.AC_BANK_OVERLAY = '/nonexistent';
const { addPr, checkDraft, deletePr, demandOf, fromGraphql, loadOpenSource, openSourceView, prId, savePr, syncOpenSource, OpenSourceError } = await import('../../scripts/open-source.mjs');
const { measure, rate } = await import('../../scripts/open-source-rating.mjs');
const { loadBank } = await import('../../scripts/ac-bank.mjs');
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');

const ME = 'atishay-kasliwal';
const node = (repo, number, over = {}) => ({
  url: `https://github.com/${repo}/pull/${number}`, number, title: `PR ${number}`, state: 'MERGED', isDraft: false, createdAt: '2026-11-19T10:00:00Z', mergedAt: '2026-11-20T10:00:00Z', closedAt: '2026-11-20T10:00:00Z',
  additions: 39, deletions: 0, changedFiles: 2, reviewDecision: 'APPROVED', body: 'Compared 6,000 problems.', repository: { nameWithOwner: repo, stargazerCount: 15255, primaryLanguage: { name: 'Python' }, owner: { login: repo.split('/')[0], __typename: 'Organization' } },
  files: { nodes: [{ path: 'scipy/optimize/trf.py', additions: 4 }, { path: 'scipy/optimize/tests/test_lsq.py', additions: 35 }] },
  commits: { nodes: [{ commit: { parents: { totalCount: 1 }, authors: { nodes: [{ user: { login: ME } }] } } }] }, ...over,
});
const github = (nodes) => {
  const calls = [];
  const f = async (url, init = {}) => { calls.push({ url: String(url), init }); return { ok: true, status: 200, json: async () => ({ data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } }) }; };
  return Object.assign(f, { calls });
};
async function withDb(fn) {
  const mongod = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongod.getUri());
  try { await fn(client.db('oss')); } finally { await client.close(); await mongod.stop(); }
}

test('rating: recognition, size, proof and status, with the caps', () => {
  const base = { owner: 'scipy', stars: 15000, code: 4, test: 35, files: 2, tested: true, measured: true, state: 'MERGED' };
  assert.deepEqual(rate(base), { score: 9, parts: { recognition: 3, size: 2, proof: 2, status: 2 }, rating: 'impressive' });
  assert.equal(rate({ ...base, state: 'OPEN' }).score, 7);
  assert.equal(rate({ ...base, code: 0, test: 0, tested: false }).rating, 'average', 'docs only');
  assert.equal(rate({ ...base, code: 1, test: 0 }).score, 5, 'one line');
  assert.equal(rate({ ...base, files: 481 }).score, 5, 'a mechanical sweep');
  assert.equal(rate({ ...base, code: 20, test: 0, measured: false }).score, 7);
  assert.ok(rate({ ...base, code: 300, shared: true }).score < rate({ ...base, code: 300 }).score, 'shared work');
  assert.equal(rate({ owner: 'x', state: 'MERGED' }), null, 'unknown size is not guessed');
  assert.deepEqual(measure({ files: [{ path: 'docs/a.md', additions: 90 }, { path: 'src/a.rs', additions: 3 }], body: 'Adds tests.' }), { code: 3, test: 0, files: 2, tested: true, measured: false });
});

test('a pull request with mostly maintainer commits is marked shared; merge commits do not count', () => {
  const c = (login, parents = 1) => ({ commit: { parents: { totalCount: parents }, authors: { nodes: [{ user: { login } }] } } });
  assert.equal(fromGraphql(node('kiali/kiali', 1, { commits: { nodes: [c(ME), c('maintainer'), c('maintainer')] } }), ME).shared, true);
  assert.equal(fromGraphql(node('a/b', 2, { commits: { nodes: [c(ME), c('maintainer', 2), c('maintainer', 2)] } }), ME).shared, false);
  assert.ok(!('body' in fromGraphql(node('a/b', 2), ME)), 'descriptions are not stored');
  assert.equal(prId('https://github.com/scipy/scipy/pull/26772/files'), 'scipy/scipy#26772');
  assert.equal(prId('https://example.com/a/b/pull/1'), null);
});

test('sync: adds, reports status changes, keeps your edits, and a status-only sync keeps the sizes', async () => withDb(async (db) => {
  const first = github([node('scipy/scipy', 26772), node('o/open', 5, { state: 'OPEN', mergedAt: null, closedAt: null })]);
  let r = await syncOpenSource(db, { login: ME, token: 't', fetchImpl: first });
  assert.equal(r.full, true);
  assert.deepEqual(r.added.sort(), ['o/open#5', 'scipy/scipy#26772']);
  assert.match(first.calls[0].init.headers.Authorization, /^Bearer t$/);
  await savePr(db, { id: 'o/open#5', rating: 'good', text: 'Added a thing.', fits: ['SWE', 'AI'] });

  r = await syncOpenSource(db, { login: ME, token: 't', fetchImpl: github([node('scipy/scipy', 26772), node('o/open', 5)]) });
  assert.deepEqual([r.added, r.changed], [[], [{ id: 'o/open#5', from: 'OPEN', to: 'MERGED' }]]);
  const rest = async () => ({ ok: true, json: async () => ({ items: [{ repository_url: 'https://api.github.com/repos/scipy/scipy', html_url: 'https://github.com/scipy/scipy/pull/26772', number: 26772, title: 'renamed', state: 'closed', created_at: '2026-11-19T10:00:00Z', closed_at: '2026-11-20T10:00:00Z', pull_request: { merged_at: '2026-11-20T10:00:00Z' } }] }) });
  r = await syncOpenSource(db, { login: ME, token: '', fetchImpl: rest });
  assert.equal(r.full, false);
  const v = await loadOpenSource(db);
  const scipy = v.prs.find((p) => p.id === 'scipy/scipy#26772');
  assert.deepEqual([scipy.title, scipy.stars, scipy.score, scipy.rating], ['renamed', 15255, 9, 'impressive']);
  assert.equal(scipy.coverage, 'covered');
  assert.ok(scipy.bullets.includes('AC-282'));
  const open = v.prs.find((p) => p.id === 'o/open#5');
  assert.deepEqual([open.rating, open.ratedByYou, open.coverage, open.fits], ['good', true, 'draft', ['SWE', 'AI']]);
  assert.deepEqual((await syncOpenSource(db, { login: ME, ifOlderMin: 60, fetchImpl: () => assert.fail('not due') })).skipped, true);
  await assert.rejects(syncOpenSource(db, { login: ME, token: 'bad', fetchImpl: async () => ({ ok: false, status: 401 }) }), /refused the token/);
  assert.equal((await loadOpenSource(db)).prs.length, 2, 'a failed sync changes nothing');
}));

test('edits: save, skip, add, delete and restore; bad input is refused', async () => withDb(async (db) => {
  await syncOpenSource(db, { login: ME, token: 't', fetchImpl: github([node('scipy/scipy', 26772), node('a/b', 1, { state: 'CLOSED', mergedAt: null })]) });
  let v = await savePr(db, { id: 'scipy/scipy#26772', rating: 'average' });
  assert.equal(v.prs.find((p) => p.n === 26772).rating, 'average');
  v = await savePr(db, { id: 'scipy/scipy#26772', rating: null, skip: true });
  assert.deepEqual([v.prs.find((p) => p.n === 26772).rating, v.prs.find((p) => p.n === 26772).coverage], ['impressive', 'skipped']);
  // Saving the bank's own wording leaves no draft behind.
  const bank = loadBank().acs.find((a) => a.id === 'AC-282').variants[0].text;
  v = await savePr(db, { id: 'scipy/scipy#26772', text: bank, skip: false });
  assert.equal((await db.collection('oss_prs').findOne({ _id: 'scipy/scipy#26772' })).mine.text, undefined);
  assert.equal(v.prs.find((p) => p.n === 26772).coverage, 'covered');
  assert.equal(v.prs.find((p) => p.n === 1).coverage, 'closed');

  v = await addPr(db, { url: 'https://github.com/x/y/pull/9', title: 'Mine', state: 'OPEN', date: '2026-11-25' });
  assert.equal(v.id, 'x/y#9');
  assert.equal(v.prs.find((p) => p.id === 'x/y#9').rating, null, 'no size, so no guessed rating');
  await assert.rejects(addPr(db, { url: 'https://github.com/x/y/pull/9', title: 'again' }), /already on the page/);
  v = await deletePr(db, { id: 'x/y#9' });
  assert.equal(v.prs.find((p) => p.id === 'x/y#9').coverage, 'deleted');
  v = await addPr(db, { url: 'https://github.com/x/y/pull/9', title: 'back' });
  assert.notEqual(v.prs.find((p) => p.id === 'x/y#9').coverage, 'deleted');
  for (const bad of [() => savePr(db, { id: 'x/y#9', rating: 'amazing' }), () => savePr(db, { id: 'x/y#9', fits: ['CEO'] }), () => savePr(db, { id: 'nope' }), () => addPr(db, { url: 'https://evil.com/a/b/pull/1', title: 't' }), () => addPr(db, { url: 'https://github.com/a/b/pull/2', title: 't', date: 'yesterday' })]) await assert.rejects(bad, OpenSourceError);
}));

test('the view: every bank bullet once, ready when rated good and clearly yours (open counts fully)', () => {
  const bank = loadBank();
  const live = bank.acs.filter((a) => a.role === 'open-source' && !(a.tracks || []).includes('retired'));
  const docs = live.flatMap((a) => a.oss.prs.map((u) => ({ _id: prId(u), gh: { ...fromGraphql(node(prId(u).split('#')[0], Number(prId(u).split('#')[1]), { url: u, state: a.oss.status === 'open' ? 'OPEN' : 'MERGED' }), ME) } })));
  const v = openSourceView(docs);
  assert.equal(v.bullets.length, live.length);
  const by = new Map(v.bullets.map((b) => [b.id, b]));
  assert.equal(by.get('AC-282').ready, true);
  assert.equal(by.get('AC-287').ready, false, 'shared with the maintainer');
  // Open pull requests count fully (2026-11-26): an open one is ready on its rating alone.
  assert.equal(by.get('AC-299').merged, false);
  assert.equal(by.get('AC-299').ready, by.get('AC-299').score >= 6, 'open counts fully');
  assert.deepEqual(by.get('AC-289').areas, ['FS', 'FE']);
  assert.deepEqual(v.masters.DS, ['AC-282', 'AC-284', 'AC-286']);
  assert.deepEqual(v.masters.DA, []);
  assert.ok(v.skills['AC-286'].includes('PyTorch'));
});

test('drafts use the bank rules; another open source bullet may share the verb', () => {
  assert.deepEqual(checkDraft('Solved an infinite loop in the lsq_linear optimizer of SciPy (15K+ GitHub stars) in Python so 8 hanging problems converge, with no other changes across 6,000 checked.'), []);
  assert.ok(checkDraft('Fixed it.').length);
  assert.deepEqual(checkDraft(''), []);
});

test('what postings ask for: whole words only, per resume', () => {
  const d = demandOf([
    { title: 'Software Engineer', description: 'Good trust in Java and Go, Kubernetes.' },
    { title: 'Full Stack Developer', description: 'A good client with JavaScript and React.' },
  ]);
  const swe = Object.fromEntries(d.SWE.skills);
  assert.deepEqual([d.SWE.n, swe.Java, swe.JavaScript, swe.Go, swe.Rust], [2, 50, 50, 50, undefined]);
  assert.equal(d.FS.n, 1);
});
