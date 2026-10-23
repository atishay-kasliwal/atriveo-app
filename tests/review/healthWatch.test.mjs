import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, transitions, notify, DEFAULTS } from "../../scripts/health-watch.mjs";

const NOW = Date.parse("2026-10-24T12:00:00Z");
const ago = (h) => new Date(NOW - h * 3_600_000).toISOString();
const facts = (o = {}) => ({ newestBoards: ago(1), newestLinkedin: ago(1), newestStaffing: ago(2), staleQueued: 0, fitMissing: 0, ...o });
const failing = (cs) => cs.filter((c) => !c.ok).map((c) => c.key);

test("healthy: recent jobs, an empty queue, Fit saved", () => assert.deepEqual(failing(evaluate(facts(), DEFAULTS, NOW)), []));

test("the Oct 16 outage would have been caught: no board jobs for 8 days", () => {
  const cs = evaluate(facts({ newestBoards: ago(8 * 24) }), DEFAULTS, NOW);
  assert.deepEqual(failing(cs), ["scrape_boards"]);
  assert.match(cs[0].message, /8 days/);
});

test("LinkedIn is watched on its own: boards can be fine while LinkedIn is blocked", () => {
  const cs = evaluate(facts({ newestLinkedin: ago(15) }), DEFAULTS, NOW);
  assert.deepEqual(failing(cs), ["scrape_linkedin"]);
  assert.match(cs.find((c) => c.key === "scrape_linkedin").message, /run the LinkedIn scrape from your Mac/);
  assert.deepEqual(failing(evaluate(facts({ newestLinkedin: ago(8) }), DEFAULTS, NOW)), [], "8h is inside the 12h limit");
  assert.deepEqual(failing(evaluate(facts({ newestBoards: ago(10) }), DEFAULTS, NOW)), ["scrape_boards"], "a stale board does not blame LinkedIn");
});

test("each check has its own limit", () => {
  assert.deepEqual(failing(evaluate(facts({ newestBoards: ago(5) }), DEFAULTS, NOW)), [], "5h is inside the 6h limit");
  assert.deepEqual(failing(evaluate(facts({ newestStaffing: ago(40) }), DEFAULTS, NOW)), ["scrape_staffing"]);
  assert.deepEqual(failing(evaluate(facts({ staleQueued: 12 }), DEFAULTS, NOW)), ["resume_queue"]);
  assert.deepEqual(failing(evaluate(facts({ staleQueued: 2 }), DEFAULTS, NOW)), [], "one or two old queued jobs are skipped companies, queued on purpose");
  assert.deepEqual(failing(evaluate(facts({ fitMissing: 500 }), DEFAULTS, NOW)), ["fit_saved"]);
  assert.deepEqual(failing(evaluate(facts({ newestBoards: null }), DEFAULTS, NOW)), ["scrape_boards"]);
});

test("one alert when it starts failing, a reminder only after 12 hours, one when it recovers", () => {
  const bad = evaluate(facts({ newestBoards: ago(10) }), DEFAULTS, NOW);
  let r = transitions(bad, {}, DEFAULTS, NOW);
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].title, "Atriveo needs attention");
  r = transitions(bad, r.state, DEFAULTS, NOW + 3_600_000);
  assert.equal(r.messages.length, 0, "no repeat an hour later");
  r = transitions(bad, r.state, DEFAULTS, NOW + 13 * 3_600_000);
  assert.deepEqual(r.messages.map((m) => m.title), ["Still down"]);
  const later = NOW + 14 * 3_600_000, fresh = new Date(later - 3_600_000).toISOString();
  const good = evaluate(facts({ newestBoards: fresh, newestLinkedin: fresh, newestStaffing: fresh }), DEFAULTS, later);
  r = transitions(good, r.state, DEFAULTS, NOW + 14 * 3_600_000);
  assert.deepEqual(r.messages.map((m) => m.title), ["Recovered"]);
  r = transitions(good, r.state, DEFAULTS, NOW + 15 * 3_600_000);
  assert.equal(r.messages.length, 0);
});

test("notify posts to the topic, and is a quiet no-op without one", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true }; };
  assert.equal(await notify({ title: "T", text: "body", tags: "warning", priority: 4 }, { topic: "secret-topic", server: "https://ntfy.example", fetchImpl }), true);
  assert.equal(calls[0].url, "https://ntfy.example/secret-topic");
  assert.equal(calls[0].init.body, "body");
  assert.equal(calls[0].init.headers.Title, "T");
  assert.equal(await notify({ title: "T", text: "x" }, { topic: undefined, fetchImpl }), false);
  assert.equal(calls.length, 1);
});
