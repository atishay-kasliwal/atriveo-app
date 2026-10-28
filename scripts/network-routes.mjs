import { NetworkError, savePositions, addPeople, archivePerson, logHistory, networkView, previewList, removeHistory, removeLink, removeSource, saveLink, savePerson, saveSource } from "./network.mjs";
import { draftStatus, mailSettings, saveMailSettings, sendNetworkMail, startDraft } from "./network-mail.mjs";

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
  "/network/mail/settings": (db, b) => saveMailSettings(db, b).then((settings) => ({ settings })),
  "/network/mail/send": (db, b, o) => sendNetworkMail(db, b, { sender: o.sender?.(), outRoot: o.outRoot }),
  "/network/mail/draft": (db, b, o) => startDraft(db, b, { generate: (request) => o.generate(request, db) }),
};
const READS = {
  "/network": (db, q) => networkView(db, { archived: q.get("archived") === "1" }),
  "/network/mail": (db, _q, o) => mailSettings(db, { outRoot: o.outRoot }).then((settings) => ({ settings })),
  "/network/mail/draft": (db, q) => draftStatus(db, q.get("id")),
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
  if (!read && !write) { send(404, { ok: false, error: "Not found" }); return true; }
  try {
    if (!opts.withDb) throw new NetworkError("MONGO_URI not configured");
    const body = read ? null : await readBody(req, url.pathname === "/network/mail/send" ? 8_000_000 : 300_000);
    const data = await opts.withDb((db) => (read ? read(db, url.searchParams, opts) : write(db, body, opts)));
    send(200, { ok: true, ...data });
  } catch (e) {
    send(e instanceof NetworkError ? 400 : 500, { ok: false, error: e instanceof NetworkError ? e.message : "Network data could not be reached. Try again." });
    if (!(e instanceof NetworkError)) console.warn("[network]", e?.message || e);
  }
  return true;
}
