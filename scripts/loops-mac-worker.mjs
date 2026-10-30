import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { subscriptionGenerate } from "./resume-ai-provider.mjs";
import { extractionRequest, validateExtraction } from "./loops-schema.mjs";

// The Mac half of Loops: asks Atriveo for a waiting capture (outbound calls only, so Atriveo never needs to reach this Mac),
// has the local Codex CLI read it, checks the answer, and sends it back. Nothing is activated here: a reading goes to review.
// Config: ~/.playatriveo/loops-worker.json { "base": "https://…", "token": "…", "provider": "codex" }
/** Calls the worker routes: outbound only, with the shared token. */
export function workerClient({ base, token, workerId }) {
  return async function call(op, body = {}) {
    const r = await fetch(`${base}/loops/worker/${op}`, { method: "POST", headers: { "X-Tailor-Token": token, "Content-Type": "application/json" }, body: JSON.stringify({ workerId, ...body }), signal: AbortSignal.timeout(20_000) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error(d.error || `Atriveo answered ${r.status}`);
    return d;
  };
}

/** One capture: Codex's answer is checked here before it is sent; the server checks it again. */
export async function processOne(capture, { call, generate = subscriptionGenerate, provider = "codex" } = {}) {
  const beat = setInterval(() => void call("heartbeat", { id: capture.id, token: capture.token }).catch(() => {}), 30_000);
  try {
    const result = await generate(provider, extractionRequest(capture.text));
    validateExtraction(result);
    await call("complete", { id: capture.id, token: capture.token, result });
    return "completed";
  } catch (e) {
    // The failure goes back so the capture is retried (or marked failed after a few tries); no transcript text is logged.
    await call("fail", { id: capture.id, token: capture.token, error: String(e.message || e).slice(0, 200) }).catch(() => {});
    return "failed";
  } finally { clearInterval(beat); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".playatriveo", "loops-worker.json"), "utf8"));
  const workerId = `${os.hostname()}:${process.pid}`;
  const call = workerClient({ base: config.base, token: config.token, workerId });
  let stopped = false; process.on("SIGTERM", () => { stopped = true; }); process.on("SIGINT", () => { stopped = true; });
  console.log("Loops worker started.");
  while (!stopped) {
    let idle = true;
    try {
      const { capture } = await call("claim");
      if (capture) { idle = false; console.log(`Capture ${(await processOne(capture, { call, provider: config.provider || "codex" })) === "completed" ? "read" : "failed (will retry)"}.`); }
    } catch { console.log("Waiting for Atriveo."); }
    await new Promise((r) => setTimeout(r, idle ? 10_000 : 1_000));
  }
}
