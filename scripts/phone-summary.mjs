import { widgetProgress, PROGRESS_TIME_ZONE } from "./widget-progress.mjs";
import { assessmentLines, listAssessments } from "./assessments.mjs";

// Phone messages that keep you going: a morning plan, a push when you pass your daily goal (and double it, and reach four times it),
// an evening wrap-up, and assessment deadlines (a 9 a.m. list of what is due, a 3 p.m. reminder for anything due today). They go out through ntfy (NTFY_TOPIC, the same topic the health alerts use). Counts only: no job, company,
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
  goal = Math.max(1, goal); // a goal of 0 would count every empty day for ever
  const by = new Map((days ?? []).map((d) => [d.day, d.applied]));
  by.set(today, applied);
  let n = 0, cur = today;
  if (includeToday && (by.get(cur) ?? 0) >= goal) n += 1;
  cur = dayBefore(cur);
  while (n < 4000 && (by.get(cur) ?? 0) >= goal) { n += 1; cur = dayBefore(cur); }
  return n;
}

// The day's milestones, lowest first: the first application, halfway, the goal, twice it, four times it. Beside them: a new personal
// best (more than any day before, once the goal is met) and a streak worth marking (3, 7, 14, 30, 60, 100 days in a row).
const STREAK_MARKS = new Set([3, 7, 14, 30, 60, 100]);
export function reached({ applied, goal, best = 0, streak = 0 }) {
  const tiers = [];
  if (applied >= 1) tiers.push("first");
  if (goal >= 4 && applied >= Math.ceil(goal / 2)) tiers.push("half");
  for (let t = 1; t <= tierOf(applied, goal); t += 1) tiers.push(`m${t}`);
  const extra = [];
  if (best > 0 && applied > best && applied >= goal) extra.push("best");
  if (applied >= goal && STREAK_MARKS.has(streak)) extra.push("streak");
  return { tiers, extra };
}

const pick = (list, seed) => list[Math.abs(seed) % list.length];
const seedOf = (day) => Number(day.replaceAll("-", "")) || 0;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The text of one message. ctx: { day, applied, goal, streak, yesterday, replies, interviews, reviewCount }.
 * Warm and specific, never a number it does not have, and no dashes used as punctuation.
 */
export function buildMessage(kind, ctx) {
  const { day, applied, goal, streak = 0, best = 0, yesterday = 0, replies = 0, interviews = 0, reviewCount = 0 } = ctx;
  const click = `${SITE}/job-matching`;
  const seed = seedOf(day);
  const mail = reviewCount > 0 ? ` ${plural(reviewCount, "mail")} to review.` : "";
  if (kind === "morning") {
    if (streak >= 2) return { title: `Day ${streak + 1} starts now`, message: `You have hit your goal ${streak} days in a row. Today's goal is ${goal}. Yesterday you applied to ${yesterday}.${mail}`, tags: ["sunrise"], priority: 3, click };
    if (streak === 1) return { title: "Yesterday you hit it", message: `Goal today is ${goal}. Make it two days in a row.${mail}`, tags: ["sunrise"], priority: 3, click };
    return { title: pick(["A fresh day", "New day, clean slate", "Good morning"], seed), message: `Today's goal is ${goal}. Yesterday you applied to ${yesterday}. One application at a time.${mail}`, tags: ["sunrise"], priority: 3, click };
  }
  if (kind === "first") return applied <= 1
    ? { title: "First one in", message: `1 of ${goal} today. The hardest one is done.`, tags: ["seedling"], priority: 3, click }
    : { title: "The day has started", message: `${applied} of ${goal} today. A good start.`, tags: ["seedling"], priority: 3, click };
  if (kind === "half") return { title: "Halfway there", message: `${applied} of ${goal} today. ${goal - applied} to go.`, tags: ["running"], priority: 3, click };
  if (kind === "best") return { title: "New personal best", message: `${applied} applied today, more than any day before. The last best was ${best}.`, tags: ["medal"], priority: 4, click };
  if (kind === "streak") return { title: `${streak} days in a row`, message: `You hit your goal ${streak} days running. Keep the chain going tomorrow.`, tags: ["link"], priority: 4, click };
  if (kind === "m1") return { title: "Goal reached", message: `${applied} applied today. The ring turns green from here.`, tags: ["tada"], priority: 4, click };
  if (kind === "m2") return { title: "Double the goal", message: `${applied} applied, twice your goal of ${goal}. The ring is red now. That is a serious day.`, tags: ["fire"], priority: 4, click };
  if (kind === "m3") return { title: "Four times the goal", message: `${applied} applied. The ring is gold. Remember this day.`, tags: ["trophy"], priority: 4, click };
  if (kind === "evening") {
    const extra = [replies ? plural(replies, "reply", "replies") : "", interviews ? plural(interviews, "interview") : ""].filter(Boolean).join(" and ");
    const news = extra ? ` Today brought ${extra}.` : "";
    if (applied >= goal) return { title: `${applied} applied today`, message: `Goal of ${goal} reached${streak >= 2 ? `, ${streak} days in a row` : ""}.${news} Rest well, you earned it.`, tags: ["sparkles"], priority: 3, click };
    return { title: `${applied} of ${goal} today`, message: `${applied ? "A real push." : "A quiet day happens."}${news} Tomorrow starts fresh with a goal of ${goal}.`, tags: ["crescent_moon"], priority: 3, click };
  }
  if (kind === "assess_am" || kind === "assess_pm") {
    const { known = [], unknown = [], lines = [] } = ctx.assessments ?? {};
    const aclick = `${SITE}/assessments`;
    if (kind === "assess_pm") {
      const names = known.filter((r) => r.state === "today").map((r) => r.company || "An assessment");
      return { title: "Due today", message: `${names.slice(0, 3).join(" and ")} ${names.length === 1 ? "is" : "are"} due today. Finish ${names.length === 1 ? "it" : "them"} and take the win.`, tags: ["alarm_clock"], priority: 4, click: aclick };
    }
    const shown = lines.slice(0, 3).map((l) => `${l}.`).join(" ");
    const more = lines.length > 3 ? ` And ${lines.length - 3} more.` : "";
    const note = unknown.length ? ` ${plural(unknown.length, "assessment")} ${unknown.length === 1 ? "has" : "have"} no deadline yet. Add ${unknown.length === 1 ? "it" : "them"} in Atriveo.` : "";
    const urgent = known.some((r) => r.state === "today" || r.state === "overdue");
    return { title: `${plural(known.length + unknown.length, "assessment")} to finish`, message: `${shown}${more}${note} You have got this.`.trim(), tags: ["memo"], priority: urgent ? 4 : 3, click: aclick };
  }
  throw new Error(`Unknown message kind ${kind}`);
}

/** Which messages are due now. `sent` holds the kinds already sent today. Milestones only go out between 7 a.m. and 11 p.m. */
export function dueKinds({ now = new Date(), applied, goal, best = 0, streak = 0, sent = new Set(), assessments = [] }) {
  const { hour, minute, weekday } = nyParts(now);
  const send = [], silent = [];
  if ((hour > 8 || (hour === 8 && minute >= 30)) && hour < 12 && !sent.has("morning")) send.push("morning");
  if (hour >= 7 && hour < 23 && goal > 0) {
    // Only the highest new milestone goes out; ones passed on the way are recorded without a message, so a burst is one push.
    // The first application and halfway are morning and afternoon news; from 7 p.m. the evening wrap-up says it better.
    const { tiers: all, extra } = reached({ applied, goal, best, streak });
    const tiers = hour < 19 ? all : all.filter((k) => k.startsWith("m"));
    const top = tiers[tiers.length - 1];
    if (top && !sent.has(top)) {
      send.push(top);
      for (const k of tiers.slice(0, -1)) if (!sent.has(k)) silent.push(k);
    }
    for (const k of extra) if (!sent.has(k)) send.push(k);
  }
  if (hour >= 20 && hour < 23 && !sent.has("evening")) send.push("evening");
  // Assessments: a list at 9 a.m. when something is due soon or overdue (a list of only undated ones only on Mon, Wed and Fri, so it never nags),
  // and a reminder from 3 p.m. for anything due today.
  const { known, unknown } = assessmentLines(assessments, new Date(now).getTime());
  if (hour >= 9 && hour < 12 && !sent.has("assess_am") && (known.length || (unknown.length && ["Mon", "Wed", "Fri"].includes(weekday)))) send.push("assess_am");
  if (hour >= 15 && hour < 19 && !sent.has("assess_pm") && known.some((r) => r.state === "today")) send.push("assess_pm");
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
export async function runPhoneTick({ db, now = new Date(), publish = publishNtfy, progress = (d, o) => widgetProgress(d, o), assessments = (d, o) => listAssessments(d, o), log = () => {} } = {}) {
  const [goal, p, rows] = await Promise.all([readGoal(db), progress(db, { now, fullHistory: true }), (async () => assessments(db, { now: new Date(now).getTime() }))().catch(() => [])]);
  const { day } = nyParts(now);
  const notices = db.collection("phone_notices");
  const sent = new Set((await notices.find({ day }).toArray()).map((r) => r.kind));
  const history = (p.days ?? []).map((d) => ({ day: d.day, applied: d.applied }));
  const best = Math.max(0, ...history.filter((d) => d.day !== day).map((d) => d.applied));
  const { send, silent } = dueKinds({ now, applied: p.appliedToday, goal, best, streak: streakOf(history, day, goal, p.appliedToday, { includeToday: true }), sent, assessments: rows });
  const claim = async (kind, extra = {}) => { try { await notices.insertOne({ _id: `${day}:${kind}`, day, kind, at: new Date(now).toISOString(), ...extra }); return true; } catch (e) { if (e?.code === 11000) return false; throw e; } };
  for (const kind of silent) await claim(kind, { silent: true });
  const out = [];
  const days = (p.days ?? []).map((d) => ({ day: d.day, applied: d.applied }));
  const yesterday = days.find((d) => d.day === dayBefore(day))?.applied ?? 0;
  const ctx = { day, applied: p.appliedToday, goal, best, yesterday, replies: p.responseEmailsToday ?? 0, interviews: p.interviewEmailsToday ?? 0, reviewCount: p.reviewCount ?? 0,
    streak: streakOf(days, day, goal, p.appliedToday, { includeToday: true }), assessments: assessmentLines(rows, new Date(now).getTime()) };
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
