// Assessments waiting on you: read from the `assessments` collection that the Gmail label watcher fills (one document per mail, with the
// deadline when the mail gave one). You can add a deadline to one that has none, and mark one done. Times are shown in New York.

const DAY = 86_400_000;
const TZ = "America/New_York";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const clockFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const nyDay = (ms) => dayFmt.format(ms);
const dayNumber = (key) => Math.round(Date.parse(`${key}T12:00:00Z`) / DAY);

/** unknown (no deadline yet), overdue, today, soon (within 3 days) or later. */
export function stateOf(deadlineAt, now = Date.now()) {
  if (!deadlineAt) return "unknown";
  const at = Date.parse(deadlineAt);
  if (!Number.isFinite(at)) return "unknown";
  if (at < now) return "overdue";
  const days = dayNumber(nyDay(at)) - dayNumber(nyDay(now));
  return days <= 0 ? "today" : days <= 3 ? "soon" : "later";
}

/** "today at 11:59 PM", "tomorrow", "in 3 days", "yesterday", "2 days ago", in New York days. */
export function when(deadlineAt, now = Date.now()) {
  if (!deadlineAt) return "no deadline yet";
  const at = Date.parse(deadlineAt);
  if (!Number.isFinite(at)) return "no deadline yet";
  const days = dayNumber(nyDay(at)) - dayNumber(nyDay(now)), time = clockFmt.format(at);
  if (days === 0) return at < now ? `today at ${time} (passed)` : `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days === -1) return `yesterday at ${time}`;
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** Open assessments, the ones with no deadline first, then by deadline. Overdue ones stay for a day, then close themselves. */
export async function listAssessments(db, { now = Date.now() } = {}) {
  const docs = await db.collection("assessments").find({ status: "open" }).project({ _id: 1, company: 1, subject: 1, receivedAt: 1, deadlineAt: 1, deadlineText: 1, deadlineSource: 1 }).toArray();
  return docs
    .filter((d) => !d.deadlineAt || Date.parse(d.deadlineAt) > now - DAY)
    .map((d) => ({ id: String(d._id), company: d.company || "", subject: d.subject || "", receivedAt: d.receivedAt, deadlineAt: d.deadlineAt ?? null, deadlineText: d.deadlineText ?? null, deadlineSource: d.deadlineSource ?? null, state: stateOf(d.deadlineAt, now), when: when(d.deadlineAt, now) }))
    .sort((a, b) => (a.deadlineAt ? 1 : 0) - (b.deadlineAt ? 1 : 0) || String(a.deadlineAt).localeCompare(String(b.deadlineAt)) || String(b.receivedAt).localeCompare(String(a.receivedAt)));
}

/** Set the deadline you were given, or mark an assessment done or dismissed. Only these fields; nothing else can be changed. */
export async function updateAssessment(db, { id, deadlineAt, status, now = Date.now() }) {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(id ?? ""))) throw new Error("An assessment id is required");
  const $set = { updatedAt: new Date(now).toISOString() };
  if (deadlineAt !== undefined) {
    if (deadlineAt === null) { $set.deadlineAt = null; $set.deadlineSource = null; }
    else {
      const t = Date.parse(deadlineAt);
      if (!Number.isFinite(t) || t < now - 400 * DAY || t > now + 400 * DAY) throw new Error("Choose a real date within a year");
      $set.deadlineAt = new Date(t).toISOString(); $set.deadlineSource = "you";
    }
  }
  if (status !== undefined) {
    if (!["open", "done", "dismissed"].includes(status)) throw new Error("Status must be open, done or dismissed");
    $set.status = status;
  }
  if (Object.keys($set).length === 1) throw new Error("Nothing to change");
  const r = await db.collection("assessments").updateOne({ _id: id }, { $set });
  if (!r.matchedCount) throw new Error("That assessment was not found");
  return { ok: true };
}

/** What the phone should say about assessments right now (counts and company names only), or null when there is nothing worth a message. */
export function assessmentLines(rows, now = Date.now()) {
  const known = rows.filter((r) => r.state !== "unknown" && r.state !== "later");
  const unknown = rows.filter((r) => r.state === "unknown");
  const lines = known.map((r) => `${r.company || "An assessment"} ${r.state === "overdue" ? `was due ${when(r.deadlineAt, now)}` : `is due ${when(r.deadlineAt, now)}`}`);
  return { known, unknown, lines, soonest: known[0] ?? null };
}
