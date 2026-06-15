// Role/project display names and dates — YAML bank is source of truth, META is fallback.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { ROLE_META, PROJECT_META } from "./tailor-dynamic.mjs";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function resolveBankDir() {
  return process.env.AC_BANK_DIR || path.join(APP_ROOT, "data", "ac-bank");
}

const MONTH_INDEX = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/** Parse project date string → sortable start timestamp (higher = more recent). */
export function projectRecencyMs(dates = "") {
  const raw = String(dates).trim().toLowerCase();
  if (!raw) return 0;
  if (raw.includes("present")) return Date.now();
  const start = raw.split("--")[0].trim();
  const monthYear = start.match(
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/,
  );
  if (monthYear) {
    return Date.UTC(Number(monthYear[2]), MONTH_INDEX[monthYear[1]], 1);
  }
  const yearOnly = start.match(/(\d{4})/);
  if (yearOnly) return Date.UTC(Number(yearOnly[1]), 0, 1);
  return 0;
}

export function loadResumeProjectPool(bankDir = resolveBankDir()) {
  try {
    const doc = yaml.load(fs.readFileSync(path.join(bankDir, "PROJECTS.yaml"), "utf8"));
    const roles = (doc?.projects || [])
      .filter((p) => p.on_resume)
      .map((p) => p.role)
      .filter(Boolean);
    if (roles.length) return roles;
    if (doc?.resume_layout?.projects?.length) return doc.resume_layout.projects;
  } catch {
    // fall through
  }
  return null;
}

export function sortProjectRolesByRecency(roles, bankDir = resolveBankDir()) {
  return [...roles].sort((a, b) => {
    const da = projectRecencyMs(resolveProjectMeta(a, bankDir).dates);
    const db = projectRecencyMs(resolveProjectMeta(b, bankDir).dates);
    return db - da;
  });
}

export function sortProjectsByRecency(projects, bankDir = resolveBankDir()) {
  return [...projects].sort((a, b) => {
    const da = projectRecencyMs(resolveProjectMeta(a.role, bankDir).dates);
    const db = projectRecencyMs(resolveProjectMeta(b.role, bankDir).dates);
    return db - da;
  });
}

function scoreProjectForJd(role, jd, cfg) {
  const pool = cfg?.canonical_pools?.[role];
  if (!pool?.story_packages?.length) return 0;
  const hay = String(jd || "").toLowerCase();
  let best = 0;
  for (const pkg of pool.story_packages) {
    let hits = 0;
    for (const sig of pkg.jd_signals || []) {
      if (hay.includes(String(sig).toLowerCase())) hits += 1;
    }
    best = Math.max(best, hits);
  }
  return best;
}

/**
 * Pick up to `maxCount` resume projects: latest first, second+ chosen for JD fit.
 */
export function pickResumeProjectRoles(roles, jd, cfg = {}, maxCount = 2, bankDir = resolveBankDir()) {
  const eligible = roles.filter(Boolean);
  if (!eligible.length) return [];
  const byRecency = sortProjectRolesByRecency(eligible, bankDir);
  const limit = Math.max(1, Math.min(maxCount, byRecency.length));
  if (limit === 1) return [byRecency[0]];

  const first = byRecency[0];
  const rest = byRecency.slice(1);
  if (rest.length === 1) return [first, rest[0]];

  let bestRole = rest[0];
  let bestScore = -1;
  let bestRecency = -1;
  for (const role of rest) {
    const score = scoreProjectForJd(role, jd, cfg);
    const recency = projectRecencyMs(resolveProjectMeta(role, bankDir).dates);
    if (score > bestScore || (score === bestScore && recency > bestRecency)) {
      bestScore = score;
      bestRecency = recency;
      bestRole = role;
    }
  }
  const picked = [first, bestRole];
  return sortProjectRolesByRecency(picked, bankDir);
}

export const ROLE_SLUG_TO_NAME = {
  "stony-brook": "Stony Brook University",
  "wake-forest": "Wake Forest – CAIR",
  shriffle: "Shriffle",
  accolite: "Accolite Digital",
};

export const PROJECT_SLUG_TO_NAME = {
  atriveo: "Atriveo",
  "insurance-platform": "Insurance Microservices Platform",
  insureraft: "InsureRaft",
  "job-pipeline": "Atriveo Job Intelligence Pipeline",
  "bayesian-mmm": "Bayesian Marketing Mix Model",
  "mri-research": "Advanced Radiomics Research Pipeline",
  medledger: "MedLedger",
  "user-data-platform": "User Data Platform",
  "radiomics-pipeline": "Advanced Radiomics Research Pipeline",
  "cpp-encryption": "Encryption and Decryption Application",
  "fomc-dashboard": "FOMC Intelligence Dashboard",
};

function readRoleYamlDates(bankDir = resolveBankDir()) {
  const byEmployer = {};
  const bySlug = {};
  for (const file of fs.readdirSync(bankDir)) {
    if (!file.endsWith(".yaml") || /^AC-\d+\.yaml$/.test(file)) continue;
    let doc;
    try {
      doc = yaml.load(fs.readFileSync(path.join(bankDir, file), "utf8"));
    } catch {
      continue;
    }
    const role = doc?.role;
    if (!role?.dates?.trim()) continue;
    if (role.employer) byEmployer[role.employer] = role.dates.trim();
    if (role.id) bySlug[role.id] = role.dates.trim();
  }
  return { byEmployer, bySlug };
}

export function resolveExperienceMeta(roleSlug, bankDir = resolveBankDir()) {
  const name = ROLE_SLUG_TO_NAME[roleSlug] || roleSlug;
  const { byEmployer, bySlug } = readRoleYamlDates(bankDir);
  const base = ROLE_META[name] || { title: "Software Engineer", loc: "", dates: "", order: 0 };
  return {
    ...base,
    dates: byEmployer[name] || bySlug[roleSlug] || base.dates || "",
  };
}

export function resolveProjectMeta(projectSlug, bankDir = resolveBankDir()) {
  const name = PROJECT_SLUG_TO_NAME[projectSlug] || projectSlug;
  const { byEmployer, bySlug } = readRoleYamlDates(bankDir);
  const base = PROJECT_META[name] || { dates: "", order: 0 };
  return {
    ...base,
    dates: byEmployer[name] || bySlug[projectSlug] || base.dates || "",
  };
}
