import { spawn } from "node:child_process";
import path from "node:path";

// Open & Fill (Ashby, Lever: you click Submit). The Atriveo Fill extension in your own Chrome asks the
// sidecar for the fill plan, the verified resume, and reports what happened; playatriveo answers
// (src/cli/manualFill.ts). The plan carries your answers, including sensitive ones, so these routes
// answer only the extension on this Mac: anything that came through Cloudflare (the dashboard relay
// or the tunnel) is refused, and the request must come from a chrome-extension:// origin. All of them are
// POST: Chrome sends an extension's Origin header only on non-GET requests.
//
// Apply with Atriveo (any job page, from the toolbar): /applications/fill-capture sends the posting the
// extension read from the page; playatriveo names it, checks it, saves its job description and opens its
// application in your browser. /applications/fill-preview answers the form you have open (what Fill would
// type, and what is yours); /applications/fill-plan-here is the plan for exactly that preview;
// /applications/fill-return hands the application back to the worker (never approves anything). The resume
// and outcome routes above serve both flows. Nothing here submits.
//
// Resume and Cover letter tabs: /applications/fill-documents (reads), fill-file (one of the application's own
// documents, to inspect), fill-select-resume, fill-cover-accept, fill-cover-clear (your explicit choices, pinned
// by checksum in playatriveo). fill-tailor and fill-cover first ask playatriveo whether the application is
// yours and the posting has its job description, then use this backend's own pipeline (`docs`): the compile
// queue exactly as /compile-enqueue (never force: a finished resume is never replaced), and the template cover
// letter generator into a new folder (nothing is overwritten). A generated cover letter is recorded as a draft.

const RELAY_HEADERS = ["cf-ray", "cf-connecting-ip", "cf-ipcountry", "cf-visitor", "cdn-loop", "x-forwarded-for", "x-forwarded-host", "x-real-ip"];

export function isLocalExtensionRequest(req) {
  if (RELAY_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
  return String(req.headers.origin ?? "").startsWith("chrome-extension://");
}

const ROUTES = new Set(["POST /applications/workday-account", "POST /applications/fill-plan", "POST /applications/fill-resume", "POST /applications/fill-event", "POST /applications/fill-capture", "POST /applications/fill-preview", "POST /applications/fill-plan-here", "POST /applications/fill-return",
  "POST /applications/fill-documents", "POST /applications/fill-file", "POST /applications/fill-select-resume", "POST /applications/fill-tailor",
  "POST /applications/fill-cover", "POST /applications/fill-cover-accept", "POST /applications/fill-cover-clear"]);
const LARGE = new Set(["/applications/fill-capture", "/applications/fill-preview", "/applications/fill-plan-here"]);

const str = (v) => String(v ?? "");
/** The playatriveo request for each route (the bodies are validated again there). */
const REQUESTS = {
  "/applications/workday-account": (b) => ({ op: "workday_account", applicationId: str(b.applicationId), url: str(b.url), operation: b.operation }),
  "/applications/fill-plan": (b) => ({ op: "plan", url: str(b.url) }),
  "/applications/fill-resume": (b) => ({ op: "resume", applicationId: str(b.applicationId), ...(b.document === "cover_letter" ? { document: "cover_letter" } : {}) }),
  "/applications/fill-capture": (b) => ({ op: "capture", page: b.page, overrides: b.overrides ?? {} }),
  "/applications/fill-preview": (b) => ({ op: "preview", applicationId: str(b.applicationId), form: b.form }),
  "/applications/fill-return": (b) => ({ op: "return", applicationId: str(b.applicationId), expectedUpdatedAt: str(b.expectedUpdatedAt) }),
  "/applications/fill-plan-here": (b) => ({ op: "plan_here", applicationId: str(b.applicationId), expectedUpdatedAt: str(b.expectedUpdatedAt), form: b.form }),
  "/applications/fill-documents": (b) => ({ op: "documents", applicationId: str(b.applicationId) }),
  "/applications/fill-file": (b) => ({ op: "file", applicationId: str(b.applicationId), path: str(b.path) }),
  "/applications/fill-select-resume": (b) => ({ op: "select_resume", applicationId: str(b.applicationId), expectedUpdatedAt: str(b.expectedUpdatedAt), path: str(b.path), sha256: str(b.sha256), acceptBasic: b.acceptBasic === true }),
  "/applications/fill-cover-accept": (b) => ({ op: "cover_accept", applicationId: str(b.applicationId), expectedUpdatedAt: str(b.expectedUpdatedAt), path: str(b.path), sha256: str(b.sha256) }),
  "/applications/fill-cover-clear": (b) => ({ op: "cover_clear", applicationId: str(b.applicationId), expectedUpdatedAt: str(b.expectedUpdatedAt) }),
  "/applications/fill-event": (b) => ({ op: "event", ...b }),
};

/** Tailoring and cover letter generation: playatriveo checks first, then this backend's pipeline does the work. */
async function documentWork(pathname, body, run, docs) {
  if (!docs) return { ok: false, error: "Document generation isn't available on this server" };
  const ids = { applicationId: str(body.applicationId), expectedUpdatedAt: str(body.expectedUpdatedAt) };
  if (pathname === "/applications/fill-tailor") {
    const check = await run({ op: "tailor_check", ...ids });
    if (!check.ok) return check;
    const queued = await docs.enqueueTailoring({ job_url: check.jobUrl, company: check.company, title: check.title, location: check.location ?? null });
    return { ok: true, jobUrl: check.jobUrl, ...queued };
  }
  const check = await run({ op: "cover_check", ...ids });
  if (!check.ok) return check;
  const built = await docs.generateCoverLetter({ jobUrl: check.jobUrl, company: check.company, title: check.title, resumeDir: check.resumeDir ?? null });
  if (!built?.ok || !built.pdf) return { ok: false, error: `Cover letter generation failed: ${built?.err ?? "unknown error"}` };
  return run({ op: "cover_recorded", applicationId: ids.applicationId, path: built.pdf });
}

async function readJson(req, limit = 50_000) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new Error("Request too large");
  }
  return JSON.parse(raw || "{}");
}

/**
 * Handles the fill routes; false for any other request. `run` sends one request to playatriveo; `docs`
 * ({ enqueueTailoring(job), generateCoverLetter({ jobUrl, company, title, resumeDir }) }) is this backend's
 * existing resume queue and cover letter generator.
 */
export async function handleFillRoute(req, res, url, run, docs = null) {
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
    // A captured page carries the job description (up to 60k characters, twice when the page's JSON-LD has it too);
    // a form read carries its controls and up to 20k characters of page text.
    const body = await readJson(req, LARGE.has(url.pathname) ? 400_000 : 50_000);
    const result = url.pathname === "/applications/fill-tailor" || url.pathname === "/applications/fill-cover"
      ? await documentWork(url.pathname, body, run, docs)
      : await run(REQUESTS[url.pathname](body));
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
