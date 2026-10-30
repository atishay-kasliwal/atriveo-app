import { withMongo, closeMongo } from "./mongo-client.mjs";
import { ensureLoopsIndexes, transcribePending } from "./loops.mjs";
import { providerFromEnv } from "./loops-transcribe.mjs";

// The Loops transcriber: a small separate process (its own container on the server) that turns saved recordings into text, one at a time,
// at low priority, whenever there is one waiting. Speed does not matter: a recording waits as RECORDED until its turn, and nothing is lost
// if this is stopped. It logs counts only, never a transcript.
const EVERY_MS = Math.max(5_000, Number(process.env.LOOPS_TRANSCRIBE_EVERY_MS) || 30_000);
const log = (m) => console.log(`[loops-transcriber ${new Date().toISOString()}] ${m}`);
// A stop signal ends the current wait at once, so the container stops promptly instead of after its sleep.
let stopped = false;
const wakers = new Set();
const sleep = (ms) => new Promise((resolve) => { const t = setTimeout(done, ms); function done() { clearTimeout(t); wakers.delete(done); resolve(); } wakers.add(done); });
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { stopped = true; for (const w of [...wakers]) w(); });

const { provider, reason } = providerFromEnv();
if (!provider) {
  // Not configured: stay up and say why, rather than crash-looping the container. Recordings keep waiting safely.
  log(`Transcription is off: ${reason}. Recordings wait until it is set up.`);
  while (!stopped) { await sleep(10 * 60_000); if (!stopped) log(`Transcription is still off: ${reason}.`); }
} else {
  log(`Started (${provider.name}).`);
  await withMongo((db) => ensureLoopsIndexes(db), { appName: "AtriveoLoopsTranscriber" }).catch(() => {});
  while (!stopped) {
    let worked = 0;
    try {
      const r = await withMongo((db) => transcribePending(db, provider, { limit: 1 }), { appName: "AtriveoLoopsTranscriber" });
      worked = r.done + r.failed;
      if (worked) log(`${r.done} transcribed, ${r.failed} failed.`);
    } catch (e) { log(`Could not reach the database: ${String(e.message || e).slice(0, 120)}`); }
    if (!worked) await sleep(EVERY_MS);
  }
}
await closeMongo().catch(() => {});
log("Stopped.");
