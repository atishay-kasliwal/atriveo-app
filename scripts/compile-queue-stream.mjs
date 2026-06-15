/**
 * SSE stream for Mongo compile queue — change streams with snapshot + deltas.
 * GET /compile-queue/stream?limit=120
 */
import { connectMongo, getDb } from "./mongo-client.mjs";
import {
  listCompileJobs,
  serializeCompileJob,
  resumeFieldTouched,
  loadCompileJobById,
} from "./resume-queue.mjs";

const PING_MS = 25_000;

export function writeSse(res, event, data) {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function serveCompileQueueStream(req, res, { limit = 120 } = {}) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");

  let closed = false;
  req.on("close", () => { closed = true; });

  let changeStream = null;
  let pingTimer = null;

  const cleanup = async () => {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    if (changeStream) {
      try { await changeStream.close(); } catch { /* ignore */ }
      changeStream = null;
    }
  };

  try {
    const client = await connectMongo({ appName: "AtriveoCompileStream" });
    const db = getDb(client);

    const jobs = await listCompileJobs(db, { limit });
    if (closed) return;
    writeSse(res, "snapshot", { ok: true, jobs });

    changeStream = db.collection("jobs").watch([], { fullDocument: "updateLookup" });

    pingTimer = setInterval(() => {
      if (!closed) res.write(": ping\n\n");
    }, PING_MS);

    for await (const change of changeStream) {
      if (closed) break;
      if (!resumeFieldTouched(change)) continue;

      let job = serializeCompileJob(change.fullDocument);
      if (!job && change.documentKey?._id) {
        job = await loadCompileJobById(db, change.documentKey._id);
      }
      if (!job?.job_url) continue;

      writeSse(res, "change", { ok: true, job });
    }
  } catch (e) {
    if (!closed) {
      writeSse(res, "error", { ok: false, error: String(e.message || e) });
    }
  } finally {
    await cleanup();
    if (!closed && !res.writableEnded) res.end();
  }
}
