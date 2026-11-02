import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { MongoClient } from 'mongodb';
import { usLocation, cleanUrl, pickListings, fetchPostingText, swelistFeed, LISTINGS_URL } from '../scripts/swelist-feed.mjs';
import { matchingSource } from '../scripts/matching-filters.mjs';
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');

const now = new Date('2026-11-02T21:00:00Z');
const at = (hoursAgo) => Math.floor(now.getTime() / 1000) - hoursAgo * 3600;
const TEXT = 'Build data pipelines and machine learning systems in Python. '.repeat(8);
const listing = (o) => ({ id: o.id, company_name: o.company ?? 'Acme', title: o.title ?? 'Software Engineer', url: o.url, locations: o.locations ?? ['Bedford, MA'], date_posted: o.date_posted ?? at(2), active: o.active ?? true, is_visible: o.is_visible ?? true, category: 'Software' });

test('US locations: City, ST and the list\'s own names count; the UK, Canada and other countries do not', () => {
  for (const l of ['Bedford, MA', 'Remote in USA', 'United States', 'SF', 'NYC', 'LA', 'South SF', 'California', 'Vancouver, WA', 'New York, NY, USA']) assert.equal(usLocation(l), true, l);
  for (const l of ['Nuneaton, UK', 'London, UK', 'Toronto, ON, Canada', 'Remote in Canada', 'Remote in UK', 'Remote in Puerto Rico', 'Canada', '', null]) assert.equal(usLocation(l), false, String(l));
});

test('listings: open, visible, recent, wanted category and in the US only; tracking parameters leave the link', () => {
  assert.equal(cleanUrl('https://job-boards.greenhouse.io/a/jobs/1?utm_source=Simplify&ref=Simplify&gh_src=x'), 'https://job-boards.greenhouse.io/a/jobs/1?gh_src=x');
  const rows = pickListings([
    listing({ id: '1', url: 'https://a.example/1?utm_source=Simplify', locations: ['Nuneaton, UK', 'Austin, TX'] }),
    listing({ id: '2', url: 'https://a.example/2', locations: ['London, UK'] }),
    listing({ id: '3', url: 'https://a.example/3', active: false }),
    listing({ id: '4', url: 'https://a.example/4', is_visible: false }),
    listing({ id: '5', url: 'https://a.example/5', date_posted: at(24 * 4) }),
    listing({ id: '6', url: 'not a url' }),
    { ...listing({ id: '7', url: 'https://a.example/7' }), category: 'Hardware' },
    { ...listing({ id: '8', url: 'https://a.example/8' }), category: 'AI/ML/Data' },
  ], { now, days: 3 });
  assert.deepEqual(rows.map((r) => r.simplify_id), ['1', '8']);
  assert.equal(rows[0].job_url, 'https://a.example/1');
  assert.equal(rows[0].location, 'Austin, TX');
  assert.equal(rows[0].site, 'swelist');
  assert.equal(rows[0].level, 'New Grad');
  assert.equal(matchingSource(rows[0]), 'swelist');
});

test('posting text from Workday, SmartRecruiters and Workable public APIs', async () => {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    const body = url.includes('/wday/cxs/') ? { jobPostingInfo: { jobDescription: `<p>${TEXT}</p>` } }
      : url.includes('api.smartrecruiters.com') ? { jobAd: { sections: { a: { text: `<p>${TEXT}</p>` } } } }
      : url.includes('apply.workable.com/api') ? { description: `<p>${TEXT}</p>` } : null;
    return { status: body ? 200 : 404, json: async () => body };
  };
  assert.ok((await fetchPostingText('https://philips.wd3.myworkdayjobs.com/jobs-and-careers/job/Bedford-MA/Associate-Data_594180', { fetchImpl })).startsWith('Build data'));
  assert.equal(asked.at(-1), 'https://philips.wd3.myworkdayjobs.com/wday/cxs/philips/jobs-and-careers/job/Bedford-MA/Associate-Data_594180');
  await fetchPostingText('https://psu.wd1.myworkdayjobs.com/en-US/PSU_Staff/job/Reston-VA/Software-Engineer_REQ_1', { fetchImpl });
  assert.equal(asked.at(-1), 'https://psu.wd1.myworkdayjobs.com/wday/cxs/psu/PSU_Staff/job/Reston-VA/Software-Engineer_REQ_1');
  assert.ok((await fetchPostingText('https://jobs.smartrecruiters.com/BoschGroup/744000159172560-graduate', { fetchImpl })).length > 200);
  assert.equal(asked.at(-1), 'https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/744000159172560');
  assert.ok((await fetchPostingText('https://apply.workable.com/capula/j/ABC123/', { fetchImpl })).length > 200);
  assert.equal(await fetchPostingText('https://careers.example.com/job/1', { fetchImpl }), null);
});

test('feed: adds new US jobs with their text, leaves other scrapers\' rows alone, queues resumes once (text first), skips an unchanged list', async (t) => {
  const mongod = await MongoMemoryServer.create(); const client = new MongoClient(mongod.getUri()); await client.connect();
  t.after(async () => { await client.close(); await mongod.stop(); });
  const db = client.db('swelist_test');
  await db.collection('jobs').insertOne({ job_url: 'https://jobs.lever.co/acme/known', site: 'lever', session_id: 's', run_at: now });
  const list = [
    listing({ id: 'a', company: 'Philips', url: 'https://philips.wd3.myworkdayjobs.com/jobs/job/Bedford-MA/Data_1?utm_source=Simplify' }),
    listing({ id: 'b', url: 'https://jobs.lever.co/acme/known' }),
    listing({ id: 'c', url: 'https://careers.example.com/no-text' }),
    listing({ id: 'd', url: 'https://jobs.smartrecruiters.com/Bosch/2', locations: ['Nuneaton, UK'] }),
  ];
  let listCalls = 0;
  const fetchImpl = async (url, init = {}) => {
    if (url === LISTINGS_URL) { listCalls++; const same = init.headers?.['If-None-Match'] === '"v1"'; return { status: same ? 304 : 200, headers: new Map([['etag', '"v1"']]), json: async () => list }; }
    if (url.includes('/wday/cxs/')) return { status: 200, json: async () => ({ jobPostingInfo: { jobDescription: TEXT } }) };
    return { status: 404, json: async () => null };
  };
  const queued = [];
  const enqueue = async (_db, job) => { queued.push(job); await db.collection('jobs').updateOne({ job_url: job.job_url }, { $set: { resume: { status: 'queued', source: job.source } } }); return { skipped: false }; };
  const report = await swelistFeed(db, { now, fetchImpl, enqueue, log: () => {} });
  assert.equal(report.added, 0);
  assert.equal(await db.collection('jobs').countDocuments({ site: 'swelist' }), 0, 'report mode writes nothing');

  const first = await swelistFeed(db, { apply: true, now, fetchImpl, enqueue, log: () => {} });
  assert.deepEqual({ kept: first.kept, known: first.known, added: first.added, described: first.described, queued: first.queued }, { kept: 3, known: 1, added: 2, described: 1, queued: 2 });
  const philips = await db.collection('jobs').findOne({ company: 'Philips' });
  assert.equal(philips.site, 'swelist');
  assert.equal(philips.job_url, 'https://philips.wd3.myworkdayjobs.com/jobs/job/Bedford-MA/Data_1');
  assert.equal((await db.collection('descriptions').findOne({ job_url: philips.job_url })).description.trim(), TEXT.trim());
  assert.equal((await db.collection('jobs').findOne({ job_url: 'https://jobs.lever.co/acme/known' })).site, 'lever');
  assert.deepEqual(queued.map((j) => [j.job_url, j.source]), [[philips.job_url, 'swelist'], ['https://careers.example.com/no-text', 'swelist']]);

  const second = await swelistFeed(db, { apply: true, now, fetchImpl, enqueue, log: () => {} });
  assert.equal(second.unchanged, true);
  assert.equal(listCalls, 3);
  const forced = await swelistFeed(db, { apply: true, force: true, now, fetchImpl, enqueue, log: () => {} });
  assert.equal(forced.added, 0);
  assert.equal(queued.length, 2, 'a job already queued is not queued again');
});
