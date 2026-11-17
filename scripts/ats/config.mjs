// ATS configuration (data/ats/*.yaml): weights, penalties, thresholds and the parser's word lists.
// The hash is over the parsed values with keys sorted, so reformatting a file leaves it unchanged
// and any changed number changes it.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

export const ATS_CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/ats");

/** JSON with object keys sorted at every level: equal values always serialize identically. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

// The bank's bullet lint (ac-bullet-rules.mjs) requires these openings; the Job Match verb check accepts them too.
export const HARVARD_VERBS_FILE = path.resolve(ATS_CONFIG_DIR, "../ac-bank/HARVARD_ACTION_VERBS.json");

function withHarvardVerbs(scoring, file = HARVARD_VERBS_FILE) {
  const achievement = scoring?.job_match?.achievement;
  if (!achievement || !fs.existsSync(file)) return scoring;
  const harvard = Object.values(JSON.parse(fs.readFileSync(file, "utf8")).categories || {}).flat().map((v) => String(v).toLowerCase());
  achievement.action_verbs = [...new Set([...(achievement.action_verbs || []), ...harvard])];
  return scoring;
}

export function loadAtsConfig(dir = ATS_CONFIG_DIR) {
  const read = (name) => yaml.load(fs.readFileSync(path.join(dir, name), "utf8")) || {};
  return withHash({
    scoring: withHarvardVerbs(read("scoring.yaml")), sections: read("sections.yaml"),
    skills: read("skills.yaml"), responsibilities: read("responsibilities.yaml"),
    domains: read("domains.yaml"),
  });
}

/** Attach (or refresh) the hash for a config object built or modified in code. */
export function withHash(config) {
  const { hash: _drop, ...values } = config;
  return { ...values, hash: sha256(canonicalJson(values)).slice(0, 16) };
}

/** The candidate settings file (data/ats/candidate.yaml). Values are read as written; "unknown" stays "unknown". */
export function loadCandidate(file = path.join(ATS_CONFIG_DIR, "candidate.yaml")) {
  return yaml.load(fs.readFileSync(file, "utf8")) || {};
}
