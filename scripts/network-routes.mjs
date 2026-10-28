import { NetworkError, savePositions, addPeople, archivePerson, logHistory, networkView, previewList, removeHistory, removeLink, removeSource, saveLink, savePerson, saveSource } from "./network.mjs";

// /network/*: the Network page's API. The sidecar's own token check runs first; every call is one small Mongo operation.
const WRITES = {
  "/network/preview": (db, b) => previewList(db, b.text).then((rows) => ({ rows })),
  "/network/people": (db, b) => addPeople(db, b),
  "/network/person": (db, b) => savePerson(db, b).then((person) => ({ person })),
  "/network/history": (db, b) => logHistory(db, b).then((person) => ({ person })),
  "/network/history/remove": (db, b) => removeHistory(db, b).then((person) => ({ person })),
  "/network/archive": (db, b) => archivePerson(db, b),
  "/network/source": (db, b) => saveSource(db, b).then((source) => ({ source })),
  "/network/source/remove": (db, b) => removeSource(db, b),
  "/network/link": (db, b) => saveLink(db, b).then((link) => ({ link })),
  "/network/link/remove": (db, b) => removeLink(db, b),
  "/network/positions": (db, b) => savePositions(db, b),
};

async function readBody(req, limit = 300_000) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new NetworkError("That is too much at once. Paste a shorter list."); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { throw new NetworkError("The request was not valid JSON"); }
}

export async function handleNetwork(req, res, url, { withDb }) {
  if (url.pathname !== "/network" && !url.pathname.startsWith("/network/")) return false;
  const send = (code, body) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };
  const write = WRITES[url.pathname];
  const read = url.pathname === "/network" && req.method === "GET";
  if (!read && !(write && req.method === "POST")) { send(404, { ok: false, error: "Not found" }); return true; }
  try {
    if (!withDb) throw new NetworkError("MONGO_URI not configured");
    const body = read ? null : await readBody(req);
    const data = await withDb((db) => (read ? networkView(db, { archived: url.searchParams.get("archived") === "1" }) : write(db, body)));
    send(200, { ok: true, ...data });
  } catch (e) {
    send(e instanceof NetworkError ? 400 : 500, { ok: false, error: e instanceof NetworkError ? e.message : "Network data could not be reached. Try again." });
    if (!(e instanceof NetworkError)) console.warn("[network]", e?.message || e);
  }
  return true;
}
