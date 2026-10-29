import { randomUUID } from "node:crypto";
import { NetworkError } from "./network.mjs";

// Calendar events for your network: a title, a New York time, an optional person, and when to be reminded. The reminder shows in
// Network Intelligence from its lead time and goes to your phone once (see runEventAlerts in network-reminders.mjs).

const DAY = 86_400_000, MINUTE = 60_000;
export const REMIND_OPTIONS = [0, 15, 60, 1440];
// Events that started more than this long ago never alert, so turning the feature on does not replay old events.
export const LATE_ALERT_MS = 2 * 3_600_000;

const shape = ({ _id, ...d }) => ({ id: _id, ...d });

/** When the reminder starts, as epoch milliseconds. */
export const reminderStart = (event) => Date.parse(event.at) - (event.remind ?? 0) * MINUTE;

export async function saveEvent(db, input = {}, now = new Date()) {
  const title = String(input.title ?? "").trim();
  if (!title || title.length > 120) throw new NetworkError("Give the event a title (up to 120 characters)");
  const at = new Date(input.at ?? "");
  if (!Number.isFinite(at.getTime())) throw new NetworkError("Choose a date and time");
  const remind = Number(input.remind ?? 15);
  if (!REMIND_OPTIONS.includes(remind)) throw new NetworkError("Choose a reminder time from the list");
  const personId = input.personId ? String(input.personId) : null;
  if (personId && !(await db.collection("network_people").findOne({ _id: personId }))) throw new NetworkError("That person is not in your network");
  const doc = {
    _id: randomUUID(), title, at: at.toISOString(), remind, personId, note: String(input.note ?? "").trim().slice(0, 500),
    done: false, notifiedAt: null, createdAt: now.toISOString(),
  };
  await db.collection("network_events").insertOne(doc);
  return { event: shape(doc) };
}

/** Upcoming and recent events that are not done yet: from a day ago onward, soonest first. */
export async function listEvents(db, { now = new Date() } = {}) {
  const since = new Date(now.getTime() - DAY).toISOString();
  const rows = await db.collection("network_events").find({ done: false, at: { $gte: since } }).sort({ at: 1 }).toArray();
  return { events: rows.map(shape) };
}

export async function markEventDone(db, id) {
  const key = String(id ?? "");
  if (!key) throw new NetworkError("Choose an event");
  const result = await db.collection("network_events").updateOne({ _id: key }, { $set: { done: true } });
  if (!result.matchedCount) throw new NetworkError("That event is gone");
  return {};
}

export async function removeEvent(db, id) {
  const key = String(id ?? "");
  if (!key) throw new NetworkError("Choose an event");
  const result = await db.collection("network_events").deleteOne({ _id: key });
  if (!result.deletedCount) throw new NetworkError("That event is gone");
  return {};
}
