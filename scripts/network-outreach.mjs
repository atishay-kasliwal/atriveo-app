import { NetworkError, addPeople, saveSource, archivePerson, logHistory } from "./network.mjs";

// LinkedIn outreach: a source made for one day's batch of reach-outs (the date starts as today and can be changed). Each person added to
// it is asked about at 24, 48 and 72 hours (the source's checkHours): "did they accept, or reply?" Yes keeps them. No at a check-in
// before the last one means "send them another message"; no at the last one archives them (restorable). Hours count from `reachedAt`.

const PEOPLE = "network_people", SOURCES = "network_sources";
export const DEFAULT_CHECK_HOURS = [24, 48, 72];
const HOUR = 3_600_000;
const fail = (m) => { throw new NetworkError(m); };
const TZ = "America/New_York";
const dayOf = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: TZ });
const dayName = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const out = ({ _id, ...doc }) => ({ id: _id, ...doc });
const hoursOf = (source) => (source?.checkHours?.length ? source.checkHours : DEFAULT_CHECK_HOURS);

/** A new outreach source for a day (YYYY-MM-DD, New York; today when none is given). The same day gives the same source back. */
export async function outreachSource(db, { date, name, checkHours } = {}, now = new Date()) {
  const d = date ? (/^\d{4}-\d{2}-\d{2}$/.test(String(date)) && !Number.isNaN(Date.parse(String(date))) ? String(date) : fail("Use a date like 2026-11-04")) : dayOf(now);
  return saveSource(db, { name: String(name ?? "").trim() || `LinkedIn outreach · ${dayName(d)}`, type: "outreach", about: "LinkedIn outreach", when: d, checkHours: checkHours ?? DEFAULT_CHECK_HOURS }, now);
}

/** Add people to an outreach source, each with the clock started (addPeople does that for any outreach source). */
export async function addOutreachPeople(db, { sourceId, rows } = {}, now = new Date()) {
  const source = await db.collection(SOURCES).findOne({ _id: String(sourceId) });
  if (!source || source.type !== "outreach") fail("Pick a LinkedIn outreach source");
  return addPeople(db, { rows, sourceId: source._id }, now);
}

/** The check-in a person is waiting on right now: the earliest hour that has passed and has no answer. Null when nothing is due. */
export function dueCheckIn(person, source, now = new Date()) {
  const o = person.outreach;
  if (!o || person.archived || o.status === "accepted" || o.status === "replied" || o.status === "archived") return null;
  const answered = new Set((o.answers ?? []).map((a) => a.hour));
  const hours = hoursOf(source), t = now.getTime() - Date.parse(o.reachedAt);
  const hour = hours.find((h) => t >= h * HOUR && !answered.has(h));
  return hour ? { hour, last: hour === hours[hours.length - 1], dueAt: new Date(Date.parse(o.reachedAt) + hour * HOUR).toISOString() } : null;
}

/** Everyone with a check-in due, oldest first. These are the bell's and the phone's questions. */
export function outreachPrompts({ people, sources }, now = new Date()) {
  const bySource = new Map(sources.map((s) => [s.id, s]));
  return people.flatMap((p) => { const due = dueCheckIn(p, bySource.get(p.sourceId), now); return due ? [{ key: `outreach:${p.id}:${due.hour}`, kind: "outreach", personId: p.id, sourceId: p.sourceId, hour: due.hour, last: due.last, dueAt: due.dueAt, title: `Did ${p.name} respond?`, detail: `${due.hour} hours since you reached out on LinkedIn` }] : []; })
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

/** Counts for a source's card: how many are waiting, accepted, replied or archived. */
export function outreachCounts(people, sourceId) {
  const c = { total: 0, waiting: 0, accepted: 0, replied: 0, archived: 0 };
  for (const p of people) if (p.sourceId === sourceId && p.outreach) { c.total++; c[p.outreach.status in c ? p.outreach.status : "waiting"]++; }
  return c;
}

/**
 * Your answer to one check-in. Accepted or replied keeps them (replied also lands in their history); neither keeps them waiting, and the
 * reply says whether to message again; neither at the last check-in archives them. "sent" says you messaged again, which counts as contact.
 */
export async function answerCheckIn(db, { id, hour, accepted = false, replied = false, sent = false } = {}, now = new Date()) {
  const cur = await db.collection(PEOPLE).findOne({ _id: String(id) });
  if (!cur?.outreach) fail("That person is not in a LinkedIn outreach source");
  const source = await db.collection(SOURCES).findOne({ _id: cur.sourceId });
  const hours = hoursOf(source), h = Number(hour);
  if (!hours.includes(h)) fail("That is not one of this source's check-ins");
  const o = cur.outreach, answers = (o.answers ?? []).filter((a) => a.hour !== h);
  answers.push({ hour: h, at: now.toISOString(), accepted: Boolean(accepted), replied: Boolean(replied), sent: Boolean(sent) });
  const yes = accepted || replied, last = h === hours[hours.length - 1];
  const status = replied ? "replied" : accepted ? "accepted" : o.status === "accepted" || o.status === "replied" ? o.status : last ? "archived" : "waiting";
  const next = { ...o, answers, status }, set = { outreach: next, updatedAt: now.toISOString() };
  if (status === "archived") { set.archived = true; next.archivedAt = now.toISOString(); }
  await db.collection(PEOPLE).updateOne({ _id: cur._id }, { $set: set });
  if (replied) await logHistory(db, { id: cur._id, type: "reply", text: "Replied to your LinkedIn message" }, now);
  if (sent && !yes) await logHistory(db, { id: cur._id, type: "message", text: `Messaged again on LinkedIn (${h}-hour check-in)` }, now);
  return { person: out(await db.collection(PEOPLE).findOne({ _id: cur._id })), status, again: !yes && !last, archived: status === "archived" };
}

/** Bring someone archived by a check-in back; they are waiting again with the clock reset to now. */
export async function restoreOutreach(db, { id } = {}, now = new Date()) {
  const cur = await db.collection(PEOPLE).findOne({ _id: String(id) });
  if (!cur?.outreach) fail("That person is not in a LinkedIn outreach source");
  await archivePerson(db, { id: cur._id, archived: false }, now);
  await db.collection(PEOPLE).updateOne({ _id: cur._id }, { $set: { outreach: { reachedAt: now.toISOString(), status: "waiting", answers: [] } } });
  return { id: cur._id };
}
