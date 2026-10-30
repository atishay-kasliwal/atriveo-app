import { captureAudio, captureText, claimCapture, completeCapture, confirmCapture, dismissCapture, doneCapture, editCapture, failCapture, getCapture, heartbeat, listCaptures, loopsSummary, LoopsError, readAudio, reopenCapture, retryCapture, setTranscript, snoozeCapture } from "./loops.mjs";

// /loops/*: the Loops API (docs/loops.md). The sidecar's token check has already run. Two kinds of caller:
//   you, through the Pages Function, which verifies your sign-in and sends X-Atriveo-User;
//   the Mac worker, which calls /loops/worker/* with only the token (it reaches out to Atriveo; Atriveo never calls the Mac).
const ACTIONS = {
  confirm: (db, u, id, b) => confirmCapture(db, u, id, b),
  edit: (db, u, id, b) => editCapture(db, u, id, b),
  done: (db, u, id, b) => doneCapture(db, u, id, b),
  snooze: (db, u, id, b) => snoozeCapture(db, u, id, b),
  dismiss: (db, u, id) => dismissCapture(db, u, id),
  retry: (db, u, id) => retryCapture(db, u, id),
  reopen: (db, u, id) => reopenCapture(db, u, id),
  transcript: (db, u, id, b) => setTranscript(db, u, id, b.text),
};
const WORKER = {
  claim: (db, b) => claimCapture(db, b.workerId),
  heartbeat: (db, b) => heartbeat(db, b),
  complete: (db, b) => completeCapture(db, b),
  fail: (db, b) => failCapture(db, b),
};

async function readRaw(req, limit) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new LoopsError("That is too large", 413); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
const readJson = async (req, limit = 64_000) => { try { return JSON.parse((await readRaw(req, limit)).toString() || "{}"); } catch (e) { if (e instanceof LoopsError) throw e; throw new LoopsError("The request was not valid JSON"); } };

export async function handleLoops(req, res, url, { withDb, send } = {}) {
  const path = url.pathname;
  if (path !== "/loops" && !path.startsWith("/loops/")) return false;
  const json = (code, body) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };
  try {
    if (!withDb) throw new LoopsError("MONGO_URI not configured", 503);
    const parts = path.split("/").filter(Boolean).slice(1); // after "loops"
    if (parts[0] === "worker") {
      const op = WORKER[parts[1]];
      if (req.method !== "POST" || !op || parts.length !== 2) return json(404, { ok: false, error: "Not found" }), true;
      const body = await readJson(req, 200_000);
      json(200, { ok: true, ...(await withDb((db) => op(db, body))) });
      return true;
    }
    const user = req.headers["x-atriveo-user"];
    if (typeof user !== "string" || !/^[^\s@]+@[^\s@]+$/.test(user)) return json(401, { ok: false, error: "Unauthorized" }), true;
    const userId = user.toLowerCase();
    const reply = async (fn) => json(200, { ok: true, ...(await withDb(fn)) });

    if (req.method === "GET" && parts.length === 0) {
      const q = url.searchParams;
      await reply((db) => listCaptures(db, userId, { section: q.get("section"), status: q.get("status"), q: q.get("q") ?? "", from: q.get("from"), to: q.get("to"), limit: Number(q.get("limit")) || 100, skip: Number(q.get("skip")) || 0 }));
      return true;
    }
    if (req.method === "GET" && parts[0] === "summary") { await reply((db) => loopsSummary(db, userId)); return true; }
    if (req.method === "POST" && parts[0] === "capture" && parts.length === 1) {
      const body = await readJson(req, 20_000);
      await reply((db) => captureText(db, userId, body));
      return true;
    }
    // POST /loops/capture/audio?id=&durationMs= with the recording as the body (audio/*): raw bytes, no base64.
    if (req.method === "POST" && parts[0] === "capture" && parts[1] === "audio") {
      const bytes = await readRaw(req, 8 * 1024 * 1024 + 1);
      await reply((db) => captureAudio(db, userId, { id: url.searchParams.get("id"), bytes, mime: req.headers["content-type"], durationMs: url.searchParams.get("durationMs") }));
      return true;
    }
    if (parts[0] && parts[0] !== "capture") {
      const id = parts[0];
      if (req.method === "GET" && parts.length === 1) { await reply((db) => getCapture(db, userId, id)); return true; }
      if (req.method === "GET" && parts[1] === "audio") {
        const audio = await withDb((db) => readAudio(db, userId, id));
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
        let start = 0, end = audio.size - 1;
        if (range) { if (range[1]) start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); if (!range[1] && range[2]) { start = Math.max(0, audio.size - Number(range[2])); end = audio.size - 1; } }
        if (start > end || start >= audio.size) { res.writeHead(416, { "Content-Range": `bytes */${audio.size}` }); res.end(); return true; }
        res.writeHead(range ? 206 : 200, { "Content-Type": audio.mime, "Content-Length": end - start + 1, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...(range ? { "Content-Range": `bytes ${start}-${end}/${audio.size}` } : {}) });
        await withDb(async (db) => { await new Promise((resolve, reject) => { const s = audio.stream({ start, end: end + 1 }); s.on("error", reject); s.on("end", resolve); s.pipe(res, { end: false }); }); });
        res.end();
        return true;
      }
      if (req.method === "POST" && ACTIONS[parts[1]] && parts.length === 2) {
        const body = await readJson(req);
        await reply((db) => ACTIONS[parts[1]](db, userId, id, body));
        return true;
      }
    }
    json(404, { ok: false, error: "Not found" });
  } catch (e) {
    const known = e instanceof LoopsError;
    if (!res.headersSent) json(known ? e.status : 500, { ok: false, error: known ? e.message : "Loops could not be reached. Try again." });
    else res.end();
    if (!known) console.warn("[loops]", e?.message || e);
  }
  return true;
}
