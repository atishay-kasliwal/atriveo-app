import { listIntelligence, intelligenceAction } from './network-intelligence.mjs';
import { withFollowUps, saveFollowUp, linkedinDay, sortLinkedInByDay, NetworkError, saveYou, savePositions, previewContacts, addFromLinkedIn, addPeople, archivePerson, logHistory, networkView, previewList, removeHistory, removeLink, removeSource, saveLink, savePerson, saveSource } from "./network.mjs";
import { draftStatus, mailSettings, saveMailSettings, sendNetworkMail, startDraft } from "./network-mail.mjs";
import { addOutreachPeople, answerCheckIn, outreachSource, restoreOutreach } from "./network-outreach.mjs";
import { listReminders, snoozeReminder } from "./network-reminders.mjs";
import { listEvents, markEventDone, removeEvent, saveEvent } from "./network-events.mjs";
import { boardView, readImage, removeBoardItem, saveBoardItem, saveImage } from "./network-board.mjs";
import { jobsForPerson, jobsForSource, knownCompanies, warmJobs } from "./network-jobs.mjs";
import { MAIN, addToMap, listMaps, mapView, openMapFile, removeFromMap, removeMap, saveMap, saveMapPositions } from "./network-maps.mjs";

// A person as the page shows them: with their automatic weekly follow-up when they have no date of their own.
const auto = async (db, person) => withFollowUps([person], await db.collection("network_sources").find({}).toArray())[0];

// Made while a map other than My network is open: it goes on that map too.
const onMap = async (db, b, ids) => { if (b.mapId && b.mapId !== MAIN && ids.length) await addToMap(db, { mapId: b.mapId, ids }); };

// /network/*: the Network page's API. The sidecar's own token check runs first; every call is one small Mongo operation.
const WRITES = {
  "/network/intelligence/action": (db,b) => intelligenceAction(db,b),
  "/network/preview": (db, b) => previewList(db, b.text).then((rows) => ({ rows })),
  "/network/import/preview": (db, b) => previewContacts(db, b.text),
  "/network/linkedin": (db, b) => addFromLinkedIn(db, b).then(async (r) => { await onMap(db, b, [r.person?.id].filter(Boolean)); return r; }),
  "/network/linkedin/today": (db, b) => linkedinDay(db, new Date(), undefined, b.rootId || null).then(async (source) => { await onMap(db, b, [source.id]); return { source }; }),
  "/network/linkedin/sort": (db, b) => sortLinkedInByDay(db, new Date(), b.rootId || null),
  "/network/outreach/source": (db, b) => outreachSource(db, b).then(async (source) => { await onMap(db, b, [source.id]); return { source }; }),
  "/network/outreach/people": (db, b) => addOutreachPeople(db, b).then(async (r) => { await onMap(db, b, r.added.map((p) => p.id)); return r; }),
  "/network/outreach/answer": (db, b) => answerCheckIn(db, b),
  "/network/outreach/restore": (db, b) => restoreOutreach(db, b),
  "/network/people": (db, b) => addPeople(db, b).then(async (r) => {
    // On a map, names already in your network are not added again, but they are put on this map.
    const known = b.mapId && b.mapId !== MAIN && r.skipped.length ? (await db.collection("network_people").find({}).toArray()).filter((p) => !p.archived && r.skipped.some((n) => n.toLowerCase() === p.name.toLowerCase())).map((p) => p._id) : [];
    await onMap(db, b, [...r.added.map((p) => p.id), ...known, r.sourceId].filter(Boolean)); return { ...r, placed: known.length };
  }),
  "/network/person": (db, b) => savePerson(db, b).then(async (person) => { if (!b.id) await onMap(db, b, [person.id]); return { person: await auto(db, person) }; }),
  "/network/follow-up": (db, b) => saveFollowUp(db, b).then(async (person) => ({ person: await auto(db, person) })),
  "/network/history": (db, b) => logHistory(db, b).then(async (person) => ({ person: await auto(db, person) })),
  "/network/history/remove": (db, b) => removeHistory(db, b).then(async (person) => ({ person: await auto(db, person) })),
  "/network/archive": (db, b) => archivePerson(db, b),
  "/network/source": (db, b) => saveSource(db, b).then(async (source) => {
    if (!b.id) await onMap(db, b, [source.id]);
    // A company may already exist in the address book but be new to this map.
    const custom = b.mapId && b.mapId !== MAIN;
    const card = custom ? await db.collection("network_map_cards").findOne({ _id: `${b.mapId}:${source.id}` }) : null;
    const placed = custom ? card?.x != null && card?.y != null : source.existed;
    // Keep the suggested location when confirming it for the first time on this map.
    if (!b.id && !placed && Number.isFinite(b.position?.x) && Number.isFinite(b.position?.y)) {
      const items = [...(Array.isArray(b.positions) ? b.positions.slice(0, 1999).filter((p) => p?.id !== source.id && Number.isFinite(p?.x) && Number.isFinite(p?.y)) : []), { id: source.id, x: b.position.x, y: b.position.y }];
      if (b.mapId && b.mapId !== MAIN) await saveMapPositions(db, { mapId: b.mapId, items });
      else await savePositions(db, { items });
      return { source: { ...source, x: b.position.x, y: b.position.y } };
    }
    return { source: card?.x != null && card?.y != null ? { ...source, x: card.x, y: card.y } : source };
  }),
  "/network/source/remove": (db, b) => removeSource(db, b),
  "/network/link": (db, b) => saveLink(db, b).then((link) => ({ link })),
  "/network/link/remove": (db, b) => removeLink(db, b),
  "/network/positions": (db, b) => (b.mapId && b.mapId !== MAIN ? saveMapPositions(db, b) : savePositions(db, b)),
  "/network/maps/save": (db, b) => saveMap(db, b).then((map) => ({ map })),
  "/network/maps/remove": (db, b) => removeMap(db, b),
  "/network/maps/add": (db, b) => addToMap(db, b),
  "/network/maps/take": (db, b) => removeFromMap(db, b),
  "/network/maps/open": (db, b) => openMapFile(db, b),
  "/network/you": (db, b) => saveYou(db, b).then((you) => ({ you })),
  "/network/mail/settings": (db, b) => saveMailSettings(db, b).then((settings) => ({ settings })),
  "/network/mail/send": (db, b, o) => sendNetworkMail(db, b, { sender: o.sender?.(), outRoot: o.outRoot }),
  "/network/reminders/snooze": (db, b) => snoozeReminder(db, b),
  "/network/events/save": (db, b) => saveEvent(db, b),
  "/network/events/done": (db, b) => markEventDone(db, b.id),
  "/network/events/remove": (db, b) => removeEvent(db, b.id),
  "/network/board/save": (db, b) => saveBoardItem(db, b).then((item) => ({ item })),
  "/network/board/remove": (db, b) => removeBoardItem(db, b),
  "/network/board/image": (db, b) => saveImage(db, b),
  "/network/photo": (db, b) => saveImage(db, b),
  "/network/mail/draft": (db, b, o) => startDraft(db, b, { generate: (request) => o.generate(request, db) }),
};
const READS = {
  "/network/intelligence": db => listIntelligence(db),
  "/network": (db, q) => (q.get("map") && q.get("map") !== MAIN ? mapView(db, q.get("map"), { archived: q.get("archived") === "1" }) : networkView(db, { archived: q.get("archived") === "1" })),
  "/network/maps": (db) => listMaps(db),
  "/network/mail": (db, _q, o) => mailSettings(db, { outRoot: o.outRoot }).then((settings) => ({ settings })),
  "/network/mail/draft": (db, q) => draftStatus(db, q.get("id")),
  "/network/reminders": (db) => listReminders(db),
  "/network/events": (db) => listEvents(db),
  "/network/board": (db, q) => boardView(db, q.get("map") || MAIN),
  "/network/jobs": (db, q) => (q.get("person") ? jobsForPerson(db, q.get("person")) : q.get("source") ? jobsForSource(db, q.get("source")) : warmJobs(db).then((groups) => ({ groups }))),
  "/network/companies": (db) => knownCompanies(db).then((companies) => ({ companies })),
};

async function readBody(req, limit) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new NetworkError("That is too much at once. Paste a shorter list or attach a smaller file."); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { throw new NetworkError("The request was not valid JSON"); }
}

/** Options: withDb(fn) runs fn with the database; outRoot is where general resumes live; sender() and generate(request) send mail and write drafts. */
export async function handleNetwork(req, res, url, opts = {}) {
  if (url.pathname !== "/network" && !url.pathname.startsWith("/network/")) return false;
  const send = (code, body) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };
  const read = req.method === "GET" ? READS[url.pathname] : null, write = req.method === "POST" ? WRITES[url.pathname] : null;
  if (req.method === "GET" && url.pathname === "/network/image") {
    try {
      if (!opts.withDb) throw new NetworkError("MONGO_URI not configured");
      const img = await opts.withDb((db) => readImage(db, url.searchParams.get("id")));
      // An image never changes once saved (a new upload gets a new id), so the browser may keep it.
      res.writeHead(200, { "Content-Type": img.type, "Content-Length": img.bytes.length, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
      res.end(img.bytes);
    } catch (e) { send(e instanceof NetworkError ? 404 : 500, { ok: false, error: e instanceof NetworkError ? e.message : "That image could not be read" }); }
    return true;
  }
  if (!read && !write) { send(404, { ok: false, error: "Not found" }); return true; }
  try {
    if (!opts.withDb) throw new NetworkError("MONGO_URI not configured");
    const body = read ? null : await readBody(req, url.pathname === "/network/mail/send" || url.pathname === "/network/board/image" || url.pathname === "/network/photo" || url.pathname === "/network/import/preview" || url.pathname === "/network/maps/open" ? 8_000_000 : url.pathname === "/network/people" ? 2_000_000 : 300_000);
    const data = await opts.withDb((db) => (read ? read(db, url.searchParams, opts) : write(db, body, opts)));
    send(200, { ok: true, ...data });
  } catch (e) {
    send(e instanceof NetworkError ? 400 : 500, { ok: false, error: e instanceof NetworkError ? e.message : "Network data could not be reached. Try again." });
    if (!(e instanceof NetworkError)) console.warn("[network]", e?.message || e);
  }
  return true;
}
