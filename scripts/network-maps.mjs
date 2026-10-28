import { randomUUID } from "node:crypto";
import { cleanEmail } from "./resume-emails.mjs";
import { NetworkError, networkView, saveLink, saveSource } from "./network.mjs";
import { saveBoardItem } from "./network-board.mjs";

// Maps: "My network" (id "main") shows everyone and keeps the layout people and sources carry themselves. Any other map is your own
// selection: which people and sources are on it and where they sit (network_map_cards), its own board (network_board items with its
// mapId) and where "You" sits. People and sources stay one address book, so editing someone on any map edits them everywhere.
// Opening a saved file makes a new map: people already in your network are reused untouched, everyone else is added.

const MAPS = "network_maps", CARDS = "network_map_cards", PEOPLE = "network_people", SOURCES = "network_sources", BOARD = "network_board", IMAGES = "network_images";
export const MAIN = "main";
const fail = (m) => { throw new NetworkError(m); };
const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const coord = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(Math.max(-100000, Math.min(100000, n)) * 10) / 10 : null; };
const isMain = (id) => !id || id === MAIN;

async function mapDoc(db, id) {
  const m = await db.collection(MAPS).findOne({ _id: String(id ?? "") });
  if (!m) fail("That map no longer exists. Go back to all maps.");
  return m;
}

/** Every map with its size and when it last changed; "My network" is always first. */
export async function listMaps(db) {
  const [maps, cards, people] = await Promise.all([db.collection(MAPS).find({}).toArray(), db.collection(CARDS).find({}).toArray(), db.collection(PEOPLE).find({}).toArray()]);
  const live = new Set(people.filter((p) => !p.archived).map((p) => p._id));
  const main = maps.find((m) => m._id === MAIN);
  const latest = people.reduce((t, p) => (p.updatedAt > t ? p.updatedAt : t), "");
  const out = [{ id: MAIN, name: main?.name || "My network", people: live.size, thumbId: main?.thumbId ?? null, updatedAt: main?.updatedAt && main.updatedAt > latest ? main.updatedAt : latest || null, main: true }];
  for (const m of maps.filter((x) => x._id !== MAIN).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))))
    out.push({ id: m._id, name: m.name, people: cards.filter((c) => c.mapId === m._id && live.has(c.id)).length, thumbId: m.thumbId ?? null, updatedAt: m.updatedAt, main: false });
  return { maps: out };
}

/** Create a map (no id), rename one, or keep its preview picture. */
export async function saveMap(db, input = {}, now = new Date()) {
  const at = now.toISOString();
  if (!input.id) {
    const name = str(input.name, 60) || fail("Give the map a name");
    const doc = { _id: randomUUID(), name, you: { x: 0, y: 0 }, thumbId: null, createdAt: at, updatedAt: at };
    await db.collection(MAPS).insertOne(doc);
    return { id: doc._id, name, people: 0, thumbId: null, updatedAt: at, main: false };
  }
  const id = String(input.id), cur = id === MAIN ? (await db.collection(MAPS).findOne({ _id: MAIN })) ?? { _id: MAIN } : await mapDoc(db, id);
  const set = {};
  if ("name" in input) set.name = str(input.name, 60) || fail("Give the map a name");
  if ("thumbId" in input) {
    set.thumbId = input.thumbId ? String(input.thumbId) : null;
    if (set.thumbId && !(await db.collection(IMAGES).findOne({ _id: set.thumbId }))) fail("Upload the preview first");
  }
  // A new preview is not a change you made to the map, so it does not move "last edited".
  if ("name" in set) set.updatedAt = at;
  await db.collection(MAPS).updateOne({ _id: cur._id }, { $set: set }, { upsert: true });
  if ("thumbId" in set && cur.thumbId && cur.thumbId !== set.thumbId) await db.collection(IMAGES).deleteOne({ _id: cur.thumbId });
  return { id: cur._id, name: set.name ?? cur.name ?? "My network" };
}

/** Delete a map: its layout, its board and its preview go; the people and sources on it stay in your network. */
export async function removeMap(db, { id } = {}) {
  if (isMain(id)) fail("My network cannot be deleted");
  const m = await mapDoc(db, id);
  const items = await db.collection(BOARD).find({ mapId: m._id }).toArray();
  for (const it of items) { await db.collection(BOARD).deleteOne({ _id: it._id }); if (it.kind === "image" && it.imageId) await db.collection(IMAGES).deleteOne({ _id: it.imageId }); }
  for (const c of await db.collection(CARDS).find({ mapId: m._id }).toArray()) await db.collection(CARDS).deleteOne({ _id: c._id });
  if (m.thumbId) await db.collection(IMAGES).deleteOne({ _id: m.thumbId });
  await db.collection(MAPS).deleteOne({ _id: m._id });
  return { id: m._id, removedBoard: items.length };
}

const touch = (db, mapId, now = new Date()) => (isMain(mapId) ? null : db.collection(MAPS).updateOne({ _id: mapId }, { $set: { updatedAt: now.toISOString() } }));

/** Put people or sources on a map (already there: kept where they are). On "My network" everyone is there already. */
export async function addToMap(db, { mapId, ids, at } = {}) {
  if (isMain(mapId)) return { added: 0 };
  const m = await mapDoc(db, mapId);
  let added = 0;
  for (const raw of (Array.isArray(ids) ? ids : []).slice(0, 2000)) {
    const id = String(raw ?? ""); if (!id) continue;
    if (!(await db.collection(PEOPLE).findOne({ _id: id })) && !(await db.collection(SOURCES).findOne({ _id: id }))) continue;
    if (await db.collection(CARDS).findOne({ _id: `${m._id}:${id}` })) continue;
    const p = at?.[id], doc = { _id: `${m._id}:${id}`, mapId: m._id, id };
    if (p && coord(p.x) != null && coord(p.y) != null) Object.assign(doc, { x: coord(p.x), y: coord(p.y) });
    await db.collection(CARDS).insertOne(doc); added++;
  }
  if (added) await touch(db, m._id);
  return { added };
}

/** Take someone off a map (they stay in your network and on other maps). */
export async function removeFromMap(db, { mapId, id } = {}) {
  if (isMain(mapId)) fail("Everyone is on My network. Archive them to take them off.");
  const m = await mapDoc(db, mapId);
  await db.collection(CARDS).deleteOne({ _id: `${m._id}:${String(id ?? "")}` });
  await touch(db, m._id);
  return { id };
}

/** Positions on a map after a drag; on "My network" the caller saves them on the people and sources themselves. */
export async function saveMapPositions(db, { mapId, items } = {}) {
  const m = await mapDoc(db, mapId);
  if (!Array.isArray(items) || !items.length) fail("Nothing to save");
  let saved = 0;
  for (const it of items.slice(0, 2000)) {
    const id = String(it?.id ?? ""), x = coord(it?.x), y = coord(it?.y);
    if (!id || x == null || y == null) continue;
    if (id === "you") { await db.collection(MAPS).updateOne({ _id: m._id }, { $set: { you: { x, y } } }); saved++; continue; }
    if (!(await db.collection(PEOPLE).findOne({ _id: id })) && !(await db.collection(SOURCES).findOne({ _id: id }))) continue;
    await db.collection(CARDS).updateOne({ _id: `${m._id}:${id}` }, { $set: { mapId: m._id, id, x, y } }, { upsert: true }); saved++;
  }
  return { saved };
}

/**
 * One map's view: the people on it and, in onMap, the sources it draws: those put on it plus each of its people's own source (so their lines have somewhere to go),
 * with this map's positions instead of the ones "My network" keeps.
 */
export async function mapView(db, mapId, { archived = false } = {}) {
  const all = await networkView(db, { archived });
  if (isMain(mapId)) return { ...all, map: { id: MAIN, name: (await db.collection(MAPS).findOne({ _id: MAIN }))?.name || "My network" } };
  const m = await mapDoc(db, mapId);
  const cards = new Map((await db.collection(CARDS).find({ mapId: m._id }).toArray()).map((c) => [c.id, c]));
  const place = ({ x: _x, y: _y, ...rest }) => { const c = cards.get(rest.id); return c && c.x != null ? { ...rest, x: c.x, y: c.y } : rest; };
  const people = all.people.filter((p) => cards.has(p.id)).map(place);
  const need = new Set([...people.map((p) => p.sourceId).filter(Boolean), ...all.sources.filter((s) => cards.has(s.id)).map((s) => s.id)]);
  // Every source still comes back (pickers offer them all); onMap says which ones this map draws.
  return { ...all, people, sources: all.sources.map(place), onMap: [...need], you: { ...all.you, x: m.you?.x ?? 0, y: m.you?.y ?? 0 }, map: { id: m._id, name: m.name } };
}

/* ---------- opening a saved file as a new map ---------- */

const keyOf = (s) => str(s, 80).toLowerCase();
const linkKey = (u) => String(u ?? "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");

/**
 * A file saved with "Save a copy" becomes a new map named `name`. Sources match on name, kind and context; people on email, then
 * LinkedIn, then name. Matches are reused exactly as they are; everything else is added. Pictures are not in the file, so photos and
 * board images are left out. Returns the new map and what happened.
 */
export async function openMapFile(db, { name, file } = {}, now = new Date()) {
  if (!file || typeof file !== "object" || file.type !== "atriveo-network") fail("That is not a saved network map. Pick a .json file made with Export, Save a copy.");
  const list = (v, max, what) => { if (v == null) return []; if (!Array.isArray(v)) fail(`The file's ${what} are damaged`); if (v.length > max) fail(`The file has more than ${max} ${what}`); return v; };
  const fSources = list(file.sources, 2000, "sources"), fPeople = list(file.people, 5000, "people"), fLinks = list(file.links, 10000, "links"), fBoard = list(file.board, 3000, "board items");
  const map = await saveMap(db, { name: str(name, 60) || "Opened map" }, now);
  const at = now.toISOString(), ids = new Map(), sum = { people: { added: 0, matched: 0 }, sources: { added: 0, matched: 0 }, links: 0, board: 0, left: 0 };

  const sources = await db.collection(SOURCES).find({}).toArray();
  const newSources = [];
  for (const s of fSources) {
    if (!s?.id || !str(s.name, 80)) continue;
    const hit = sources.find((x) => keyOf(x.name) === keyOf(s.name) && x.type === s.type && keyOf(x.context) === keyOf(s.context));
    if (hit) { ids.set(String(s.id), hit._id); sum.sources.matched++; continue; }
    try {
      const made = await saveSource(db, { name: s.name, type: s.type, about: s.about, context: s.context, notes: s.notes, place: s.place, when: s.when, color: s.color }, now);
      ids.set(String(s.id), made.id); sources.push({ _id: made.id, ...made }); newSources.push(s); sum.sources.added++;
    } catch { sum.left++; }
  }

  const people = await db.collection(PEOPLE).find({}).toArray(), newPeople = [];
  for (const p of fPeople) {
    if (!p?.id || !str(p.name, 80)) continue;
    const email = cleanEmail(p.email) ?? "", li = linkKey(p.linkedin);
    const hit = (email && people.find((x) => x.email === email)) || (li && people.find((x) => x.linkedin && linkKey(x.linkedin) === li)) || people.find((x) => keyOf(x.name) === keyOf(p.name));
    if (hit) { ids.set(String(p.id), hit._id); sum.people.matched++; continue; }
    const doc = {
      _id: randomUUID(), name: str(p.name, 80), role: str(p.role, 80), city: str(p.city, 80), company: str(p.company, 80), email, linkedin: /^https?:\/\//i.test(String(p.linkedin ?? "")) ? str(p.linkedin, 300) : "",
      phone: str(p.phone, 40), notes: String(p.notes ?? "").slice(0, 4000), sourceId: null, via: null, alsoVia: [], color: /^#[0-9a-f]{6}$/i.test(String(p.color ?? "")) ? String(p.color).toLowerCase() : null,
      photoId: null, watchJobs: Boolean(p.watchJobs), tags: (Array.isArray(p.tags) ? p.tags : []).map((t) => str(t, 30)).filter(Boolean).slice(0, 12),
      lastContact: typeof p.lastContact === "string" ? p.lastContact : null, nextFollowUp: /^\d{4}-\d{2}-\d{2}$/.test(String(p.nextFollowUp ?? "")) ? p.nextFollowUp : null,
      history: (Array.isArray(p.history) ? p.history : []).slice(-200).filter((h) => h && typeof h.text === "string").map((h) => ({ id: randomUUID(), at: String(h.at ?? at), type: String(h.type ?? "note"), text: String(h.text).slice(0, 2000) })),
      archived: false, createdAt: at, updatedAt: at,
    };
    await db.collection(PEOPLE).insertOne(doc); people.push(doc); ids.set(String(p.id), doc._id); newPeople.push(p); sum.people.added++;
  }
  // Only the newcomers get their source, introducers and source parents from the file; anyone matched stays exactly as they were.
  for (const p of newPeople) {
    const set = {}, via = [p.via, ...(Array.isArray(p.alsoVia) ? p.alsoVia : [])].map((x) => ids.get(String(x ?? ""))).filter(Boolean);
    if (p.sourceId && ids.has(String(p.sourceId))) set.sourceId = ids.get(String(p.sourceId));
    if (via.length) { set.via = via[0]; set.alsoVia = [...new Set(via.slice(1))].filter((x) => x !== via[0]); }
    if (Object.keys(set).length) await db.collection(PEOPLE).updateOne({ _id: ids.get(String(p.id)) }, { $set: set });
  }
  for (const s of newSources) {
    const parent = s.parentSourceId ? ids.get(String(s.parentSourceId)) : null, person = s.viaPersonId ? ids.get(String(s.viaPersonId)) : null;
    if (parent || person) { try { await saveSource(db, { id: ids.get(String(s.id)), parentSourceId: parent ?? null, viaPersonId: parent ? null : person, introYear: s.introYear ?? "" }, now); } catch { /* a loop or a missing link: it stays a direct source */ } }
    const also = (Array.isArray(s.alsoVia) ? s.alsoVia : []).map((v) => ({ id: ids.get(String(v?.id ?? "")), year: v?.year ?? "" })).filter((v) => v.id);
    if (also.length) { try { await saveSource(db, { id: ids.get(String(s.id)), alsoVia: also }, now); } catch { /* left without the extra introducers */ } }
  }

  const links = await db.collection("network_links").find({}).toArray();
  for (const l of fLinks) {
    const a = ids.get(String(l?.a ?? "")), b = ids.get(String(l?.b ?? ""));
    if (!a || !b || a === b || links.some((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))) continue;
    try { const made = await saveLink(db, { a, b, kind: l.kind, label: l.label, color: l.color }, now); links.push({ _id: made.id, a, b }); sum.links++; } catch { sum.left++; }
  }

  // The layout: every person and source in the file goes on the new map where it sat when it was saved.
  for (const x of [...fSources, ...fPeople]) {
    const id = ids.get(String(x?.id ?? "")); if (!id) continue;
    const doc = { _id: `${map.id}:${id}`, mapId: map.id, id };
    if (coord(x.x) != null && coord(x.y) != null) Object.assign(doc, { x: coord(x.x), y: coord(x.y) });
    if (!(await db.collection(CARDS).findOne({ _id: doc._id }))) await db.collection(CARDS).insertOne(doc);
  }
  if (file.you && coord(file.you.x) != null) await db.collection(MAPS).updateOne({ _id: map.id }, { $set: { you: { x: coord(file.you.x), y: coord(file.you.y) ?? 0 } } });

  const remap = (id) => ids.get(String(id ?? ""));
  for (const it of fBoard) {
    if (!it || !["text", "note", "stroke", "group", "work"].includes(it.kind)) { if (it?.kind === "image") sum.left++; continue; }
    // Through the board's own checks, like anything drawn by hand.
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = it;
    const input = { ...rest, mapId: map.id };
    if (input.pin) input.pin = remap(input.pin.id) ? { ...input.pin, id: remap(input.pin.id) } : null;
    if (Array.isArray(input.ids)) input.ids = input.ids.map(remap).filter(Boolean);
    if (Array.isArray(input.people)) input.people = input.people.map(remap).filter(Boolean);
    try { await saveBoardItem(db, input, now); sum.board++; } catch { sum.left++; }
  }
  return { map, summary: sum };
}
