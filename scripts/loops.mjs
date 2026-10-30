import crypto from "node:crypto";
import { GridFSBucket } from "mongodb";
import { sameCompany } from "./network-jobs.mjs";
import { sendPushNotification } from "./web-push.mjs";
import { validateExtraction } from "./loops-schema.mjs";

// Loops: a thought you said or typed once, kept until you deal with it (docs/loops.md).
//   captures        one row per thought: the original input (never overwritten), the Codex reading of it (`structured`), what you
//                   confirmed or corrected (`view`), and the reminder state (status, reminder.nextAt, lastAt: no future rows).
//   capture_events  append-only story of each capture (captured, transcribed, processed, edited, reminded, snoozed, done).
//   loop_audio      GridFS bucket for voice recordings.
// The state machine lives here, so every route, the Mac worker and the reminder tick obey the same rules.

export class LoopsError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

export const STATES = ["RECORDED", "TRANSCRIBING", "WAITING_FOR_CODEX", "PROCESSING", "NEEDS_REVIEW", "ACTIVE", "SNOOZED", "COMPLETED", "DISMISSED", "FAILED"];
const NEXT = {
  RECORDED: ["TRANSCRIBING", "WAITING_FOR_CODEX", "FAILED", "DISMISSED"],
  TRANSCRIBING: ["WAITING_FOR_CODEX", "RECORDED", "FAILED"],
  WAITING_FOR_CODEX: ["PROCESSING", "DISMISSED"],
  PROCESSING: ["NEEDS_REVIEW", "WAITING_FOR_CODEX", "FAILED"],
  NEEDS_REVIEW: ["ACTIVE", "WAITING_FOR_CODEX", "DISMISSED"],
  ACTIVE: ["SNOOZED", "COMPLETED", "DISMISSED"],
  SNOOZED: ["ACTIVE", "SNOOZED", "COMPLETED", "DISMISSED"],
  COMPLETED: ["ACTIVE"],
  DISMISSED: ["NEEDS_REVIEW"],
  FAILED: ["WAITING_FOR_CODEX", "RECORDED", "DISMISSED"],
};
export const canMove = (from, to) => (NEXT[from] ?? []).includes(to);

export const DEFAULT_INTERVAL_HOURS = 6;
export const MAX_ATTEMPTS = 3;
const LEASE_MS = 120_000;
const RETRY_PUSH_MS = 5 * 60_000;
const HOUR = 3_600_000;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const AUDIO_TYPES = /^audio\/(webm|ogg|mp4|mpeg|wav|x-m4a|aac)(;.*)?$/i;

const caps = (db) => db.collection("captures");
const events = (db) => db.collection("capture_events");
const idOf = (id) => { if (typeof id !== "string" || !ID.test(id)) throw new LoopsError("That capture id is not valid"); return id; };
const hoursOf = (h, fallback = DEFAULT_INTERVAL_HOURS) => { const n = Number(h ?? fallback); if (!Number.isFinite(n)) throw new LoopsError("Hours must be a number"); return Math.min(168, Math.max(1, Math.round(n))); };

export async function ensureLoopsIndexes(db) {
  await caps(db).createIndex({ userId: 1, status: 1, "reminder.nextAt": 1 });
  await caps(db).createIndex({ status: 1, retryAt: 1, createdAt: 1 });
  await caps(db).createIndex({ "lease.until": 1 }, { sparse: true });
  await caps(db).createIndex({ "links.personId": 1 }, { sparse: true });
  await caps(db).createIndex({ "links.sourceId": 1 }, { sparse: true });
  await caps(db).createIndex({ createdAt: -1 });
  await events(db).createIndex({ captureId: 1, at: 1 });
}

async function log(db, captureId, type, data = {}, at = new Date()) {
  await events(db).insertOne({ captureId, type, at, data });
}

/** Move a capture to `to` only if it is still in one of `from` (and any extra filter holds): one atomic write, so racing callers cannot both win. */
async function move(db, id, from, to, set = {}, { filter = {}, unset = {}, inc = null, now = new Date() } = {}) {
  for (const f of from) if (!canMove(f, to)) throw new Error(`Loops: ${f} cannot become ${to}`);
  const update = { $set: { ...set, status: to, updatedAt: now } };
  if (Object.keys(unset).length) update.$unset = unset;
  if (inc) update.$inc = inc;
  return caps(db).findOneAndUpdate({ _id: id, status: { $in: from }, ...filter }, update, { returnDocument: "after" });
}

// ── Quiet hours: reminders never land overnight (New York), whatever the interval ───────────────────────────────────
export const QUIET = { from: 22, to: 8 };
const nyHour = (d) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(d));
const isQuiet = (d, q) => { const h = nyHour(d); return q.from > q.to ? h >= q.from || h < q.to : h >= q.from && h < q.to; };
/** `at`, or the first quarter hour after the quiet window when it falls inside it. */
export function afterQuiet(at, quiet = QUIET) {
  let t = new Date(at);
  for (let i = 0; i < 96 && isQuiet(t, quiet); i++) t = new Date(+t + 15 * 60_000);
  return t;
}
async function settingsOf(db) {
  const s = await db.collection("app_settings").findOne({ _id: "loops:settings" });
  return { quiet: { from: Number.isInteger(s?.quiet?.from) ? s.quiet.from : QUIET.from, to: Number.isInteger(s?.quiet?.to) ? s.quiet.to : QUIET.to }, intervalHours: s?.intervalHours ?? DEFAULT_INTERVAL_HOURS };
}

// ── Intake ───────────────────────────────────────────────────────────────────────────────────────────────────────
const base = (userId, id, now) => ({ _id: id, userId, createdAt: now, updatedAt: now, structured: null, view: null, edited: false, links: null, tasks: [], reminder: { intervalHours: null, nextAt: null, lastAt: null, count: 0 }, attempts: 0, error: null, completedAt: null });

/** A typed thought. The client picks the id, so a retried upload is the same capture, never a second one. */
export async function captureText(db, userId, { id, text } = {}, now = new Date()) {
  idOf(id);
  const body = String(text ?? "").trim();
  if (!body) throw new LoopsError("Write the thought first");
  if (body.length > 12_000) throw new LoopsError("That is too long for one capture. Split it in two.");
  const doc = { ...base(userId, id, now), inputType: "TEXT", text: body, audio: null, transcript: null, status: "WAITING_FOR_CODEX" };
  return insertOnce(db, userId, doc, "captured", { inputType: "TEXT" }, now);
}
/** A voice recording: the audio is saved first, as RECORDED, before anything else can fail. */
export async function captureAudio(db, userId, { id, bytes, mime, durationMs } = {}, now = new Date()) {
  idOf(id);
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new LoopsError("The recording was empty");
  if (bytes.length > MAX_AUDIO_BYTES) throw new LoopsError("That recording is too large", 413);
  if (!AUDIO_TYPES.test(String(mime ?? ""))) throw new LoopsError("That is not an audio recording");
  const existing = await caps(db).findOne({ _id: id, userId }, { projection: { _id: 1 } });
  if (existing) return { capture: await publicCapture(db, id, userId), existed: true };
  const bucket = new GridFSBucket(db, { bucketName: "loop_audio" });
  const fileId = await new Promise((resolve, reject) => {
    const up = bucket.openUploadStream(`${id}`, { metadata: { userId, captureId: id, mime } });
    up.on("error", reject); up.on("finish", () => resolve(up.id)); up.end(bytes);
  });
  const doc = { ...base(userId, id, now), inputType: "VOICE", text: null, transcript: null, audio: { fileId, mime: String(mime).split(";")[0], bytes: bytes.length, durationMs: Math.max(0, Math.round(Number(durationMs) || 0)) }, status: "RECORDED" };
  return insertOnce(db, userId, doc, "captured", { inputType: "VOICE", durationMs: doc.audio.durationMs }, now);
}
async function insertOnce(db, userId, doc, type, data, now) {
  try { await caps(db).insertOne(doc); } catch (e) {
    if (e.code !== 11000) throw e;
    if (doc.audio) await new GridFSBucket(db, { bucketName: "loop_audio" }).delete(doc.audio.fileId).catch(() => {});
    return { capture: await publicCapture(db, doc._id, userId), existed: true };
  }
  await log(db, doc._id, type, data, now);
  return { capture: await publicCapture(db, doc._id, userId), existed: false };
}

/** Audio read back for playback; null when this capture has none (or is not yours). */
export async function readAudio(db, userId, id) {
  const c = await caps(db).findOne({ _id: idOf(id), userId }, { projection: { audio: 1 } });
  if (!c?.audio) throw new LoopsError("There is no recording for this capture", 404);
  return { mime: c.audio.mime, size: c.audio.bytes, stream: (range) => new GridFSBucket(db, { bucketName: "loop_audio" }).openDownloadStream(c.audio.fileId, range) };
}

// ── Transcription: a provider turns audio into text; the pipeline never loses the audio if it fails ────────────────
/** provider: { name, transcribe(buffer, mime) → string }. null provider (not configured yet): recordings simply wait as RECORDED. */
export async function transcribePending(db, provider, { limit = 1, now = new Date() } = {}) {
  if (!provider) return { done: 0, failed: 0 };
  let done = 0, failed = 0;
  for (let i = 0; i < limit; i++) {
    const claimed = await caps(db).findOneAndUpdate({ status: "RECORDED", $or: [{ retryAt: null }, { retryAt: { $lte: now } }] }, { $set: { status: "TRANSCRIBING", updatedAt: now } }, { sort: { createdAt: 1 }, returnDocument: "after" });
    if (!claimed) break;
    try {
      const chunks = []; for await (const chunk of new GridFSBucket(db, { bucketName: "loop_audio" }).openDownloadStream(claimed.audio.fileId)) chunks.push(chunk);
      const text = String(await provider.transcribe(Buffer.concat(chunks), claimed.audio.mime) ?? "").trim();
      if (!text) throw new Error("no speech was found");
      await move(db, claimed._id, ["TRANSCRIBING"], "WAITING_FOR_CODEX", { transcript: text, text, error: null, retryAt: null });
      await log(db, claimed._id, "transcribed", { provider: provider.name, characters: text.length });
      done++;
    } catch (e) {
      await move(db, claimed._id, ["TRANSCRIBING"], "FAILED", { error: { stage: "transcribe", message: String(e.message || e).slice(0, 300) } });
      await log(db, claimed._id, "transcription_failed", { provider: provider.name, message: String(e.message || e).slice(0, 300) });
      failed++;
    }
  }
  return { done, failed };
}
/** You typed the transcript yourself (transcription failed or is not set up): the recording stays, the text joins the pipeline. */
export async function setTranscript(db, userId, id, text, now = new Date()) {
  const body = String(text ?? "").trim();
  if (!body) throw new LoopsError("Write what you said first");
  if (body.length > 12_000) throw new LoopsError("That is too long for one capture");
  const r = await move(db, idOf(id), ["RECORDED", "TRANSCRIBING", "FAILED"], "WAITING_FOR_CODEX", { transcript: body, text: body, error: null, retryAt: null }, { filter: { userId, inputType: "VOICE" }, now });
  if (!r) throw await wrongState(db, userId, id, "add a transcript to");
  await log(db, id, "transcribed", { provider: "typed", characters: body.length }, now);
  return { capture: await publicCapture(db, id, userId) };
}

// ── The Mac worker: claim → (heartbeat) → complete | fail, with a lease so two workers never hold one capture ─────
export async function touchWorker(db, workerId, now = new Date()) {
  await db.collection("app_settings").updateOne({ _id: "loops:worker" }, { $set: { workerId: String(workerId || "mac").slice(0, 60), lastSeenAt: now } }, { upsert: true });
}
export async function workerStatus(db) {
  const w = await db.collection("app_settings").findOne({ _id: "loops:worker" });
  return { lastSeenAt: w?.lastSeenAt ?? null };
}
export async function claimCapture(db, workerId, now = new Date()) {
  await touchWorker(db, workerId, now);
  // A lease that ran out (the Mac slept or crashed mid-capture) returns the capture to the queue, or fails it after too many tries.
  await caps(db).updateMany({ status: "PROCESSING", "lease.until": { $lte: now }, attempts: { $gte: MAX_ATTEMPTS } }, { $set: { status: "FAILED", updatedAt: now, error: { stage: "codex", message: "The Mac stopped answering several times." } }, $unset: { lease: "" } });
  await caps(db).updateMany({ status: "PROCESSING", "lease.until": { $lte: now } }, { $set: { status: "WAITING_FOR_CODEX", updatedAt: now }, $unset: { lease: "" } });
  const token = crypto.randomUUID();
  const doc = await caps(db).findOneAndUpdate(
    { status: "WAITING_FOR_CODEX", $or: [{ retryAt: null }, { retryAt: { $exists: false } }, { retryAt: { $lte: now } }] },
    { $set: { status: "PROCESSING", updatedAt: now, lease: { workerId: String(workerId || "mac").slice(0, 60), token, until: new Date(+now + LEASE_MS) } }, $inc: { attempts: 1 } },
    { sort: { createdAt: 1 }, returnDocument: "after" });
  if (!doc) return { capture: null };
  await log(db, doc._id, "claimed", { workerId: doc.lease.workerId, attempt: doc.attempts }, now);
  return { capture: { id: doc._id, token, text: doc.text, attempt: doc.attempts } };
}
export async function heartbeat(db, { id, token, workerId } = {}, now = new Date()) {
  await touchWorker(db, workerId, now);
  const r = await caps(db).updateOne({ _id: String(id), status: "PROCESSING", "lease.token": String(token) }, { $set: { "lease.until": new Date(+now + LEASE_MS) } });
  return { ok: true, held: r.matchedCount === 1 };
}
/** The worker's answer. Accepted once, only from the lease holder; malformed answers fail the attempt and activate nothing. */
export async function completeCapture(db, { id, token, result } = {}, now = new Date()) {
  const doc = await caps(db).findOne({ _id: String(id) });
  if (!doc) throw new LoopsError("Unknown capture", 404);
  if (doc.status !== "PROCESSING" || doc.lease?.token !== token) {
    // The same answer sent twice (a retry after a dropped reply) is not an error.
    if (doc.status !== "PROCESSING" && doc.structured && doc.processedToken === token) return { ok: true, duplicate: true };
    throw new LoopsError("That capture is no longer yours to finish", 409);
  }
  let structured;
  try { structured = validateExtraction(result); } catch (e) {
    await log(db, doc._id, "malformed", { message: String(e.message).slice(0, 200) }, now);
    return failCapture(db, { id, token, error: `Codex's answer was not usable: ${e.message}` }, now);
  }
  const links = await matchEntities(db, structured);
  const view = { summary: structured.summary, company: structured.company, position: structured.position, person: structured.person, intent: structured.intent, context: structured.context };
  const tasks = structured.tasks.map((t, i) => ({ id: `t${i + 1}`, ...t, done: false, doneAt: null }));
  const r = await move(db, doc._id, ["PROCESSING"], "NEEDS_REVIEW", { structured, view, links, tasks, processedToken: token, error: null, "reminder.intervalHours": structured.suggested_reminder_hours ?? null }, { filter: { "lease.token": token }, unset: { lease: "", retryAt: "" }, now });
  if (!r) throw new LoopsError("That capture is no longer yours to finish", 409);
  await log(db, doc._id, "processed", { action_type: structured.action_type, tasks: tasks.length, linked: Object.keys(links.linked ?? {}) }, now);
  return { ok: true };
}
export async function failCapture(db, { id, token, error } = {}, now = new Date()) {
  const doc = await caps(db).findOne({ _id: String(id) });
  if (!doc || doc.status !== "PROCESSING" || doc.lease?.token !== token) throw new LoopsError("That capture is no longer yours to finish", 409);
  const message = String(error ?? "Processing failed").slice(0, 300);
  const final = doc.attempts >= MAX_ATTEMPTS;
  const r = await move(db, doc._id, ["PROCESSING"], final ? "FAILED" : "WAITING_FOR_CODEX",
    final ? { error: { stage: "codex", message } } : { error: { stage: "codex", message }, retryAt: new Date(+now + Math.min(30, 2 ** doc.attempts) * 60_000) }, { filter: { "lease.token": token }, unset: { lease: "" }, now });
  if (!r) throw new LoopsError("That capture is no longer yours to finish", 409);
  await log(db, doc._id, "codex_failed", { message, attempt: doc.attempts, retrying: !final }, now);
  return { ok: true, retrying: !final };
}

// ── Matching what you said to what Atriveo already knows (never creates anyone) ──────────────────────────────────
const words = (s) => String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const first = (name) => words(name)[0] ?? "";
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export async function matchEntities(db, s) {
  const out = { linked: {}, candidates: { people: [], jobs: [], companies: [] } };
  let company = null;
  if (s.company) {
    const sources = await db.collection("network_sources").find({ type: { $in: ["company", "staffing"] } }, { projection: { name: 1 } }).toArray().catch(() => []);
    const hits = sources.filter((x) => sameCompany(x.name, s.company));
    out.candidates.companies = hits.slice(0, 5).map((x) => ({ id: String(x._id), name: x.name }));
    if (hits.length === 1) { out.linked.sourceId = String(hits[0]._id); company = hits[0].name; }
    out.linked.company = company ?? s.company;
    const w = words(s.company)[0];
    const jobs = w ? await db.collection("jobs").find({ company: { $regex: `^${esc(w)}`, $options: "i" } }, { projection: { job_url: 1, title: 1, company: 1 } }).sort({ run_at: -1 }).limit(200).toArray().catch(() => []) : [];
    const sameCo = jobs.filter((j) => sameCompany(j.company, s.company));
    const pos = words(s.position).filter((x) => x.length > 2);
    const fitting = pos.length ? sameCo.filter((j) => pos.every((x) => words(j.title).includes(x))) : [];
    out.candidates.jobs = fitting.slice(0, 5).map((j) => ({ url: j.job_url, title: j.title, company: j.company }));
    if (fitting.length === 1) out.linked.jobUrl = fitting[0].job_url;
  }
  if (s.person) {
    const people = await db.collection("network_people").find({ archived: { $ne: true } }, { projection: { name: 1, company: 1, sourceId: 1 } }).toArray().catch(() => []);
    const full = words(s.person).length > 1;
    const byName = people.filter((p) => (full ? words(p.name).join(" ") === words(s.person).join(" ") : first(p.name) === first(s.person)));
    const sameCo2 = s.company ? byName.filter((p) => sameCompany(p.company, s.company) || (out.linked.sourceId && p.sourceId === out.linked.sourceId)) : [];
    out.candidates.people = byName.slice(0, 5).map((p) => ({ id: String(p._id), name: p.name, company: p.company ?? null }));
    // A first name alone is only trusted when exactly one person with it works at the company said; otherwise you pick at review.
    const sure = full && byName.length === 1 ? byName : sameCo2.length === 1 ? sameCo2 : [];
    if (sure.length === 1) out.linked.personId = String(sure[0]._id);
  }
  return out;
}

// ── Review, edit, confirm ────────────────────────────────────────────────────────────────────────────────────────
const FIELDS = { summary: 300, company: 120, position: 160, person: 120, intent: 300 };
async function mine(db, userId, id) {
  const c = await caps(db).findOne({ _id: idOf(id), userId });
  if (!c) throw new LoopsError("That capture was not found", 404);
  return c;
}
async function wrongState(db, userId, id, verb) {
  const c = await caps(db).findOne({ _id: id, userId }, { projection: { status: 1 } });
  return new LoopsError(c ? `You can't ${verb} a capture that is ${c.status.toLowerCase().replace(/_/g, " ")}` : "That capture was not found", c ? 409 : 404);
}
/** Your corrections to the reading: company, position, person, summary, intent, tasks, link choices. Recorded as events with before and after. */
export async function editCapture(db, userId, id, patch = {}, now = new Date()) {
  const c = await mine(db, userId, id);
  if (!["NEEDS_REVIEW", "ACTIVE", "SNOOZED"].includes(c.status)) throw await wrongState(db, userId, id, "edit");
  const set = {}, change = {};
  for (const [k, max] of Object.entries(FIELDS)) if (k in patch) {
    const v = patch[k] == null ? null : String(patch[k]).replace(/\s+/g, " ").trim().slice(0, max) || null;
    if (k === "summary" && !v) throw new LoopsError("The summary can't be empty");
    if (v !== (c.view?.[k] ?? null)) { set[`view.${k}`] = v; change[k] = { from: c.view?.[k] ?? null, to: v }; }
  }
  if (Array.isArray(patch.tasks)) {
    if (patch.tasks.length > 8) throw new LoopsError("Up to 8 tasks");
    const tasks = patch.tasks.map((t, i) => {
      const title = String(t?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (!title) throw new LoopsError(`Task ${i + 1} needs a title`);
      const prior = c.tasks.find((x) => x.id === t.id);
      return { id: prior?.id ?? `t${Date.now().toString(36)}${i}`, title, description: t.description == null ? null : String(t.description).trim().slice(0, 400) || null, priority: ["high", "medium", "low"].includes(t.priority) ? t.priority : prior?.priority ?? "medium", done: Boolean(prior?.done), doneAt: prior?.doneAt ?? null };
    });
    if (JSON.stringify(tasks.map((t) => [t.title, t.description, t.priority])) !== JSON.stringify(c.tasks.map((t) => [t.title, t.description, t.priority]))) { set.tasks = tasks; change.tasks = { from: c.tasks.map((t) => t.title), to: tasks.map((t) => t.title) }; }
  }
  if ("reminderHours" in patch) { const h = hoursOf(patch.reminderHours); if (h !== c.reminder.intervalHours) { set["reminder.intervalHours"] = h; change.reminderHours = { from: c.reminder.intervalHours, to: h }; } }
  if (patch.link && typeof patch.link === "object") {
    // Picking one of the candidates (or clearing a link) at review; only ids the reading offered are accepted.
    for (const [key, list, pick] of [["personId", c.links?.candidates?.people, (p) => String(p.id)], ["sourceId", c.links?.candidates?.companies, (p) => String(p.id)], ["jobUrl", c.links?.candidates?.jobs, (p) => p.url]]) {
      if (!(key in patch.link)) continue;
      const v = patch.link[key];
      if (v !== null && !(list ?? []).some((p) => pick(p) === v)) throw new LoopsError("That is not one of the matches");
      set[`links.linked.${key}`] = v; change[key] = { from: c.links?.linked?.[key] ?? null, to: v };
    }
  }
  if (!Object.keys(change).length) return { capture: await publicCapture(db, id, userId), unchanged: true };
  await caps(db).updateOne({ _id: c._id }, { $set: { ...set, edited: true, updatedAt: now } });
  await log(db, c._id, "edited", change, now);
  return { capture: await publicCapture(db, id, userId) };
}
/** Review → ACTIVE. Needs at least one task. Reminders start here and nowhere earlier. */
export async function confirmCapture(db, userId, id, { reminderHours = null } = {}, now = new Date()) {
  const c = await mine(db, userId, id);
  if (c.status !== "NEEDS_REVIEW") throw await wrongState(db, userId, id, "confirm");
  if (!c.tasks.some((t) => !t.done)) throw new LoopsError("Add at least one thing to do before confirming");
  const settings = await settingsOf(db);
  const hours = hoursOf(reminderHours ?? c.reminder.intervalHours ?? settings.intervalHours);
  const nextAt = afterQuiet(new Date(+now + hours * HOUR), settings.quiet);
  const r = await move(db, c._id, ["NEEDS_REVIEW"], "ACTIVE", { "reminder.intervalHours": hours, "reminder.nextAt": nextAt, confirmedAt: now }, { filter: { userId }, now });
  if (!r) throw await wrongState(db, userId, id, "confirm");
  await log(db, c._id, "confirmed", { intervalHours: hours, nextReminderAt: nextAt.toISOString() }, now);
  return { capture: await publicCapture(db, id, userId) };
}
/** Put a failed or reviewed capture back in the queue for another reading. */
export async function retryCapture(db, userId, id, now = new Date()) {
  const c = await mine(db, userId, id);
  const to = c.status === "FAILED" && c.error?.stage === "transcribe" ? "RECORDED" : "WAITING_FOR_CODEX";
  const r = await move(db, c._id, to === "RECORDED" ? ["FAILED"] : ["FAILED", "NEEDS_REVIEW"], to, { error: null, attempts: 0, retryAt: null }, { filter: { userId }, unset: { lease: "" }, now });
  if (!r) throw await wrongState(db, userId, id, "retry");
  await log(db, c._id, "retried", { to }, now);
  return { capture: await publicCapture(db, id, userId) };
}

// ── The inertia: Done, Snooze, Dismiss, and the reminder tick ────────────────────────────────────────────────────
/** One task done (taskId) or every open task (none given). The capture completes with its last open task and its reminders stop. */
export async function doneCapture(db, userId, id, { taskId = null } = {}, now = new Date()) {
  const c = await mine(db, userId, id);
  if (!["ACTIVE", "SNOOZED"].includes(c.status)) throw await wrongState(db, userId, id, "finish");
  if (taskId && !c.tasks.some((t) => t.id === taskId)) throw new LoopsError("That task was not found", 404);
  const tasks = c.tasks.map((t) => (!t.done && (!taskId || t.id === taskId) ? { ...t, done: true, doneAt: now } : t));
  const complete = tasks.every((t) => t.done);
  const r = complete
    ? await move(db, c._id, ["ACTIVE", "SNOOZED"], "COMPLETED", { tasks, completedAt: now, "reminder.nextAt": null }, { filter: { userId }, now })
    : await caps(db).findOneAndUpdate({ _id: c._id, userId, status: { $in: ["ACTIVE", "SNOOZED"] } }, { $set: { tasks, updatedAt: now } }, { returnDocument: "after" });
  if (!r) throw await wrongState(db, userId, id, "finish");
  await log(db, c._id, complete ? "completed" : "task_done", { taskId }, now);
  return { capture: await publicCapture(db, id, userId) };
}
export async function snoozeCapture(db, userId, id, { hours } = {}, now = new Date()) {
  const h = hoursOf(hours);
  const settings = await settingsOf(db);
  const nextAt = afterQuiet(new Date(+now + h * HOUR), settings.quiet);
  const r = await move(db, idOf(id), ["ACTIVE", "SNOOZED"], "SNOOZED", { "reminder.nextAt": nextAt, snoozedAt: now }, { filter: { userId }, now });
  if (!r) throw await wrongState(db, userId, id, "snooze");
  await log(db, id, "snoozed", { hours: h, until: nextAt.toISOString() }, now);
  return { capture: await publicCapture(db, id, userId) };
}
export async function dismissCapture(db, userId, id, now = new Date()) {
  const r = await move(db, idOf(id), ["RECORDED", "WAITING_FOR_CODEX", "NEEDS_REVIEW", "ACTIVE", "SNOOZED", "FAILED"], "DISMISSED", { "reminder.nextAt": null }, { filter: { userId }, unset: { lease: "" }, now });
  if (!r) throw await wrongState(db, userId, id, "dismiss");
  await log(db, id, "dismissed", {}, now);
  return { capture: await publicCapture(db, id, userId) };
}
export async function reopenCapture(db, userId, id, now = new Date()) {
  const c = await mine(db, userId, id);
  const to = c.status === "DISMISSED" ? "NEEDS_REVIEW" : "ACTIVE";
  const settings = await settingsOf(db);
  const hours = hoursOf(c.reminder.intervalHours ?? settings.intervalHours);
  const set = to === "ACTIVE" ? { tasks: c.tasks.map((t) => ({ ...t, done: false, doneAt: null })), completedAt: null, "reminder.nextAt": afterQuiet(new Date(+now + hours * HOUR), settings.quiet) } : {};
  const r = await move(db, c._id, [c.status], to, set, { filter: { userId }, now });
  if (!r) throw await wrongState(db, userId, id, "reopen");
  await log(db, c._id, "reopened", { to }, now);
  return { capture: await publicCapture(db, id, userId) };
}

const ago = (from, now) => { const h = Math.max(0, Math.floor((+now - +from) / HOUR)); return h < 1 ? "less than an hour" : h < 48 ? `${h} hour${h === 1 ? "" : "s"}` : `${Math.floor(h / 24)} days`; };
export function reminderNotification(c, now = new Date()) {
  const open = c.tasks.find((t) => !t.done);
  const where = [c.view?.company, c.view?.position].filter(Boolean).join(" · ");
  return { title: "Atriveo", body: [`Still open: ${open?.title ?? c.view?.summary ?? "something you wanted to do"}`, where, `Waiting ${ago(c.confirmedAt ?? c.createdAt, now)}`].filter(Boolean).join("\n"), url: `/loops?id=${encodeURIComponent(c._id)}`, type: "loop_reminder", tag: `loop:${c._id}` };
}
/**
 * Called every minute with the push poller. One atomic claim per due capture (advancing nextAt as it claims), then the push: a second
 * tick or a second server cannot send the same reminder, and a failed push is retried in five minutes. No future rows exist.
 */
export async function tickReminders(db, userId, { now = new Date(), send = sendPushNotification } = {}) {
  const settings = await settingsOf(db);
  let sent = 0, failed = 0;
  for (let i = 0; i < 25; i++) {
    // Quiet hours at send time too: a due reminder just waits for the morning.
    const resume = afterQuiet(now, settings.quiet);
    if (resume > now) { await caps(db).updateMany({ userId, status: { $in: ["ACTIVE", "SNOOZED"] }, "reminder.nextAt": { $lte: now } }, { $set: { "reminder.nextAt": resume } }); break; }
    const before = await caps(db).findOneAndUpdate({ userId, status: { $in: ["ACTIVE", "SNOOZED"] }, "reminder.nextAt": { $lte: now } },
      // The claim itself moves nextAt to the push-retry time, so a second tick or server finds nothing due; a sent push then sets the real next time.
      { $set: { status: "ACTIVE", "reminder.lastAt": now, "reminder.nextAt": new Date(+now + RETRY_PUSH_MS), updatedAt: now }, $inc: { "reminder.count": 1 } }, { sort: { "reminder.nextAt": 1 }, returnDocument: "before" });
    if (!before) break;
    const interval = hoursOf(before.reminder.intervalHours ?? settings.intervalHours);
    const next = afterQuiet(new Date(+now + interval * HOUR), settings.quiet);
    let result;
    try { result = await send(db, userId, reminderNotification(before, now)); } catch (e) { result = { sent: 0, failed: 1, error: String(e.message || e).slice(0, 200) }; }
    // Only a still-open capture is moved on (you may have finished it while the push was in flight).
    const advance = () => caps(db).updateOne({ _id: before._id, status: "ACTIVE" }, { $set: { "reminder.nextAt": next } });
    if (result.sent) { sent++; await advance(); await log(db, before._id, "reminder_sent", { devices: result.sent, nextAt: next.toISOString() }, now); }
    else if (result.failed) {
      failed++;
      await log(db, before._id, "reminder_failed", { message: result.error ?? "no device accepted it", retryAt: new Date(+now + RETRY_PUSH_MS).toISOString() }, now);
    } else { await advance(); await log(db, before._id, "reminder_skipped", { reason: "no devices are subscribed", nextAt: next.toISOString() }, now); }
  }
  return { sent, failed };
}

// ── Reading ──────────────────────────────────────────────────────────────────────────────────────────────────────
const SECTION = { NEEDS_ACTION: ["ACTIVE", "SNOOZED"], WAITING: ["RECORDED", "TRANSCRIBING", "WAITING_FOR_CODEX", "PROCESSING", "FAILED"], NEEDS_REVIEW: ["NEEDS_REVIEW"], COMPLETED: ["COMPLETED"], DISMISSED: ["DISMISSED"] };
function shape(c) {
  return {
    id: c._id, inputType: c.inputType, status: c.status, createdAt: c.createdAt, updatedAt: c.updatedAt, completedAt: c.completedAt ?? null, confirmedAt: c.confirmedAt ?? null,
    text: c.text, audio: c.audio ? { mime: c.audio.mime, bytes: c.audio.bytes, durationMs: c.audio.durationMs } : null,
    view: c.view, structured: c.structured, edited: Boolean(c.edited), links: c.links, tasks: c.tasks, reminder: c.reminder, error: c.error ?? null, attempts: c.attempts,
  };
}
async function publicCapture(db, id, userId) { const c = await caps(db).findOne({ _id: id, userId }); return c ? shape(c) : null; }
export async function getCapture(db, userId, id) {
  const c = await mine(db, userId, id);
  const story = await events(db).find({ captureId: c._id }).sort({ at: 1 }).toArray();
  return { capture: shape(c), events: story.map((e) => ({ type: e.type, at: e.at, data: e.data })) };
}
/** The list: filter by section or status, and search company, person, position, text, status and date. */
export async function listCaptures(db, userId, { section = null, status = null, q = "", from = null, to = null, limit = 100, skip = 0 } = {}) {
  const filter = { userId };
  if (status) { if (!STATES.includes(status)) throw new LoopsError("Unknown status"); filter.status = status; }
  else if (section) { if (!SECTION[section]) throw new LoopsError("Unknown section"); filter.status = { $in: SECTION[section] }; }
  const terms = String(q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (terms.length) filter.$and = terms.map((t) => { const re = { $regex: esc(t.slice(0, 60)), $options: "i" }; return { $or: [{ "view.company": re }, { "view.person": re }, { "view.position": re }, { "view.summary": re }, { text: re }, { "tasks.title": re }] }; });
  if (from || to) filter.createdAt = { ...(from ? { $gte: new Date(from) } : {}), ...(to ? { $lte: new Date(to) } : {}) };
  const rows = await caps(db).find(filter).sort(section === "NEEDS_ACTION" ? { "reminder.nextAt": 1 } : { createdAt: -1 }).skip(Math.max(0, skip)).limit(Math.min(200, Math.max(1, limit))).toArray();
  return { captures: rows.map(shape) };
}
/** The dock and Today: counts per section, the worker's last-seen time, and the few unfinished intentions that matter now. */
export async function loopsSummary(db, userId, { now = new Date() } = {}) {
  const counts = await caps(db).aggregate([{ $match: { userId } }, { $group: { _id: "$status", n: { $sum: 1 } } }]).toArray();
  const by = Object.fromEntries(counts.map((c) => [c._id, c.n]));
  const section = Object.fromEntries(Object.entries(SECTION).map(([k, v]) => [k, v.reduce((n, s) => n + (by[s] ?? 0), 0)]));
  const open = await caps(db).find({ userId, status: { $in: ["ACTIVE", "SNOOZED"] } }).sort({ confirmedAt: 1 }).limit(5).toArray();
  return { counts: section, byStatus: by, worker: await workerStatus(db), now: now.toISOString(), open: open.map((c) => ({ id: c._id, view: c.view, firstTask: c.tasks.find((t) => !t.done)?.title ?? null, waitingSince: c.confirmedAt ?? c.createdAt, nextAt: c.reminder.nextAt, status: c.status })) };
}
