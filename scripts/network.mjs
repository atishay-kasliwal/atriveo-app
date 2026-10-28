import { randomUUID } from "node:crypto";
import { cleanEmail } from "./resume-emails.mjs";

// Network: the people around your job search, the places they come from (a company, an event, family) and how they connect.
// Three Mongo collections: network_people, network_sources, network_links. A person belongs to one source (sourceId) and may have
// been introduced by another person (via); other connections are explicit links. Archived people are kept, never deleted.

const PEOPLE = "network_people", SOURCES = "network_sources", LINKS = "network_links";
export const SOURCE_TYPES = ["company", "event", "family", "other"];
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
    people: people.filter((p) => archived || !p.archived).sort((a, b) => a.name.localeCompare(b.name)),
    sources: sources.sort((a, b) => a.name.localeCompare(b.name)),
    links,
    you: { x: you?.x ?? 0, y: you?.y ?? 0 },
  };
}

const YOU = "network_you";
const coord = (v) => { const n = Number(v); if (!Number.isFinite(n)) fail("A position must be a number"); return Math.round(Math.max(-100000, Math.min(100000, n)) * 10) / 10; };

/** Where cards sit on the canvas, saved after a drag: people, sources, or "you". Unknown ids are ignored (someone may have archived them). */
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

/** Bulk add from a pasted list: new names become people in one source; names already in your network are skipped and reported. */
export async function addPeople(db, { rows, sourceId, newSource } = {}, now = new Date()) {
  if (!Array.isArray(rows) || !rows.length) fail("Paste at least one name");
  if (rows.length > MAX_LIST) fail(`Add up to ${MAX_LIST} people at a time`);
  const src = await sourceFor(db, { sourceId, newSource }, now);
  const have = new Set((await all(db, PEOPLE)).filter((p) => !p.archived).map((p) => key(p.name)));
  const docs = [], skipped = [];
  for (const r of rows) {
    const name = str(r?.name, 80); if (!name) continue;
    if (have.has(name.toLowerCase())) { skipped.push(name); continue; }
    have.add(name.toLowerCase());
    docs.push(blank({ name, city: str(r?.city, 80), sourceId: src }, now));
  }
  if (docs.length) await db.collection(PEOPLE).insertMany(docs);
  return { added: docs.map(out), skipped, sourceId: src };
}

function blank(fields, now) {
  const at = now.toISOString();
  return { _id: randomUUID(), name: "", role: "", city: "", email: "", linkedin: "", phone: "", notes: "", sourceId: null, via: null, color: null, tags: [],
    lastContact: null, nextFollowUp: null, history: [], archived: false, createdAt: at, updatedAt: at, ...fields };
}

async function checkPersonRefs(db, id, { sourceId, via }) {
  if (sourceId && !(await db.collection(SOURCES).findOne({ _id: sourceId }))) fail("That source no longer exists");
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
  if ("color" in input) p.color = color(input.color);
  if ("nextFollowUp" in input) p.nextFollowUp = day(input.nextFollowUp);
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
  await checkPersonRefs(db, id, { sourceId: patch.sourceId, via: patch.via });
  const next = { ...patch, updatedAt: now.toISOString() };
  await db.collection(PEOPLE).updateOne({ _id: id }, { $set: next });
  return out({ ...cur, ...next });
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

/** Create a source (a company, an event, family...) or change one. Names are unique: saving "randstad" again returns Randstad. */
export async function saveSource(db, input = {}, now = new Date()) {
  const patch = {};
  if ("name" in input || !input.id) { patch.name = str(input.name, 80); if (!patch.name) fail("Give the source a name"); }
  if ("type" in input || !input.id) { patch.type = SOURCE_TYPES.includes(input.type) ? input.type : "other"; }
  if ("about" in input) patch.about = str(input.about, 120);
  if ("color" in input) patch.color = color(input.color);
  const sources = await all(db, SOURCES);
  const clash = patch.name && sources.find((s) => key(s.name) === key(patch.name) && s.id !== input.id);
  if (!input.id) {
    if (clash) return { ...clash, existed: true };
    const at = now.toISOString(), doc = { _id: randomUUID(), about: "", color: null, createdAt: at, updatedAt: at, ...patch };
    await db.collection(SOURCES).insertOne(doc);
    return out(doc);
  }
  const cur = sources.find((s) => s.id === String(input.id));
  if (!cur) fail("That source no longer exists. Reload the page.");
  if (clash) fail(`You already have a source called ${clash.name}`);
  const next = { ...patch, updatedAt: now.toISOString() };
  await db.collection(SOURCES).updateOne({ _id: cur.id }, { $set: next });
  return { ...cur, ...next };
}

/** Remove a source; its people stay and simply have no source. */
export async function removeSource(db, { id } = {}, now = new Date()) {
  const sid = String(id);
  if (!(await db.collection(SOURCES).findOne({ _id: sid }))) fail("That source no longer exists. Reload the page.");
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
