#!/usr/bin/env node
/**
 * Log real-world application outcomes against a composed resume.
 *
 * Usage:
 *   node scripts/ac-outcome.mjs \
 *     --correlation resume_abc123 \
 *     --job-id linkedin:4425280035 \
 *     --resume-version 17 \
 *     --acs AC-001,AC-007,AC-023 \
 *     --applied --viewed --recruiter-reply --oa --no-interview
 */
import { ingestApplicationOutcome } from "./ac-learning.mjs";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((v) => v.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function hasNegFlag(name) {
  return process.argv.includes(`--no-${name}`);
}

const correlationId = arg("correlation");
const jobId = arg("job-id", "unknown");
const resumeVersion = Number(arg("resume-version", 0));
const selectedAcs = String(arg("acs", "")).split(",").map((s) => s.trim()).filter(Boolean);
const notes = arg("notes", "");

if (!correlationId) {
  console.error("Required: --correlation <resume correlation id from compose run>");
  process.exit(1);
}

const outcome = {
  applied: hasFlag("applied"),
  viewed: hasFlag("viewed"),
  recruiter_reply: hasFlag("recruiter-reply"),
  oa: hasFlag("oa"),
  interview: hasFlag("interview") && !hasNegFlag("interview"),
  offer: hasFlag("offer"),
};

const event = ingestApplicationOutcome({
  correlationId,
  jobId,
  resumeVersion,
  selectedAcs,
  outcome,
  notes,
});

console.log("Logged application_outcome event:", event.id);
console.log("Outcome:", outcome);
