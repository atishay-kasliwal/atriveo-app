import { widgetProgress, PROGRESS_TIME_ZONE } from "./widget-progress.mjs";

// Phone messages that keep you going: a morning plan, a push when you pass your daily goal (and double it, and reach four times it),
// and an evening wrap-up. They go out through ntfy (NTFY_TOPIC, the same topic the health alerts use). Counts only: no job, company,
// mail or any text of yours is ever put in a message. Each message goes out once per New York day, remembered in Mongo so a restart
// or a second instance never repeats one.

export const DEFAULT_GOAL = 15;
const SITE = "https://apply.atriveo.com";
const clock = new Intl.DateTimeFormat("en-CA", { timeZone: PROGRESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
export function nyParts(now = new Date()) {
  const p = Object.fromEntries(clock.formatToParts(now).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday: p.weekday };
}
const dayBefore = (day) => new Date(Date.parse(`${day}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);

/** 0 under the goal, 1 from the goal, 2 from double, 3 from four times (the ring: accent, green, red, gold). */
export function tierOf(applied, goal) {
  const m = Math.max(0, applied) / Math.max(1, goal);
  return m >= 4 ? 3 : m >= 2 ? 2 : m >= 1 ? 1 : 0;
}

/** Days in a row that met the goal. Today counts once it has met it; with includeToday false the run is counted through yesterday. */
export function streakOf(days, today, goal, applied, { includeToday = true } = {}) {
  const by = new Map((days ?? []).map((d) => [d.day, d.applied]));
  by.set(today, applied);
  let n = 0, cur = today;
  if (includeToday && (by.get(cur) ?? 0) >= goal) n += 1;
  cur = dayBefore(cur);
  while ((by.get(cur) ?? 0) >= goal) { n += 1; cur = dayBefore(cur); }
  return n;
}

const pick = (list, seed) => list[Math.abs(seed) % list.length];
const seedOf = (day) => Number(day.replaceAll("-", "")) || 0;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The text of one message. ctx: { day, applied, goal, streak, yesterday, replies, interviews, reviewCount }.
 * Warm and specific, never a number it does not have, and no dashes used as punctuation.
 */
export function buildMessage(kind, ctx) {
  const { day, applied, goal, streak = 0, yesterday = 0, replies = 0, interviews = 0, reviewCount = 0 } = ctx;
  const click = `${SITE}/job-matching`;
  const seed = seedOf(day);
  const mail = reviewCount > 0 ? ` ${plural(reviewCount, "mail")} to review.` : "";
  if (kind === "morning") {
    if (streak >= 2) return { title: `Day ${streak + 1} starts now`, message: `You have hit your goal ${streak} days in a row. Today's goal is ${goal}. Yesterday you applied to ${yesterday}.${mail}`, tags: ["sunrise"], priority: 3, click };
    if (streak === 1) return { title: "Yesterday you hit it", message: `Goal today is ${goal}. Make it two days in a row.${mail}`, tags: ["sunrise"], priority: 3, click };
    return { title: pick(["A fresh day", "New day, clean slate", "Good morning"], seed), message: `Today's goal is ${goal}. Yesterday you applied to ${yesterday}. One application at a time.${mail}`, tags: ["sunrise"], priority: 3, click };
  }
  if (kind === "m1") return { title: "Goal reached", message: `${applied} applied today. The ring turns green from here.`, tags: ["tada"], priority: 4, click };
  if (kind === "m2") return { title: "Double the goal", message: `${applied} applied, twice your goal of ${goal}. The ring is red now. That is a serious day.`, tags: ["fire"], priority: 4, click };
  if (kind === "m3") return { title: "Four times the goal", message: `${applied} applied. The ring is gold. Remember this day.`, tags: ["trophy"], priority: 4, click };
  if (kind === "evening") {
    const extra = [replies ? plural(replies, "reply", "replies") : "", interviews ? plural(interviews, "interview") : ""].filter(Boolean).join(" and ");
    const news = extra ? ` Today brought ${extra}.` : "";
    if (applied >= goal) return { title: `${applied} applied today`, message: `Goal of ${goal} reached${streak >= 2 ? `, ${streak} days in a row` : ""}.${news} Rest well, you earned it.`, tags: ["sparkles"], priority: 3, click };
    return { title: `${applied} of ${goal} today`, message: `${applied ? "A real push." : "A quiet day happens."}${news} Tomorrow starts fresh with a goal of ${goal}.`, tags: ["crescent_moon"], priority: 3, click };
  }
  throw new Error(`Unknown message kind ${kind}`);
}

/** Which messages are due now. `sent` holds the kinds already sent today. Milestones only go out between 7 a.m. and 11 p.m. */
export function dueKinds({ now = new Date(), applied, goal, sent = new Set() }) {
  const { hour, minute } = nyParts(now);
  const send = [], silent = [];
  if ((hour > 8 || (hour === 8 && minute >= 30)) && hour < 12 && !sent.has("morning")) send.push("morning");
  if (hour >= 7 && hour < 23 && goal > 0) {
    const tier = tierOf(applied, goal);
    if (tier >= 1 && !sent.has(`m${tier}`)) {
      send.push(`m${tier}`);
      for (let t = 1; t < tier; t += 1) if (!sent.has(`m${t}`)) silent.push(`m${t}`);
    }
  }
  if (hour >= 20 && hour < 23 && !sent.has("evening")) send.push("evening");
  return { send, silent };
}

export async function publishNtfy(n, { server = process.env.NTFY_SERVER || "https://ntfy.sh", topic = process.env.NTFY_TOPIC, fetchImpl = fetch } = {}) {
  if (!topic) return false;
  const res = await fetchImpl(server, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic, title: n.title, message: n.message, priority: n.priority ?? 3, tags: n.tags ?? [], ...(n.click ? { click: n.click } : {}) }), signal: AbortSignal.timeout(8000) });
  return res.ok;
}

export async function readGoal(db) {
  const doc = await db.collection("app_settings").findOne({ _id: "daily_goal" });
  return Number.isInteger(doc?.goal) && doc.goal >= 1 && doc.goal <= 200 ? doc.goal : DEFAULT_GOAL;
}
export async function saveGoal(db, goal) {
  if (!Number.isInteger(goal) || goal < 1 || goal > 200) throw new Error("Goal must be a whole number from 1 to 200");
  await db.collection("app_settings").updateOne({ _id: "daily_goal" }, { $set: { goal, updatedAt: new Date().toISOString() } }, { upsert: true });
  return goal;
}

/** One check: send what is due, once. Returns what was sent. */
export async function runPhoneTick({ db, now = new Date(), publish = publishNtfy, progress = (d, o) => widgetProgress(d, o), log = () => {} } = {}) {
  const [goal, p] = await Promise.all([readGoal(db), progress(db, { now })]);
  const { day } = nyParts(now);
  const notices = db.collection("phone_notices");
  const sent = new Set((await notices.find({ day }).toArray()).map((r) => r.kind));
  const { send, silent } = dueKinds({ now, applied: p.appliedToday, goal, sent });
  const claim = async (kind, extra = {}) => { try { await notices.insertOne({ _id: `${day}:${kind}`, day, kind, at: new Date(now).toISOString(), ...extra }); return true; } catch (e) { if (e?.code === 11000) return false; throw e; } };
  for (const kind of silent) await claim(kind, { silent: true });
  const out = [];
  const days = (p.days ?? []).map((d) => ({ day: d.day, applied: d.applied }));
  const yesterday = days.find((d) => d.day === dayBefore(day))?.applied ?? 0;
  const ctx = { day, applied: p.appliedToday, goal, yesterday, replies: p.responseEmailsToday ?? 0, interviews: p.interviewEmailsToday ?? 0, reviewCount: p.reviewCount ?? 0,
    streak: streakOf(days, day, goal, p.appliedToday, { includeToday: true }) };
  for (const kind of send) {
    if (!(await claim(kind))) continue;
    const message = buildMessage(kind, kind === "morning" ? { ...ctx, streak: streakOf(days, day, goal, 0, { includeToday: false }) } : ctx);
    let ok = false;
    try { ok = await publish(message); } catch (e) { log(`phone ${kind}: ${e.message}`); }
    if (ok) { out.push(kind); log(`phone message sent: ${kind}`); } else await notices.deleteOne({ _id: `${day}:${kind}` }); // try again next check
  }
  return out;
}

/** Checks once a minute inside the sidecar. Does nothing without NTFY_TOPIC, or with PHONE_SUMMARIES=off. */
export function startPhoneSummaries({ withMongo, log = console.log, everyMs = 60_000, publish = publishNtfy } = {}) {
  if (!process.env.NTFY_TOPIC || /^(off|0|false)$/i.test(process.env.PHONE_SUMMARIES || "")) { log("phone summaries: off (no NTFY_TOPIC, or PHONE_SUMMARIES=off)"); return null; }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await withMongo((db) => runPhoneTick({ db, publish, log }), { appName: "AtriveoPhoneSummaries" }); } catch (e) { log(`phone summaries: ${e.message}`); } finally { running = false; }
  };
  setTimeout(tick, 20_000).unref?.();
  const timer = setInterval(tick, everyMs);
  timer.unref?.();
  log("phone summaries: on (morning plan, goal milestones, evening wrap-up)");
  return timer;
}
