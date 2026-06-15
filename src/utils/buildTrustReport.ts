import type { TailorExplainSummary } from "../types/tailorExplain";
import type { TrustReport, TrustReportCompositionExtras } from "../types/trustReport";
import { summarizeExplain } from "./summarizeExplain";

function pct(n: number | null | undefined): number | null {
  if (n == null || Number.isNaN(n)) return null;
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}

function topCapabilityNodes(graph: Record<string, number> | null | undefined, limit = 14): TrustReport["jdCoverage"]["capabilityMap"] {
  if (!graph || typeof graph !== "object") return [];
  return Object.entries(graph)
    .map(([node, strength]) => ({ node, strength: Number(strength) || 0 }))
    .filter((n) => n.strength > 0.05)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, limit);
}

export function buildTrustReport(
  explain?: TailorExplainSummary | null,
  extras?: TrustReportCompositionExtras | null,
): TrustReport | null {
  if (!explain) return null;

  const { confidence } = summarizeExplain(explain);
  const id = explain.engineering_identity;
  const gs = explain.global_score;
  const replay: string[] = [];

  if (id?.primary) {
    const conf = id.confidence != null ? pct(id.confidence) : null;
    replay.push(
      conf != null
        ? `Reads as ${id.primary}${id.secondary ? ` (${id.secondary})` : ""} — identity confidence ${conf}%.`
        : `Reads as ${id.primary}${id.secondary ? ` with ${id.secondary} emphasis` : ""}.`,
    );
  }

  if (gs?.after != null) {
    replay.push(
      gs.before != null
        ? `Resume confidence ${gs.after}${gs.delta != null ? ` (+${Math.round(gs.delta)} from ${gs.before})` : ""}.`
        : `Resume confidence score ${gs.after}.`,
    );
  } else if (explain.information_gain != null) {
    replay.push(`Information gain ${Number(explain.information_gain).toFixed(1)} across 15 bullets.`);
  }

  const hm = extras?.hiringManager;
  if (hm?.would_interview != null) {
    replay.push(
      hm.would_interview
        ? `Hiring-manager test: would interview${hm.because?.[0] ? ` — ${hm.because[0]}` : ""}.`
        : `Hiring-manager test: pass${hm.concerns?.[0] ? ` — concern: ${hm.concerns[0]}` : ""}.`,
    );
  }

  const topGain = [...(explain.per_bullet_gain || [])].sort((a, b) => (b.gain || 0) - (a.gain || 0))[0];
  if (topGain?.adds?.[0]) {
    replay.push(`Strongest JD fit: ${topGain.adds[0]} (${topGain.ac_id}).`);
  }

  const weightedPct = pct(extras?.coverage?.weighted_coverage ?? null);
  const missing = extras?.coverage?.missing_claimable || [];
  const unclaimable = extras?.coverage?.unclaimable || [];
  if (weightedPct != null) {
    replay.push(
      missing.length
        ? `JD keyword coverage ~${weightedPct}% — ${missing.length} supported gap(s) remain.`
        : `JD keyword coverage ~${weightedPct}%.`,
    );
  } else if (missing.length) {
    replay.push(`${missing.length} JD term(s) have evidence in bank but were not emphasized.`);
  }

  if (explain.borderline && explain.jd_gate?.message) {
    replay.push(`Caution: borderline JD — ${explain.jd_gate.message}`);
  }

  const rejections = (explain.rejections_sample || []).map((r) => ({
    rejected: r.rejected,
    selected: r.selected,
    role: r.role,
    reasons: r.reasons || [],
    informationGain: r.information_gain ?? null,
  }));

  return {
    confidence,
    recruiterReplay: replay.slice(0, 6),
    rejections,
    jdCoverage: {
      weightedPct,
      missingClaimable: missing.slice(0, 12),
      unclaimable: unclaimable.slice(0, 12),
      capabilityMap: topCapabilityNodes(extras?.graphCoverage),
    },
    hiringManager: hm
      ? {
          wouldInterview: hm.would_interview ?? null,
          because: hm.because || [],
          concerns: hm.concerns || [],
        }
      : null,
    borderlineMessage: explain.borderline ? (explain.jd_gate?.message || "Borderline JD") : null,
  };
}
