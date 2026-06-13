#!/usr/bin/env node
/**
 * Model head-to-head for the tailor Phase-1 analysis call.
 * Runs the EXACT system prompt + bank + JD + JSON schema through each model
 * and reports: JSON valid?, truncated?, time, eval tokens, bullet count, ATS.
 *
 * Usage: node scripts/tailor-bench.mjs "<path to jd.txt>" [model1 model2 ...]
 */
import http from "node:http";
import fs from "node:fs";
import { loadBullets } from "./tailor-bank.mjs";
import { SYSTEM_PROMPT as DYN_SYSTEM, RESPONSE_SCHEMA as DYN_SCHEMA, buildUserMessage } from "./tailor-dynamic.mjs";

const JD_PATH = process.argv[2];
const MODELS = process.argv.slice(3).length ? process.argv.slice(3) : ["gemma3:12b", "gemma4:12b", "qwen3:8b"];
if (!JD_PATH || !fs.existsSync(JD_PATH)) {
  console.error("Provide a valid jd.txt path");
  process.exit(1);
}

const BANK = loadBullets();
const jd = fs.readFileSync(JD_PATH, "utf8");
const user = buildUserMessage(BANK, jd);

function ollama(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ keep_alive: "5m", ...payload });
    const req = http.request(
      { hostname: "127.0.0.1", port: 11434, path: "/api/chat", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        res.setTimeout(0);
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.setTimeout(0);
    req.write(body);
    req.end();
  });
}

async function runModel(model, budget) {
  const t0 = Date.now();
  const data = await ollama({
    model,
    messages: [{ role: "system", content: DYN_SYSTEM }, { role: "user", content: user }],
    stream: false, think: false, format: DYN_SCHEMA,
    options: { temperature: 0.2, num_predict: budget, num_ctx: 16384 },
  });
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  const content = data.message?.content || "";
  const truncated = data.done_reason === "length";
  let parsed = null, parseErr = null;
  try { parsed = JSON.parse(content); } catch (e) { parseErr = e.message; }

  let bullets = 0, skills = 0, ats = "";
  if (parsed) {
    bullets = (parsed.experience || []).reduce((n, e) => n + (e.bullets?.length || 0), 0)
            + (parsed.projects || []).reduce((n, p) => n + (p.bullets?.length || 0), 0);
    skills = (parsed.skills || []).length;
    ats = `${parsed.ats_before}→${parsed.ats_after}`;
  }
  return { model, sec, truncated, evalTokens: data.eval_count, jsonChars: content.length,
           valid: !!parsed, parseErr, bullets, skills, ats, parsed, content };
}

console.log(`\nJD: ${JD_PATH}`);
console.log(`JD size: ${jd.length.toLocaleString()} chars · prompt: ${user.length.toLocaleString()} chars\n`);
console.log("model".padEnd(14), "valid", "trunc", "time", "evalTok", "jsonChars", "bullets", "skills", "ATS");
console.log("-".repeat(80));

const results = [];
for (const model of MODELS) {
  try {
    const r = await runModel(model, 6144);
    results.push(r);
    console.log(
      model.padEnd(14),
      (r.valid ? "YES" : "NO ").padEnd(5),
      (r.truncated ? "YES" : "no ").padEnd(5),
      `${r.sec}s`.padEnd(7),
      String(r.evalTokens ?? "?").padEnd(7),
      String(r.jsonChars).padEnd(9),
      String(r.bullets).padEnd(7),
      String(r.skills).padEnd(6),
      r.ats || (r.parseErr ? `ERR: ${r.parseErr.slice(0, 30)}` : ""),
    );
  } catch (e) {
    console.log(model.padEnd(14), "FAILED:", e.message);
  }
}

// Dump first experience block bullets for quality comparison
for (const r of results) {
  if (!r.parsed) continue;
  console.log(`\n=== ${r.model} · header: "${r.parsed.header_title}" · eligible: ${r.parsed.eligible} ===`);
  const exp0 = (r.parsed.experience || [])[0];
  if (exp0) {
    console.log(`  Role ${exp0.role_id} (${BANK.roles[exp0.role_id]?.name || "?"}):`);
    for (const b of exp0.bullets || []) console.log(`   [${b.id}] ${b.text}`);
  }
  if (r.parsed.skills?.length) {
    console.log("  Skills line 1:", r.parsed.skills[0]?.slice(0, 100));
  }
}
console.log();
