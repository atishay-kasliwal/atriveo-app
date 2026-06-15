// Case-based warm start: boost ACs that succeeded for similar companies/roles.

import fs from "node:fs";
import path from "node:path";
import { readEvents } from "./ac-learning.mjs";
import { decayWeight } from "./ac-events.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const MEMORY_PATH = path.join(ROOT, "data", "ac-learning", "projections", "case_memory.json");

function normalizeCompany(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

export function buildCaseMemory(events = null) {
  const rows = events || readEvents();
  const profiles = {};

  for (const event of rows) {
    if (event.type !== "application_outcome") continue;
    const payload = event.payload || {};
    const outcome = payload.outcome || {};
    if (!outcome.interview && !outcome.offer && !outcome.recruiter_reply) continue;

    const w = decayWeight(event);
    const reward = outcome.offer ? 1 : outcome.interview ? 0.85 : 0.45;
    const company = normalizeCompany(payload.company || payload.job_id?.split(":")[0] || "unknown");
    profiles[company] = profiles[company] || { ac_weights: {}, successes: 0 };

    for (const acId of payload.selected_acs || []) {
      profiles[company].ac_weights[acId] = (profiles[company].ac_weights[acId] || 0) + reward * w;
    }
    profiles[company].successes += w;
  }

  return { generated_at: new Date().toISOString(), profiles };
}

export function loadCaseMemory() {
  if (fs.existsSync(MEMORY_PATH)) {
    try { return JSON.parse(fs.readFileSync(MEMORY_PATH, "utf8")); } catch { /* rebuild */ }
  }
  const memory = buildCaseMemory();
  fs.mkdirSync(path.dirname(MEMORY_PATH), { recursive: true });
  fs.writeFileSync(MEMORY_PATH, `${JSON.stringify(memory, null, 2)}\n`);
  return memory;
}

export function warmStartBoosts(company, bank) {
  const memory = loadCaseMemory();
  const key = normalizeCompany(company);
  const profile = memory.profiles?.[key];
  if (!profile) return {};

  const boosts = {};
  for (const [acId, weight] of Object.entries(profile.ac_weights || {})) {
    if ((bank.acs || []).some((ac) => ac.id === acId)) {
      boosts[acId] = Number((weight * 0.08).toFixed(4));
    }
  }
  return boosts;
}

export function saveCaseMemory() {
  const memory = buildCaseMemory();
  fs.mkdirSync(path.dirname(MEMORY_PATH), { recursive: true });
  fs.writeFileSync(MEMORY_PATH, `${JSON.stringify(memory, null, 2)}\n`);
  return memory;
}
