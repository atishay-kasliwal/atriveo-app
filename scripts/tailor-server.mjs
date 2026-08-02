#!/usr/bin/env node
/**
 * Atriveo local tailor sidecar.
 *
 * A browser cannot write to disk or reliably reach localhost services across
 * origins, and Cloudflare Pages Functions run in the cloud, not on this Mac.
 * This tiny Node server bridges that gap. It runs ALONGSIDE `npm run dev`,
 * accepts selected JDs from the feed, runs the AC evidence pipeline (beam + RCS),
 * compiles with tectonic, and writes everything to the external drive.
 * Set TAILOR_LEGACY=1 to use the old Gemma bullet-rewrite path.
 *
 * Run:  npm run tailor
 * Then: in the app, select jobs → "Tailor selected".
 *
 * No external dependencies — Node built-ins only.
 */
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import dotenv from "dotenv";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadBullets, loadSafeClaims, loadBankNumbers, bulletNumbers } from "./tailor-bank.mjs";
import {
  SYSTEM_PROMPT as DYN_SYSTEM, RESPONSE_SCHEMA as DYN_SCHEMA,
  CRITIQUE_SYSTEM, CRITIQUE_SCHEMA,
  buildUserMessage, assembleResume, filterSkillsLine,
  collectDraftBullets, buildCritiqueMessage, applyCritique,
  dedupeVerbs, dedupeSkills,
} from "./tailor-dynamic.mjs";
import { buildSkillsLines, capSkillsLineToOnePhysicalLine } from "./skills-library.mjs";
import { tailorOneAc, readAtsFromDir } from "./tailor-ac.mjs";
import { readManifest, getArtifactsRoot } from "./ac-artifact-store.mjs";
import { withMongo, closeMongo } from "./mongo-client.mjs";
import { listCompileJobs, findJobByFingerprint, enqueueJob, enqueueTopJobs, enqueueFreshSessionJobs, cancelCompileJob, enqueueJobs, countActiveCompileJobs, countPipelineKpis, lookupJobsByUrl, fetchDescription } from "./resume-queue.mjs";
import { serveCompileQueueStream } from "./compile-queue-stream.mjs";
import { listActiveWorkers } from "./worker-registry.mjs";
import { buildCoverLetter } from "./cover-letter.mjs";
import {
  startScrape, cancelScrape, readScrapeState, tailScrapeLog, readScrapeEstimate,
  isScrapeRunning, SCRAPE_PHASES, JOB_PIPELINE_DIR, SCRAPE_SCRIPT,
} from "./scrape-control.mjs";

dotenv.config();

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(SCRIPT_DIR, "..");
dotenv.config({ path: path.join(ROOT, ".env") });
dotenv.config({ path: path.join(ROOT, ".env.tailor") });

// Load the engine bank once at startup.
const RECOVER_SCRIPT = path.join(SCRIPT_DIR, "tailor-recover.mjs");
function spawnRecover(reason) {
  try {
    const child = spawn(process.execPath, [RECOVER_SCRIPT, `--reason=${reason}`], {
      detached: true,
      stdio: "ignore",
      cwd: path.join(SCRIPT_DIR, ".."),
    });
    child.unref();
    log(`auto-recovery spawned · ${reason}`);
  } catch (e) {
    log(`auto-recovery spawn failed · ${e.message}`);
  }
}

function isRecoverableServerError(message) {
  const err = String(message || "").toLowerCase();
  return (
    err.includes("fetch failed")
    || err.includes("disconnected")
    || err.includes("ollama unreachable")
    || err.includes("econnreset")
    || err.includes("socket hang up")
  );
}

const BANK = loadBullets();
const SAFE_CLAIMS = loadSafeClaims(BANK);
const BANK_NUMBERS = loadBankNumbers(BANK);

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT = 8787;
const TAILOR_TOKEN = process.env.TAILOR_TOKEN?.trim() || "";
const DEFAULT_MODEL = "gemma4:12b";
const USE_LEGACY = process.env.TAILOR_LEGACY === "1";
const AC_PLANNER = process.env.TAILOR_PLANNER?.trim() || "v2";
const AC_LEARN = process.env.TAILOR_LEARN === "1";
const OUT_ROOT = process.env.TAILOR_OUT_ROOT?.trim() || path.join(os.homedir(), "Documents", "tailored-resumes");
const TEMPLATE =
  "/Users/atishaykasliwal/atriveo-app/resume-engine/tailored/2026-06-12/04-veryai-fullstack-engineer/resume.tex";

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

function companySlug(s, max = 32) {
  // PascalCase: strip non-alphanumeric, title-case each word, join without separator
  return String(s || "")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("")
    .slice(0, max) || "Unknown";
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

const OLLAMA_HOST = "127.0.0.1";
const OLLAMA_PORT = 11434;
const OLLAMA_TRANSIENT_RETRIES = 3;
const MIN_FULL_JD_CHARS = 400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientOllamaError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("fetch failed")
    || msg.includes("econnreset")
    || msg.includes("etimedout")
    || msg.includes("socket hang up")
    || msg.includes("aborted")
    || msg.includes("broken pipe")
    || msg.includes("disconnected")
  );
}

/** Node fetch() uses Undici's 300s body timeout — use http for long Ollama streams. */
function ollamaHttpRequest(payload, stream = false) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ keep_alive: "30m", ...payload });
    const req = http.request(
      {
        hostname: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: "/api/chat",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        res.socket?.setTimeout(0);
        res.setTimeout(0);

        if (res.statusCode >= 400) {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            reject(new Error(`Ollama HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 400)}`));
          });
          res.on("error", reject);
          return;
        }

        if (!stream) {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString()));
            } catch (e) {
              reject(new Error(`Ollama invalid JSON: ${e.message}`));
            }
          });
          res.on("error", reject);
          return;
        }

        resolve(res);
      },
    );
    req.on("error", reject);
    req.setTimeout(0);
    req.write(body);
    req.end();
  });
}

function readOllamaStream(res, handlers = {}) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let content = "";
    let thinkBuf = "";
    let doneReason = null;
    let evalCount = null;

    const processLine = (line) => {
      if (!line.trim()) return;
      let chunk;
      try { chunk = JSON.parse(line); } catch { return; }
      if (chunk.message?.thinking) {
        thinkBuf += chunk.message.thinking;
        handlers.onThink?.(thinkBuf);
      }
      if (chunk.message?.content) {
        content += chunk.message.content;
        handlers.onContent?.(content, thinkBuf);
      }
      if (chunk.done_reason) doneReason = chunk.done_reason;
      if (chunk.eval_count != null) evalCount = chunk.eval_count;
    };

    res.on("data", (raw) => {
      buffer += raw.toString();
      const parts = buffer.split("\n");
      buffer = parts.pop() || "";
      for (const line of parts) processLine(line);
    });
    res.on("end", () => {
      if (buffer.trim()) processLine(buffer);
      resolve({ content, thinkBuf, doneReason, evalCount });
    });
    res.on("error", reject);
  });
}

async function callOllamaOnce(model, jd, resumeText, numPredict) {
  const payload = {
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
  const data = await ollamaHttpRequest(payload, false);
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
    let truncated = false;

    for (let transientTry = 0; transientTry < OLLAMA_TRANSIENT_RETRIES; transientTry++) {
      if (transientTry > 0) {
        onLog?.("warn", `Ollama connection lost — retry ${transientTry + 1}/${OLLAMA_TRANSIENT_RETRIES} in 5s…`);
        await sleep(5000);
        await checkOllama(model, onLog);
      }

      const retrySuffix = transientTry > 0 ? ` · reconnect ${transientTry + 1}` : "";
      onLog?.("step", `[Attempt ${attempt + 1}/${budgets.length}] POST Ollama /api/chat · model=${model} · max_output=${budget.toLocaleString()} tokens${retrySuffix}`);

      const payload = {
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

      const ollamaKeepalive = onLog
        ? setInterval(() => {
            const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
            onLog(
              "step",
              `Ollama working… ${elapsed}s elapsed${content ? ` · JSON ${content.length.toLocaleString()} chars` : ""}${thinkBuf ? ` · thinking ${thinkBuf.length.toLocaleString()} chars` : ""}`,
            );
          }, STREAM_HEARTBEAT_MS)
        : null;

      const emitThinkLines = () => {
        if (!onLog) return;
        const lines = thinkBuf.split("\n");
        while (thinkLineEmitted < lines.length - 1) {
          const line = lines[thinkLineEmitted].trim();
          if (line) onLog("think", line);
          thinkLineEmitted += 1;
        }
      };

      try {
        const res = await ollamaHttpRequest(payload, true);
        onLog?.("result", "Ollama stream opened — waiting for model response…");

        const streamResult = await readOllamaStream(res, {
          onThink: (buf) => {
            thinkBuf = buf;
            emitThinkLines();
          },
          onContent: (nextContent, buf) => {
            content = nextContent;
            thinkBuf = buf;
          },
        });
        content = streamResult.content;
        thinkBuf = streamResult.thinkBuf;
        doneReason = streamResult.doneReason;
        evalCount = streamResult.evalCount;
      } catch (e) {
        const elapsedSec = ((Date.now() - t0) / 1000).toFixed(0);
        if (isTransientOllamaError(e) && transientTry < OLLAMA_TRANSIENT_RETRIES - 1) {
          onLog?.("error", `${e.message} (${elapsedSec}s elapsed)`);
          continue;
        }
        if (isTransientOllamaError(e)) {
          throw new Error(
            `Ollama disconnected after ${elapsedSec}s — restart Ollama (ollama serve) or try a smaller model`,
          );
        }
        throw e;
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
        truncated = true;
        break;
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

    if (truncated) continue;
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

// Health-check Ollama with retries. A cold model load from the external drive
// (--no-mmap reads the whole model into RAM) can stall even the lightweight
// /api/tags call for 10-30s, so a single 5s timeout would wrongly declare a
// healthy-but-warming Ollama "unreachable" and fail the whole job. Retry with
// growing timeouts before giving up.
const OLLAMA_HEALTH_TIMEOUTS = [8000, 15000, 25000];

async function checkOllama(model, onLog) {
  onLog?.("step", `Checking Ollama at http://${OLLAMA_HOST}:${OLLAMA_PORT}…`);
  let lastErr;
  for (let attempt = 0; attempt < OLLAMA_HEALTH_TIMEOUTS.length; attempt++) {
    const timeout = OLLAMA_HEALTH_TIMEOUTS[attempt];
    if (attempt > 0) {
      onLog?.("warn", `Ollama not ready (likely loading a model) — retry ${attempt + 1}/${OLLAMA_HEALTH_TIMEOUTS.length}, waiting up to ${timeout / 1000}s…`);
    }
    try {
      const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw new Error(`Ollama tags HTTP ${res.status}`);
      const data = await res.json();
      const names = (data.models || []).map((m) => m.name);
      const hasModel = names.some((n) => n === model || n.startsWith(`${model}:`));
      onLog?.("result", `Ollama online · ${names.length} model(s) installed`);
      if (hasModel) onLog?.("result", `Model available · ${model}`);
      else onLog?.("warn", `Model "${model}" not in list — will try anyway (${names.slice(0, 4).join(", ")}${names.length > 4 ? "…" : ""})`);
      return true;
    } catch (e) {
      lastErr = e;
      if (attempt < OLLAMA_HEALTH_TIMEOUTS.length - 1) await sleep(2000);
    }
  }
  onLog?.("error", `Ollama unreachable after ${OLLAMA_HEALTH_TIMEOUTS.length} tries · ${lastErr?.message} · run: ollama serve`);
  throw lastErr;
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

// Count pages in the COMPILED PDF — the authoritative answer. tectonic writes
// fully compressed PDFs (FlateDecode object streams), so the page objects are
// hidden inside zlib streams. We inflate every stream and count /Type /Page
// objects (excluding /Pages). This is exact, unlike a content-length estimate.
// Node built-in zlib only. Returns null if it can't be determined.
function pdfPageCount(pdfPath) {
  try {
    const data = fs.readFileSync(pdfPath);
    let pages = 0;
    // inflate each `stream ... endstream` chunk and count page objects inside
    const re = /stream\r?\n/g;
    let m;
    while ((m = re.exec(data.toString("latin1"))) !== null) {
      const start = m.index + m[0].length;
      const end = data.toString("latin1").indexOf("endstream", start);
      if (end === -1) continue;
      const chunk = data.subarray(start, end);
      try {
        const dec = zlib.inflateSync(chunk).toString("latin1");
        pages += (dec.match(/\/Type\s*\/Page(?![s])/g) || []).length;
      } catch { /* not a flate stream */ }
    }
    // also count any uncompressed page objects in the raw bytes
    pages += (data.toString("latin1").match(/\/Type\s*\/Page(?![s])/g) || []).length;
    return pages > 0 ? pages : null;
  } catch {
    return null;
  }
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
  const pages = pdfPageCount(named);
  if (pages != null) {
    if (pages > 1) {
      onLog?.("warn", `PDF is ${pages} pages — RULEBOOK requires ONE page. Bullets ran long; regenerate tighter.`);
    } else {
      onLog?.("result", "Page check passed · 1 page");
    }
  }
  return { ok: true, pdf: named, pages };
}

// ─── Per-job tailor ──────────────────────────────────────────────────────────
// `ctx.sendPhase(phase, extra)` + `ctx.log(kind, text)` report live progress.
async function tailorOne(job, resumeText, model, seq, dateDir, ctx) {
  if (!USE_LEGACY) {
    return tailorOneAc(job, seq, dateDir, ctx, { planner: AC_PLANNER, learn: AC_LEARN });
  }

  const { sendPhase, log: onLog } = ctx;
  const company = job.company || "unknown";
  const role = job.title || "role";
  // dateDir is OUT_ROOT/YYYY-MM-DD; folders named CompanyName(12thJuly)
  const companyPart = companySlug(company, 32);
  const now = new Date();
  const day = now.getDate();
  const suffix = day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th';
  const month = now.toLocaleString('en-US', { month: 'long' });
  const datePart = `${day}${suffix}${month}`;
  const folder = `${companyPart} (${datePart})`;
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
  if (jdLen < MIN_FULL_JD_CHARS) {
    onLog?.("warn", `JD too short (${jdLen} chars < ${MIN_FULL_JD_CHARS}) — full LinkedIn text missing; skipping to avoid bad output`);
    result.status = "no-jd";
    result.error = `JD too short (${jdLen} chars) — paste the full JD in Tailor Lab or wait for scrape`;
    sendPhase("done", result);
    return result;
  }
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

    // Clamp ATS to 0-100 — some models ignore the schema max and emit junk like 90000.
    const clampPct = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
    ai.ats_before = clampPct(ai.ats_before);
    ai.ats_after = clampPct(ai.ats_after);

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

    // ── Unique action verbs (deterministic — models repeat them) ──
    dedupeVerbs(ai);
    onLog?.("result", "Unique-verb pass — every bullet starts with a distinct action verb");

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

    // Skills come from the curated library, SELECTED against this JD — not from
    // the model's free-form guess. The library is truthful + canonically named,
    // so it never invents a skill, never duplicates an alias, and (capped here)
    // always fits one physical line. The model's filtered skills are a fallback.
    onLog?.("step", "Phase 2/4 · Skills — selecting from curated library against the JD");
    const libSkills = buildSkillsLines(jd);
    if (libSkills.length >= 4) {
      ai.skills = libSkills;
      onLog?.("result", `Library selected ${libSkills.length} JD-aligned lines (truthful, one line each)`);
      for (const line of libSkills) onLog?.("think", `  ${line}`);
    } else {
      onLog?.("warn", "Library produced too few lines — falling back to model skills + truth guard");
      const droppedSkills = [];
      ai.skills = (ai.skills || []).map((line, i) => {
        const { line: kept, dropped } = filterSkillsLine(line, SAFE_CLAIMS);
        droppedSkills.push(...dropped);
        if (dropped.length) onLog?.("warn", `  Dropped from line ${i + 1}: ${dropped.join(", ")}`);
        return kept;
      }).filter(Boolean);
      if (droppedSkills.length) {
        ai._dropped_skills = droppedSkills;
        log(`  dropped fabricated skills: ${droppedSkills.join(", ")}`);
      }
      ai.skills = dedupeSkills(ai.skills);
    }

    // Final one-physical-line guard on every line, regardless of source — trim
    // the least-relevant items from the END until the rendered line never wraps.
    ai.skills = (ai.skills || []).map((line) => {
      const colon = line.indexOf(":");
      if (colon === -1) return line;
      const label = line.slice(0, colon);
      const items = line.slice(colon + 1).split(",").map((s) => s.trim()).filter(Boolean);
      const capped = capSkillsLineToOnePhysicalLine(label, items);
      if (capped.length < items.length) {
        onLog?.("think", `  Trimmed "${label}" to fit one line: ${items.length}→${capped.length} items`);
      }
      return `${label}: ${capped.join(", ")}`;
    }).filter(Boolean);

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
    result.pages = c.pages ?? null;
    if (!c.ok) {
      result.status = "tex-failed";
      result.error = c.err;
    } else {
      // Still a success (PDF exists), but flag overflow so it is visible, not silent.
      result.overflow = c.pages != null && c.pages > 1;
      onLog?.("result", `✓ Complete · ATS ${result.ats}${result.overflow ? ` · ⚠ ${c.pages} pages` : " · 1 page"} · ${c.pdf}`);
    }
  } catch (e) {
    result.status = "ai-failed";
    result.error = String(e.message || e);
    onLog?.("error", result.error);
    if (isRecoverableServerError(result.error)) {
      spawnRecover(result.error);
    }
  }
  sendPhase("done", result);
  return result;
}

// ─── HTTP server ─────────────────────────────────────────────────────────────
let tailorBusy = false;

// /list-tailored walks the whole external drive tree (slow on exfat over
// USB), and the dashboard polls it every few seconds. Cache briefly so
// polling doesn't re-scan the drive on every request and stall the
// single-threaded server.
let listTailoredCache = null; // { at: number, resumes: [] }
const LIST_TAILORED_CACHE_MS = 30_000;

const server = http.createServer(async (req, res) => {
  // permissive CORS so the Vite dev origin can reach us
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Tailor-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS,DELETE");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  const reqUrl = new URL(req.url || "/", "http://127.0.0.1");
  const pathname = reqUrl.pathname;
  if (TAILOR_TOKEN && req.headers["x-tailor-token"] !== TAILOR_TOKEN) {
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
  }

  if (req.method === "GET" && pathname === "/health") {
    const driveOk = fs.existsSync(path.dirname(OUT_ROOT));
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      ok: true,
      driveMounted: driveOk,
      outRoot: OUT_ROOT,
      artifactsRoot: getArtifactsRoot(),
      mongo: Boolean(process.env.MONGO_URI),
      pipeline: USE_LEGACY ? "legacy" : "ac",
      planner: USE_LEGACY ? null : AC_PLANNER,
      scrape: {
        available: fs.existsSync(SCRAPE_SCRIPT),
        running: isScrapeRunning(),
        pipelineDir: JOB_PIPELINE_DIR,
      },
    }));
  }

  // ─── On-demand scrape ──────────────────────────────────────────────────────
  // Replaces the hourly LaunchAgent: the app starts a run, polls status, and
  // can stop it. See scripts/scrape-control.mjs.

  if (req.method === "GET" && pathname === "/scrape/status") {
    const state = readScrapeState();
    const wantLog = reqUrl.searchParams.get("log") === "1";
    const lines = Number.parseInt(reqUrl.searchParams.get("lines") || "40", 10);
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({
      ok: true,
      running: isScrapeRunning(),
      knownPhases: SCRAPE_PHASES,
      state,
      estimate: readScrapeEstimate(),
      logLines: wantLog ? tailScrapeLog(Number.isFinite(lines) ? lines : 40) : undefined,
    }));
  }

  if (req.method === "GET" && pathname === "/scrape/log") {
    const lines = Number.parseInt(reqUrl.searchParams.get("lines") || "200", 10);
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({
      ok: true,
      lines: tailScrapeLog(Number.isFinite(lines) ? lines : 200),
    }));
  }

  if (req.method === "POST" && pathname === "/scrape/start") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let opts = {};
      try {
        opts = raw.trim() ? JSON.parse(raw) : {};
      } catch {
        opts = {};
      }
      const result = startScrape({
        skipResume: opts.skipResume === true,
        skipDeploy: opts.skipDeploy === true,
      });
      const status = result.ok ? 200 : (result.code ?? 500);
      log(result.ok ? `scrape started · ${result.runId}` : `scrape start rejected · ${result.error}`);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    });
    return;
  }

  if (req.method === "POST" && pathname === "/scrape/cancel") {
    const result = cancelScrape();
    log(result.ok ? `scrape cancelled · pid ${result.pid}` : `scrape cancel noop · ${result.error}`);
    res.writeHead(result.ok ? 200 : (result.code ?? 500), { "Content-Type": "application/json" });
    return res.end(JSON.stringify(result));
  }

  if (req.method === "POST" && pathname === "/tailor") {
    if (tailorBusy) {
      res.writeHead(503, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        ok: false,
        error: "Tailor busy — another job is still running on your Mac. Wait for it to finish.",
      }));
    }
    let raw = "";
    let clientGone = false;
    req.on("data", (c) => (raw += c));
    // Do NOT free tailorBusy on client disconnect. The tailoring work in the
    // "end" handler keeps running (Ollama + compile finish on the Mac), and its
    // own finally{} frees tailorBusy when truly done. Freeing it here on a page
    // refresh would let a SECOND job start and fight the first for the GPU —
    // which surfaced as "Connection dropped" failures. We just note the client
    // is gone so streaming can stop early; the PDF still gets written, and the
    // browser recovers it via /check-job.
    req.on("close", () => {
      if (!res.writableEnded) {
        clientGone = true;
        log("client disconnected mid-stream — job continues on the Mac, will finish + write PDF");
      }
    });
    req.on("end", async () => {
      tailorBusy = true;
      // Stream newline-delimited JSON events so the frontend shows live, per-job
      // progress instead of waiting minutes for one big response.
      const send = makeNdjsonSender(res);
      let heartbeat = null;
      try {
        const { jobs, resumeText, model } = JSON.parse(raw);
        if (!Array.isArray(jobs) || !jobs.length) throw new Error("no jobs");
        if (USE_LEGACY && (!resumeText || resumeText.trim().length < 50)) {
          throw new Error("resume text missing — save it in Settings first");
        }
        if (!fs.existsSync(path.dirname(OUT_ROOT))) throw new Error(`external drive not mounted: ${path.dirname(OUT_ROOT)}`);

        const useModel = model || DEFAULT_MODEL;
        const date = new Date().toISOString().slice(0, 10);
        // Structure: OUT_ROOT/YYYY-MM-DD/company-slug/HH-MM_NN_role-slug/
        const dateDir = path.join(OUT_ROOT, date);
        fs.mkdirSync(dateDir, { recursive: true });
        let existingToday = 0;
        try {
          for (const co of fs.readdirSync(dateDir)) {
            const coPath = path.join(dateDir, co);
            if (!fs.statSync(coPath).isDirectory()) continue;
            existingToday += fs.readdirSync(coPath).length;
          }
        } catch { /* dateDir may be empty */ }
        let seq = existingToday;

        res.writeHead(200, {
          "Content-Type": "application/x-ndjson",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        });
        if (typeof res.flushHeaders === "function") res.flushHeaders();
        const runLog = createRunLogger(send);

        runLog("step", `Server · POST /tailor received · ${jobs.length} job(s)`);
        if (USE_LEGACY) {
          runLog("think", `Resume text · ${resumeText.trim().length.toLocaleString()} chars from Settings`);
        } else {
          runLog("think", `AC pipeline · planner=${AC_PLANNER} · evidence bank (no Gemma rewrites)`);
        }
        runLog("result", `External drive mounted · ${path.dirname(OUT_ROOT)}`);
        runLog("think", `Output date folder · ${dateDir} · ${existingToday} run(s) today`);
        send({ type: "start", total: jobs.length, dateDir, model: USE_LEGACY ? useModel : `ac:${AC_PLANNER}` });
        runLog("result", USE_LEGACY ? `Stream started · model=${useModel}` : `Stream started · AC pipeline v2`);
        heartbeat = startStreamHeartbeat(send);
        log(`tailoring ${jobs.length} job(s) ${USE_LEGACY ? `with ${useModel}` : `via AC/${AC_PLANNER}`} → ${dateDir}`);

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
        tailorBusy = false;
      }
    });
    return;
  }

  if (req.method === "POST" && pathname === "/recover") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let reason = "manual";
      try {
        if (raw.trim()) reason = JSON.parse(raw).reason || reason;
      } catch {
        /* ignore */
      }
      spawnRecover(reason);
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: "Recovery started on Mac — check Queue log in ~30s" }));
    });
    return;
  }

  // Check if a job already completed on disk (used after stream drop/timeout).
  // POST /check-job { company, title, job_url? } → { ok, found, pdfPath, dir, folder, ats }
  // List ALL tailored resumes that exist on disk (source of truth, independent
  // of the browser's localStorage). Scans the last few date folders so the
  // UTC/EST date boundary never hides today's runs. GET /list-tailored
  if (req.method === "GET" && pathname === "/list-tailored") {
    try {
      const fresh = listTailoredCache && (Date.now() - listTailoredCache.at) < LIST_TAILORED_CACHE_MS;
      if (fresh) {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ ok: true, resumes: listTailoredCache.resumes, cached: true }));
      }

      const out = [];
      const rootExists = await fsp.access(OUT_ROOT).then(() => true).catch(() => false);
      if (rootExists) {
        // Structure: OUT_ROOT/YYYY-MM-DD/company-slug/HH-MM_NN_role/
        const rootEntries = await fsp.readdir(OUT_ROOT);
        const dateDirs = rootEntries
          .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
          .sort().reverse().slice(0, 7);
        for (const dd of dateDirs) {
          const dateDir = path.join(OUT_ROOT, dd);
          let companyDirs;
          try { companyDirs = (await fsp.readdir(dateDir)).filter((d) => !d.startsWith(".")); }
          catch { continue; }
          for (const co of companyDirs) {
            const coDir = path.join(dateDir, co);
            try { if (!(await fsp.stat(coDir)).isDirectory()) continue; } catch { continue; }
            let folders;
            try { folders = await fsp.readdir(coDir); }
            catch { continue; }
            for (const folder of folders) {
              const dir = path.join(coDir, folder);
              const pdfPath = path.join(dir, "Atishay Kasliwal.pdf");
              const hasPdf = await fsp.access(pdfPath).then(() => true).catch(() => false);
              if (!hasPdf) continue;
              let meta = {};
              try { meta = JSON.parse(await fsp.readFile(path.join(dir, "meta.json"), "utf8")); } catch { /* none */ }
              const ats = readAtsFromDir(dir);
              let explain = null;
              try { explain = JSON.parse(await fsp.readFile(path.join(dir, "explain.json"), "utf8")); } catch { /* none */ }
              out.push({
                folder,
                dateDir: dd,
                dir,
                pdfPath,
                company: meta.company || co,
                title: meta.role || "",
                jobUrl: meta.url || "",
                score: meta.score_pct ?? null,
                ats,
                tailoredAt: meta.tailored_at || null,
                identity: explain?.engineering_identity?.primary || null,
                informationGain: explain?.information_gain ?? null,
                borderline: Boolean(explain?.borderline),
              });
            }
          }
        }
      }
      // newest first by tailoredAt
      out.sort((a, b) => new Date(b.tailoredAt || 0) - new Date(a.tailoredAt || 0));
      listTailoredCache = { at: Date.now(), resumes: out };
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ ok: true, resumes: out }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
  }

  if (req.method === "POST" && pathname === "/check-job") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      try {
        const { company, title, job_url: jobUrlRaw } = JSON.parse(raw);
        if (!company || !title) throw new Error("company and title required");
        const compSlug = slug(company, 32);
        const titleSlug = slug(title, 40);
        const jobUrl = typeof jobUrlRaw === "string" ? jobUrlRaw.trim() : "";
        // Scan recent date dirs (most runs land within the last week; a full
        // history scan on every check-job call is what starves the server).
        const rootExists = await fsp.access(OUT_ROOT).then(() => true).catch(() => false);
        const dateDirs = rootExists
          ? (await fsp.readdir(OUT_ROOT)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse().slice(0, 14)
          : [];
        let best = null; let bestDir = null;
        for (const dd of dateDirs) {
          const dateDir = path.join(OUT_ROOT, dd);
          let companyDirs;
          try { companyDirs = (await fsp.readdir(dateDir)).filter((d) => !d.startsWith(".")); }
          catch { continue; }
          for (const co of companyDirs) {
            const coDir = path.join(dateDir, co);
            try { if (!(await fsp.stat(coDir)).isDirectory()) continue; } catch { continue; }
            let runs;
            try { runs = (await fsp.readdir(coDir)).sort().reverse(); }
            catch { continue; }
            for (const folder of runs) {
              const dir = path.join(coDir, folder);
              const pdfPath = path.join(dir, "Atishay Kasliwal.pdf");
              const hasPdf = await fsp.access(pdfPath).then(() => true).catch(() => false);
              if (!hasPdf) continue;
              let meta = {};
              try { meta = JSON.parse(await fsp.readFile(path.join(dir, "meta.json"), "utf8")); } catch { /* none */ }

              if (jobUrl && meta.url === jobUrl) {
                const ats = readAtsFromDir(dir);
                res.writeHead(200, { "Content-Type": "application/json" });
                return res.end(JSON.stringify({ ok: true, found: true, pdfPath, dir, folder, ats }));
              }

              const folderTitleSlug = slug(meta.role || folder, 40);
              const folderCompanySlug = slug(meta.company || co, 32);
              const companyMatch = folderCompanySlug === compSlug || co === compSlug;
              const titleMatch = folderTitleSlug.includes(titleSlug) || folder.includes(titleSlug);

              if (companyMatch && titleMatch) {
                best = folder;
                bestDir = coDir;
                break;
              }
              if (!best && companyMatch) {
                best = folder;
                bestDir = coDir;
              }
            }
            if (best) break;
          }
          if (best) break;
        }
        if (!best) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: true, found: false }));
        }
        const dir = path.join(bestDir, best);
        const pdfPath = path.join(dir, "Atishay Kasliwal.pdf");
        const hasPdf = await fsp.access(pdfPath).then(() => true).catch(() => false);
        const ats = readAtsFromDir(dir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, found: hasPdf, pdfPath: hasPdf ? pdfPath : null, dir, folder: best, ats }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }

  // Read composition + explain artifacts for diff / explain UI. GET /resume-artifacts?dir=...
  if (req.method === "GET" && pathname === "/resume-artifacts") {
    try {
      const rawDir = reqUrl.searchParams.get("dir");
      if (!rawDir) throw new Error("dir required");
      const dir = path.resolve(rawDir);
      const root = path.resolve(OUT_ROOT);
      if (!dir.startsWith(root + path.sep)) throw new Error("invalid path");
      if (!fs.existsSync(dir)) throw new Error("not found");

      let explain = null;
      let composition = null;
      try { explain = JSON.parse(fs.readFileSync(path.join(dir, "explain.json"), "utf8")); } catch { /* none */ }
      try { composition = JSON.parse(fs.readFileSync(path.join(dir, "composition.json"), "utf8")); } catch { /* none */ }

      const selectedAcs = composition?.selected_acs
        || composition?.gate?.metrics?.selected_acs
        || [];
      const inner = composition?.composition || {};
      const coverage = inner.coverage || composition?.coverage || null;
      const graphCoverage = composition?.global_optimize?.after?.profile?.graph_coverage
        || composition?.global_optimize?.profile?.graph_coverage
        || null;
      const hiringManager = composition?.hiring_manager_test
        || composition?.quality?.hiring_manager_test
        || inner?.quality?.hiring_manager_test
        || null;
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({
        ok: true,
        dir,
        selectedAcs: Array.isArray(selectedAcs) ? selectedAcs : [],
        explain,
        identity: explain?.engineering_identity?.primary || null,
        informationGain: explain?.information_gain ?? null,
        borderline: Boolean(explain?.borderline),
        coverage,
        graphCoverage,
        hiringManager,
      }));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
  }

  // GET /compile-workers — active worker fleet (heartbeats)
  if (req.method === "GET" && pathname === "/compile-workers") {
    (async () => {
      try {
        if (!process.env.MONGO_URI) throw new Error("MONGO_URI not configured");
        const workers = await withMongo((db) => listActiveWorkers(db), { appName: "AtriveoTailorServer" });
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: true, workers }));
      } catch (e) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    })();
    return;
  }

  // GET /compile-queue/stream — SSE live updates via Mongo change stream
  if (req.method === "GET" && pathname === "/compile-queue/stream") {
    (async () => {
      try {
        if (!process.env.MONGO_URI) throw new Error("MONGO_URI not configured");
        const limit = Math.min(Number(reqUrl.searchParams.get("limit") || 120), 200);
        await serveCompileQueueStream(req, res, { limit });
      } catch (e) {
        if (!res.headersSent) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
      }
    })();
    return;
  }

  // GET /compile-queue/kpis — postings vs resumes (Mongo, ET today + latest hour)
  if (req.method === "GET" && pathname === "/compile-queue/kpis") {
    (async () => {
      try {
        if (!process.env.MONGO_URI) throw new Error("MONGO_URI not configured");
        const kpis = await withMongo((db) => countPipelineKpis(db), { appName: "AtriveoTailorServer" });
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: true, ...kpis }));
      } catch (e) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    })();
    return;
  }

  // GET /compile-queue/stats — active queued + running counts (Mongo)
  if (req.method === "GET" && pathname === "/compile-queue/stats") {
    (async () => {
      try {
        if (!process.env.MONGO_URI) throw new Error("MONGO_URI not configured");
        const stats = await withMongo((db) => countActiveCompileJobs(db), { appName: "AtriveoTailorServer" });
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: true, ...stats }));
      } catch (e) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    })();
    return;
  }

  // GET /compile-queue?status=queued — Mongo-backed compile queue (observe-only)
  if (req.method === "GET" && pathname === "/compile-queue") {
    (async () => {
      try {
        if (!process.env.MONGO_URI) throw new Error("MONGO_URI not configured");
        const status = reqUrl.searchParams.get("status") || undefined;
        const limit = Math.min(Number(reqUrl.searchParams.get("limit") || 50), 2000);
        const jobs = await withMongo((db) => listCompileJobs(db, { status, limit }), { appName: "AtriveoTailorServer" });
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: true, jobs }));
      } catch (e) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    })();
    return;
  }

  // POST /compile-queue/lookup { urls: string[] } — fetch queue entries for specific job URLs
  // Used by the dock to resolve already_success skips that fall outside the paginated list
  if (req.method === "POST" && pathname === "/compile-queue/lookup") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      (async () => {
        try {
          if (!process.env.MONGO_URI) throw new Error("MONGO_URI not configured");
          const body = JSON.parse(raw || "{}");
          const urls = Array.isArray(body.urls) ? body.urls.slice(0, 500) : [];
          if (!urls.length) throw new Error("urls array required");
          const jobs = await withMongo((db) => lookupJobsByUrl(db, urls), { appName: "AtriveoTailorServer" });
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ ok: true, jobs }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
      })();
    });
    return;
  }

  // POST /compile-enqueue — queue one job { job_url, company, title, score_pct?, force? }
  if (req.method === "POST" && pathname === "/compile-enqueue") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      (async () => {
        try {
          if (!process.env.MONGO_URI) throw new Error("MONGO_URI not configured");
          const body = JSON.parse(raw || "{}");
          if (!body.job_url) throw new Error("job_url required");
          const result = await withMongo(
            (db) => enqueueJob(db, {
              ...body,
              priority: body.force ? undefined : body.priority,
              source: body.force ? "manual" : body.source,
            }, { force: body.force === true }),
            { appName: "AtriveoTailorServer" },
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, ...result }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
      })();
    });
    return;
  }

  // POST /compile-enqueue-top { limit?, min_score? } — hourly fresh session jobs only
  if (req.method === "POST" && pathname === "/compile-enqueue-top") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      (async () => {
        try {
          if (!process.env.MONGO_URI) throw new Error("MONGO_URI not configured");
          const body = JSON.parse(raw || "{}");
          const rawLimit = body.limit;
          const limit = rawLimit == null || rawLimit === "all" || rawLimit === 0
            ? null
            : (Number.isFinite(Number(rawLimit)) && Number(rawLimit) > 0 ? Number(rawLimit) : null);
          const minScore = Number(body.min_score || 0);
          const results = await withMongo(
            (db) => enqueueFreshSessionJobs(db, { limit, minScore }),
            { appName: "AtriveoTailorServer" },
          );
          const enqueued = results.filter((r) => !r.skipped).length;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, enqueued, skipped: results.length - enqueued, results }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
      })();
    });
    return;
  }

  // POST /compile-enqueue-batch { jobs: [{ job_url, company, title, score_pct }] }
  if (req.method === "POST" && pathname === "/compile-enqueue-batch") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      (async () => {
        try {
          if (!process.env.MONGO_URI) throw new Error("MONGO_URI not configured");
          const body = JSON.parse(raw || "{}");
          const jobs = Array.isArray(body.jobs) ? body.jobs : [];
          if (!jobs.length) throw new Error("jobs array required");
          const BATCH_CAP = 50;
          const truncated = jobs.length > BATCH_CAP ? jobs.length - BATCH_CAP : 0;
          const results = await withMongo(
            (db) => enqueueJobs(db, jobs.slice(0, BATCH_CAP), { force: body.force === true }),
            { appName: "AtriveoTailorServer" },
          );
          const enqueued = results.filter((r) => !r.skipped).length;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, enqueued, results, truncated }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
      })();
    });
    return;
  }

  // POST /compile-cancel { job_url } — remove queued job (worker-owned running jobs are not cancelled)
  if (req.method === "POST" && pathname === "/compile-cancel") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      (async () => {
        try {
          if (!process.env.MONGO_URI) throw new Error("MONGO_URI not configured");
          const body = JSON.parse(raw || "{}");
          if (!body.job_url) throw new Error("job_url required");
          const cancelled = await withMongo(
            (db) => cancelCompileJob(db, body.job_url),
            { appName: "AtriveoTailorServer" },
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, cancelled }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
      })();
    });
    return;
  }

  // GET /resume/:fingerprint — manifest + job metadata for a compile
  const resumeFpMatch = pathname.match(/^\/resume\/([a-f0-9]{64})$/);
  if (req.method === "GET" && resumeFpMatch) {
    (async () => {
      try {
        const fingerprint = resumeFpMatch[1];
        const manifest = readManifest(fingerprint);
        if (!manifest) throw new Error("manifest not found");
        let job = null;
        if (process.env.MONGO_URI) {
          job = await withMongo((db) => findJobByFingerprint(db, fingerprint), { appName: "AtriveoTailorServer" });
        }
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: true, fingerprint, manifest, artifacts_root: getArtifactsRoot(), job }));
      } catch (e) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    })();
    return;
  }

  // POST /manual-jd { job_url, company, title, description }
  // Stores a hand-pasted JD so the worker's fetchDescription() can find it.
  // Used by the dock's "Build a Resume" (Create) tab for manual:// job URLs.
  if (req.method === "POST" && pathname === "/manual-jd") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      (async () => {
        try {
          if (!process.env.MONGO_URI) throw new Error("MONGO_URI not configured");
          const body = JSON.parse(raw || "{}");
          if (!body.job_url) throw new Error("job_url required");
          const description = String(body.description || "");
          if (description.length < MIN_FULL_JD_CHARS) {
            throw new Error(`JD too short (${description.length} chars < ${MIN_FULL_JD_CHARS})`);
          }
          const now = new Date();
          await withMongo(async (db) => {
            // 1) descriptions collection — what fetchDescription() reads
            await db.collection("descriptions").updateOne(
              { job_url: body.job_url },
              { $set: { job_url: body.job_url, description, source: "manual", updated_at: now } },
              { upsert: true },
            );
            // 2) jobs collection — so company/title/score exist for the queue + folder naming
            await db.collection("jobs").updateOne(
              { job_url: body.job_url },
              {
                $set: {
                  job_url: body.job_url,
                  company: body.company || "Unknown",
                  title: body.title || "role",
                  score_pct: body.score_pct ?? 100,
                  source: "manual",
                  batch_time: now,
                },
                $setOnInsert: { created_at: now },
              },
              { upsert: true },
            );
          }, { appName: "AtriveoTailorServer" });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
      })();
    });
    return;
  }

  // Reveal a saved PDF or its folder in Finder.
  // POST /cover-enqueue { job_url, company, title } → build a template cover-letter PDF
  if (req.method === "POST" && pathname === "/cover-enqueue") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      (async () => {
        try {
          if (!process.env.MONGO_URI) throw new Error("MONGO_URI not configured");
          const body = JSON.parse(raw || "{}");
          if (!body.job_url) throw new Error("job_url required");
          const company = body.company || "Unknown";
          const role = body.title || "role";

          // Resolve target folder: same dir as the resume PDF if it exists,
          // otherwise a fresh CompanyName(12thJuly) folder under today's date.
          const jd = await withMongo((db) => fetchDescription(db, body.job_url), { appName: "AtriveoTailorServer" });
          if (!jd || jd.length < 200) throw new Error("No full JD captured for this job yet");

          const existing = await withMongo((db) => lookupJobsByUrl(db, [body.job_url]), { appName: "AtriveoTailorServer" });
          const pdfPath = existing?.[0]?.resume?.pdf_path;
          let dir;
          if (pdfPath && fs.existsSync(path.dirname(pdfPath))) {
            dir = path.dirname(pdfPath);
          } else {
            const today = new Date().toISOString().slice(0, 10);
            const dateDir = path.join(OUT_ROOT, today);
            const companyPart = companySlug(company, 32);
            const now = new Date();
            const day = now.getDate();
            const suffix = day === 1 ? "st" : day === 2 ? "nd" : day === 3 ? "rd" : "th";
            const month = now.toLocaleString("en-US", { month: "long" });
            dir = path.join(dateDir, `${companyPart} (${day}${suffix}${month})`);
          }

          const result = buildCoverLetter(
            { company, role, jd, dir, bank: BANK },
            (kind, text) => log(`[cover] ${kind}: ${text}`),
          );
          if (!result.ok) throw new Error(result.err || "cover letter build failed");

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, pdf_path: result.pdf }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
      })();
    });
    return;
  }

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

  // GET /serve-pdf?path=...           → inline (browser preview)
  // GET /serve-pdf?path=...&dl=1      → attachment (download)
  if (req.method === "GET" && pathname === "/serve-pdf") {
    const pdfPath = url.searchParams.get("path");
    if (!pdfPath || !pdfPath.startsWith(OUT_ROOT)) {
      res.writeHead(400); res.end("invalid path");
      return;
    }
    if (!fs.existsSync(pdfPath)) {
      res.writeHead(404); res.end("not found");
      return;
    }
    try {
      const data = fs.readFileSync(pdfPath);
      const isDownload = url.searchParams.get("dl") === "1";
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": data.length,
        "Content-Disposition": isDownload
          ? 'attachment; filename="Atishay Kasliwal.pdf"'
          : 'inline; filename="Atishay Kasliwal.pdf"',
      });
      res.end(data);
    } catch (e) {
      res.writeHead(500); res.end(String(e.message || e));
    }
    return;
  }

  res.writeHead(404); res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  log(`listening on http://localhost:${PORT}`);
  // Bound to loopback, so this only matters once cloudflared publishes it — but
  // then /scrape/start is reachable by anyone who knows the tunnel URL, and it
  // both scrapes and deploys to production. The Pages Function's JWT check does
  // not help: the tunnel is a second, unauthenticated way in.
  if (!TAILOR_TOKEN) {
    log("WARNING: TAILOR_TOKEN is empty — every route, including /scrape/start, is unauthenticated.");
    log("         Set TAILOR_TOKEN in .env (same value as the Cloudflare env var) to close this.");
  }
  log(`output → ${OUT_ROOT}`);
  log(`pipeline → ${USE_LEGACY ? `legacy (gemma ${DEFAULT_MODEL})` : `ac (planner ${AC_PLANNER})`}`);
  if (USE_LEGACY) log(`template → ${TEMPLATE}`);
  const usesExternalDrive = OUT_ROOT.startsWith("/Volumes/");
  log(usesExternalDrive
    ? `drive mounted: ${fs.existsSync(path.dirname(OUT_ROOT)) ? "YES" : "NO — plug in the external drive"}`
    : `output root: ${fs.existsSync(OUT_ROOT) ? "OK" : "MISSING — create it first"}`);
  void os; // reserved
});
