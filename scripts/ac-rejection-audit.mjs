#!/usr/bin/env node
/**
 * Rejection audit — why wasn't this AC selected?
 */
import {
  buildCoverageState,
  explainRejection,
  loadCapabilityGraph,
} from "./ac-capability-graph.mjs";
import {
  buildResumeEvidenceProfile,
  extractEvidence,
  flattenResumeBullets,
} from "./ac-evidence.mjs";

function bulletAcId(bullet) {
  return bullet.ac?.id || bullet.ac_id;
}

function priorCoverageBeforePosition(profile, position) {
  const prior = {};
  for (const row of profile.bullets) {
    if (row.position >= position) break;
    const { coverage_after } = explainRejection({
      candidateEvidence: row.evidence,
      selectedEvidence: row.evidence,
      priorCoverage: prior,
    });
    Object.assign(prior, coverage_after || {});
  }
  return prior;
}

/**
 * Audit unselected candidates per role slot vs what was selected.
 */
export function auditSelectionRejections(composition, bank, cfg = {}) {
  const graph = loadCapabilityGraph();
  const profile = buildResumeEvidenceProfile(composition, bank);
  const byId = new Map((bank.acs || []).map((a) => [a.id, a]));
  const used = new Set(profile.bullets.map((b) => b.ac_id));
  const pinned = new Set();
  for (const ids of Object.values(cfg.pinned_ac_ids || {})) {
    for (const id of ids || []) pinned.add(id);
  }

  const coverageState = buildCoverageState(profile.bullets, graph);
  const rejections = [];

  for (const row of profile.bullets) {
    const role = row.slot_role;
    const selectedAc = byId.get(row.ac_id);
    if (!selectedAc) continue;

    const prior = {};
    for (const b of profile.bullets) {
      if (b.position >= row.position) break;
      const igRow = coverageState.per_bullet.find((p) => p.ac_id === b.ac_id);
      if (igRow?.coverage_after) Object.assign(prior, igRow.coverage_after);
    }

    const candidates = (bank.acs || []).filter((ac) => {
      if (ac.role !== role) return false;
      if (ac.visibility?.default === false) return false;
      if (used.has(ac.id) && ac.id !== row.ac_id) return false;
      return true;
    });

    const selectedEvidence = extractEvidence(selectedAc);
    for (const ac of candidates) {
      if (ac.id === row.ac_id) continue;
      const candidateEvidence = extractEvidence(ac);
      const explanation = explainRejection({
        candidateEvidence,
        selectedEvidence,
        priorCoverage: prior,
        graph,
      });
      if (explanation.information_gain < explanation.selected_gain) {
        rejections.push({
          slot_role: role,
          position: row.position,
          selected: row.ac_id,
          rejected: ac.id,
          ...explanation,
        });
      }
    }
  }

  rejections.sort((a, b) => a.information_gain - b.information_gain);

  return {
    coverage: coverageState.coverage,
    per_bullet_gain: coverageState.per_bullet,
    total_information_gain: coverageState.total_gain,
    rejections: rejections.slice(0, 40),
  };
}

export function formatRejectionReport(audit) {
  const lines = [`Total IG: ${audit.total_information_gain?.toFixed(1)}`];
  for (const r of audit.rejections.slice(0, 12)) {
    lines.push(`\n${r.rejected} not chosen over ${r.selected} (${r.slot_role} #${r.position})`);
    lines.push(`  IG: ${r.information_gain} (selected: ${r.selected_gain})`);
    if (r.adds.length) lines.push(`  Would add: ${r.adds.join(", ")}`);
    for (const reason of r.reasons) lines.push(`  · ${reason}`);
  }
  return lines.join("\n");
}

async function cliMain() {
  const { loadBank, compose } = await import("./ac-bank.mjs");
  const { buildPlannerRuntimeConfig, loadPlannerConfig } = await import("./ac-planner.mjs");
  const jd = process.argv.slice(2).join(" ") || "AI Engineer Python FastAPI LangChain AWS Kafka";
  const bank = loadBank();
  const cfg = buildPlannerRuntimeConfig("v2", { jd, bank });
  const composition = compose(jd, bank, cfg);
  const audit = auditSelectionRejections(composition, bank, loadPlannerConfig("v2"));
  console.log(formatRejectionReport(audit));
}

if (process.argv[1]?.endsWith("ac-rejection-audit.mjs")) {
  cliMain().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
