import { nyParts, publishNtfy } from "./phone-summary.mjs";
import { sendPushNotification } from "./web-push.mjs";
import { companyOf, jobsForCompanies, sameCompany } from "./network-jobs.mjs";
import { NetworkError, withFollowUps } from "./network.mjs";

// What needs you in your network, newest worries first: someone replied and waits for an answer, a follow-up is due, someone has gone
// quiet, people in a source have never heard from you. Each reminder has a stable key so it can be snoozed. A morning phone message
// goes out once per New York day: through Web Push to your own phone (names, tap to open) or, without it, ntfy (counts only).

const QUIET_DAYS = 14, NEVER_AFTER_DAYS = 2, REPLY_AFTER_DAYS = 1;
const DAY = 86_400_000;
const dayNum = (iso) => Date.parse(`${String(iso).slice(0, 10)}T12:00:00Z`) / DAY;
const weeks = (d) => (d < 14 ? `${d} days` : d < 60 ? `${Math.round(d / 7)} weeks` : `${Math.round(d / 30)} months`);
const CONTACT = new Set(["email", "message", "call", "met"]);

/** The reminders for a network as it is now. `today` is a New York day (YYYY-MM-DD); snoozed keys are left out. */
export function reminders({ people: all, sources, work = [] }, { today, snoozed = new Set() }) {
  // Everyone but family has a weekly follow-up unless switched off (see autoFollowUp).
  const people = withFollowUps(all, sources);
  const out = [], t = dayNum(today);
  for (const p of people) {
    if (p.archived) continue;
    const hist = p.history ?? [], last = hist[hist.length - 1];
    const lastMine = hist.filter((h) => CONTACT.has(h.type)).pop();
    if (last?.type === "reply" && (!lastMine || lastMine.at < last.at) && t - dayNum(last.at) >= REPLY_AFTER_DAYS) {
      const d = Math.round(t - dayNum(last.at));
      out.push({ key: `reply:${p.id}:${last.id}`, kind: "reply", personId: p.id, title: `${p.name} replied ${d === 1 ? "yesterday" : `${weeks(d)} ago`}`, detail: "Answer them while it is fresh", rank: 0 - d / 1000 });
      continue;
    }
    if (p.followUpPlan?.enabled === false) continue;
    if (p.nextFollowUp && dayNum(p.nextFollowUp) <= t) {
      const late = Math.round(t - dayNum(p.nextFollowUp));
      out.push({ key: `due:${p.id}:${p.nextFollowUp}`, kind: "due", personId: p.id, title: `Follow up with ${p.name}`, detail: late ? `${late} day${late === 1 ? "" : "s"} late` : "Due today", rank: 1 - late / 1000 });
      continue;
    }
    if (p.lastContact && !(p.nextFollowUp && dayNum(p.nextFollowUp) > t)) {
      const d = Math.round(t - dayNum(p.lastContact));
      if (d >= QUIET_DAYS) out.push({ key: `quiet:${p.id}:${p.lastContact.slice(0, 10)}`, kind: "quiet", personId: p.id, title: `It has been ${weeks(d)} since you reached out to ${p.name}`, detail: "Say hello, or set a follow-up", rank: 2 - d / 1000 });
    }
  }
  for (const s of sources) {
    if (t - dayNum(s.createdAt) < NEVER_AFTER_DAYS) continue;
    const never = people.filter((p) => !p.archived && p.sourceId === s.id && !p.via && !p.lastContact && p.followUpPlan?.enabled !== false && !p.nextFollowUp).length;
    if (never) out.push({ key: `never:${s.id}:${never}`, kind: "never", sourceId: s.id, title: `${never} ${never === 1 ? "person" : "people"} at ${s.name} ${never === 1 ? "has" : "have"} never heard from you`, detail: "Write one note and reuse it", rank: 3 - never / 1000 });
  }
  for (const w of work) {
    if (w.done || !w.end) continue;
    const left = Math.round(dayNum(w.end) - t);
    if (left <= 7) out.push({ key: `work:${w.id}:${w.end}`, kind: "work", workId: w.id, title: left < 0 ? `${w.title} is ${-left} day${left === -1 ? "" : "s"} past its end` : left === 0 ? `${w.title} ends today` : `${w.title} ends in ${left} day${left === 1 ? "" : "s"}`, detail: w.next ? `Next: ${w.next}` : "Set the next step, or mark it done", rank: 1.5 + left / 1000 });
  }
  return out.filter((r) => !snoozed.has(r.key)).sort((a, b) => a.rank - b.rank).map(({ rank, ...r }) => r);
}

async function snoozedKeys(db, now) {
  const rows = await db.collection("network_snoozes").find({}).toArray();
  return new Set(rows.filter((r) => r.until > now.toISOString()).map((r) => r._id));
}

export async function listReminders(db, { now = new Date() } = {}) {
  const [people, sources, board, snoozed] = await Promise.all([db.collection("network_people").find({}).toArray(), db.collection("network_sources").find({}).toArray(), db.collection("network_board").find({}).toArray(), snoozedKeys(db, now)]);
  const id = ({ _id, ...d }) => ({ id: _id, ...d });
  return { reminders: reminders({ people: people.map(id), sources: sources.map(id), work: board.filter((b) => b.kind === "work").map(id) }, { today: nyParts(now).day, snoozed }) };
}

/** Hide one reminder for a few days (1 to 60). */
export async function snoozeReminder(db, { key, days = 7 } = {}, now = new Date()) {
  const k = String(key ?? "");
  if (!/^(reply|due|quiet|never|work):[\w-]+:[\w.-]+$/.test(k)) throw new NetworkError("That reminder is not known");
  const n = Number(days);
  if (!Number.isInteger(n) || n < 1 || n > 60) throw new NetworkError("Snooze for 1 to 60 days");
  const until = new Date(now.getTime() + n * DAY).toISOString();
  await db.collection("network_snoozes").updateOne({ _id: k }, { $set: { until } }, { upsert: true });
  return { key: k, until };
}

/** The phone message: counts only. Null when nothing needs you. */
export function phoneMessage(list) {
  const n = (k) => list.filter((r) => r.kind === k).length;
  const parts = [[n("reply"), "waiting for your answer", "waiting for your answer"], [n("due"), "follow-up due", "follow-ups due"], [n("work"), "piece of work ending", "pieces of work ending"], [n("quiet"), "person gone quiet", "people gone quiet"]]
    .filter(([c]) => c > 0).map(([c, one, many]) => `${c} ${c === 1 ? one : many}`);
  if (!parts.length) return null;
  return { title: "Network", message: `${parts.join(", ")}. A two-line note keeps the door open.`, tags: ["handshake"], priority: 3, click: "https://apply.atriveo.com/network" };
}

/** The week in your network, counts only: emails you sent, replies logged, people added, and what is waiting. Null on an empty week. */
export async function weeklyDigest(db, now = new Date()) {
  const since = new Date(now.getTime() - 7 * DAY).toISOString();
  const [people, mail, { reminders: waiting }] = await Promise.all([db.collection("network_people").find({}).toArray(), db.collection("network_mail_log").find({}).toArray(), listReminders(db, { now })]);
  const sent = mail.filter((m) => m.at >= since && m.state !== "failed").length;
  const replies = people.reduce((n, p) => n + (p.history ?? []).filter((h) => h.type === "reply" && h.at >= since).length, 0);
  const added = people.filter((p) => !p.archived && p.createdAt >= since).length;
  const open = waiting.filter((r) => r.kind !== "never").length;
  if (!sent && !replies && !added && !open) return null;
  const n = (c, one, many) => `${c} ${c === 1 ? one : many}`;
  const week = [sent && n(sent, "email", "emails"), replies && n(replies, "reply", "replies"), added && n(added, "new person", "new people")].filter(Boolean).join(", ");
  return { title: "Your week in Network", message: `${week ? `${week}. ` : "A quiet week. "}${open ? `${n(open, "thing waits", "things wait")} for you.` : "Nothing is waiting."}`, tags: ["calendar"], priority: 2, click: "https://apply.atriveo.com/network" };
}

/** The same reminders for Web Push, which goes only to your own devices, encrypted: names are fine there, and a tap opens the right place. */
export function webMessage(list) {
  const open = list.filter((r) => r.kind !== "never");
  if (!open.length) return null;
  const link = (r) => (r.personId ? `/network?person=${encodeURIComponent(r.personId)}` : r.workId ? `/network?work=${encodeURIComponent(r.workId)}` : "/network");
  if (open.length === 1) return { title: open[0].title, body: open[0].detail, url: link(open[0]), type: "network" };
  const shown = open.slice(0, 3).map((r) => r.title).join(" · ");
  return { title: `${open.length} things need you in Network`, body: open.length > 3 ? `${shown} · and ${open.length - 3} more` : shown, url: "/network?view=due", type: "network" };
}

/**
 * Where Network's phone messages go. Web Push (the Atriveo app on your phone) when it is configured; otherwise ntfy. NETWORK_PUSH=both
 * sends to both, NETWORK_PUSH=ntfy keeps ntfy only.
 */
export function channels(env = process.env) {
  const web = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT && env.PUSH_EVENT_USER_ID?.trim());
  const ntfy = Boolean(env.NTFY_TOPIC), mode = String(env.NETWORK_PUSH || "").toLowerCase();
  return { web: web && mode !== "ntfy", ntfy: ntfy && (mode === "ntfy" || mode === "both" || !web) };
}

// Each message is claimed once (phone_notices) before it is sent; if no channel took it, the claim is dropped and the next check retries.
async function sendOnce(db, id, now, build, out, log, label) {
  const notices = db.collection("phone_notices");
  if (await notices.findOne({ _id: id })) return null;
  const msg = await build();
  try { await notices.insertOne({ _id: id, day: id.split(":")[0], kind: label, at: now.toISOString(), ...(msg ? {} : { silent: true }) }); } catch (e) { if (e?.code === 11000) return null; throw e; }
  if (!msg) return null;
  let ok = true;
  if (out.ch.ntfy && msg.ntfy) { let sent = false; try { sent = await out.publish(msg.ntfy); } catch (e) { log(`${label} (ntfy): ${e.message}`); } ok &&= sent; }
  if (out.ch.web && msg.web) { let r = { sent: 0, failed: 1 }; try { r = await out.webPush(db, msg.web); } catch (e) { log(`${label} (web push): ${e.message}`); } ok &&= r.sent > 0 || r.failed === 0; }
  if (!ok) { await notices.deleteOne({ _id: id }); return null; }
  log(`phone message sent: ${label}${out.ch.web ? " (web push)" : ""}${out.ch.ntfy ? " (ntfy)" : ""}`);
  return msg;
}

/** From 9 a.m. New York time, once per day: what needs you. On Sunday from 6 p.m., the week's digest too. */
export async function runNetworkTick({ db, now = new Date(), publish = publishNtfy, webPush, env = process.env, log = () => {} } = {}) {
  const ch = channels(env);
  if (!ch.web && !ch.ntfy) return null;
  const userId = env.PUSH_EVENT_USER_ID?.trim().toLowerCase();
  const out = { ch, publish, webPush: webPush ?? ((d, m) => sendPushNotification(d, userId, m, { env })) };
  const { day, hour, weekday } = nyParts(now);
  if (weekday === "Sun" && hour >= 18) await sendOnce(db, `${day}:network-week`, now, async () => {
    const w = await weeklyDigest(db, now);
    return w && { ntfy: w, web: { title: w.title, body: w.message, url: "/network", type: "network_week" } };
  }, out, log, "network-week");
  if (hour < 9) return null;
  return sendOnce(db, `${day}:network`, now, async () => {
    const list = (await listReminders(db, { now })).reminders, ntfy = phoneMessage(list), web = webMessage(list);
    return ntfy || web ? { ntfy, web } : null;
  }, out, log, "network");
}

/**
 * New jobs at the companies of people you asked to watch ("Tell me about new jobs at …"). Checked every few minutes; the job board
 * scrapes hourly, so an alert comes within the hour. Each job alerts once (network_job_alerts); jobs you applied to or passed are skipped.
 * Web Push names the person and the job and opens them; ntfy says how many, nothing more.
 */
export async function runJobAlerts({ db, now = new Date(), publish = publishNtfy, webPush, env = process.env, log = () => {} } = {}) {
  const ch = channels(env);
  if (!ch.web && !ch.ntfy) return null;
  const settings = db.collection("app_settings"), state = await settings.findOne({ _id: "network_job_watch" });
  // The first check only starts the clock, so turning this on never sends a flood of old postings.
  if (!state) { await settings.updateOne({ _id: "network_job_watch" }, { $set: { since: now.toISOString() } }, { upsert: true }); return null; }
  const [people, sources] = await Promise.all([db.collection("network_people").find({}).toArray(), db.collection("network_sources").find({}).toArray()]);
  const byId = new Map(sources.map((s) => [s._id, s]));
  const watched = people.filter((p) => p.watchJobs && !p.archived).map((p) => ({ id: p._id, name: p.name, company: companyOf(p, byId) })).filter((p) => p.company);
  if (!watched.length) { await settings.updateOne({ _id: "network_job_watch" }, { $set: { since: now.toISOString() } }); return null; }
  // A scrape stamps jobs with the time it started, which can be before the last check: look back two hours and let the alert log dedupe.
  const after = new Date(Math.max(Date.parse(state.since), now.getTime() - 2 * DAY)) - 2 * 3_600_000;
  const jobs = (await jobsForCompanies(db, watched.map((p) => p.company), { now, days: 3 })).filter((j) => (j.status === "new" || j.status === "ready") && j.foundAt && Date.parse(j.foundAt) > after);
  const alerts = db.collection("network_job_alerts"), fresh = [];
  for (const j of jobs) { try { await alerts.insertOne({ _id: j.url, company: j.company, at: now.toISOString() }); fresh.push(j); } catch (e) { if (e?.code !== 11000) throw e; } }
  if (!fresh.length) { await settings.updateOne({ _id: "network_job_watch" }, { $set: { since: now.toISOString() } }); return null; }
  const groups = [];
  for (const j of fresh) { const p = watched.find((w) => sameCompany(w.company, j.company)); const g = groups.find((x) => x.person.id === p.id); if (g) g.jobs.push(j); else groups.push({ person: p, jobs: [j] }); }
  const n = fresh.length, first = groups[0], job = first.jobs[0];
  const web = groups.length === 1
    ? { title: `${first.person.company} posted ${first.jobs.length === 1 ? job.title : `${first.jobs.length} new jobs`}`, body: `${first.person.name} works there.${first.jobs.length === 1 ? (job.location ? ` ${job.location}.` : "") : ` ${first.jobs.slice(0, 3).map((x) => x.title).join(" · ")}.`} Ask for a referral?`, url: `/network?person=${encodeURIComponent(first.person.id)}&jobs=1`, type: "network_job" }
    : { title: `${n} new jobs where you know someone`, body: groups.slice(0, 3).map((g) => `${g.person.company}: ${g.jobs[0].title}${g.jobs.length > 1 ? ` +${g.jobs.length - 1}` : ""}`).join(" · "), url: "/network?view=jobs", type: "network_job" };
  const ntfy = { title: "Network", message: `${n} new ${n === 1 ? "job" : "jobs"} at ${groups.length === 1 ? "a company" : `${groups.length} companies`} where you know someone.`, tags: ["briefcase"], priority: 3, click: "https://apply.atriveo.com/network?view=jobs" };
  const userId = env.PUSH_EVENT_USER_ID?.trim().toLowerCase();
  let ok = true;
  if (ch.ntfy) { let sent = false; try { sent = await publish(ntfy); } catch (e) { log(`job alert (ntfy): ${e.message}`); } ok &&= sent; }
  if (ch.web) { let r = { sent: 0, failed: 1 }; try { r = await (webPush ?? ((d, m) => sendPushNotification(d, userId, m, { env })))(db, web); } catch (e) { log(`job alert (web push): ${e.message}`); } ok &&= r.sent > 0 || r.failed === 0; }
  // Nothing got through: forget these alerts so the next check tries again.
  if (!ok) { for (const j of fresh) await alerts.deleteOne({ _id: j.url }); return null; }
  await settings.updateOne({ _id: "network_job_watch" }, { $set: { since: now.toISOString() } });
  log(`job alert sent: ${n} new`);
  return { web, ntfy, jobs: fresh };
}

/** Checks every few minutes inside the sidecar; off when neither Web Push nor ntfy is set up, or with PHONE_SUMMARIES=off / NETWORK_REMINDERS=off. */
export function startNetworkReminders({ withMongo, log = console.log, everyMs = 10 * 60_000, publish = publishNtfy } = {}) {
  const off = (v) => /^(off|0|false)$/i.test(v || "");
  const ch = channels();
  if ((!ch.web && !ch.ntfy) || off(process.env.PHONE_SUMMARIES) || off(process.env.NETWORK_REMINDERS)) { log("network reminders on the phone: off"); return null; }
  let running = false;
  const tick = async () => { if (running) return; running = true; try { await withMongo(async (db) => { await runNetworkTick({ db, publish, log }); await runJobAlerts({ db, publish, log }); }, { appName: "AtriveoNetworkReminders" }); } catch (e) { log(`network reminders: ${e.message}`); } finally { running = false; } };
  setTimeout(tick, 30_000).unref?.();
  const timer = setInterval(tick, everyMs); timer.unref?.();
  log(`network reminders on the phone: on through ${[ch.web && "Web Push (names, tap to open)", ch.ntfy && "ntfy (counts only)"].filter(Boolean).join(" and ")}; 9 a.m. New York daily, Sunday 6 p.m. weekly, new jobs at watched people's companies within the hour`);
  return timer;
}
