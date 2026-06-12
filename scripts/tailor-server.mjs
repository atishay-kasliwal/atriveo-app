#!/usr/bin/env node
/**
 * Atriveo local tailor sidecar.
 *
 * A browser cannot write to disk or reliably reach localhost services across
 * origins, and Cloudflare Pages Functions run in the cloud, not on this Mac.
 * This tiny Node server bridges that gap. It runs ALONGSIDE `npm run dev`,
 * accepts selected JDs from the feed, calls local Ollama, applies the bullet
 * rewrites to a real resume.tex template, compiles with tectonic, and writes
 * everything to the external drive.
 *
 * Run:  npm run tailor
 * Then: in the app, select jobs → "Tailor selected".
 *
 * No external dependencies — Node built-ins only.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { loadBullets, loadSafeClaims } from "./tailor-bank.mjs";
import {
  SYSTEM_PROMPT as DYN_SYSTEM, RESPONSE_SCHEMA as DYN_SCHEMA,
  buildUserMessage, assembleResume, filterSkillsLine,
} from "./tailor-dynamic.mjs";

// Load the engine bank once at startup.
const BANK = loadBullets();
const SAFE_CLAIMS = loadSafeClaims(BANK);

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT = 8787;
const TAILOR_TOKEN = process.env.TAILOR_TOKEN?.trim() || "";
const OLLAMA = "http://localhost:11434/api/chat";
const DEFAULT_MODEL = "gemma4:12b";
const OUT_ROOT = "/Volumes/Kasliwal v2/tailored-resumes";
const TEMPLATE =
  "/Users/atishaykasliwal/Desktop/June/Resume claude/tailored/2026-06-12/04-veryai-fullstack-engineer/resume.tex";

// IMPORTANT: keep the output SMALL. gemma3:12b under a JSON schema will generate
// unbounded text (filling keyword arrays + rewriting every bullet verbosely) and
// blow past the token budget, truncating the JSON. So we cap every list hard, in
// BOTH the prompt and the schema (maxItems), and drop human scores + the likely/
// have_now audit which were pure bloat for the file-generation path.
const SYSTEM_PROMPT = `You are an expert ATS resume optimizer. Output ONE valid JSON object only — no markdown, no prose, nothing outside the JSON. Be concise. Do NOT pad lists.

TRUTH RULES:
- Truthful to the candidate's real experience only. Never fabricate tools, metrics, or outcomes.
- If a JD term has no evidence in the resume, it is "missing". Do not claim it.

BULLET REWRITES (the main task):
- Rewrite AT MOST 6 bullets — only the ones that most help THIS job. Skip the rest.
- The "before" field MUST be copied verbatim from a resume bullet so it can be matched.
- Each "after": strong verb + scope/stack + measurable impact, impact in first 8-12 words.
- No semicolons, no em-dashes, no "leveraged"/"spearheaded"/"cutting-edge". Use verbs like Built, Engineered, Automated, Reduced, Scaled, Architected, Optimized.
- Only include a bullet if you actually improved it.

SCORING (be honest, not generous): ats_before reflects the CURRENT resume vs this JD — most resumes score 50-75 before tailoring. ats_after reflects the resume after your rewrites. Do not inflate. If the resume lacks core JD skills, ats_before should be low.

LIMITS (hard): missing ≤ 8 items, skills_to_add ≤ 6 items, bullet_rewrites ≤ 6 items, quick_wins ≤ 2 sentences.

Return ONLY:
{
  "ats_before": <int 0-100>,
  "ats_after": <int 0-100>,
  "missing_keywords": [<string>],
  "skills_to_add": [<string>],
  "bullet_rewrites": [ { "before": "<verbatim bullet>", "after": "<improved>", "reason": "<short>" } ],
  "quick_wins": "<1-2 sentences>"
}`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    ats_before: { type: "integer" },
    ats_after: { type: "integer" },
    missing_keywords: { type: "array", items: { type: "string" }, maxItems: 8 },
    skills_to_add: { type: "array", items: { type: "string" }, maxItems: 6 },
    bullet_rewrites: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        properties: { before: { type: "string" }, after: { type: "string" }, reason: { type: "string" } },
        required: ["before", "after", "reason"],
      },
    },
    quick_wins: { type: "string" },
  },
  required: ["ats_before", "ats_after", "missing_keywords", "skills_to_add", "bullet_rewrites", "quick_wins"],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const log = (...a) => console.log(`[tailor]`, ...a);

function slug(s, max = 40) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max) || "untitled";
}

// LaTeX-escape AI text before injecting into the .tex
function escapeTex(s) {
  return String(s)
    .replace(/^\s*[•·▪\-*]\s+/, "")   // strip any leading bullet marker the model echoed back
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/→/g, "$\\to$")
    .replace(/×/g, "$\\times$")
    .replace(/[—–]/g, "-");
}

// Normalize for fuzzy matching between AI "before" and a template \resumeItem
function norm(s) {
  return String(s)
    .replace(/\\[a-zA-Z]+\{?|\}/g, " ")  // strip latex commands/braces
    .replace(/\\[#$%&_~^]/g, "")
    .replace(/[^a-z0-9 ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function callOllamaOnce(model, jd, resumeText, numPredict) {
  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `--- JOB DESCRIPTION ---\n${jd.trim()}\n\n--- MY RESUME ---\n${resumeText.trim()}` },
    ],
    stream: false,
    think: false,
    format: RESPONSE_SCHEMA,
    options: { temperature: 0.15, num_predict: numPredict },
  };
  const res = await fetch(OLLAMA, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { content: data.message.content, truncated: data.done_reason === "length" };
}

// Call with auto-retry at a larger token budget if the model truncates.
async function callOllama(model, jd, resumeText) {
  const budgets = [3072, 5120];
  let lastErr;
  for (const budget of budgets) {
    try {
      const { content, truncated } = await callOllamaOnce(model, jd, resumeText, budget);
      if (truncated) { lastErr = new Error(`truncated at ${budget} tokens`); log(`  retrying, ${lastErr.message}`); continue; }
      return JSON.parse(content);
    } catch (e) {
      lastErr = e;
      if (!String(e.message).includes("truncated")) throw e;
    }
  }
  throw new Error(`model output truncated even at ${budgets.at(-1)} tokens — JD may be too long`);
}

// Generic chat call (system + user) with schema + truncation retry. Used by the
// dynamic select-and-rewrite flow, which builds its own messages and schema.
async function chatJSON(model, system, user, schema, budgets = [6144, 9216]) {
  for (const budget of budgets) {
    const body = {
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      stream: false, think: false, format: schema,
      // num_ctx is CRITICAL: Ollama defaults to 4096, but our prompt (full
      // 45-bullet bank) is ~4.4K tokens — it would overflow the window and the
      // model could emit only 1 token. 16K gives ample room for prompt+output.
      options: { temperature: 0.2, num_predict: budget, num_ctx: 16384 },
    };
    const res = await fetch(OLLAMA, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (data.done_reason === "length") { log(`  retrying, truncated at ${budget} tokens`); continue; }
    return JSON.parse(data.message.content);
  }
  throw new Error(`model output truncated even at ${budgets.at(-1)} tokens`);
}

// Parse every real \resumeItem{...} bullet out of the template by brace-counting
// (regex can't handle the nested/escaped braces inside bullets). Skips the
// \newcommand definition line. Returns [{ start, end, raw, text }] in order.
function parseBullets(tex) {
  const bullets = [];
  const marker = "\\resumeItem{";
  let i = 0;
  while ((i = tex.indexOf(marker, i)) !== -1) {
    // skip the macro DEFINITION: \newcommand{\resumeItem}[1]{
    const lineStart = tex.lastIndexOf("\n", i);
    const line = tex.slice(lineStart, i);
    if (line.includes("\\newcommand")) { i += marker.length; continue; }

    const contentStart = i + marker.length;
    let depth = 1, j = contentStart;
    while (j < tex.length && depth > 0) {
      const c = tex[j];
      if (c === "\\") { j += 2; continue; }   // skip escaped char
      if (c === "{") depth++;
      else if (c === "}") depth--;
      j++;
    }
    const raw = tex.slice(contentStart, j - 1);          // bullet LaTeX
    bullets.push({ start: i, end: j, raw, text: latexToPlain(raw) });
    i = j;
  }
  return bullets;
}

// Build a clean plain-text resume from the template: section headings +
// experience/project subheadings + the exact bullets, so the AI has real
// context and its "before" strings will match our parsed bullets.
function bulletsToResumeText(tex, bullets) {
  const lines = [];
  // pull experience/project subheadings for context
  const subs = [...tex.matchAll(/\\resumeSubheading\s*\{([^}]*)\}\{[^}]*\}\s*\{([^}]*)\}/g)]
    .map((m) => `${m[1]} — ${latexToPlain(m[2])}`);
  const projs = [...tex.matchAll(/\\resumeProjectHeading\s*\{([\s\S]*?)\}\{[^}]*\}/g)]
    .map((m) => latexToPlain(m[1]));
  if (subs.length) lines.push("EXPERIENCE ROLES:", ...subs.map((s) => "  " + s), "");
  if (projs.length) lines.push("PROJECTS:", ...projs.map((p) => "  " + p), "");
  lines.push("BULLETS (rewrite only these, copy 'before' verbatim, no bullet marker):");
  bullets.forEach((b) => lines.push(b.text));
  // include skills section verbatim for keyword audit
  const skills = tex.match(/\\section\{Technical Skills\}([\s\S]*?)\\end\{itemize\}/);
  if (skills) lines.push("", "SKILLS:", latexToPlain(skills[1]).replace(/\\\\/g, " | "));
  return lines.join("\n");
}

// Strip LaTeX to readable plain text so the AI sees clean bullets.
function latexToPlain(s) {
  return s
    .replace(/\\%/g, "%").replace(/\\\$/g, "$").replace(/\\&/g, "&")
    .replace(/\\#/g, "#").replace(/\\_/g, "_")
    .replace(/\$\\to\$/g, "→").replace(/\$\\times\$/g, "×")
    .replace(/\\textbackslash\{\}/g, "\\")
    .replace(/\s+/g, " ").trim();
}

// Apply AI rewrites back to the template. The AI's "before" is matched against
// the plain-text of each parsed bullet (same source, so matching is reliable).
// Replaces from the end backwards so byte offsets stay valid.
function applyRewrites(tex, bullets, rewrites) {
  const edits = [];
  for (const rw of rewrites) {
    if (!rw.before || !rw.after || norm(rw.before) === norm(rw.after)) continue;
    const target = norm(rw.before);
    let best = -1, bestScore = 0;
    bullets.forEach((b, idx) => {
      const bn = norm(b.text);
      // overlap score: shared prefix length after normalization
      let score = 0;
      const a = bn, c = target;
      const minLen = Math.min(a.length, c.length);
      for (let k = 0; k < minLen && a[k] === c[k]; k++) score++;
      if (bn.includes(c.slice(0, 30)) || c.includes(bn.slice(0, 30))) score += 50;
      if (score > bestScore) { bestScore = score; best = idx; }
    });
    if (best !== -1 && bestScore >= 25 && !edits.find((e) => e.idx === best)) {
      edits.push({ idx: best, after: rw.after });
    }
  }
  // apply from highest offset down so earlier offsets remain valid
  edits.sort((a, b) => bullets[b.idx].start - bullets[a.idx].start);
  for (const e of edits) {
    const b = bullets[e.idx];
    tex = tex.slice(0, b.start) + "\\resumeItem{" + escapeTex(e.after) + "}" + tex.slice(b.end);
  }
  return { tex, applied: edits.length };
}

function compileTex(dir) {
  const r = spawnSync("tectonic", ["resume.tex"], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) return { ok: false, err: (r.stderr || r.stdout || "").slice(-400) };
  // name the PDF after the candidate, matching the engine hook convention
  const pdf = path.join(dir, "resume.pdf");
  const named = path.join(dir, "Atishay Kasliwal.pdf");
  if (fs.existsSync(pdf)) fs.renameSync(pdf, named);
  return { ok: true, pdf: named };
}

// ─── Per-job tailor ──────────────────────────────────────────────────────────
// `emit(phase, extra)` reports live progress: queued → analyzing → assembling →
// compiling → done | error. Returns the final result object.
async function tailorOne(job, resumeText, model, seq, dateDir, emit = () => {}) {
  const company = job.company || "unknown";
  const role = job.title || "role";
  const folder = `${String(seq).padStart(2, "0")}-${slug(company, 24)}-${slug(role, 30)}`;
  const dir = path.join(dateDir, folder);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(path.join(dir, "jd.txt"), job.jd || "");
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(
    { company, role, url: job.job_url, score_pct: job.score_pct, tailored_at: new Date().toISOString(), model }, null, 2));

  const result = { folder, company, role, dir, status: "ok" };
  try {
    emit("analyzing");   // calling the model to select + rewrite
    const user = buildUserMessage(BANK, job.jd || "");
    const ai = await chatJSON(model, DYN_SYSTEM, user, DYN_SCHEMA);

    // Eligibility screen — hard No-Go stops here.
    if (ai.eligible === false) {
      fs.writeFileSync(path.join(dir, "optimizer.json"), JSON.stringify(ai, null, 2));
      result.status = "no-go";
      result.error = ai.no_go_reason || "eligibility blocked";
      emit("done", result);
      return result;
    }

    // Truth guard: strip skills not backed by the safe-claim allowlist.
    const droppedSkills = [];
    ai.skills = (ai.skills || []).map((line) => {
      const { line: kept, dropped } = filterSkillsLine(line, SAFE_CLAIMS);
      droppedSkills.push(...dropped);
      return kept;
    }).filter(Boolean);
    if (droppedSkills.length) { ai._dropped_skills = droppedSkills; log(`  dropped fabricated skills: ${droppedSkills.join(", ")}`); }

    fs.writeFileSync(path.join(dir, "optimizer.json"), JSON.stringify(ai, null, 2));
    result.ats = `${ai.ats_before}→${ai.ats_after}`;
    result.headerTitle = ai.header_title || "";

    emit("assembling");
    const tex = assembleResume(ai, BANK);
    const withJd = tex.replace(/\\end\{document\}/, `\\end{document}\n\n% ==== JD: ${company} — ${role} ====\n% ${(job.jd||"").replace(/\n/g, "\n% ").slice(0, 4000)}`);
    fs.writeFileSync(path.join(dir, "resume.tex"), withJd);

    emit("compiling");
    const c = compileTex(dir);
    result.pdf = c.ok;
    result.pdfPath = c.ok ? c.pdf : "";
    result.dropped = droppedSkills.length;
    if (!c.ok) { result.status = "tex-failed"; result.error = c.err; }
  } catch (e) {
    result.status = "ai-failed";
    result.error = String(e.message || e);
  }
  emit("done", result);
  return result;
}

// ─── HTTP server ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // permissive CORS so the Vite dev origin can reach us
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Tailor-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  const pathname = (req.url || "/").split("?")[0];
  if (TAILOR_TOKEN && req.headers["x-tailor-token"] !== TAILOR_TOKEN) {
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
  }

  if (req.method === "GET" && pathname === "/health") {
    const driveOk = fs.existsSync(path.dirname(OUT_ROOT));
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, driveMounted: driveOk, outRoot: OUT_ROOT }));
  }

  if (req.method === "POST" && pathname === "/tailor") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      // Stream newline-delimited JSON events so the frontend shows live, per-job
      // progress instead of waiting minutes for one big response.
      const send = (obj) => res.write(JSON.stringify(obj) + "\n");
      try {
        const { jobs, resumeText, model } = JSON.parse(raw);
        if (!Array.isArray(jobs) || !jobs.length) throw new Error("no jobs");
        if (!resumeText || resumeText.trim().length < 50) throw new Error("resume text missing — save it in Settings first");
        if (!fs.existsSync(path.dirname(OUT_ROOT))) throw new Error(`external drive not mounted: ${path.dirname(OUT_ROOT)}`);

        const useModel = model || DEFAULT_MODEL;
        const date = new Date().toISOString().slice(0, 10);
        const dateDir = path.join(OUT_ROOT, date);
        fs.mkdirSync(dateDir, { recursive: true });
        const existing = fs.readdirSync(dateDir).filter((d) => /^\d\d-/.test(d));
        let seq = existing.length;

        res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" });
        send({ type: "start", total: jobs.length, dateDir, model: useModel });
        log(`tailoring ${jobs.length} job(s) with ${useModel} → ${dateDir}`);

        for (let i = 0; i < jobs.length; i++) {
          const job = jobs[i];
          seq += 1;
          const index = i;
          send({ type: "job", index, phase: "queued", company: job.company, role: job.title });
          const r = await tailorOne(job, resumeText, useModel, seq, dateDir, (phase, extra) => {
            send({ type: "job", index, phase, company: job.company, role: job.title, ...(extra || {}) });
          });
          log(`  ${r.folder}: ${r.status}${r.ats ? ` (ATS ${r.ats}, ${r.dropped} dropped, pdf=${r.pdf})` : r.error ? ` — ${r.error}` : ""}`);
        }
        send({ type: "end" });
        res.end();
      } catch (e) {
        // header may already be sent; emit an error event then close
        try { send({ type: "fatal", error: String(e.message || e) }); res.end(); }
        catch { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: String(e.message || e) })); }
      }
    });
    return;
  }

  // Reveal a saved PDF or its folder in Finder.
  if (req.method === "POST" && pathname === "/open") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        const { path: target } = JSON.parse(raw);
        if (!target || !target.startsWith(OUT_ROOT)) throw new Error("invalid path");
        if (!fs.existsSync(target)) throw new Error("not found");
        // `open -R` reveals a file in Finder; `open` opens a folder.
        const isFile = fs.statSync(target).isFile();
        spawnSync("open", isFile ? ["-R", target] : [target]);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }

  res.writeHead(404); res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  log(`listening on http://localhost:${PORT}`);
  log(`output → ${OUT_ROOT}`);
  log(`template → ${TEMPLATE}`);
  log(`drive mounted: ${fs.existsSync(path.dirname(OUT_ROOT)) ? "YES" : "NO — plug in 'Kasliwal v2'"}`);
  void os; // reserved
});
