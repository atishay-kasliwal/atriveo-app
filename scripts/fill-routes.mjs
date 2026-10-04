import { spawn } from "node:child_process";
import path from "node:path";

// Open & Fill (Ashby, Lever: you click Submit). The Atriveo Fill extension in your own Chrome asks the
// sidecar for the fill plan, the verified resume, and reports what happened; playatriveo answers
// (src/cli/manualFill.ts). The plan carries your answers, including sensitive ones, so these routes
// answer only the extension on this Mac: anything that came through Cloudflare (the dashboard relay
// or the tunnel) is refused, and the request must come from a chrome-extension:// origin. All three are
// POST: Chrome sends an extension's Origin header only on non-GET requests.

const RELAY_HEADERS = ["cf-ray", "cf-connecting-ip", "cf-ipcountry", "cf-visitor", "cdn-loop", "x-forwarded-for", "x-forwarded-host", "x-real-ip"];

export function isLocalExtensionRequest(req) {
  if (RELAY_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
  return String(req.headers.origin ?? "").startsWith("chrome-extension://");
}

const ROUTES = new Set(["POST /applications/fill-plan", "POST /applications/fill-resume", "POST /applications/fill-event"]);

async function readJson(req, limit = 50_000) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new Error("Request too large");
  }
  return JSON.parse(raw || "{}");
}

/** Handles the three fill routes; false for any other request. `run` sends one request to playatriveo. */
export async function handleFillRoute(req, res, url, run) {
  const route = `${req.method} ${url.pathname}`;
  if (!ROUTES.has(route)) return false;
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };
  if (!isLocalExtensionRequest(req)) {
    send(403, { ok: false, error: "Open & Fill answers only the Atriveo Fill extension on this Mac" });
    return true;
  }
  try {
    const body = await readJson(req);
    const request = url.pathname === "/applications/fill-plan" ? { op: "plan", url: String(body.url || "") }
      : url.pathname === "/applications/fill-resume" ? { op: "resume", applicationId: String(body.applicationId || "") }
      : { op: "event", ...body };
    const result = await run(request);
    send(result.ok ? 200 : 400, result);
  } catch (e) {
    send(400, { ok: false, error: String(e?.message || e) });
  }
  return true;
}

/** One request to playatriveo's Open & Fill CLI: JSON on stdin, the last stdout line is the JSON answer. */
export function runManualFill(playatriveoDir, request, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(path.join(playatriveoDir, "node_modules", ".bin", "tsx"), ["src/cli/manualFill.ts"], { cwd: playatriveoDir, env: process.env });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", (e) => (err += String(e.message || e)));
    child.on("close", (code) => {
      clearTimeout(timer);
      const line = out.trim().split("\n").pop() || "";
      try { resolve(JSON.parse(line)); } catch { resolve({ ok: false, error: (err || out || `exit ${code}`).slice(0, 400) }); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
