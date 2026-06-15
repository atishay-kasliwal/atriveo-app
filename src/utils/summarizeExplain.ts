import type { TailorExplainSummary } from "../types/tailorExplain";

export function summarizeExplain(explain?: TailorExplainSummary | null): {
  bullets: string[];
  confidence: "High" | "Medium" | "Low";
} {
  if (!explain) return { bullets: [], confidence: "Medium" };

  const bullets: string[] = [];
  const id = explain.engineering_identity?.primary;
  if (id) bullets.push(`Identity: ${id}`);

  const gs = explain.global_score;
  if (gs?.delta != null && gs.applied) {
    bullets.push(`Resume score ${gs.before != null ? Math.round(gs.before) : "?"} → ${gs.after != null ? Math.round(gs.after) : "?"} (+${Math.round(gs.delta)})`);
  }

  const topGain = [...(explain.per_bullet_gain || [])]
    .sort((a, b) => (b.gain || 0) - (a.gain || 0))[0];
  if (topGain?.adds?.length) {
    bullets.push(`Strongest fit: ${topGain.adds[0]}`);
  } else if (topGain?.ac_id) {
    bullets.push(`Top AC: ${topGain.ac_id} (gain ${topGain.gain.toFixed(1)})`);
  }

  for (const s of (explain.swaps || []).slice(0, 2)) {
    if (s.reason) bullets.push(s.reason);
    else bullets.push(`${s.role}: ${s.from} → ${s.to}`);
  }

  if (explain.borderline && explain.jd_gate?.message) {
    bullets.push(`Borderline JD — ${explain.jd_gate.message}`);
  } else if (explain.information_gain != null && bullets.length < 3) {
    bullets.push(`Information gain ${Number(explain.information_gain).toFixed(1)}`);
  }

  const conf = explain.engineering_identity?.confidence;
  let confidence: "High" | "Medium" | "Low" = "Medium";
  if (conf != null) {
    const c = conf < 1 ? conf : conf / 100;
    if (c >= 0.85) confidence = "High";
    else if (c < 0.6) confidence = "Low";
  }
  if (explain.borderline) confidence = "Low";

  return { bullets: bullets.slice(0, 5), confidence };
}
