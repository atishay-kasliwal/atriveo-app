import type { ResumeDiffResult } from "../utils/resumeDiff";

interface Props {
  diff: ResumeDiffResult;
  fromLabel: string;
  toLabel: string;
  onClose: () => void;
}

export default function ResumeDiffPanel({ diff, fromLabel, toLabel, onClose }: Props) {
  return (
    <div className="resume-diff-overlay" role="dialog" aria-modal="true" aria-label="Resume diff">
      <div className="resume-diff-panel">
        <header className="resume-diff-header">
          <div>
            <h2 className="resume-diff-title">Compile diff</h2>
            <p className="resume-diff-sub">
              <span>{fromLabel}</span>
              <span className="resume-diff-arrow">→</span>
              <span>{toLabel}</span>
            </p>
          </div>
          <button type="button" className="resume-diff-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="resume-diff-body">
          {diff.identityChanged ? (
            <section className="resume-diff-section">
              <h3>Engineering identity</h3>
              <p className="resume-diff-identity">
                <span className="resume-diff-old">{diff.identityFrom || "—"}</span>
                <span className="resume-diff-arrow">→</span>
                <span className="resume-diff-new">{diff.identityTo || "—"}</span>
              </p>
            </section>
          ) : diff.identityTo ? (
            <section className="resume-diff-section">
              <h3>Engineering identity</h3>
              <p>{diff.identityTo} <span className="resume-diff-unchanged">(unchanged)</span></p>
            </section>
          ) : null}

          {diff.informationGainDelta != null ? (
            <section className="resume-diff-section">
              <h3>Information gain</h3>
              <p>
                {diff.informationGainFrom?.toFixed(1)} → {diff.informationGainTo?.toFixed(1)}
                {" "}
                <span className={diff.informationGainDelta >= 0 ? "resume-diff-pos" : "resume-diff-neg"}>
                  ({diff.informationGainDelta >= 0 ? "+" : ""}{diff.informationGainDelta.toFixed(1)})
                </span>
              </p>
            </section>
          ) : null}

          {diff.slotChanges.length > 0 ? (
            <section className="resume-diff-section">
              <h3>AC slot changes ({diff.slotChanges.length})</h3>
              <ul className="resume-diff-slots">
                {diff.slotChanges.map((s) => (
                  <li key={`${s.position}-${s.from}-${s.to}`}>
                    <span className="resume-diff-slot-num">#{s.position}</span>
                    <code>{s.from}</code>
                    <span className="resume-diff-arrow">→</span>
                    <code>{s.to}</code>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="resume-diff-section">
              <h3>AC selection</h3>
              <p className="resume-diff-unchanged">Same 15 AC slots as previous compile.</p>
            </section>
          )}

          {(diff.addedAcs.length > 0 || diff.removedAcs.length > 0) ? (
            <section className="resume-diff-section">
              <h3>Set changes</h3>
              {diff.addedAcs.length > 0 ? (
                <p><strong>Added:</strong> {diff.addedAcs.join(", ")}</p>
              ) : null}
              {diff.removedAcs.length > 0 ? (
                <p><strong>Removed:</strong> {diff.removedAcs.join(", ")}</p>
              ) : null}
            </section>
          ) : null}

          {diff.swapSummary.length > 0 ? (
            <section className="resume-diff-section">
              <h3>Swap rationale</h3>
              <ul className="resume-diff-swaps">
                {diff.swapSummary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
