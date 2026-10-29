import { randomUUID } from "node:crypto";
import { cleanEmail } from "./resume-emails.mjs";

// Network: the people around your job search, the places they come from (a company, an event, family) and how they connect.
// Three Mongo collections: network_people, network_sources, network_links. A person belongs to one source (sourceId) and may have
// been introduced by another person (via); other connections are explicit links. Archived people are kept, never deleted.

const PEOPLE = "network_people", SOURCES = "network_sources", LINKS = "network_links";
export const SOURCE_TYPES = ["company", "staffing", "event", "family", "linkedin", "day", "oa", "other"];
export const LINK_KINDS = ["works", "family", "intro", "other"];
export const HISTORY_TYPES = ["note", "email", "message", "call", "met", "reply"];
const CONTACT = new Set(["email", "message", "call", "met"]);
const MAX_LIST = 500, MAX_HISTORY = 200, MAX_TAGS = 12;

export class NetworkError extends Error {}
const fail = (m) => { throw new NetworkError(m); };
const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const text = (v, max) => String(v ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);
const color = (v) => (v == null || v === "" ? null : /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toLowerCase() : fail("A colour looks like #3366ff"));
const day = (v) => (v == null || v === "" ? null : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(String(v))) ? String(v) : fail("Use a date like 2026-11-04"));
const link = (v) => { const s = str(v, 300); if (!s) return ""; let u; try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { fail("That LinkedIn address is not a link"); } if (u.protocol !== "https:" && u.protocol !== "http:") fail("That LinkedIn address is not a link"); return u.href; };
const key = (name) => str(name, 80).toLowerCase();
const out = ({ _id, ...doc }) => ({ id: _id, ...doc });

/** One person per line. Leading bullets and numbers go; anything after " - " (or a tab) is the city. Duplicates in the list are marked. */
export function parseList(input) {
  const seen = new Set(), rows = [];
  for (const raw of String(input ?? "").split(/\n/)) {
    const line = raw.replace(/^[\s•·*\-–—]*(\d+[.)]\s*)?/, "").trim();
    if (!line || line.length > 200 || !/\p{L}/u.test(line)) continue;
    const [first, ...rest] = line.split(/\t|\s+[-–—|]\s+/);
    const name = str(first, 80);
    if (!/\p{L}/u.test(name)) continue;
    const k = name.toLowerCase();
    rows.push({ name, city: str(rest.join(", "), 80), repeat: seen.has(k) });
    seen.add(k);
    if (rows.length >= MAX_LIST) break;
  }
  return rows;
}

async function all(db, name) { return (await db.collection(name).find({}).toArray()).map(out); }

/** Everything the page shows: people (archived ones left out unless asked), sources, links, and where "You" sits on the canvas. */
export async function networkView(db, { archived = false } = {}) {
  const [people, sources, links, you] = await Promise.all([all(db, PEOPLE), all(db, SOURCES), all(db, LINKS), db.collection("app_settings").findOne({ _id: YOU })]);
  return {
    people: withFollowUps(people.filter((p) => archived || !p.archived), sources).sort((a, b) => a.name.localeCompare(b.name)),
    sources: sources.sort((a, b) => a.name.localeCompare(b.name)),
    links,
    you: { x: you?.x ?? 0, y: you?.y ?? 0, name: you?.name ?? "", title: you?.title ?? "", photoId: you?.photoId ?? null, note: you?.note ?? "" },
  };
}

/**
 * Follow-ups are on by default, every week, for everyone but family: due 7 days after you last reached them (or after they were
 * added, if you never have). Someone reached through LinkedIn is first due 3 days after being added. A date you set yourself always
 * wins, and switching follow-ups off for a person (their plan's "No follow-up") stops it. Worked out each time, never stored.
 */
export function autoFollowUp(p, sources) {
  if (p.archived || p.followUpPlan?.enabled === false || p.nextFollowUp) return null;
  const byId = new Map(sources.map((s) => [s.id ?? s._id, s]));
  let family = false, linkedin = false;
  for (let s = byId.get(p.sourceId), n = 0; s && n < 8; s = s.parentSourceId ? byId.get(s.parentSourceId) : null, n++) {
    if (s.type === "family") family = true;
    if (s.type === "linkedin" || (!s.parentSourceId && /^linkedin\b/i.test(s.name))) linkedin = true;
  }
  const base = p.lastContact || p.createdAt;
  if (family || !base || Number.isNaN(Date.parse(base))) return null;
  return dayOf(Date.parse(base) + (!p.lastContact && linkedin ? 3 : 7) * 86_400_000);
}

/** People with their automatic follow-up filled in (followUpAuto marks it as not set by hand). */
export const withFollowUps = (people, sources) => people.map((p) => { const d = autoFollowUp(p, sources); return d ? { ...p, nextFollowUp: d, followUpAuto: true } : p; });

const YOU = "network_you";
const coord = (v) => { const n = Number(v); if (!Number.isFinite(n)) fail("A position must be a number"); return Math.round(Math.max(-100000, Math.min(100000, n)) * 10) / 10; };

/** Where cards sit on the canvas, saved after a drag: people, sources, or "you". Unknown ids are ignored (someone may have archived them). */
/** "You" on the map: your name, a title ("Data engineer, open to roles in NYC"), a photo and a note. Only the fields sent change. */
export async function saveYou(db, input = {}) {
  const set = {};
  if ("name" in input) set.name = str(input.name, 80);
  if ("title" in input) set.title = str(input.title, 120);
  if ("note" in input) set.note = text(input.note, 2000);
  if ("photoId" in input) {
    set.photoId = input.photoId ? String(input.photoId) : null;
    if (set.photoId && !(await db.collection("network_images").findOne({ _id: set.photoId }))) fail("Upload the photo first");
  }
  const cur = await db.collection("app_settings").findOne({ _id: YOU });
  await db.collection("app_settings").updateOne({ _id: YOU }, { $set: { ...set, updatedAt: new Date().toISOString() } }, { upsert: true });
  if ("photoId" in set && cur?.photoId && cur.photoId !== set.photoId) await db.collection("network_images").deleteOne({ _id: cur.photoId });
  const next = { ...cur, ...set };
  return { x: next.x ?? 0, y: next.y ?? 0, name: next.name ?? "", title: next.title ?? "", photoId: next.photoId ?? null, note: next.note ?? "" };
}

export async function savePositions(db, { items } = {}) {
  if (!Array.isArray(items) || !items.length) fail("Nothing to save");
  if (items.length > 2000) fail("Too many positions at once");
  let saved = 0;
  for (const it of items) {
    const id = String(it?.id ?? ""), set = { x: coord(it?.x), y: coord(it?.y) };
    if (id === "you") { await db.collection("app_settings").updateOne({ _id: YOU }, { $set: set }, { upsert: true }); saved++; continue; }
    for (const name of [PEOPLE, SOURCES]) if (await db.collection(name).findOne({ _id: id })) { await db.collection(name).updateOne({ _id: id }, { $set: set }); saved++; break; }
  }
  return { saved };
}

/** Rows from a pasted list, marked when the name is already in your network (or repeated in the list). */
export async function previewList(db, input) {
  const have = new Set((await all(db, PEOPLE)).filter((p) => !p.archived).map((p) => key(p.name)));
  return parseList(input).map((r) => ({ ...r, exists: have.has(r.name.toLowerCase()) }));
}

async function sourceFor(db, { sourceId, newSource }, now) {
  if (sourceId) { if (!(await db.collection(SOURCES).findOne({ _id: String(sourceId) }))) fail("That source no longer exists. Reload and pick again."); return String(sourceId); }
  if (newSource?.name) return (await saveSource(db, newSource, now)).id;
  return null;
}

/** Split CSV text into rows of cells: quoted cells may hold commas, quotes ("") and line breaks. */
export function csvRows(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  const s = String(text ?? "").replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; continue; }
    if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * People from a contacts file: LinkedIn's Connections.csv (First Name, Last Name, URL, Email Address, Company, Position) or a Google
 * Contacts export (First/Last Name or Name, E-mail 1 - Value, Phone 1 - Value, Organization Name / Organization 1 - Name and Title).
 * LinkedIn puts a few lines of notes above its header; the header is found wherever it is.
 */
export function parseContacts(text) {
  const rows = csvRows(text);
  const at = rows.findIndex((r) => r.some((c) => /^(first name|given name|name)$/i.test(c.trim())));
  if (at < 0) fail("That file has no name column. Use LinkedIn's Connections.csv or a Google Contacts export (CSV).");
  const head = rows[at].map((c) => c.trim().toLowerCase());
  const col = (...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const format = head.includes("connected on") || head.includes("position") ? "linkedin" : "google";
  const c = { first: col("first name", "given name"), last: col("last name", "family name"), name: col("name"), email: col("email address", "e-mail 1 - value", "email 1 - value", "e-mail address"),
    phone: col("phone 1 - value", "phone"), company: col("company", "organization name", "organization 1 - name"), role: col("position", "organization title", "organization 1 - title"), url: col("url", "website 1 - value"), city: col("address 1 - city", "location") };
  const get = (r, i) => (i >= 0 ? String(r[i] ?? "").trim() : "");
  const out = [], seen = new Set();
  for (const r of rows.slice(at + 1)) {
    const name = str(get(r, c.name) || [get(r, c.first), get(r, c.last)].filter(Boolean).join(" "), 80);
    if (!name || !/\p{L}/u.test(name)) continue;
    const email = cleanEmail(get(r, c.email)) ?? "", key = `${name.toLowerCase()}|${email}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const url = get(r, c.url);
    out.push({ name, email, phone: str(get(r, c.phone), 40), company: str(get(r, c.company), 80), role: str(get(r, c.role), 80), city: str(get(r, c.city), 80), linkedin: /linkedin\.com\//i.test(url) ? url : "" });
    if (out.length >= 5000) break;
  }
  return { format, rows: out };
}

/** A contacts file, previewed: each row marked when the person is already in your network (same name or same email). */
export async function previewContacts(db, text) {
  const { format, rows } = parseContacts(text);
  const people = (await all(db, PEOPLE)).filter((p) => !p.archived);
  const names = new Set(people.map((p) => key(p.name))), emails = new Set(people.map((p) => p.email).filter(Boolean));
  return { format, rows: rows.map((r) => ({ ...r, exists: names.has(r.name.toLowerCase()) || Boolean(r.email && emails.has(r.email)) })) };
}

/** Bulk add from a pasted list: new names become people in one source; names already in your network are skipped and reported. */
export async function addPeople(db, { rows, sourceId, newSource } = {}, now = new Date()) {
  if (!Array.isArray(rows) || !rows.length) fail("Paste at least one name");
  if (rows.length > MAX_LIST) fail(`Add up to ${MAX_LIST} people at a time`);
  const src = await sourceFor(db, { sourceId, newSource }, now);
  const current = (await all(db, PEOPLE)).filter((p) => !p.archived);
  const have = new Set(current.map((p) => key(p.name))), mails = new Set(current.map((p) => p.email).filter(Boolean));
  const docs = [], skipped = [];
  for (const r of rows) {
    const name = str(r?.name, 80); if (!name) continue;
    const email = cleanEmail(r?.email) ?? "";
    if (have.has(name.toLowerCase()) || (email && mails.has(email))) { skipped.push(name); continue; }
    have.add(name.toLowerCase()); if (email) mails.add(email);
    // A contacts file brings more than a name; anything that does not check out is simply left empty.
    let linkedin = ""; try { linkedin = r?.linkedin ? link(r.linkedin) : ""; } catch { linkedin = ""; }
    docs.push(blank({ name, city: str(r?.city, 80), sourceId: src, email, linkedin, company: str(r?.company, 80), role: str(r?.role, 80), phone: str(r?.phone, 40) }, now));
  }
  if (docs.length) await db.collection(PEOPLE).insertMany(docs);
  return { added: docs.map(out), skipped, sourceId: src };
}

function blank(fields, now) {
  const at = now.toISOString();
  return { _id: randomUUID(), name: "", role: "", city: "", company: "", email: "", linkedin: "", phone: "", notes: "", sourceId: null, via: null, alsoVia: [], color: null, photoId: null, watchJobs: false, tags: [],
    lastContact: null, nextFollowUp: null, history: [], archived: false, createdAt: at, updatedAt: at, ...fields };
}

async function checkPersonRefs(db, id, { sourceId, via, photoId }) {
  if (sourceId && !(await db.collection(SOURCES).findOne({ _id: sourceId }))) fail("That source no longer exists");
  if (sourceId) {
    // Someone who introduced a source (or a source above it) cannot also belong to it: that would make a loop back to themselves.
    const sources = await all(db, SOURCES);
    for (let s = sources.find((x) => x.id === sourceId), seen = new Set(); s && !seen.has(s.id); seen.add(s.id), s = s.parentSourceId ? sources.find((x) => x.id === s.parentSourceId) : null)
      if (s.viaPersonId === id) fail(`They introduced ${s.name}, so they cannot belong to it. Keep their own source and set "Works at" instead.`);
  }
  if (photoId && !(await db.collection("network_images").findOne({ _id: photoId }))) fail("Upload the photo first");
  if (via) { if (via === id) fail("Someone cannot introduce themselves"); if (!(await db.collection(PEOPLE).findOne({ _id: via }))) fail("The person who introduced them is not in your network"); }
}

function personPatch(input) {
  const p = {};
  if ("name" in input) { p.name = str(input.name, 80); if (!p.name) fail("A person needs a name"); }
  for (const [k, max] of [["role", 80], ["city", 80], ["phone", 40]]) if (k in input) p[k] = str(input[k], max);
  if ("email" in input) { const raw = str(input.email, 120); p.email = raw ? cleanEmail(raw) ?? fail(`"${raw}" is not an email address`) : ""; }
  if ("linkedin" in input) p.linkedin = link(input.linkedin);
  if ("notes" in input) p.notes = text(input.notes, 4000);
  if ("sourceId" in input) p.sourceId = input.sourceId ? String(input.sourceId) : null;
  if ("via" in input) p.via = input.via ? String(input.via) : null;
  // More than one person can have introduced someone: the first is "via" (it decides their colour and place), the rest are kept here.
  if ("alsoVia" in input) p.alsoVia = [...new Set((Array.isArray(input.alsoVia) ? input.alsoVia : []).map((x) => String(x ?? "")).filter(Boolean))].slice(0, 12);
  if ("color" in input) p.color = color(input.color);
  if ("nextFollowUp" in input) p.nextFollowUp = day(input.nextFollowUp);
  if ("photoId" in input) p.photoId = input.photoId ? String(input.photoId) : null;
  if ("company" in input) p.company = str(input.company, 80);
  if ("watchJobs" in input) p.watchJobs = Boolean(input.watchJobs);
  if ("tags" in input) p.tags = [...new Set((Array.isArray(input.tags) ? input.tags : []).map((t) => str(t, 30)).filter(Boolean))].slice(0, MAX_TAGS);
  return p;
}

/** Create a person (no id) or change one (id): only the fields you send change. */
export async function savePerson(db, input = {}, now = new Date()) {
  const patch = personPatch(input);
  if (!input.id) {
    if (!patch.name) fail("A person needs a name");
    const doc = blank(patch, now);
    await checkPersonRefs(db, doc._id, doc);
    await db.collection(PEOPLE).insertOne(doc);
    return out(doc);
  }
  const id = String(input.id), cur = await db.collection(PEOPLE).findOne({ _id: id });
  if (!cur) fail("That person is no longer in your network. Reload the page.");
  const vias = patch.alsoVia ?? cur.alsoVia ?? [], first = "via" in patch ? patch.via : cur.via;
  if (!first && vias.length) { patch.via = vias[0]; patch.alsoVia = vias.slice(1); }
  else if (first && vias.includes(first)) patch.alsoVia = vias.filter((x) => x !== first);
  for (const other of patch.alsoVia ?? []) await checkPersonRefs(db, id, { via: other });
  await checkPersonRefs(db, id, { sourceId: patch.sourceId, via: patch.via, photoId: patch.photoId });
  const next = { ...patch, updatedAt: now.toISOString() };
  await db.collection(PEOPLE).updateOne({ _id: id }, { $set: next });
  // A replaced or removed photo's bytes go with it.
  if ("photoId" in patch && cur.photoId && cur.photoId !== patch.photoId) await db.collection("network_images").deleteOne({ _id: cur.photoId });
  return out({ ...cur, ...next });
}

export const FOLLOW_UP_PLATFORMS = ["linkedin", "email", "whatsapp", "phone", "in-person", "other"];

/** Save the next step and, optionally, the previous attempt together in one database update. */
export async function saveFollowUp(db, input = {}, now = new Date()) {
  const cur = await db.collection(PEOPLE).findOne({ _id: String(input.id) });
  if (!cur) fail("That person is no longer in your network. Reload the page.");
  const plan = input.plan;
  if (!plan || typeof plan.enabled !== "boolean") fail("Choose whether a follow-up is needed");
  if (!FOLLOW_UP_PLATFORMS.includes(plan.platform)) fail("Choose a follow-up platform");
  const followUpPlan = { enabled: plan.enabled, platform: plan.platform, regarding: str(plan.regarding, 240), nextNotes: text(plan.nextNotes, 2000) };
  const nextFollowUp = plan.enabled ? day(input.nextFollowUp) : null;
  if (nextFollowUp && new Date(nextFollowUp).toISOString().slice(0, 10) !== nextFollowUp) fail("Choose a valid follow-up date");
  if (plan.enabled && (!nextFollowUp || !followUpPlan.regarding)) fail("Add a topic and date for the next follow-up");
  const set = { followUpPlan, nextFollowUp, updatedAt: now.toISOString() };
  if (input.outcome) {
    if (typeof input.outcome.completed !== "boolean") fail("Did you follow up? Choose yes or no");
    const previous = cur.followUpPlan || followUpPlan;
    const platform = previous.platform || followUpPlan.platform;
    const completed = input.outcome.completed;
    const type = completed ? (platform === "email" ? "email" : platform === "phone" ? "call" : platform === "in-person" ? "met" : "message") : "note";
    const entry = { id: randomUUID(), at: now.toISOString(), type, text: text(input.outcome.notes, 2000), followUp: { completed, platform, regarding: previous.regarding || followUpPlan.regarding, nextNotes: followUpPlan.nextNotes, nextFollowUp } };
    set.history = [...(cur.history || []), entry].sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX_HISTORY);
    if (completed && (!cur.lastContact || now.toISOString() > cur.lastContact)) set.lastContact = now.toISOString();
  }
  await db.collection(PEOPLE).updateOne({ _id: cur._id }, { $set: set });
  return out({ ...cur, ...set });
}

/** Add something that happened (a note, an email, a call...). Contact of any kind moves "last contact" forward. */
export async function logHistory(db, { id, type, text: body, at } = {}, now = new Date()) {
  if (!HISTORY_TYPES.includes(type)) fail("Pick what happened: note, email, message, call, met or reply");
  const cur = await db.collection(PEOPLE).findOne({ _id: String(id) });
  if (!cur) fail("That person is no longer in your network. Reload the page.");
  const when = at ? (Number.isNaN(Date.parse(at)) ? fail("That date is not valid") : new Date(at).toISOString()) : now.toISOString();
  const entry = { id: randomUUID(), at: when, type, text: text(body, 2000) };
  if (!entry.text && type === "note") fail("Write the note first");
  const history = [...(cur.history ?? []), entry].sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX_HISTORY);
  const set = { history, updatedAt: now.toISOString() };
  if (CONTACT.has(type) && (!cur.lastContact || when > cur.lastContact)) set.lastContact = when;
  await db.collection(PEOPLE).updateOne({ _id: cur._id }, { $set: set });
  return out({ ...cur, ...set });
}

export async function removeHistory(db, { id, entryId } = {}, now = new Date()) {
  const cur = await db.collection(PEOPLE).findOne({ _id: String(id) });
  if (!cur) fail("That person is no longer in your network. Reload the page.");
  const history = (cur.history ?? []).filter((h) => h.id !== entryId);
  const lastContact = history.filter((h) => CONTACT.has(h.type)).map((h) => h.at).sort().pop() ?? null;
  const set = { history, lastContact, updatedAt: now.toISOString() };
  await db.collection(PEOPLE).updateOne({ _id: cur._id }, { $set: set });
  return out({ ...cur, ...set });
}

/** Archive hides a person everywhere; restore brings them back with everything they had. */
export async function archivePerson(db, { id, archived = true } = {}, now = new Date()) {
  const cur = await db.collection(PEOPLE).findOne({ _id: String(id) });
  if (!cur) fail("That person is no longer in your network. Reload the page.");
  await db.collection(PEOPLE).updateOne({ _id: cur._id }, { $set: { archived: Boolean(archived), updatedAt: now.toISOString() } });
  return { id: cur._id, archived: Boolean(archived) };
}

/**
 * The source a person belongs to, then whatever brought that source to you (a parent source, or the person who introduced it), and so
 * on: every source on the way from this person back to you. Used to refuse loops.
 */
function upstreamSources(personId, people, sources) {
  const seen = new Set();
  let sid = people.find((p) => p.id === personId)?.sourceId ?? null;
  while (sid && !seen.has(sid)) {
    seen.add(sid);
    const s = sources.find((x) => x.id === sid);
    if (!s) break;
    sid = s.parentSourceId || (s.viaPersonId ? people.find((p) => p.id === s.viaPersonId)?.sourceId ?? null : null);
  }
  return seen;
}

/**
 * Sources are distinct by name + what brought them (a parent source or the person who introduced them) + context, not employer name
 * alone: NKHS introduced by Chani is a different record from NKHS you found yourself. A source comes through a source or a person, not both.
 */
export async function saveSource(db, input = {}, now = new Date()) {
  const sources = await all(db, SOURCES);
  const cur = input.id ? sources.find((s) => s.id === String(input.id)) : null;
  if (input.id && !cur) fail("That source no longer exists. Reload the page.");
  const patch = {};
  if ("name" in input || !cur) { patch.name = str(input.name, 80); if (!patch.name) fail("Give the source a name"); }
  if ("type" in input || !cur) patch.type = SOURCE_TYPES.includes(input.type) ? input.type : "other";
  if ("about" in input) patch.about = str(input.about, 120);
  // Any kind you like ("Discord community", "Hackathon"): shown instead of the kind's own name; the kind itself stays "other".
  if ("kindName" in input) patch.kindName = str(input.kindName, 30);
  if ("color" in input) patch.color = color(input.color);
  if ("notes" in input) patch.notes = text(input.notes, 4000);
  // Shown on the card: where it is ("Raleigh, NC", "Global") and, for an event, when ("Oct 2024").
  if ("place" in input) patch.place = str(input.place, 60);
  if ("when" in input) patch.when = str(input.when, 30);
  if ("photoId" in input) {
    patch.photoId = input.photoId ? String(input.photoId) : null;
    if (patch.photoId && !(await db.collection("network_images").findOne({ _id: patch.photoId }))) fail("Upload the picture first");
  }
  if ("context" in input || !cur) patch.context = str(input.context, 100);
  if ("parentSourceId" in input || !cur) patch.parentSourceId = input.parentSourceId ? str(input.parentSourceId, 80) : null;
  if ("viaPersonId" in input || !cur) patch.viaPersonId = input.viaPersonId ? str(input.viaPersonId, 80) : null;
  if (patch.viaPersonId) patch.parentSourceId = null;
  else if (patch.parentSourceId) patch.viaPersonId = null;
  // When it reached you that way ("2024"), and anyone or anything else that also brought it to you later, each with its own year.
  const year = (v) => { const s = str(v, 4); if (s && !/^(19|20)\d\d$/.test(s)) fail("Give the year as four digits, like 2024"); return s; };
  if ("introYear" in input) patch.introYear = year(input.introYear);
  if ("alsoVia" in input) {
    const people = await all(db, PEOPLE), seen = new Set();
    patch.alsoVia = [];
    for (const raw of (Array.isArray(input.alsoVia) ? input.alsoVia : []).slice(0, 12)) {
      const id = str(raw?.id, 80);
      if (!id || seen.has(id)) continue;
      if (id === cur?.id) fail("A source cannot introduce itself");
      if (!people.some((p) => p.id === id) && !sources.some((s) => s.id === id)) fail("One of those who also introduced it is no longer in your network. Reload the page.");
      seen.add(id); patch.alsoVia.push({ id, year: year(raw?.year) });
    }
  }
  const next = { ...cur, ...patch };
  // The main introducer is not listed again as an extra one.
  if (next.alsoVia?.length && (next.viaPersonId || next.parentSourceId)) { const main = next.viaPersonId || next.parentSourceId; if (next.alsoVia.some((v) => v.id === main)) patch.alsoVia = next.alsoVia = next.alsoVia.filter((v) => v.id !== main); }
  if (next.viaPersonId) {
    const people = (await all(db, PEOPLE)).filter((p) => !p.archived);
    const who = people.find((p) => p.id === next.viaPersonId);
    if (!who) fail("The person who introduced it is not in your network. Pick someone else.");
    if (cur && upstreamSources(who.id, people, sources).has(cur.id)) fail(`${who.name} belongs to ${cur.name}, so they cannot be the one who introduced it. Put them in their own source and set "Works at".`);
  }
  if (next.parentSourceId) {
    let parent = sources.find((s) => s.id === next.parentSourceId);
    if (!parent) fail("The parent source no longer exists. Pick another source.");
    const visited = new Set(cur ? [cur.id] : []);
    while (parent) {
      if (visited.has(parent.id)) fail("A source cannot be introduced through itself or its descendants.");
      visited.add(parent.id);
      parent = parent.parentSourceId ? sources.find((s) => s.id === parent.parentSourceId) : null;
    }
  }
  const sameIdentity = (a, b) => key(a.name) === key(b.name) && (a.parentSourceId || null) === (b.parentSourceId || null) && (a.viaPersonId || null) === (b.viaPersonId || null) && str(a.context, 100).toLowerCase() === str(b.context, 100).toLowerCase();
  const clash = sources.find((s) => s.id !== cur?.id && sameIdentity(s, next));
  if (!cur) {
    if (clash) return { ...clash, existed: true };
    const at = now.toISOString(), doc = { _id: randomUUID(), about: "", color: null, createdAt: at, updatedAt: at, ...patch };
    await db.collection(SOURCES).insertOne(doc);
    return out(doc);
  }
  if (clash && !sameIdentity(cur, next)) fail(`You already have a source called ${clash.name} in that context. Choose a different context.`);
  const update = { ...patch, updatedAt: now.toISOString() };
  await db.collection(SOURCES).updateOne({ _id: cur.id }, { $set: update });
  // A replaced or removed logo's bytes go with it.
  if ("photoId" in patch && cur.photoId && cur.photoId !== patch.photoId) await db.collection("network_images").deleteOne({ _id: cur.photoId });
  return { ...cur, ...update };
}

/** Remove a source; its people stay and simply have no source. */
export async function removeSource(db, { id } = {}, now = new Date()) {
  const sid = String(id);
  if (!(await db.collection(SOURCES).findOne({ _id: sid }))) fail("That source no longer exists. Reload the page.");
  // Child contexts remain separate records if their parent is removed. (A source introduced by a person keeps that person.)
  const removed = await db.collection(SOURCES).findOne({ _id: sid });
  for (const child of (await all(db, SOURCES)).filter((s) => s.parentSourceId === sid)) await db.collection(SOURCES).updateOne({ _id: child.id }, { $set: { parentSourceId: null, context: child.context || `Via ${removed.name}`, updatedAt: now.toISOString() } });
  const people = (await all(db, PEOPLE)).filter((p) => p.sourceId === sid);
  for (const p of people) await db.collection(PEOPLE).updateOne({ _id: p.id }, { $set: { sourceId: null, updatedAt: now.toISOString() } });
  for (const l of (await all(db, LINKS)).filter((l) => l.a === sid || l.b === sid)) await db.collection(LINKS).deleteOne({ _id: l.id });
  await db.collection(SOURCES).deleteOne({ _id: sid });
  return { id: sid, released: people.length };
}

async function exists(db, id) { return Boolean((await db.collection(PEOPLE).findOne({ _id: id })) || (await db.collection(SOURCES).findOne({ _id: id }))); }

/** Connect two people (or a person and a source). One link per pair: saving the same pair again changes it. */
export async function saveLink(db, input = {}, now = new Date()) {
  const kind = LINK_KINDS.includes(input.kind) ? input.kind : "other";
  const label = str(input.label, 60), c = color(input.color);
  if (input.id) {
    const cur = await db.collection(LINKS).findOne({ _id: String(input.id) });
    if (!cur) fail("That connection no longer exists. Reload the page.");
    const next = { kind, label, color: c, updatedAt: now.toISOString() };
    await db.collection(LINKS).updateOne({ _id: cur._id }, { $set: next });
    return out({ ...cur, ...next });
  }
  const a = String(input.a ?? ""), b = String(input.b ?? "");
  if (!a || !b || a === b) fail("Pick two different people to connect");
  if (!(await exists(db, a)) || !(await exists(db, b))) fail("One of them is no longer in your network. Reload the page.");
  const same = (await all(db, LINKS)).find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
  if (same) return saveLink(db, { id: same.id, kind, label, color: input.color }, now);
  const at = now.toISOString(), doc = { _id: randomUUID(), a, b, kind, label, color: c, createdAt: at, updatedAt: at };
  await db.collection(LINKS).insertOne(doc);
  return out(doc);
}

export async function removeLink(db, { id } = {}) {
  const r = await db.collection(LINKS).deleteOne({ _id: String(id) });
  if (!r?.deletedCount) fail("That connection no longer exists. Reload the page.");
  return { id: String(id) };
}

// LinkedIn reach-outs are sorted by day: You, then LinkedIn, then a card for each day ("Oct 28, 2026"), then the people you reached that
// day. Days follow New York time, like the rest of the app's dates.
const DAY_TZ = "America/New_York";
const dayOf = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: DAY_TZ });
const dayName = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The LinkedIn source (made once). */
async function linkedinRoot(db, now) {
  const sources = (await all(db, SOURCES)).filter((s) => !s.parentSourceId && !s.viaPersonId).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return sources.find((s) => s.type === "linkedin") ?? sources.find((s) => /^linkedin$/i.test(s.name)) ?? saveSource(db, { name: "LinkedIn", type: "linkedin" }, now);
}

/** The card for one day's LinkedIn reach-outs under LinkedIn, made the first time it is needed and the same one after that. */
export async function linkedinDay(db, now = new Date(), day = dayOf(now), rootId = null) {
  const root = rootId ? (await all(db, SOURCES)).find((s) => s.id === String(rootId)) ?? fail("That source no longer exists. Reload the page.") : await linkedinRoot(db, now);
  return saveSource(db, { name: dayName(day), type: "day", parentSourceId: root.id, about: "LinkedIn reach-outs", when: day }, now);
}

/**
 * People sitting straight on the LinkedIn card (added before day cards existed, or put there by hand) move to the card for the day
 * they were added. Their own details do not change. Returns how many moved and into how many days.
 */
export async function sortLinkedInByDay(db, now = new Date(), rootId = null) {
  const root = rootId ? (await all(db, SOURCES)).find((s) => s.id === String(rootId)) ?? fail("That source no longer exists. Reload the page.") : await linkedinRoot(db, now);
  const people = (await all(db, PEOPLE)).filter((p) => p.sourceId === root.id && !p.via);
  const days = new Map();
  for (const p of people) { const d = dayOf(p.createdAt || now); days.set(d, [...(days.get(d) ?? []), p]); }
  for (const [d, list] of days) {
    const card = await linkedinDay(db, now, d, root.id);
    for (const p of list) await db.collection(PEOPLE).updateOne({ _id: p.id }, { $set: { sourceId: card.id, updatedAt: now.toISOString() } });
  }
  return { moved: people.length, days: days.size };
}

/**
 * One person from their LinkedIn profile (the extension's toolbar button): found again by their profile link or name, else added to
 * today's card under LinkedIn with their headline, company and city. Returns the person and whether they were already here.
 */
export async function addFromLinkedIn(db, input = {}, now = new Date()) {
  const name = str(input.name, 80);
  if (!name || !/\p{L}/u.test(name)) fail("No name on that LinkedIn page. Open a person's profile and click again.");
  let profile = "";
  try { profile = link(input.linkedin); } catch { profile = ""; }
  if (!/^https:\/\/([a-z]+\.)?linkedin\.com\/in\/[^/?#]+/i.test(profile)) fail("That is not a LinkedIn profile link");
  profile = profile.replace(/^https:\/\/([a-z]+\.)?linkedin\.com\/in\/([^/?#]+).*$/i, "https://www.linkedin.com/in/$2/");
  const people = (await all(db, PEOPLE)).filter((p) => !p.archived);
  const slug = (u) => String(u || "").toLowerCase().replace(/^https:\/\/([a-z]+\.)?linkedin\.com\/in\//, "").replace(/\/.*$/, "");
  const same = people.find((p) => p.linkedin && slug(p.linkedin) === slug(profile)) ?? people.find((p) => key(p.name) === key(name));
  if (same) {
    const fill = {};
    for (const [k, v] of [["linkedin", profile], ["role", str(input.role, 80)], ["company", str(input.company, 80)], ["city", str(input.city, 80)]]) if (v && !same[k]) fill[k] = v;
    return { person: Object.keys(fill).length ? await savePerson(db, { id: same.id, ...fill }, now) : same, existed: true };
  }
  const source = await linkedinDay(db, now);
  const person = await savePerson(db, { name, role: str(input.role, 80), company: str(input.company, 80), city: str(input.city, 80), linkedin: profile, sourceId: source.id }, now);
  return { person: await logHistory(db, { id: person.id, type: "note", text: "Added from LinkedIn" }, now), existed: false };
}
