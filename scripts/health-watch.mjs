// Health watch: tells you (a push notification) when the pipeline stops, instead of you finding out days later.
//   node --env-file=.env scripts/health-watch.mjs --once            one check, then exit
//   node --env-file=.env scripts/health-watch.mjs --loop 900        check every 15 minutes (this is how it runs on Oracle)
//   add --dry to print what would be sent without sending
//
// It checks Mongo only: new jobs are still arriving per source, and the resume queue is moving. A check that fails sends one
// alert when it starts failing, one when it recovers, and a reminder every REMIND_HOURS while it stays down. Alerts go to ntfy
// (the free ntfy app on your phone, subscribed to your secret topic): set NTFY_TOPIC (and NTFY_SERVER if you self-host).
import { withMongo } from "./mongo-client.mjs";

export const DEFAULTS = {
  boards_hours: 6,      // newest job from any source other than staffing (LinkedIn, ATS boards...)
  staffing_hours: 36,   // newest staffing job
  queue_hours: 3,       // a queued resume this old counts as waiting too long
  stale_queue_min: 5,   // ...and this many of them is a stuck queue (one or two are usually skipped-company jobs, queued on purpose)
  fit_missing: 300,     // recent tailored jobs with no Fit saved
  remind_hours: 12,
};

const hoursSince = (d, now) => (d ? (now - new Date(d).getTime()) / 3_600_000 : Infinity);
const rounded = (h) => (h === Infinity ? "never" : h >= 48 ? `${Math.round(h / 24)} days` : `${Math.round(h)} hours`);

/** Turn the facts read from Mongo into named checks: { key, ok, message }. Pure, so it is tested without a database. */
export function evaluate(facts, cfg = DEFAULTS, now = Date.now()) {
  const boards = hoursSince(facts.newestBoards, now), staffing = hoursSince(facts.newestStaffing, now);
  return [
    { key: "scrape_boards", ok: boards <= cfg.boards_hours, message: `No new jobs from LinkedIn or the job boards for ${rounded(boards)} (last at ${facts.newestBoards ? new Date(facts.newestBoards).toISOString().slice(0, 16) + "Z" : "never"}).` },
    { key: "scrape_staffing", ok: staffing <= cfg.staffing_hours, message: `No new staffing jobs for ${rounded(staffing)}.` },
    { key: "resume_queue", ok: facts.staleQueued < cfg.stale_queue_min, message: `${facts.staleQueued} resumes have waited more than ${cfg.queue_hours} hours: the resume workers may be stuck.` },
    { key: "fit_saved", ok: facts.fitMissing <= cfg.fit_missing, message: `${facts.fitMissing} recent jobs have no Fit saved (the worker or backfill is not writing it).` },
  ];
}

/**
 * Compare with what was reported last time and decide what to send. state = { [key]: { ok, since, notifiedAt } }.
 * Returns { messages, state }. Pure.
 */
export function transitions(checks, state = {}, cfg = DEFAULTS, now = Date.now()) {
  const next = {}, messages = [];
  for (const c of checks) {
    const was = state[c.key];
    if (c.ok) {
      if (was && !was.ok) messages.push({ title: "Recovered", text: `${c.key.replace(/_/g, " ")} is back.`, tags: "white_check_mark" });
      next[c.key] = { ok: true, since: was?.ok ? was.since : now, notifiedAt: null };
    } else if (!was || was.ok) {
      messages.push({ title: "Atriveo needs attention", text: c.message, tags: "warning", priority: 4 });
      next[c.key] = { ok: false, since: now, notifiedAt: now };
    } else {
      const remind = now - (was.notifiedAt ?? was.since) >= cfg.remind_hours * 3_600_000;
      if (remind) messages.push({ title: "Still down", text: c.message, tags: "warning", priority: 3 });
      next[c.key] = { ok: false, since: was.since, notifiedAt: remind ? now : was.notifiedAt };
    }
  }
  return { messages, state: next };
}

export async function notify(message, { server = process.env.NTFY_SERVER || "https://ntfy.sh", topic = process.env.NTFY_TOPIC, fetchImpl = fetch, dry = false } = {}) {
  console.log(`[alert] ${message.title}: ${message.text}`);
  if (dry || !topic) { if (!topic && !dry) console.log("  (NTFY_TOPIC is not set: logged only)"); return false; }
  const res = await fetchImpl(`${server}/${topic}`, { method: "POST", headers: { Title: message.title, Tags: message.tags ?? "", Priority: String(message.priority ?? 3) }, body: message.text, signal: AbortSignal.timeout(15_000) });
  return res.ok;
}

export async function readFacts(db, now = Date.now()) {
  const jobs = db.collection("jobs");
  const [boards, staffing, staleQueued, fitMissing] = await Promise.all([
    jobs.find({ site: { $ne: "staffing" } }, { projection: { run_at: 1 } }).sort({ run_at: -1 }).limit(1).toArray(),
    jobs.find({ site: "staffing" }, { projection: { run_at: 1 } }).sort({ run_at: -1 }).limit(1).toArray(),
    jobs.countDocuments({ "resume.status": "queued", "resume.updated_at": { $lt: new Date(now - DEFAULTS.queue_hours * 3_600_000).toISOString() } }),
    jobs.countDocuments({ run_at: { $gte: new Date(now - 3 * 86_400_000) }, "resume.status": "success", fit: { $exists: false } }),
  ]);
  return { newestBoards: boards[0]?.run_at ?? null, newestStaffing: staffing[0]?.run_at ?? null, staleQueued, fitMissing };
}

export async function runOnce({ dry = false, cfg = DEFAULTS, now = Date.now(), send = notify } = {}) {
  return withMongo(async (db) => {
    const store = db.collection("health_state");
    const prev = (await store.findOne({ _id: "watch" }))?.checks ?? {};
    const checks = evaluate(await readFacts(db, now), cfg, now);
    const { messages, state } = transitions(checks, prev, cfg, now);
    for (const m of messages) await send(m, { dry });
    if (!dry) await store.updateOne({ _id: "watch" }, { $set: { checks: state, checkedAt: new Date(now), summary: checks.map(({ key, ok }) => ({ key, ok })) } }, { upsert: true });
    return { checks, messages };
  }, { appName: "AtriveoHealthWatch" });
}

async function main() {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const dry = process.argv.includes("--dry");
  const every = Number(arg("--loop")) || 0;
  do {
    try {
      const { checks } = await runOnce({ dry });
      console.log(`${new Date().toISOString()}  ` + checks.map((c) => `${c.key}:${c.ok ? "ok" : "FAIL"}`).join("  "));
    } catch (e) {
      // Mongo itself unreachable: say so (once per outage is not tracked here; the loop's next pass retries).
      console.error(`${new Date().toISOString()}  health check could not run: ${e.message}`);
      await notify({ title: "Atriveo health check cannot reach Mongo", text: String(e.message).slice(0, 200), tags: "rotating_light", priority: 4 }, { dry }).catch(() => {});
    }
    if (every) await new Promise((r) => setTimeout(r, every * 1000));
  } while (every);
  process.exit(0);
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
