#!/usr/bin/env node
/**
 * Compact explain artifact for composition.json / tailor UI (diff + trust).
 */
export function buildComposeExplain(pipeline, jdGate = null) {
  const g = pipeline?.result?.global_optimize;
  const id = g?.engineering_identity || g?.after?.engineering_identity || g?.after?.profile?.engineering_identity;
  const gate = jdGate || pipeline?.jd_gate;

  return {
    outcome: gate?.outcome || (pipeline?.unsupported_jd ? "unsupported" : "compose"),
    borderline: gate?.outcome === "borderline" || pipeline?.borderline_jd === true,
    engineering_identity: id
      ? {
        primary: id.primary,
        secondary: id.secondary ?? null,
        confidence: id.confidence ?? null,
        coherence: id.coherence ?? null,
      }
      : null,
    global_score: g
      ? {
        before: g.before?.global_score ?? null,
        after: g.after?.global_score ?? null,
        delta: g.delta ?? null,
        applied: g.applied ?? g.improved ?? false,
      }
      : null,
    information_gain: g?.after?.profile?.total_information_gain ?? null,
    per_bullet_gain: (g?.after?.profile?.per_bullet_information_gain || []).map((b) => ({
      ac_id: b.ac_id,
      position: b.position,
      gain: b.gain,
      adds: (b.adds || []).slice(0, 8),
      redundant: (b.redundant || []).slice(0, 4),
    })),
    swaps: (g?.swaps || []).map((s) => ({
      from: s.from,
      to: s.to,
      role: s.role,
      position: s.position,
      reason: s.reason || "",
      delta: s.delta ?? null,
    })),
    rejections_sample: (g?.rejection_audit?.rejections || []).slice(0, 10).map((r) => ({
      rejected: r.rejected,
      selected: r.selected,
      role: r.slot_role,
      information_gain: r.information_gain,
      reasons: r.reasons || [],
    })),
    jd_gate: gate
      ? {
        outcome: gate.outcome,
        message: gate.user_message || gate.message,
        warnings: gate.warnings || [],
        confidence: gate.relevance?.confidence ?? null,
      }
      : null,
    selected_acs: pipeline?.result?.gate?.metrics?.selected_acs
      || pipeline?.result?.compact?.selected_acs
      || null,
  };
}

export function formatExplainLogLines(explain) {
  if (!explain) return [];
  const lines = [];
  if (explain.borderline && explain.jd_gate?.message) {
    lines.push(`warn:Borderline JD · ${explain.jd_gate.message}`);
  }
  if (explain.engineering_identity?.primary) {
    const id = explain.engineering_identity;
    lines.push(`result:Identity · ${id.primary}${id.secondary ? ` / ${id.secondary}` : ""} · confidence ${id.confidence ?? "—"}`);
  }
  if (explain.global_score?.after != null) {
    const g = explain.global_score;
    lines.push(`result:Global score · ${g.before ?? "?"} → ${g.after}${g.delta != null ? ` (${g.delta >= 0 ? "+" : ""}${g.delta})` : ""}`);
  }
  if (explain.information_gain != null) {
    lines.push(`result:Information gain · ${Number(explain.information_gain).toFixed(1)}`);
  }
  for (const s of (explain.swaps || []).slice(0, 6)) {
    lines.push(`think:Swap · ${s.from} → ${s.to} (${s.role}) · ${s.reason || "optimizer"}`);
  }
  return lines;
}
