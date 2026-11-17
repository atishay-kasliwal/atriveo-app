// PR-level skills exposure. Approval and status are separate gates.
// Policy (QUESTION_ANSWERS "Open Source Work on Resumes", 2026-11-16): merged and open PRs are both usable;
// merged evidence comes first, a CLOSED source drops the record, and status is never printed on a resume.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const DEFAULT_BANK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/ac-bank");
const PR_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/;
const LIVE = new Set(["MERGED", "OPEN"]);

export function loadSkillEvidence(bankDir = process.env.AC_BANK_DIR || DEFAULT_BANK) {
  const file = path.join(bankDir, "SKILL_EVIDENCE.yaml");
  if (!fs.existsSync(file)) return { records: [] };
  return yaml.load(fs.readFileSync(file, "utf8")) || { records: [] };
}

export const skillEvidenceKey = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9+#.]/g, "");

/** Approved, resume eligible, every source a real PR that is merged or still open. */
export function usableSkillEvidence(record) {
  return record?.approved === true
    && record.resume_eligible === true
    && LIVE.has(record.status)
    && Array.isArray(record.sources) && record.sources.length > 0
    && record.sources.every((source) => LIVE.has(source?.status) && PR_URL.test(source?.url || ""));
}

/** Merged evidence: the first priority (usable, and the record and every source merged). */
export function eligibleSkillEvidence(record) {
  return usableSkillEvidence(record)
    && record.status === "MERGED"
    && record.sources.every((source) => source.status === "MERGED");
}

/**
 * Skill key → source PR urls. Default: merged evidence only. includeOpen: merged and open evidence (merged urls
 * first). pending: open records only (for showing what is still in review).
 */
export function skillEvidenceSources(records = [], { pending = false, includeOpen = false } = {}) {
  const result = new Map();
  const add = (record) => {
    for (const source of record.sources || []) {
      for (const name of source.skills || record.skills || []) {
        const key = skillEvidenceKey(name);
        if (!result.has(key)) result.set(key, new Set());
        result.get(key).add(source.url);
      }
    }
  };
  if (pending) {
    for (const record of records) if (record.status === "OPEN") add(record);
    return result;
  }
  for (const record of records) if (eligibleSkillEvidence(record)) add(record);
  if (includeOpen) for (const record of records) if (usableSkillEvidence(record) && !eligibleSkillEvidence(record)) add(record);
  return result;
}

/** Skill keys backed only by open evidence: usable, but sorted after merged ones when a Skills line is full. */
export function openOnlySkillKeys(records = []) {
  const merged = skillEvidenceSources(records);
  return new Set([...skillEvidenceSources(records, { includeOpen: true }).keys()].filter((key) => !merged.has(key)));
}
