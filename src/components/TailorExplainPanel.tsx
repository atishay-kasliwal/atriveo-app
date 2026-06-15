import type { TailorExplainSummary } from "../types/tailorExplain";

interface Props {
  explain?: TailorExplainSummary | null;
  compact?: boolean;
}

function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n < 1 ? `${Math.round(n * 100)}%` : String(Math.round(n));
}

export default function TailorExplainPanel({ explain, compact = false }: Props) {
  if (!explain) return null;

  const id = explain.engineering_identity;
  const gs = explain.global_score;
  const hasSwaps = (explain.swaps?.length ?? 0) > 0;
  const hasRejections = (explain.rejections_sample?.length ?? 0) > 0;
  const hasBullets = (explain.per_bullet_gain?.length ?? 0) > 0;

  if (!id && !gs && !hasSwaps && !hasRejections && !explain.borderline && !explain.jd_gate?.message) {
    return null;
  }

  return (
    <div className={`tailor-explain${compact ? " tailor-explain--compact" : ""}`}>
      {explain.borderline && explain.jd_gate?.message ? (
        <p className="tailor-explain-banner tailor-explain-banner--warn" role="status">
          Borderline JD — {explain.jd_gate.message}
        </p>
      ) : null}

      {id?.primary ? (
        <div className="tailor-explain-row">
          <span className="tailor-explain-label">Identity</span>
          <span className="tailor-explain-value">
            {id.primary}
            {id.secondary ? ` · ${id.secondary}` : ""}
            {id.confidence != null ? ` · ${pct(id.confidence)} conf` : ""}
          </span>
        </div>
      ) : null}

      {gs?.after != null ? (
        <div className="tailor-explain-row">
          <span className="tailor-explain-label">Global score</span>
          <span className="tailor-explain-value">
            {gs.before ?? "?"} → {gs.after}
            {gs.delta != null ? ` (${gs.delta >= 0 ? "+" : ""}${gs.delta})` : ""}
          </span>
        </div>
      ) : null}

      {explain.information_gain != null ? (
        <div className="tailor-explain-row">
          <span className="tailor-explain-label">Info gain</span>
          <span className="tailor-explain-value">{Number(explain.information_gain).toFixed(1)}</span>
        </div>
      ) : null}

      {hasSwaps ? (
        <details className="tailor-explain-details">
          <summary>Optimizer swaps ({explain.swaps!.length})</summary>
          <ul className="tailor-explain-list">
            {explain.swaps!.map((s) => (
              <li key={`${s.from}-${s.to}-${s.role}`}>
                <code>{s.from}</code> → <code>{s.to}</code>
                <span className="tailor-explain-muted"> · {s.role}</span>
                {s.reason ? <span className="tailor-explain-muted"> · {s.reason}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {!compact && hasBullets ? (
        <details className="tailor-explain-details">
          <summary>Per-bullet information gain</summary>
          <ul className="tailor-explain-list">
            {explain.per_bullet_gain!.map((b) => (
              <li key={`${b.ac_id}-${b.position}`}>
                <code>{b.ac_id}</code>
                <span className="tailor-explain-muted"> #{b.position} · +{b.gain}</span>
                {b.adds?.length ? (
                  <span className="tailor-explain-muted"> · {b.adds.join(", ")}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {!compact && hasRejections ? (
        <details className="tailor-explain-details">
          <summary>Why not selected (sample)</summary>
          <ul className="tailor-explain-list">
            {explain.rejections_sample!.map((r) => (
              <li key={`${r.rejected}-${r.selected}`}>
                <code>{r.rejected}</code>
                <span className="tailor-explain-muted"> vs {r.selected} ({r.role})</span>
                {r.reasons[0] ? <span className="tailor-explain-muted"> · {r.reasons[0]}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
