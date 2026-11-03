// Lucky hours on the server (docs/lucky.md): the page's data, your birth and location details, the private calendar feed, and the
// four reminders around each window (sent from the push loop, push-events.mjs).
//   GET  /lucky                 the next 14 days, your chart, and how many you applied in today's window so far
//   POST /lucky/profile         { birthUtc, birthPlace, birthLocal, location: { name, lat, lon, tz }, workStart, workEnd }
//   POST /lucky/calendar        { reset? } -> { token } for the calendar link (a new token makes the old link stop working)
//   GET  /lucky/ics/<token>     the iCalendar feed; the website serves it at /calendar/lucky/<token>.ics without a sign-in
import crypto from "node:crypto";
import { appliedItems } from "./applied-core.mjs";
import { DEFAULT_LOCATION, luckyIcs, luckyPlan, windowStages } from "./lucky.mjs";

const PROFILE = "lucky_profile";
const TOKEN = /^[a-f0-9]{48}$/;

export async function readProfile(db) {
  const p = (await db.collection("app_settings").findOne({ _id: PROFILE })) ?? {};
  return { saved: !!p._id, birthUtc: p.birthUtc ?? null, birthPlace: p.birthPlace ?? "", birthLocal: p.birthLocal ?? "", location: p.location ?? DEFAULT_LOCATION, workStart: p.workStart ?? 9, workEnd: p.workEnd ?? 21, calendarToken: p.calendarToken ?? null };
}
const planOf = (p, now = Date.now(), days = 14) => luckyPlan({ now, days, location: p.location, workStart: p.workStart, workEnd: p.workEnd, birthUtc: p.birthUtc });

/** Applications sent between two instants (tracked submissions and jobs you marked applied), each counted once. */
export async function appliedBetween(db, startIso, endIso) {
  const [apps, swipes] = await Promise.all([
    db.collection("applications").find({ status: "APPLIED" }, { projection: { _id: 1, jobUrls: 1, "lifecycle.appliedAt": 1, "submission.submittedAt": 1 } }).toArray(),
    db.collection("job_swipes").find({ direction: "applied" }, { projection: { _id: 0, job_url: 1, direction: 1, applied_at: 1, swiped_at: 1 } }).toArray(),
  ]);
  const s = Date.parse(startIso), e = Date.parse(endIso);
  return appliedItems(apps, swipes).filter((it) => { const t = Date.parse(it.appliedAt); return t >= s && t <= e; }).length;
}

export function validProfile(body) {
  const out = {};
  if (body.birthUtc != null) { const t = Date.parse(body.birthUtc); if (!Number.isFinite(t) || t < Date.UTC(1900, 0, 1) || t > Date.now()) throw new Error("Birth time must be a real past date"); out.birthUtc = new Date(t).toISOString(); }
  if (body.birthPlace != null) out.birthPlace = String(body.birthPlace).trim().slice(0, 80);
  if (body.birthLocal != null) out.birthLocal = String(body.birthLocal).trim().slice(0, 80);
  if (body.location != null) {
    const { name, lat, lon, tz } = body.location;
    if (!(Math.abs(lat) <= 66) || !(Math.abs(lon) <= 180)) throw new Error("Latitude must be within 66° (sunrise every day) and longitude within 180°");
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { throw new Error("Unknown time zone"); }
    out.location = { name: String(name || "Here").trim().slice(0, 60), lat: Number(lat), lon: Number(lon), tz: String(tz) };
  }
  for (const k of ["workStart", "workEnd"]) if (body[k] != null) { const h = Number(body[k]); if (!Number.isInteger(h) || h < 0 || h > 24) throw new Error("Working hours are whole hours from 0 to 24"); out[k] = h; }
  if ((out.workStart ?? 0) >= (out.workEnd ?? 24)) throw new Error("Working hours must start before they end");
  return out;
}

export async function handleLucky(req, res, url, { withDb }) {
  const path = url.pathname;
  if (path !== "/lucky" && !path.startsWith("/lucky/")) return false;
  const json = (code, body) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };
  const readJson = async () => { let raw = ""; for await (const c of req) { raw += c; if (raw.length > 4000) throw new Error("Payload too large"); } return JSON.parse(raw || "{}"); };
  try {
    if (!withDb) return json(503, { ok: false, error: "MONGO_URI not configured" }), true;
    if (req.method === "GET" && path === "/lucky") {
      const data = await withDb(async (db) => {
        const p = await readProfile(db), plan = planOf(p), today = plan.days[0], now = Date.now();
        const started = today.lucky && Date.parse(today.lucky.start) <= now;
        const applied = started ? await appliedBetween(db, today.lucky.start, new Date(Math.min(now, Date.parse(today.lucky.end))).toISOString()) : 0;
        const history = await db.collection("lucky_sessions").find({}, { projection: { _id: 1, applied: 1 } }).sort({ _id: -1 }).limit(30).toArray();
        return { profile: { birthPlace: p.birthPlace, birthLocal: p.birthLocal, hasBirth: !!p.birthUtc, location: p.location, workStart: p.workStart, workEnd: p.workEnd, calendar: !!p.calendarToken }, ...plan, appliedInWindow: applied, best: Math.max(0, ...history.map((h) => h.applied || 0)), history };
      });
      return json(200, { ok: true, ...data }), true;
    }
    if (req.method === "POST" && path === "/lucky/profile") {
      const patch = validProfile(await readJson());
      await withDb((db) => db.collection("app_settings").updateOne({ _id: PROFILE }, { $set: { ...patch, updatedAt: new Date() } }, { upsert: true }));
      return json(200, { ok: true }), true;
    }
    if (req.method === "POST" && path === "/lucky/calendar") {
      const body = await readJson();
      const token = await withDb(async (db) => {
        const p = await readProfile(db);
        if (p.calendarToken && !body.reset) return p.calendarToken;
        const t = crypto.randomBytes(24).toString("hex");
        await db.collection("app_settings").updateOne({ _id: PROFILE }, { $set: { calendarToken: t } }, { upsert: true });
        return t;
      });
      return json(200, { ok: true, token }), true;
    }
    const ics = path.match(/^\/lucky\/ics\/([a-f0-9]+)$/);
    if (req.method === "GET" && ics) {
      const body = await withDb(async (db) => {
        const p = await readProfile(db);
        if (!TOKEN.test(ics[1]) || !p.calendarToken || !crypto.timingSafeEqual(Buffer.from(ics[1]), Buffer.from(p.calendarToken))) return null;
        return luckyIcs(planOf(p), { url: "https://apply.atriveo.com/lucky" });
      });
      if (!body) return json(404, { ok: false, error: "Not found" }), true;
      res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "public, max-age=3600" }); res.end(body);
      return true;
    }
    return json(404, { ok: false, error: "Not found" }), true;
  } catch (e) {
    return json(400, { ok: false, error: e instanceof SyntaxError ? "Send JSON" : e.message }), true;
  }
}

const clock = (iso, tz) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
/** The reminder for one stage of a window (pure; `applied` is the count in the window so far). */
export function stageMessage(stage, day, { tz, applied = 0, best = 0 } = {}) {
  const w = day.lucky, from = clock(w.start, tz), to = clock(w.end, tz), why = `${w.choghadiya} Choghadiya with a ${w.hora} hora`;
  const tone = day.strength?.verdict === "good" ? " A good day for you." : "";
  if (stage === "soon") return { title: "Lucky hour in 15 min", body: `${from} to ${to} · ${why}.${tone}`, url: "/lucky" };
  if (stage === "start") return { title: "Lucky hour is on", body: `Until ${to}. Matching is ready for you.`, url: "/job-matching" };
  if (stage === "last15") return { title: "15 minutes left", body: applied ? `${applied} applied so far this hour. Keep going.` : "Still time for a few. Open Matching.", url: "/job-matching" };
  const record = applied > 0 && applied > best ? " Your best lucky hour yet 🎉" : "";
  return { title: "Lucky hour done", body: `${applied} applied between ${from} and ${to}.${record}`, url: "/lucky" };
}

/** Called every minute by the push loop: sends each stage of today's window once, within 10 minutes of its time.
 *  Nothing is sent until you have saved your details on the Lucky page once. */
export async function tickLucky(db, { now = new Date(), deliver }) {
  const p = await readProfile(db);
  if (!p.saved) return;
  const today = planOf(p, +now, 1).days[0];
  if (!today.lucky) return;
  for (const { stage, at } of windowStages(today.lucky)) {
    if (+now < at || +now >= at + 10 * 60_000) continue;
    let applied = 0, best = 0;
    if (stage === "last15" || stage === "end") applied = await appliedBetween(db, today.lucky.start, new Date(Math.min(+now, Date.parse(today.lucky.end))).toISOString());
    if (stage === "end") {
      best = Math.max(0, ...(await db.collection("lucky_sessions").find({ _id: { $ne: today.day } }, { projection: { applied: 1 } }).toArray()).map((h) => h.applied || 0));
      await db.collection("lucky_sessions").updateOne({ _id: today.day }, { $set: { applied, start: today.lucky.start, end: today.lucky.end } }, { upsert: true });
    }
    const m = stageMessage(stage, today, { tz: p.location.tz, applied, best });
    await deliver(`lucky:${today.day}:${stage}`, { ...m, type: `lucky_${stage}` });
  }
}
