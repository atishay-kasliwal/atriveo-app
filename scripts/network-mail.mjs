import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanEmail } from "./resume-emails.mjs";
import { loadResumeProfile } from "./resume-profile.mjs";
import { generalResumes } from "./no-text-jobs.mjs";
import { NetworkError, logHistory, savePerson } from "./network.mjs";
import { storeFromEnv, resumeKey } from "./resume-store.mjs";
import { resumeRevision } from "./application-kit.mjs";

// Email from the Network page: sent from your own Gmail through the same send-only connection Outreach uses (gmail.send: it can send,
// never read), only when you press Send. Each email is logged in that person's history and can set the next follow-up.

const fail = (m) => { throw new NetworkError(m); };
const SETTINGS = "network_mail", LOG = "network_mail_log", DRAFTS = "network_drafts";
const line = (v, max) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
const text = (v, max) => String(v ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);
export const tokenFile = (env = process.env) => path.join(path.resolve(env.PLAYATRIVEO_HOME?.trim() || path.join(os.homedir(), ".playatriveo")), "gmail-send-token.json");

/** Who you send as, a few lines about you for drafts, your signature; plus whether Gmail is connected and which resumes can be attached. */
export async function mailSettings(db, { outRoot, env = process.env } = {}) {
  const doc = (await db.collection("app_settings").findOne({ _id: SETTINGS })) ?? {};
  const profile = loadResumeProfile();
  return {
    fromName: doc.fromName || profile.name || "",
    fromEmail: doc.fromEmail || profile.email || "",
    about: doc.about || "",
    signature: doc.signature ?? (profile.name || ""),
    connected: Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim() && fs.existsSync(tokenFile(env))),
    resumes: Object.entries(outRoot ? generalResumes(outRoot) : {}).map(([track, r]) => ({ track, label: r.label })),
  };
}

export async function saveMailSettings(db, input = {}) {
  const set = {};
  if ("fromName" in input) set.fromName = line(input.fromName, 100);
  if ("fromEmail" in input) { const e = line(input.fromEmail, 120); set.fromEmail = e ? cleanEmail(e) ?? fail(`"${e}" is not an email address`) : ""; }
  if ("about" in input) set.about = text(input.about, 1500);
  if ("signature" in input) set.signature = text(input.signature, 300);
  await db.collection("app_settings").updateOne({ _id: SETTINGS }, { $set: { ...set, updatedAt: new Date().toISOString() } }, { upsert: true });
  return set;
}

/** RFC 2047 for non-ASCII header words, and the message as Gmail's raw upload wants it: plain text, plus a PDF when there is one. */
const header = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
const wrap76 = (b64) => b64.replace(/.{1,76}/g, "$&\r\n");
export function buildMime({ from, fromName, to, subject, body, attachment }, boundary = `atriveo-${crypto.randomBytes(12).toString("hex")}`) {
  for (const [v, what] of [[from, "Sender"], [fromName, "Sender name"], [to, "Recipient"], [subject, "Subject"]]) if (/[\r\n]/.test(v)) fail(`${what} has a line break`);
  const head = [`From: ${fromName ? `${header(fromName)} <${from}>` : from}`, `To: ${to}`, `Subject: ${header(subject)}`, "MIME-Version: 1.0"];
  const part = ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap76(Buffer.from(body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64"))];
  if (!attachment) return [...head, ...part].join("\r\n");
  const name = attachment.fileName.replace(/["\r\n]/g, "");
  return [...head, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", `--${boundary}`, ...part, `--${boundary}`,
    `Content-Type: application/pdf; name="${name}"`, `Content-Disposition: attachment; filename="${name}"`, "Content-Transfer-Encoding: base64", "",
    wrap76(attachment.bytes.toString("base64")), `--${boundary}--`, ""].join("\r\n");
}

/** Sends through the Gmail API with the saved refresh token. "uncertain" means it may have gone out: never retried by itself. */
export function gmailSender({ env = process.env, fetchImpl = fetch, timeoutMs = 30_000 } = {}) {
  let access = null;
  async function token() {
    if (access && access.expires > Date.now() + 30_000) return access.token;
    const file = tokenFile(env), id = env.GOOGLE_CLIENT_ID?.trim(), secret = env.GOOGLE_CLIENT_SECRET?.trim();
    if (!id || !secret || !fs.existsSync(file)) throw new NetworkError("Gmail is not connected. Connect it once in Outreach, then send again.");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    const res = await fetchImpl("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: saved.refresh_token, grant_type: "refresh_token" }), signal: AbortSignal.timeout(timeoutMs) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) throw new NetworkError(`Gmail sign-in failed (${json.error_description ?? res.status}). Connect Gmail again in Outreach.`);
    access = { token: json.access_token, expires: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return access.token;
  }
  return {
    async send(email) {
      let t;
      try { t = await token(); } catch (e) { return { state: "failed", error: e.message }; }
      let res, body;
      try {
        res = await fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
          body: JSON.stringify({ raw: Buffer.from(buildMime(email), "utf8").toString("base64url") }), signal: AbortSignal.timeout(timeoutMs) });
        body = await res.json().catch(() => null);
      } catch (e) { return { state: "uncertain", error: `No answer from Gmail (${e.message}). Check your Sent folder before sending again.` }; }
      if (res.ok && body?.id) return { state: "sent", messageId: body.id };
      if (res.ok || res.status >= 500) return { state: "uncertain", error: `Gmail ${res.status}: ${body?.error?.message ?? "server error"}. Check your Sent folder before sending again.` };
      return { state: "failed", error: `Gmail refused it (${res.status}: ${body?.error?.message ?? "refused"})` };
    },
  };
}

const DAYS = { "3d": 3, "1w": 7, "2w": 14 };
const addDays = (now, n) => new Date(now.getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** The resume built for one job (the one you would apply with), from the resume store or the server's resume folder. */
async function jobResume(db, jobUrl, outRoot, store = storeFromEnv()) {
  const job = await db.collection("jobs").findOne({ job_url: String(jobUrl) }, { projection: { resume: 1 } });
  if (job?.resume?.status !== "success") fail("That job's resume is not built yet. Attach your general resume instead.");
  let bytes = null;
  if (job.resume.object && store) bytes = await store.get(resumeKey(resumeRevision(job.resume)));
  else {
    const file = path.resolve(String(job.resume.pdf_path || ""));
    if (path.extname(file).toLowerCase() !== ".pdf" || (outRoot && !file.startsWith(path.resolve(outRoot) + path.sep)) || !fs.existsSync(file)) fail("That job's resume is not on the server. Attach your general resume instead.");
    bytes = fs.readFileSync(file);
  }
  if (!bytes?.length || bytes.length > 5_000_000 || bytes.subarray(0, 5).toString("latin1") !== "%PDF-") fail("That job's resume could not be read. Attach your general resume instead.");
  return bytes;
}

async function attachmentFor(input, outRoot, db) {
  if (input.jobResume) return { fileName: `${(loadResumeProfile().name || "Resume").replace(/[^\w .-]/g, "")}.pdf`, bytes: await jobResume(db, input.jobResume, outRoot) };
  if (input.upload) {
    const name = line(input.upload.name, 120).replace(/[^\w .()-]/g, "_") || "attachment.pdf";
    const bytes = Buffer.from(String(input.upload.base64 ?? ""), "base64");
    if (!bytes.length) fail("That file is empty");
    if (bytes.length > 5_000_000) fail("Attach a PDF under 5 MB");
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") fail("Only PDF files can be attached");
    return { fileName: name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`, bytes };
  }
  if (input.resume) {
    const r = generalResumes(outRoot)[String(input.resume)];
    if (!r) fail("That resume is not on the server any more. Pick another or upload one.");
    const profile = loadResumeProfile();
    return { fileName: `${(profile.name || "Resume").replace(/[^\w .-]/g, "")}.pdf`, bytes: fs.readFileSync(r.path) };
  }
  return null;
}

/** Send one email to one person, then log it in their history (and remember their address if they had none). */
export async function sendNetworkMail(db, input = {}, { sender = gmailSender(), outRoot, now = new Date() } = {}) {
  const person = await db.collection("network_people").findOne({ _id: String(input.personId ?? "") });
  if (!person) fail("That person is no longer in your network. Reload the page.");
  const to = cleanEmail(input.to) ?? fail(`"${line(input.to, 80)}" is not an email address`);
  const subject = line(input.subject, 200); if (!subject) fail("Add a subject");
  const body = text(input.body, 20_000); if (!body) fail("Write the message first");
  const settings = await mailSettings(db, { outRoot });
  if (!settings.fromEmail) fail("Set the address you send from (Sender, at the bottom of the mail window)");
  // The same message to the same address within a minute is a double click or a retry, not a second email.
  const recent = (await db.collection(LOG).find({ personId: person._id, to, subject }).toArray()).find((m) => m.personId === person._id && m.to === to && m.subject === subject && m.state !== "failed" && now.getTime() - Date.parse(m.at) < 60_000);
  if (recent) fail("That email was just sent. Check Sent before sending it again.");
  const attachment = await attachmentFor(input, outRoot, db);
  const result = await sender.send({ from: settings.fromEmail, fromName: settings.fromName, to, subject, body, attachment });
  if (result.state === "failed") fail(result.error);
  const referral = input.referral?.title ? { title: line(input.referral.title, 120), company: line(input.referral.company, 80), url: line(input.referral.url, 500) } : null;
  await db.collection(LOG).insertOne({ _id: crypto.randomUUID(), personId: person._id, to, subject, body, attachment: attachment?.fileName ?? null, referral, state: result.state, messageId: result.messageId ?? null, error: result.error ?? null, at: now.toISOString() });
  const what = referral ? `Asked for a referral: ${referral.title}${referral.company ? ` at ${referral.company}` : ""}` : subject;
  const note = result.state === "sent" ? what : `${what} (Gmail did not confirm it; check Sent before sending again)`;
  let updated = await logHistory(db, { id: person._id, type: "email", text: note, at: now.toISOString() }, now);
  const days = DAYS[input.followUp];
  const patch = { ...(days ? { nextFollowUp: addDays(now, days) } : {}), ...(!person.email ? { email: to } : {}) };
  if (Object.keys(patch).length) updated = await savePerson(db, { id: person._id, ...patch }, now);
  return { state: result.state, person: updated, ...(result.state === "uncertain" ? { warning: result.error } : {}) };
}

/* ---------- Draft with AI: written from their record, through the same AI worker as application answers ---------- */
export const DRAFT_SCHEMA = { type: "object", additionalProperties: false, required: ["subject", "body"], properties: { subject: { type: "string", maxLength: 120 }, body: { type: "string", maxLength: 3000 } } };
const TONES = { friendly: "warm and friendly, like a message to someone you know", short: "short: four sentences at most", formal: "polite and formal" };

export function draftRequest({ person, source, via, settings, tone = "friendly", intent = "", job = null }) {
  const recent = (person.history ?? []).slice(-6).map((h) => `${h.at.slice(0, 10)} ${h.type}${h.text ? `: ${h.text}` : ""}`).join("\n") || "(nothing yet)";
  return {
    purpose: "network-email",
    schema: DRAFT_SCHEMA,
    system: [
      "You write one short email from a job seeker to someone in their network. Return only the schema: a subject line and the plain-text body.",
      `Tone: ${TONES[tone] ?? TONES.friendly}. Write in first person as the sender. No markdown, no placeholders in brackets, no em dashes.`,
      "Use only facts given here. Never invent shared history, companies, roles or numbers. Never mention a product or platform called Atriveo.",
      "Greet the person by first name. End with the sender's signature exactly as given, on its own lines.",
    ].join("\n"),
    user: [
      `Sender: ${settings.fromName || "the sender"}`,
      `About the sender: ${settings.about || "(not given; keep claims about the sender general)"}`,
      `Signature:\n${settings.signature || settings.fromName || ""}`,
      `Recipient: ${person.name}${person.role ? `, ${person.role}` : ""}${person.city ? `, ${person.city}` : ""}`,
      `Where they come from: ${source ? `${source.name} (${source.type}${source.about ? `, ${source.about}` : ""})` : "not set"}`,
      via ? `Introduced by: ${via.name}` : "",
      `Notes about them: ${person.notes || "(none)"}`,
      `What happened so far:\n${recent}`,
      `What this email is for: ${intent || "stay in touch and ask whether they know of roles that fit"}`,
      job ? `The job: ${job.title} at ${job.company}${job.location ? ` (${job.location})` : ""}. Link: ${job.url}. Ask whether they would refer you or pass your resume to the hiring team, and include the link.` : "",
    ].filter(Boolean).join("\n"),
  };
}

/** Start a draft in the background and return its id at once; the page asks for the result (a model can take a minute). */
export async function startDraft(db, input = {}, { generate, now = new Date() } = {}) {
  const person = await db.collection("network_people").findOne({ _id: String(input.personId ?? "") });
  if (!person) fail("That person is no longer in your network. Reload the page.");
  const [source, via, settings] = await Promise.all([
    person.sourceId ? db.collection("network_sources").findOne({ _id: person.sourceId }) : null,
    person.via ? db.collection("network_people").findOne({ _id: person.via }) : null,
    db.collection("app_settings").findOne({ _id: SETTINGS }),
  ]);
  const profile = loadResumeProfile();
  const job = input.job?.title ? { title: line(input.job.title, 120), company: line(input.job.company, 80), location: line(input.job.location, 80), url: line(input.job.url, 500) } : null;
  const request = draftRequest({ person, source, via, settings: { fromName: settings?.fromName || profile.name || "", about: settings?.about || "", signature: settings?.signature ?? (profile.name || "") }, tone: input.tone, intent: line(input.intent, 300), job });
  const id = crypto.randomUUID();
  await db.collection(DRAFTS).insertOne({ _id: id, personId: person._id, status: "writing", createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000) });
  void Promise.resolve().then(() => generate(request)).then(
    (r) => db.collection(DRAFTS).updateOne({ _id: id }, { $set: { status: "done", subject: line(r?.subject, 120), body: text(r?.body, 3000).replace(/\s*[\u2014\u2013]\s*/g, ", ") } }),
    (e) => db.collection(DRAFTS).updateOne({ _id: id }, { $set: { status: "failed", error: String(e?.message || e).slice(0, 300) } }),
  ).catch(() => {});
  return { id };
}

export async function draftStatus(db, id) {
  const d = await db.collection(DRAFTS).findOne({ _id: String(id ?? "") });
  if (!d) fail("That draft has expired. Ask for a new one.");
  return { status: d.status, subject: d.subject ?? "", body: d.body ?? "", error: d.error ?? "" };
}
