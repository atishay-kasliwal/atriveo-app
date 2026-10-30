// The ATO 2026 file came in with every person under the event card (one colour for all) and on My network too. This gives each
// employer its own card (under All Things Open 2026) and its own colour, moves each person onto their employer's card (so they take
// their organization's colour), and keeps the event, its employer cards and its people off My network: they belong to the ATO 2026
// map only. Only people tagged "ATO 2026" move; your own sources and people are never touched. Safe to run again.
//
//   node --env-file=.env.tailor --env-file=.env scripts/network-ato-companies.mjs            show the plan, change nothing
//   node --env-file=.env.tailor --env-file=.env scripts/network-ato-companies.mjs --apply    do it
import { pathToFileURL } from "node:url";
import { savePerson, saveSource } from "./network.mjs";
import { addToMap } from "./network-maps.mjs";

const EVENT = "all things open 2026", TAG = "ATO 2026", NONE = "Independent";
const key = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const hexHue = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), max = Math.max(r, g, b), d = max - Math.min(r, g, b); if (!d) return 0; const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
/** A spread of distinct hues that read on the dark canvas: the golden angle keeps neighbours apart however many companies there are. */
export function colorAt(i) {
  const h = (i * 137.508) % 360, s = 0.68, l = 0.62, a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0"); };
  return `#${f(0)}${f(8)}${f(4)}`;
}
/** The next `n` colours, none close to the event card's own, so a company is never mistaken for the event. */
export function colorsFor(n, avoid) {
  const out = []; let i = 0;
  while (out.length < n) { const c = colorAt(i++); const d = avoid ? Math.abs(hexHue(c) - hexHue(avoid)) : 180; if (Math.min(d, 360 - d) > 25) out.push(c); }
  return out;
}

export async function planAtoCompanies(db, { apply = false, map: mapName = "ATO 2026" } = {}, now = new Date()) {
  const people = (await db.collection("network_people").find({}).toArray()).filter((p) => (p.tags ?? []).includes(TAG));
  const sources = await db.collection("network_sources").find({}).toArray();
  const event = sources.find((s) => key(s.name) === EVENT);
  if (!event) throw new Error("Open the ATO 2026 file on /network first: there is no All Things Open 2026 card.");
  const map = (await db.collection("network_maps").find({}).toArray()).find((m) => key(m.name) === key(mapName));
  if (!map) throw new Error(`There is no map called "${mapName}". Open the file on /network first, or pass --map "<its name>".`);
  const eventId = event._id ?? event.id;
  const names = new Map(); // key -> display name
  for (const p of people) { const name = String(p.company ?? "").trim() || NONE; if (!names.has(key(name))) names.set(key(name), name); }
  const existing = (k) => sources.find((s) => s.type === "company" && key(s.name) === k && !s.context && s.parentSourceId === eventId);
  const order = [...names.keys()].sort(), spread = colorsFor(order.length, event.color), color = new Map(order.map((k, i) => [k, spread[i]]));
  const plan = { people: 0, moved: 0, created: [], recolored: 0, separated: 0, map: map.name };
  const mine = new Set([eventId]), setOnly = async (col, doc) => { if (doc.mapOnly === (map._id ?? map.id)) return; plan.separated++; if (apply) await db.collection(col).updateOne({ _id: doc._id ?? doc.id }, { $set: { mapOnly: map._id ?? map.id } }); };
  const id = new Map();
  for (const k of order) {
    let src = existing(k);
    if (!src) {
      plan.created.push(names.get(k));
      src = apply ? await saveSource(db, { name: names.get(k), type: "company", parentSourceId: eventId, about: `Speaker at ATO 2026`, color: color.get(k) }, now) : { id: `new:${k}` };
    } else if (src.color !== color.get(k)) {
      plan.recolored++;
      if (apply) await saveSource(db, { id: src._id ?? src.id, color: color.get(k) }, now);
    }
    id.set(k, src._id ?? src.id); mine.add(src._id ?? src.id);
    if (src._id ?? src.id) await setOnly("network_sources", src);
  }
  await setOnly("network_sources", event);
  if (apply) await addToMap(db, { mapId: map._id ?? map.id, ids: [...mine].filter((x) => !x.startsWith("new:")) });
  for (const p of people) {
    plan.people++;
    await setOnly("network_people", p);
    const target = id.get(key(String(p.company ?? "").trim() || NONE));
    if ((p.sourceId ?? null) === target) continue;
    plan.moved++;
    if (apply) await savePerson(db, { id: p._id ?? p.id, sourceId: target }, now);
  }
  return plan;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { withMongo, closeMongo } = await import("./mongo-client.mjs");
  const apply = process.argv.includes("--apply"), at = process.argv.indexOf("--map"), map = at > 0 ? process.argv[at + 1] : undefined;
  await withMongo(async (db) => {
    const plan = await planAtoCompanies(db, { apply, ...(map ? { map } : {}) });
    console.log(`${apply ? "Done" : "Plan (nothing changed)"} for the map "${plan.map}": ${plan.people} ATO people, ${plan.moved} move to their employer's card, ${plan.created.length} new company cards, ${plan.recolored} existing cards recoloured, ${plan.separated} cards kept off My network.`);
    if (plan.created.length) console.log("New cards:", plan.created.slice(0, 40).join(", ") + (plan.created.length > 40 ? ", …" : ""));
    if (!apply) console.log("Run again with --apply to do it.");
  });
  await closeMongo();
}
