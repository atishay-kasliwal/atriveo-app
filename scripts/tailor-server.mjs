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
import { loadBullets, loadSafeClaims, loadBankNumbers, bulletNumbers } from "./tailor-bank.mjs";
import {
  SYSTEM_PROMPT as DYN_SYSTEM, RESPONSE_SCHEMA as DYN_SCHEMA,
  CRITIQUE_SYSTEM, CRITIQUE_SCHEMA,
  buildUserMessage, assembleResume, filterSkillsLine,
  collectDraftBullets, buildCritiqueMessage, applyCritique,
} from "./tailor-dynamic.mjs";

// Load the engine bank once at startup.
const BANK = loadBullets();
const SAFE_CLAIMS = loadSafeClaims(BANK);
const BANK_NUMBERS = loadBankNumbers(BANK);

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

/** Keep NDJSON lines flowing so Cloudflare / browser proxies don't idle-timeout (~100s). */
const STREAM_HEARTBEAT_MS = 12_000;

function makeNdjsonSender(res) {
  res.socket?.setNoDelay(true);
  return (obj) => {
    if (res.writableEnded) return false;
    const ok = res.write(JSON.stringify(obj) + "\n");
    if (typeof res.flush === "function") res.flush();
    return ok;
  };
}

function startStreamHeartbeat(send) {
  return setInterval(() => {
    try {
      send({ type: "ping", ts: new Date().toISOString() });
    } catch {
      /* stream closed */
    }
  }, STREAM_HEARTBEAT_MS);
}

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

// Generic chat call (system + user) with schema + truncation retry.
async function chatJSON(model, system, user, schema, budgets = [6144, 9216], onLog = null) {
  const sysChars = system.length;
  const userChars = user.length;
  onLog?.("step", `Prompt built · system ${sysChars.toLocaleString()} chars · user ${userChars.toLocaleString()} chars · ctx 16K`);
  await checkOllama(model, onLog);

  for (let attempt = 0; attempt < budgets.length; attempt++) {
    const budget = budgets[attempt];
    onLog?.("step", `[Attempt ${attempt + 1}/${budgets.length}] POST Ollama /api/chat · model=${model} · max_output=${budget.toLocaleString()} tokens`);

    const body = {
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      stream: true,
      think: false,
      format: schema,
      options: { temperature: 0.2, num_predict: budget, num_ctx: 16384 },
    };
    const t0 = Date.now();
    let content = "";
    let thinkBuf = "";
    let thinkLineEmitted = 0;
    let doneReason = null;
    let evalCount = null;

    // Interval keepalive: reader.read() can block for minutes during thinking with no
    // Ollama chunks, which starves the NDJSON stream and trips proxy idle timeouts.
    const ollamaKeepalive = onLog
      ? setInterval(() => {
          const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
          onLog(
            "step",
            `Ollama working… ${elapsed}s elapsed${content ? ` · JSON ${content.length.toLocaleString()} chars` : ""}${thinkBuf ? ` · thinking ${thinkBuf.length.toLocaleString()} chars` : ""}`,
          );
        }, STREAM_HEARTBEAT_MS)
      : null;

    let res;
    try {
      res = await fetch(OLLAMA, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const errText = await res.text();
        onLog?.("error", `Ollama HTTP ${res.status}: ${errText.slice(0, 200)}`);
        throw new Error(`Ollama ${res.status}: ${errText}`);
      }
      onLog?.("result", "Ollama stream opened — waiting for model response…");

      const decoder = new TextDecoder();
      let buffer = "";

      const emitThinkLines = () => {
        if (!onLog) return;
        const lines = thinkBuf.split("\n");
        while (thinkLineEmitted < lines.length - 1) {
          const line = lines[thinkLineEmitted].trim();
          if (line) onLog("think", line);
          thinkLineEmitted += 1;
        }
      };

      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() || "";
        for (const line of parts) {
          if (!line.trim()) continue;
          let chunk;
          try { chunk = JSON.parse(line); } catch { continue; }
          if (chunk.message?.thinking) {
            thinkBuf += chunk.message.thinking;
            emitThinkLines();
          }
          if (chunk.message?.content) content += chunk.message.content;
          if (chunk.done_reason) doneReason = chunk.done_reason;
          if (chunk.eval_count != null) evalCount = chunk.eval_count;
        }
      }
    } finally {
      if (ollamaKeepalive) clearInterval(ollamaKeepalive);
    }
    if (thinkBuf && thinkLineEmitted < thinkBuf.split("\n").length) {
      const tail = thinkBuf.split("\n").slice(thinkLineEmitted).join("\n").trim();
      if (tail) onLog?.("think", tail);
    }

    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
    if (doneReason === "length") {
      onLog?.("warn", `Truncated at ${budget} tokens after ${elapsedSec}s — retrying larger budget…`);
      continue;
    }

    onLog?.("result", `Ollama finished in ${elapsedSec}s · JSON ${content.length.toLocaleString()} chars${evalCount != null ? ` · ~${evalCount} eval tokens` : ""}`);
    onLog?.("step", "Parsing structured JSON response…");
    try {
      const parsed = JSON.parse(content);
      onLog?.("result", "JSON parsed successfully");
      return parsed;
    } catch (e) {
      onLog?.("error", `JSON parse failed: ${e.message} · preview: ${content.slice(0, 120)}…`);
      throw new Error(`invalid JSON from model: ${e.message}`);
    }
  }
  throw new Error(`model output truncated even at ${budgets.at(-1)} tokens`);
}

// ─── Structured run logging (streamed to frontend) ───────────────────────────
function createJobLogger(index, send) {
  const t0 = Date.now();
  let step = 0;
  const log = (kind, text) => {
    step += 1;
    send({
      type: "log",
      index,
      kind,
      text,
      step,
      elapsedMs: Date.now() - t0,
      ts: new Date().toISOString(),
    });
  };
  return { log, elapsedSec: () => ((Date.now() - t0) / 1000).toFixed(1) };
}

function createRunLogger(send) {
  const t0 = Date.now();
  let step = 0;
  return (kind, text) => {
    step += 1;
    send({
      type: "log",
      index: -1,
      kind,
      text,
      step,
      elapsedMs: Date.now() - t0,
      ts: new Date().toISOString(),
    });
  };
}

async function checkOllama(model, onLog) {
  onLog?.("step", `Checking Ollama at ${OLLAMA.replace("/api/chat", "")}…`);
  try {
    const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Ollama tags HTTP ${res.status}`);
    const data = await res.json();
    const names = (data.models || []).map((m) => m.name);
    const hasModel = names.some((n) => n === model || n.startsWith(`${model}:`));
    onLog?.("result", `Ollama online · ${names.length} model(s) installed`);
    if (hasModel) onLog?.("result", `Model available · ${model}`);
    else onLog?.("warn", `Model "${model}" not in list — will try anyway (${names.slice(0, 4).join(", ")}${names.length > 4 ? "…" : ""})`);
    return true;
  } catch (e) {
    onLog?.("error", `Ollama unreachable · ${e.message} · run: ollama serve`);
    throw e;
  }
}

function scanJdSignals(jd) {
  const text = jd || "";
  const signals = [];
  if (/sponsorship|visa|h-?1b|work authorization|authorized to work|u\.?s\.? citizen|clearance|security clearance/i.test(text)) {
    signals.push("work-auth / sponsorship / clearance language detected");
  }
  if (/\b(\d+)\+?\s*years?\s*(of\s*)?(experience|exp)/i.test(text)) {
    const m = text.match(/\b(\d+)\+?\s*years?\s*(of\s*)?(experience|exp)/i);
    signals.push(`years-of-experience requirement ~${m?.[1] || "?"}y`);
  }
  if (/machine learning|artificial intelligence|\bml\b|\bai\b|llm|deep learning/i.test(text)) {
    signals.push("ML/AI keywords present");
  }
  if (/python|java|typescript|react|aws|kubernetes|spark/i.test(text)) {
    signals.push("core stack keywords present");
  }
  return signals;
}

function bankStats(bank) {
  const roleBullets = bank.roles.reduce((n, r) => n + r.bullets.length, 0);
  const projectBullets = bank.projects.reduce((n, p) => n + p.bullets.length, 0);
  return { roles: bank.roles.length, projects: bank.projects.length, bullets: roleBullets + projectBullets };
}

function logAssemblePlan(onLog, ai, bank) {
  const byId = new Map((ai.experience || []).filter((e) => bank.roles[e.role_id]).map((e) => [e.role_id, e]));
  const third = byId.has(1) ? 1 : byId.has(2) ? 2 : 1;
  const thirdName = bank.roles[third]?.name || `role ${third}`;
  onLog?.("step", "Enforcing fixed experience structure (SBU×4 + Accolite×4 + one of Wake/Shriffle×2)");
  onLog?.("think", `Third experience slot → ${thirdName} (role_id ${third})`);
  onLog?.("think", `Experience blocks: Stony Brook (4), Accolite (4), ${thirdName} (2)`);
  onLog?.("think", `Projects selected: ${(ai.projects || []).length} · ${(ai.projects || []).map((p) => bank.projects[p.project_id]?.name || p.project_id).join(", ") || "none"}`);
  const bulletCount =
    (ai.experience || []).reduce((n, e) => n + (e.bullets?.length || 0), 0) +
    (ai.projects || []).reduce((n, p) => n + (p.bullets?.length || 0), 0);
  onLog?.("think", `Total rewritten bullets going into .tex: ${bulletCount}`);
}

function logAiPlan(onLog, ai, bank) {
  if (!onLog) return;
  if (ai.eligible === false) {
    onLog("warn", `No-Go · ${ai.no_go_reason || "eligibility blocked — skipping PDF"}`);
    return;
  }
  const delta = (ai.ats_after ?? 0) - (ai.ats_before ?? 0);
  onLog("result", `Eligible · proceeding with one-page resume`);
  if (ai.selection_reason) onLog("result", `Why these bullets: ${ai.selection_reason}`);
  onLog("think", `ATS fit estimate: ${ai.ats_before}% → ${ai.ats_after}% (${delta >= 0 ? "+" : ""}${delta})`);
  if (ai.header_title) onLog("think", `Header title: ${ai.header_title}`);

  for (const exp of ai.experience || []) {
    const name = bank.roles[exp.role_id]?.name || `Role ${exp.role_id}`;
    const ids = (exp.bullets || []).map((b) => b.id).join(", ");
    onLog("think", `Experience · ${name} · ${exp.bullets?.length || 0} bullets [${ids}]`);
    for (const bullet of exp.bullets || []) {
      const preview = bullet.text.length > 100 ? `${bullet.text.slice(0, 100)}…` : bullet.text;
      onLog("think", `  ${bullet.id}: ${preview}`);
    }
  }

  for (const proj of ai.projects || []) {
    const name = bank.projects[proj.project_id]?.name || `Project ${proj.project_id}`;
    const ids = (proj.bullets || []).map((b) => b.id).join(", ");
    onLog("think", `Project · ${name} · ${proj.bullets?.length || 0} bullets [${ids}]`);
    for (const bullet of proj.bullets || []) {
      const preview = bullet.text.length > 100 ? `${bullet.text.slice(0, 100)}…` : bullet.text;
      onLog("think", `  ${bullet.id}: ${preview}`);
    }
  }

  if (ai.skills?.length) {
    onLog("think", `Skills stack (${ai.skills.length} lines) — JD-aligned, truth-filtered next`);
    for (const line of ai.skills) onLog("think", `  ${line.slice(0, 140)}${line.length > 140 ? "…" : ""}`);
  }
  if (ai.notes) onLog("think", `Biggest gap (not claimable): ${ai.notes}`);
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

function compileTex(dir, onLog) {
  const t0 = Date.now();
  onLog?.("step", `Running: tectonic resume.tex (cwd: ${dir})`);
  const r = spawnSync("tectonic", ["resume.tex"], { cwd: dir, encoding: "utf8" });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    const tail = err.slice(-500);
    onLog?.("error", `Tectonic failed after ${elapsed}s (exit ${r.status})`);
    for (const line of tail.split("\n").slice(-6).filter(Boolean)) onLog?.("error", `  ${line.slice(0, 200)}`);
    return { ok: false, err: tail.slice(-400) };
  }
  onLog?.("result", `Tectonic succeeded in ${elapsed}s`);
  const pdf = path.join(dir, "resume.pdf");
  const named = path.join(dir, "Atishay Kasliwal.pdf");
  if (fs.existsSync(pdf)) {
    fs.renameSync(pdf, named);
    onLog?.("result", `Renamed resume.pdf → Atishay Kasliwal.pdf`);
  } else {
    onLog?.("warn", "resume.pdf not found after compile — check tectonic output");
  }
  return { ok: true, pdf: named };
}

// ─── Per-job tailor ──────────────────────────────────────────────────────────
// `ctx.sendPhase(phase, extra)` + `ctx.log(kind, text)` report live progress.
async function tailorOne(job, resumeText, model, seq, dateDir, ctx) {
  const { sendPhase, log: onLog } = ctx;
  const company = job.company || "unknown";
  const role = job.title || "role";
  const folder = `${String(seq).padStart(2, "0")}-${slug(company, 24)}-${slug(role, 30)}`;
  const dir = path.join(dateDir, folder);

  onLog?.("step", `━━━ Job ${seq} · ${company} · ${role} ━━━`);
  onLog?.("step", `Creating output directory…`);
  fs.mkdirSync(dir, { recursive: true });
  onLog?.("result", `Directory ready · ${dir}`);

  const jd = (job.jd || "").trim();
  const jdLen = jd.length;
  const stats = bankStats(BANK);
  const signals = scanJdSignals(jd);

  onLog?.("step", `JD loaded · ${jdLen.toLocaleString()} chars`);
  if (job.job_url) onLog?.("think", `Source URL · ${job.job_url}`);
  if (job.score_pct != null) onLog?.("think", `Feed match score · ${job.score_pct}%`);
  for (const sig of signals) onLog?.("think", `JD signal · ${sig}`);
  if (!signals.length) onLog?.("think", "JD signal · no hard eligibility keywords matched (model will still screen)");

  onLog?.("step", `Loading engine bullet bank · ${stats.roles} roles · ${stats.projects} projects · ${stats.bullets} bullets`);
  onLog?.("step", `Safe-claim allowlist · ${SAFE_CLAIMS.size.toLocaleString()} verified tokens`);

  onLog?.("step", "Writing jd.txt…");
  fs.writeFileSync(path.join(dir, "jd.txt"), jd);
  onLog?.("result", "jd.txt saved");

  const meta = { company, role, url: job.job_url, score_pct: job.score_pct, tailored_at: new Date().toISOString(), model };
  onLog?.("step", "Writing meta.json…");
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  onLog?.("result", "meta.json saved");

  const result = { folder, company, role, dir, status: "ok" };
  try {
    onLog?.("step", "Phase 1/4 · Analyze — eligibility screen + bullet selection + rewrites");
    sendPhase("analyzing");

    onLog?.("think", "Building user message: full bullet bank + JD…");
    const user = buildUserMessage(BANK, jd);
    onLog?.("think", "System prompt: dynamic select-and-rewrite rules (fixed 3-role structure, truth guard)");

    const ai = await chatJSON(model, DYN_SYSTEM, user, DYN_SCHEMA, [6144, 9216], onLog);

    onLog?.("step", "Phase 1 complete · reviewing model output");
    if (ai.eligible === false) {
      logAiPlan(onLog, ai, BANK);
      onLog?.("step", "Writing optimizer.json (No-Go record)…");
      fs.writeFileSync(path.join(dir, "optimizer.json"), JSON.stringify(ai, null, 2));
      onLog?.("warn", "Skipping PDF generation due to eligibility block");
      result.status = "no-go";
      result.error = ai.no_go_reason || "eligibility blocked";
      sendPhase("done", result);
      return result;
    }

    logAiPlan(onLog, ai, BANK);

    // ── Self-critique pass: score every bullet, rewrite anything below 9 ──
    onLog?.("step", "Phase 1b · Self-critique — scoring every bullet, rewriting any below 9/10");
    try {
      const draft = collectDraftBullets(ai);
      const critique = await chatJSON(model, CRITIQUE_SYSTEM, buildCritiqueMessage(jd, draft), CRITIQUE_SCHEMA, [3072, 4608], onLog);
      const scores = (critique.bullets || []).map((b) => b.score);
      const low = (critique.bullets || []).filter((b) => b.score < 9);
      applyCritique(ai, critique);
      if (scores.length) {
        const avg = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
        onLog?.("result", `Critique done · avg ${avg}/10 · rewrote ${low.length}/${scores.length} weak bullet(s)`);
        for (const b of low) onLog?.("think", `  ↑ ${b.id} (${b.score}/10) → ${b.text.slice(0, 90)}${b.text.length > 90 ? "…" : ""}`);
      }
    } catch (e) {
      onLog?.("warn", `Critique pass skipped (${e.message}) — using first-draft bullets`);
    }

    // ── Metric lock (rule 28): flag any number not present in the bank ──
    const invented = [];
    const checkBullet = (b) => {
      for (const n of bulletNumbers(b.text)) {
        if (n.length <= 1 && !/[%kmb]/.test(n)) continue; // ignore bare single digits (counts like "3 streams")
        if (!BANK_NUMBERS.has(n)) invented.push(`${b.id}:${n}`);
      }
    };
    for (const exp of ai.experience || []) (exp.bullets || []).forEach(checkBullet);
    for (const proj of ai.projects || []) (proj.bullets || []).forEach(checkBullet);
    if (invented.length) {
      onLog?.("warn", `Metric lock · numbers NOT in bank (review for inflation): ${invented.join(", ")}`);
      ai._invented_metrics = invented;
    } else {
      onLog?.("result", "Metric lock passed — every number traces to a real bank bullet");
    }

    onLog?.("step", "Phase 2/4 · Truth guard — filtering skills against safe-claim allowlist");
    const droppedSkills = [];
    ai.skills = (ai.skills || []).map((line, i) => {
      onLog?.("think", `Checking skills line ${i + 1}/${ai.skills.length}…`);
      const { line: kept, dropped } = filterSkillsLine(line, SAFE_CLAIMS);
      droppedSkills.push(...dropped);
      if (dropped.length) onLog?.("warn", `  Dropped from line ${i + 1}: ${dropped.join(", ")}`);
      return kept;
    }).filter(Boolean);
    if (droppedSkills.length) {
      onLog?.("warn", `Truth guard total dropped: ${droppedSkills.join(", ")}`);
      ai._dropped_skills = droppedSkills;
      log(`  dropped fabricated skills: ${droppedSkills.join(", ")}`);
    } else {
      onLog?.("result", "Truth guard passed — every skill token verified against resume evidence");
    }

    onLog?.("step", "Writing optimizer.json…");
    fs.writeFileSync(path.join(dir, "optimizer.json"), JSON.stringify(ai, null, 2));
    onLog?.("result", "optimizer.json saved");
    result.ats = `${ai.ats_before}→${ai.ats_after}`;
    result.headerTitle = ai.header_title || "";

    onLog?.("step", "Phase 3/4 · Assemble — building one-page resume.tex");
    sendPhase("assembling");
    logAssemblePlan(onLog, ai, BANK);
    onLog?.("think", "Applying LaTeX preamble + header + education (fixed blocks)…");
    const tex = assembleResume(ai, BANK);
    onLog?.("think", `Base .tex size · ${tex.length.toLocaleString()} chars`);
    const withJd = tex.replace(/\\end\{document\}/, `\\end{document}\n\n% ==== JD: ${company} — ${role} ====\n% ${jd.replace(/\n/g, "\n% ").slice(0, 4000)}`);
    onLog?.("step", "Writing resume.tex (with JD appendix comment)…");
    fs.writeFileSync(path.join(dir, "resume.tex"), withJd);
    onLog?.("result", `resume.tex saved · ${withJd.length.toLocaleString()} chars`);

    onLog?.("step", "Phase 4/4 · Compile — Tectonic PDF");
    sendPhase("compiling");
    const c = compileTex(dir, onLog);
    result.pdf = c.ok;
    result.pdfPath = c.ok ? c.pdf : "";
    result.dropped = droppedSkills.length;
    if (!c.ok) {
      result.status = "tex-failed";
      result.error = c.err;
    } else {
      onLog?.("result", `✓ Complete · ATS ${result.ats} · ${c.pdf}`);
    }
  } catch (e) {
    result.status = "ai-failed";
    result.error = String(e.message || e);
    onLog?.("error", result.error);
  }
  sendPhase("done", result);
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
      const send = makeNdjsonSender(res);
      let heartbeat = null;
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

        res.writeHead(200, {
          "Content-Type": "application/x-ndjson",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        });
        if (typeof res.flushHeaders === "function") res.flushHeaders();
        const runLog = createRunLogger(send);

        runLog("step", `Server · POST /tailor received · ${jobs.length} job(s)`);
        runLog("think", `Resume text · ${resumeText.trim().length.toLocaleString()} chars from Settings`);
        runLog("result", `External drive mounted · ${path.dirname(OUT_ROOT)}`);
        runLog("think", `Output date folder · ${dateDir} · ${existing.length} existing run(s) today`);
        send({ type: "start", total: jobs.length, dateDir, model: useModel });
        runLog("result", `Stream started · model=${useModel}`);
        heartbeat = startStreamHeartbeat(send);
        log(`tailoring ${jobs.length} job(s) with ${useModel} → ${dateDir}`);

        for (let i = 0; i < jobs.length; i++) {
          const job = jobs[i];
          seq += 1;
          const index = i;
          runLog("step", `Queue · job ${i + 1}/${jobs.length} · ${job.company} · ${job.title}`);
          send({ type: "job", index, phase: "queued", company: job.company, role: job.title });
          const { log: jobLog } = createJobLogger(index, send);
          const r = await tailorOne(job, resumeText, useModel, seq, dateDir, {
            sendPhase: (phase, extra) => {
              send({ type: "job", index, phase, company: job.company, role: job.title, ...(extra || {}) });
            },
            log: jobLog,
          });
          runLog("result", `Job ${i + 1} finished · ${r.status}${r.ats ? ` · ATS ${r.ats}` : ""}${r.error ? ` · ${r.error.slice(0, 80)}` : ""}`);
          log(`  ${r.folder}: ${r.status}${r.ats ? ` (ATS ${r.ats}, ${r.dropped} dropped, pdf=${r.pdf})` : r.error ? ` — ${r.error}` : ""}`);
        }
        runLog("result", "All jobs processed · closing stream");
        send({ type: "end" });
        res.end();
      } catch (e) {
        // header may already be sent; emit an error event then close
        try { send({ type: "fatal", error: String(e.message || e) }); res.end(); }
        catch { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: String(e.message || e) })); }
      } finally {
        if (heartbeat) clearInterval(heartbeat);
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
