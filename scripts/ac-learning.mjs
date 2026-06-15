// Event-sourced learning layer for the AC resume engine.
// Canonical store: events.jsonl. Aggregates are replay projections only.
// Learning optimizes selection and authoring — never silently changes evidence.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  correlationId,
  createEvent,
  computeReward,
} from "./ac-events.mjs";
import { EVENTS_PATH, LEARNING_DIR, replayAll } from "./ac-replay.mjs";

export { EVENTS_PATH, LEARNING_DIR };
export { replayAll, loadProjection } from "./ac-replay.mjs";
export { computeReward, correlationId } from "./ac-events.mjs";

export const DRAFTS_DIR = path.join(LEARNING_DIR, "drafts");
export const VERSIONS_DIR = path.join(LEARNING_DIR, "versions");
export const PLANNER_VERSION = process.env.AC_PLANNER_VERSION || "v1";

const DUPLICATE_STORY_PAIRS = [
  ["AC-001", "AC-002"],
  ["AC-010", "AC-027"],
];

let resumeVersionCounter = null;

function ensureDirs() {
  fs.mkdirSync(LEARNING_DIR, { recursive: true });
  fs.mkdirSync(DRAFTS_DIR, { recursive: true });
  fs.mkdirSync(VERSIONS_DIR, { recursive: true });
}

function eventId() {
  return crypto.randomBytes(8).toString("hex");
}

function nextResumeVersion() {
  const counterFile = path.join(LEARNING_DIR, "resume_version.counter");
  let n = 0;
  if (fs.existsSync(counterFile)) n = Number(fs.readFileSync(counterFile, "utf8")) || 0;
  n += 1;
  fs.writeFileSync(counterFile, String(n));
  return n;
}

export function appendEvents(events) {
  ensureDirs();
  const written = [];
  for (const event of events) {
    const row = {
      id: event.id || eventId(),
      ...event,
    };
    fs.appendFileSync(EVENTS_PATH, `${JSON.stringify(row)}\n`);
    written.push(row);
  }
  return written;
}

export function appendEvent(event) {
  return appendEvents([event])[0];
}

export function readEvents(opts) {
  if (!fs.existsSync(EVENTS_PATH)) return [];
  const lines = fs.readFileSync(EVENTS_PATH, "utf8").trim().split("\n").filter(Boolean);
  let events = lines.map((line) => JSON.parse(line));
  if (opts?.since) events = events.filter((event) => event.ts >= opts.since);
  if (opts?.types?.length) events = events.filter((event) => opts.types.includes(event.type));
  if (opts?.limit != null) events = events.slice(-opts.limit);
  return events;
}

function selectedAcIds(composition) {
  const ids = [];
  for (const role of composition.experience || []) {
    for (const bullet of role.bullets || []) ids.push(bullet.ac_id || bullet.ac?.id);
  }
  for (const project of composition.projects || []) {
    for (const bullet of project.bullets || []) ids.push(bullet.ac_id || bullet.ac?.id);
  }
  return ids.filter(Boolean);
}

function countAiBullets(composition) {
  let count = 0;
  const all = [];
  for (const role of composition.experience || []) all.push(...(role.bullets || []));
  for (const project of composition.projects || []) all.push(...(project.bullets || []));
  for (const bullet of all) {
    const facet = bullet.facet || bullet.face?.facet || bullet.emphasis || bullet.face?.emphasis || "";
    const text = String(bullet.text || bullet.face?.text || "").toLowerCase();
    if (/llm|machine learning|\bai\b|agent|rag|langchain/.test(`${facet} ${text}`)) count += 1;
  }
  return count;
}

function hasMetric(text) {
  return /(\d+%|\$\d|[$]\d|\d+k\+?|\d+\+|\d+\.\d+|\d+ users|\d+ req)/i.test(String(text || ""));
}

export function computeDeductions(composition, analyst = null) {
  const deductions = [];
  const coverage = composition.coverage || {};
  const weighted = Math.round((coverage.weighted_coverage || 0) * 100);

  for (const keyword of coverage.missing_claimable || []) {
    deductions.push({ type: "missing_claimable", keyword: String(keyword).trim(), points: -3 });
  }
  for (const keyword of coverage.unclaimable || []) {
    deductions.push({ type: "missing_unclaimable", keyword: String(keyword).trim(), points: -5 });
  }

  const selected = selectedAcIds(composition);
  for (const [a, b] of DUPLICATE_STORY_PAIRS) {
    if (selected.includes(a) && selected.includes(b)) {
      deductions.push({ type: "duplicate_story", ac_ids: [a, b], points: -4 });
    }
  }

  const aiCount = countAiBullets(composition);
  if (aiCount >= 4) deductions.push({ type: "repeated_ai", count: aiCount, points: -2 * (aiCount - 3) });

  const bullets = [];
  for (const role of composition.experience || []) bullets.push(...(role.bullets || []));
  for (const project of composition.projects || []) bullets.push(...(project.bullets || []));
  if (bullets.filter((b) => !hasMetric(b.text || b.face?.text)).length >= 3) {
    deductions.push({ type: "weak_metrics", count: bullets.length, points: -3 });
  }

  const readability = analyst?.tasks?.readability?.parsed;
  if (readability?.flags?.length) {
    for (const flag of readability.flags) {
      deductions.push({
        type: flag.type || "readability",
        bullet_id: flag.bullet_id || null,
        detail: flag.detail,
        points: -2,
      });
    }
  }

  const totalDeduction = deductions.reduce((sum, item) => sum + item.points, 0);
  return {
    base_score: weighted,
    deductions,
    total_deduction: totalDeduction,
    final_score: Math.max(0, Math.min(100, weighted + totalDeduction)),
    readability: readability?.score_1_to_10 ?? null,
    weighted_coverage: coverage.weighted_coverage ?? null,
  };
}

export function buildPlannerMetrics(composition, analyst = null) {
  const selected = selectedAcIds(composition);
  const unusedBetter = [];

  const verify = analyst?.tasks?.verify?.parsed;
  if (verify?.route_changes?.length) {
    for (const change of verify.route_changes) {
      if (change.suggested_ac_id && !selected.includes(change.suggested_ac_id)) {
        unusedBetter.push({ ac_id: change.suggested_ac_id, keyword: change.keyword, reason: change.reason });
      }
    }
  }

  const weakest = analyst?.tasks?.weakest?.parsed;
  if (weakest?.replacement_ac_id && !selected.includes(weakest.replacement_ac_id)) {
    unusedBetter.push({
      ac_id: weakest.replacement_ac_id,
      keyword: null,
      reason: weakest.replacement_reason || weakest.why,
    });
  }

  return {
    selected_acs: selected,
    unused_better_candidates: unusedBetter,
    unsupported: composition.coverage?.unclaimable || [],
    missing_claimable: composition.coverage?.missing_claimable || [],
    rejected: composition.selection_trace?.rejected || [],
    selected_trace: composition.selection_trace?.selected || [],
  };
}

function coverageGapEvents(coverage, correlationIdValue) {
  const events = [];
  for (const keyword of coverage?.missing_claimable || []) {
    events.push(createEvent("coverage_gap", {
      keyword,
      gap_type: "missing_claimable",
    }, { correlation_id: correlationIdValue, source: "compose" }));
  }
  for (const keyword of coverage?.unclaimable || []) {
    events.push(createEvent("coverage_gap", {
      keyword,
      gap_type: "unclaimable",
    }, { correlation_id: correlationIdValue, source: "compose" }));
  }
  return events;
}

function librarianEvents(analyst, correlationIdValue) {
  const suggestions = analyst?.tasks?.librarian?.parsed?.authoring_suggestions || [];
  return suggestions.map((item) => createEvent("librarian_suggestion", {
    ac: item.ac || item.ac_id,
    suggestion: item.suggestion,
    rationale: item.rationale || "",
    priority: item.priority || "medium",
  }, { correlation_id: correlationIdValue, source: "librarian" }));
}

export function ingestComposeRun({
  composition,
  analyst = null,
  job = {},
  source = "compose_review",
  plannerVersion = PLANNER_VERSION,
}) {
  const cid = correlationId("resume");
  const resumeVersion = nextResumeVersion();
  const scores = computeDeductions(composition, analyst);
  const plannerMetrics = buildPlannerMetrics(composition, analyst);
  const reward = computeReward({
    ats: scores.final_score,
    humanReadability: scores.readability,
    coverage: (scores.weighted_coverage || 0) * 100,
    outcome: null,
  });

  const events = [
    createEvent("resume_generated", {
      resume_version: resumeVersion,
      job,
      theme: composition.theme,
      selected_acs: plannerMetrics.selected_acs,
      planner_version: plannerVersion,
    }, { correlation_id: cid, source, planner_version: plannerVersion }),

    createEvent("planner_decision", {
      selected: plannerMetrics.selected_trace,
      rejected: plannerMetrics.rejected,
      plan_routes: composition.plan?.routes || {},
    }, { correlation_id: cid, source, planner_version: plannerVersion }),

    createEvent("benchmark_result", {
      resume_version: resumeVersion,
      selected_acs: plannerMetrics.selected_acs,
      scores,
      reward,
      unused_better_candidates: plannerMetrics.unused_better_candidates,
      analyst_missing_but_supported: analyst?.tasks?.verify?.parsed?.missing_but_supported || [],
    }, { correlation_id: cid, source, planner_version: plannerVersion }),

    ...coverageGapEvents(composition.coverage, cid),
    ...librarianEvents(analyst, cid),
  ];

  const written = appendEvents(events);
  const projection = replayAll();
  return {
    correlation_id: cid,
    resume_version: resumeVersion,
    events: written,
    scores,
    reward,
    planner_metrics: plannerMetrics,
    projection_summary: {
      avg_reward: projection.avg_reward,
      authoring_queue_top: projection.authoring_queue?.slice(0, 3) || [],
    },
  };
}

export function ingestApplicationOutcome({
  correlationId: cid,
  jobId,
  resumeVersion,
  selectedAcs,
  outcome,
  notes = "",
}) {
  const event = appendEvent(createEvent("application_outcome", {
    job_id: jobId,
    resume_version: resumeVersion,
    selected_acs: selectedAcs,
    outcome: {
      applied: !!outcome.applied,
      viewed: !!outcome.viewed,
      recruiter_reply: !!outcome.recruiter_reply,
      oa: !!outcome.oa,
      interview: !!outcome.interview,
      offer: !!outcome.offer,
    },
    notes,
  }, { correlation_id: cid, source: "manual" }));

  replayAll();
  return event;
}

export function ingestMarketObservation(marketFrequency, marketDrift) {
  const event = appendEvent(createEvent("market_observation", {
    frequency: marketFrequency?.frequency || [],
    drift: marketDrift?.drift || [],
    jobs_scanned: marketFrequency?.jobs_scanned || 0,
  }, { source: "market_scan" }));
  replayAll();
  return event;
}

export function ingestPromotion({ acId, fromVersion, toVersion, draftPath, promotedBy = "human" }) {
  return appendEvent(createEvent("promotion", {
    ac_id: acId,
    from_version: fromVersion,
    to_version: toVersion,
    draft_path: draftPath,
    promoted_by: promotedBy,
  }, { source: "human" }));
}

export function ingestAuthoringRejection({ acId, suggestion, reason, rejectedBy = "human" }) {
  const event = appendEvent(createEvent("rejection", {
    ac_id: acId,
    suggestion,
    reason,
    rejected_by: rejectedBy,
  }, { source: "human" }));
  replayAll();
  return event;
}

export function createDraftPatch({ acId, suggestion, patch, rationale = "", sourceEventId = null }) {
  ensureDirs();
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = String(suggestion || "patch").replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  const acDir = path.join(DRAFTS_DIR, acId);
  fs.mkdirSync(acDir, { recursive: true });
  const file = path.join(acDir, `${slug}-${stamp}-${eventId()}.json`);
  const payload = {
    status: "pending_review",
    ac_id: acId,
    suggestion,
    rationale,
    source_event_id: sourceEventId,
    created_at: new Date().toISOString(),
    patch,
    promotion_workflow: ["human_review", "benchmark", "promote_to_ac_bank"],
  };
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

// Back-compat alias
export function recomputeAggregates() {
  return replayAll();
}

export function loadAggregates() {
  return replayAll();
}

// Legacy helper kept for analyst ingest path
export function ingestLibrarianSuggestions(suggestions, { sourceEventId = null } = {}) {
  const events = (suggestions || []).map((item) => createEvent("librarian_suggestion", {
    ac: item.ac || item.ac_id,
    suggestion: item.suggestion,
    rationale: item.rationale || item.reason || "",
    priority: item.priority || "medium",
    source_event_id: sourceEventId,
  }, { source: "librarian" }));
  appendEvents(events);
  return replayAll();
}
