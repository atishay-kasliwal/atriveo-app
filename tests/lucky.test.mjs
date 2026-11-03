import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { MongoClient } from 'mongodb';
import { planDay, luckyPlan, birthChart, dayStrength, sunTimes, wallClock, luckyIcs, windowStages, DEFAULT_LOCATION } from '../scripts/lucky.mjs';
import { handleLucky, tickLucky, stageMessage, validProfile } from '../scripts/lucky-routes.mjs';
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');

const ny = (ms) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const BIRTH = '1999-06-17T18:35:00Z'; // 18 June 1999, 12:05 AM in Ujjain (IST)

test('New York sunrise and sunset match published times within a few minutes', () => {
  const { rise, set } = sunTimes('2026-11-03', 40.7128, -74.006);
  assert.equal(ny(rise), '6:27 AM'); // NOAA: 6:28 AM
  assert.equal(ny(set), '4:51 PM');
  const june = sunTimes('2026-06-21', 40.7128, -74.006);
  assert.ok(Math.abs(Date.parse('2026-06-21T09:25:00Z') - june.rise) < 4 * 60_000, ny(june.rise)); // 5:25 AM EDT
});

test('Choghadiya, Hora and Rahu Kaal follow the weekday tables', () => {
  const tue = planDay('2026-11-03'), mon = planDay('2026-11-09'), sun = planDay('2026-11-08');
  assert.equal(tue.weekday, 'Tue');
  assert.deepEqual(tue.choghadiya.slice(0, 8).map((c) => c.name), ['Rog', 'Udveg', 'Chal', 'Labh', 'Amrit', 'Kaal', 'Shubh', 'Rog']);
  assert.deepEqual(mon.choghadiya.slice(0, 8).map((c) => c.name), ['Amrit', 'Kaal', 'Shubh', 'Rog', 'Udveg', 'Chal', 'Labh', 'Amrit']);
  assert.deepEqual(mon.choghadiya.slice(8).map((c) => c.name), ['Chal', 'Rog', 'Kaal', 'Labh', 'Udveg', 'Shubh', 'Amrit', 'Chal']);
  assert.equal(tue.hora[0].name, 'Mars'); assert.equal(sun.hora[0].name, 'Sun'); assert.equal(tue.hora[1].name, 'Sun');
  const eighth = (tue.sunset - tue.sunrise) / 8;
  assert.equal(Math.round((tue.rahu.start - tue.sunrise) / eighth), 6); // Tuesday: the 7th part
  assert.equal(Math.round((mon.rahu.start - mon.sunrise) / ((mon.sunset - mon.sunrise) / 8)), 1);
  assert.equal(planDay('2026-11-04').abhijit, null); // not on Wednesdays
});

test('the lucky window: good Choghadiya meets a good hora, outside Rahu Kaal and inside working hours, at most 50 minutes', () => {
  const tue = planDay('2026-11-03');
  assert.deepEqual([ny(tue.lucky.start), ny(tue.lucky.end), tue.lucky.choghadiya, tue.lucky.hora], ['11:40 AM', '12:30 PM', 'Amrit', 'Jupiter']);
  for (const key of ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-12-21', '2027-06-21']) {
    const d = planDay(key);
    if (!d.lucky) continue;
    assert.ok(d.lucky.end - d.lucky.start <= 50 * 60_000 && d.lucky.end - d.lucky.start >= 20 * 60_000, key);
    assert.ok(!(d.rahu.start < d.lucky.end && d.rahu.end > d.lucky.start), `${key} overlaps Rahu Kaal`);
    assert.ok(d.lucky.start >= wallClock(key, 9, 0, 'America/New_York') && d.lucky.end <= wallClock(key, 21, 0, 'America/New_York'), key);
  }
  const early = planDay('2026-11-03', { workStart: 13, workEnd: 15 });
  assert.ok(!early.lucky || early.lucky.start >= wallClock('2026-11-03', 13, 0, 'America/New_York'));
});

test('birth chart and the day for you: Tara Bala and Chandra Bala', () => {
  const chart = birthChart(BIRTH);
  assert.equal(chart.nakshatraName, 'Ashlesha'); assert.equal(chart.rashiName, 'Karka'); assert.equal(chart.pada, 3);
  const s = dayStrength(chart, Date.parse('2026-11-03T16:05:00Z'));
  assert.equal(s.moonNakshatra, 'Magha'); assert.equal(s.tara, 'Sampat'); assert.equal(s.taraTone, 'good'); assert.equal(s.verdict, 'good');
  assert.equal(dayStrength(null, Date.now()), null);
  assert.equal(birthChart('not a date'), null);
});

test('plan JSON, calendar feed and window stages', () => {
  const plan = luckyPlan({ now: Date.parse('2026-11-03T15:00:00Z'), days: 7, birthUtc: BIRTH });
  assert.equal(plan.today, '2026-11-03'); assert.equal(plan.days.length, 7); assert.equal(typeof plan.days[0].lucky.start, 'string');
  const ics = luckyIcs(plan, { now: Date.parse('2026-11-03T15:00:00Z') });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/); assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.match(ics, /UID:lucky-2026-11-03@atriveo\r\nDTSTAMP:20261103T150000Z\r\nDTSTART:20261103T164\d{3}Z/);
  assert.match(ics, /TRIGGER:-PT15M/); assert.equal((ics.match(/SUMMARY:Rahu Kaal/g) || []).length, 7);
  assert.ok(ics.split('\r\n').every((l) => l.length <= 75));
  const stages = windowStages(plan.days[0].lucky);
  assert.deepEqual(stages.map((s) => s.stage), ['soon', 'start', 'last15', 'end']);
  assert.equal(stages[1].at - stages[0].at, 15 * 60_000);
});

test('profile validation', () => {
  assert.deepEqual(validProfile({ birthUtc: BIRTH, birthPlace: 'Ujjain', location: { name: 'New York', lat: 40.7, lon: -74, tz: 'America/New_York' }, workStart: 9, workEnd: 21 }).location.tz, 'America/New_York');
  assert.throws(() => validProfile({ birthUtc: '3000-01-01' }), /past date/);
  assert.throws(() => validProfile({ location: { lat: 80, lon: 0, tz: 'UTC' } }), /66/);
  assert.throws(() => validProfile({ location: { lat: 40, lon: 0, tz: 'Mars/Base' } }), /time zone/);
  assert.throws(() => validProfile({ workStart: 18, workEnd: 9 }), /start before/);
});

test('reminder wording', () => {
  const day = planDay('2026-11-03', { chart: birthChart(BIRTH) }), iso = { ...day, lucky: { ...day.lucky, start: new Date(day.lucky.start).toISOString(), end: new Date(day.lucky.end).toISOString() } };
  assert.match(stageMessage('soon', iso, { tz: 'America/New_York' }).body, /^11:40 AM to 12:30 PM · Amrit Choghadiya with a Jupiter hora\. A good day for you\.$/);
  assert.equal(stageMessage('start', iso, { tz: 'America/New_York' }).url, '/job-matching');
  assert.match(stageMessage('end', iso, { tz: 'America/New_York', applied: 7, best: 5 }).body, /7 applied between 11:40 AM and 12:30 PM\. Your best lucky hour yet/);
  assert.doesNotMatch(stageMessage('end', iso, { tz: 'America/New_York', applied: 3, best: 5 }).body, /best/);
});

test('routes, reminders once each, and the private calendar link', async (t) => {
  const mongod = await MongoMemoryServer.create(); const client = new MongoClient(mongod.getUri()); await client.connect();
  t.after(async () => { await client.close(); await mongod.stop(); });
  const db = client.db('lucky_test'), withDb = (fn) => fn(db);
  const server = http.createServer(async (req, res) => { if (!(await handleLucky(req, res, new URL(req.url, 'http://x'), { withDb }))) { res.writeHead(418); res.end(); } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, body) => { const r = await fetch(base + p, body ? { method: 'POST', body: JSON.stringify(body) } : {}); return { status: r.status, type: r.headers.get('content-type'), body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }; };

  let r = await call('/lucky');
  assert.equal(r.status, 200); assert.equal(r.body.profile.hasBirth, false); assert.equal(r.body.chart, null); assert.equal(r.body.days.length, 14);
  assert.equal((await call('/lucky/profile', { birthUtc: 'nope' })).status, 400);
  assert.equal((await call('/lucky/profile', { birthUtc: BIRTH, birthPlace: 'Ujjain', birthLocal: '18 June 1999, 12:05 AM IST' })).status, 200);
  r = await call('/lucky');
  assert.equal(r.body.profile.hasBirth, true); assert.equal(r.body.chart.nakshatraName, 'Ashlesha'); assert.equal(r.body.profile.birthPlace, 'Ujjain');
  assert.equal('birthUtc' in r.body.profile, false, 'the exact birth time is not sent back');

  const a = await call('/lucky/calendar', {}), b = await call('/lucky/calendar', {});
  assert.match(a.body.token, /^[a-f0-9]{48}$/); assert.equal(a.body.token, b.body.token);
  const feed = await call(`/lucky/ics/${a.body.token}`);
  assert.equal(feed.status, 200); assert.match(feed.type, /text\/calendar/); assert.match(feed.body, /Atriveo lucky hours/);
  assert.equal((await call(`/lucky/ics/${'0'.repeat(48)}`)).status, 404);
  const c = await call('/lucky/calendar', { reset: true });
  assert.notEqual(c.body.token, a.body.token); assert.equal((await call(`/lucky/ics/${a.body.token}`)).status, 404);

  // Reminders: each stage once, inside its 10 minutes; the end counts what you applied in the window and keeps the result.
  const day = luckyPlan({ now: Date.parse('2026-11-03T15:00:00Z'), days: 1 }).days[0], s = Date.parse(day.lucky.start), e = Date.parse(day.lucky.end);
  await db.collection('job_swipes').insertMany([{ job_url: 'a', direction: 'applied', applied_at: new Date(s + 5 * 60_000).toISOString() }, { job_url: 'b', direction: 'applied', applied_at: new Date(s - 60 * 60_000).toISOString() }]);
  const sent = [];
  const fresh = client.db('lucky_unsaved'); await tickLucky(fresh, { now: new Date(s + 60_000), deliver: async (id) => sent.push({ id }) });
  assert.equal(sent.length, 0, 'no reminders before the Lucky details are saved');
  const deliver = async (id, n) => { if (!sent.some((x) => x.id === id)) sent.push({ id, ...n }); };
  for (const at of [s - 20 * 60_000, s - 14 * 60_000, s - 10 * 60_000, s + 60_000, e - 14 * 60_000, e + 2 * 60_000, e + 30 * 60_000]) await tickLucky(db, { now: new Date(at), deliver });
  assert.deepEqual(sent.map((x) => x.id), ['lucky:2026-11-03:soon', 'lucky:2026-11-03:start', 'lucky:2026-11-03:last15', 'lucky:2026-11-03:end']);
  assert.match(sent[3].body, /^1 applied between/);
  assert.equal((await db.collection('lucky_sessions').findOne({ _id: '2026-11-03' })).applied, 1);
});
