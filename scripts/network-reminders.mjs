import { nyParts, publishNtfy } from "./phone-summary.mjs";
import { NetworkError } from "./network.mjs";

// What needs you in your network, newest worries first: someone replied and waits for an answer, a follow-up is due, someone has gone
// quiet, people in a source have never heard from you. Each reminder has a stable key so it can be snoozed. A short morning phone
// message gives the counts only (never a name), once per New York day, like the other phone messages.

const QUIET_DAYS = 14, NEVER_AFTER_DAYS = 2, REPLY_AFTER_DAYS = 1;
const DAY = 86_400_000;
const dayNum = (iso) => Date.parse(`${String(iso).slice(0, 10)}T12:00:00Z`) / DAY;
const weeks = (d) => (d < 14 ? `${d} days` : d < 60 ? `${Math.round(d / 7)} weeks` : `${Math.round(d / 30)} months`);
const CONTACT = new Set(["email", "message", "call", "met"]);

/** The reminders for a network as it is now. `today` is a New York day (YYYY-MM-DD); snoozed keys are left out. */
export function reminders({ people, sources, work = [] }, { today, snoozed = new Set() }) {
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
    const never = people.filter((p) => !p.archived && p.sourceId === s.id && !p.via && !p.lastContact).length;
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

async function sendOnce(db, id, now, build, publish, log, label) {
  const notices = db.collection("phone_notices");
  if (await notices.findOne({ _id: id })) return null;
  const msg = await build();
  try { await notices.insertOne({ _id: id, day: id.split(":")[0], kind: label, at: now.toISOString(), ...(msg ? {} : { silent: true }) }); } catch (e) { if (e?.code === 11000) return null; throw e; }
  if (!msg) return null;
  let ok = false;
  try { ok = await publish(msg); } catch (e) { log(`${label}: ${e.message}`); }
  if (!ok) { await notices.deleteOne({ _id: id }); return null; }
  log(`phone message sent: ${label}`);
  return msg;
}

/** From 9 a.m. New York time, once per day: send the counts if anything needs you. On Sunday from 6 p.m., the week's digest too. */
export async function runNetworkTick({ db, now = new Date(), publish = publishNtfy, log = () => {} } = {}) {
  const { day, hour, weekday } = nyParts(now);
  if (weekday === "Sun" && hour >= 18) await sendOnce(db, `${day}:network-week`, now, () => weeklyDigest(db, now), publish, log, "network-week");
  if (hour < 9) return null;
  return sendOnce(db, `${day}:network`, now, async () => phoneMessage((await listReminders(db, { now })).reminders), publish, log, "network");
}

/** Checks every few minutes inside the sidecar; off without NTFY_TOPIC, or with PHONE_SUMMARIES=off or NETWORK_REMINDERS=off. */
export function startNetworkReminders({ withMongo, log = console.log, everyMs = 5 * 60_000, publish = publishNtfy } = {}) {
  const off = (v) => /^(off|0|false)$/i.test(v || "");
  if (!process.env.NTFY_TOPIC || off(process.env.PHONE_SUMMARIES) || off(process.env.NETWORK_REMINDERS)) { log("network reminders on the phone: off"); return null; }
  let running = false;
  const tick = async () => { if (running) return; running = true; try { await withMongo((db) => runNetworkTick({ db, publish, log }), { appName: "AtriveoNetworkReminders" }); } catch (e) { log(`network reminders: ${e.message}`); } finally { running = false; } };
  setTimeout(tick, 30_000).unref?.();
  const timer = setInterval(tick, everyMs); timer.unref?.();
  log("network reminders on the phone: on (9 a.m. New York daily, Sunday 6 p.m. weekly digest; counts only)");
  return timer;
}
