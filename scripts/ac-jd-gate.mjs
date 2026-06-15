#!/usr/bin/env node
/**
 * Unified JD gate — every compose path returns one of:
 *   compose     → engineering JD, proceed to PDF
 *   borderline  → low confidence / short JD — warn (compose unless strict)
 *   blocked     → eligibility no-go (sponsorship, role mismatch)
 *   unsupported → not a software/engineering JD
 */
import fs from "node:fs";
import path from "node:path";
import { engineeringConfidence, SUPPORTED_THRESHOLD, BORDERLINE_THRESHOLD } from "./ac-jd-relevance.mjs";
import { screenJdEligibility } from "./ac-eligibility.mjs";

export const MIN_JD_HARD = 200;
export const MIN_JD_IDEAL = 400;

export { SUPPORTED_THRESHOLD, BORDERLINE_THRESHOLD };

/**
 * @param {string} jd
 * @param {{ title?: string, forceBorderline?: boolean, strict?: boolean }} [opts]
 */
export function assessJdGate(jd, opts = {}) {
  const text = String(jd || "").trim();
  const title = opts.title || "";
  const jdLen = text.length;

  const eligibility = screenJdEligibility(text, title);
  if (!eligibility.eligible) {
    return {
      outcome: "blocked",
      can_compose: false,
      jd_length: jdLen,
      eligibility,
      relevance: null,
      warnings: [],
      message: eligibility.reason || "Eligibility blocked — sponsorship or role mismatch.",
      user_message: `Cannot tailor: ${eligibility.reason}`,
    };
  }

  if (jdLen < MIN_JD_HARD) {
    return {
      outcome: "unsupported",
      can_compose: false,
      jd_length: jdLen,
      eligibility,
      relevance: null,
      warnings: [],
      message: `JD too short (${jdLen} chars, minimum ${MIN_JD_HARD}). Paste the full job description.`,
      user_message: "Job description is too short to tailor reliably. Paste the full LinkedIn or company posting text.",
    };
  }

  const relevance = engineeringConfidence(text);
  let outcome = "compose";
  let can_compose = true;
  let message = "Engineering JD — compose allowed.";
  const warnings = [];

  if (jdLen < MIN_JD_IDEAL) {
    warnings.push(`JD is short (${jdLen} chars; ${MIN_JD_IDEAL}+ recommended for best results).`);
  }

  if (relevance.confidence < BORDERLINE_THRESHOLD) {
    outcome = "unsupported";
    can_compose = false;
    message = `Unsupported JD — engineering confidence ${relevance.confidence} (need ≥ ${BORDERLINE_THRESHOLD}).`;
  } else if (
    relevance.hits.non_engineering.length > 0
    && relevance.confidence < SUPPORTED_THRESHOLD
  ) {
    outcome = "unsupported";
    can_compose = false;
    message = `Unsupported JD — non-engineering role detected (confidence ${relevance.confidence}).`;
  } else if (relevance.confidence < SUPPORTED_THRESHOLD) {
    outcome = "borderline";
    can_compose = opts.strict !== true;
    if (opts.forceBorderline) can_compose = true;
    message = `Borderline engineering JD (confidence ${relevance.confidence}, ideal ≥ ${SUPPORTED_THRESHOLD}).`;
    warnings.push(message);
  }

  if (outcome === "borderline" && !can_compose) {
    message += " Strict mode — compose skipped.";
  }

  return {
    outcome,
    can_compose,
    jd_length: jdLen,
    eligibility,
    relevance,
    warnings,
    message,
    user_message: outcome === "compose"
      ? (warnings[0] || message)
      : outcome === "borderline"
        ? `${message} ${can_compose ? "Proceeding with warning." : "Re-run with force to continue."}`
        : message,
    thresholds: {
      supported: SUPPORTED_THRESHOLD,
      borderline: BORDERLINE_THRESHOLD,
      min_jd: MIN_JD_HARD,
      ideal_jd: MIN_JD_IDEAL,
    },
  };
}

export function writeJdGateFile(dir, gate) {
  if (!dir) return;
  fs.writeFileSync(path.join(dir, "jd-gate.json"), `${JSON.stringify(gate, null, 2)}\n`);
}
