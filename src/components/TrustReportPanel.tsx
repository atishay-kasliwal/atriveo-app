import { useEffect, useMemo, useState } from "react";
import type { TailorExplainSummary } from "../types/tailorExplain";
import type { TrustReport } from "../types/trustReport";
import { buildTrustReport } from "../utils/buildTrustReport";
import { fetchResumeArtifacts } from "../utils/tailorRun";
import ExplainSummary from "./ExplainSummary";

interface Props {
  explain?: TailorExplainSummary | null;
  /** Run dir on Mac — loads composition coverage for full trust report. */
  dir?: string | null;
  compact?: boolean;
}

export default function TrustReportPanel({ explain, dir, compact = false }: Props) {
  const [extras, setExtras] = useState<Awaited<ReturnType<typeof fetchResumeArtifacts>>>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!dir) {
      setExtras(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchResumeArtifacts(dir).then((art) => {
      if (!cancelled) {
        setExtras(art);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [dir]);

  const report: TrustReport | null = useMemo(() => {
    const mergedExplain = extras?.explain ?? explain;
    return buildTrustReport(mergedExplain, extras ? {
      coverage: extras.coverage,
      graphCoverage: extras.graphCoverage,
      hiringManager: extras.hiringManager,
    } : null);
  }, [explain, extras]);

  if (!explain && !extras?.explain && !loading) return null;

  return (
    <div className={`trust-report${compact ? " trust-report--compact" : ""}`}>
      <ExplainSummary explain={extras?.explain ?? explain} showDetails={false} />

      {loading ? (
        <p className="trust-report-loading">Loading coverage map…</p>
      ) : null}

      {report ? (
        <>
          {report.borderlineMessage ? (
            <p className="trust-report-banner">{report.borderlineMessage}</p>
          ) : null}

          {report.recruiterReplay.length > 0 ? (
            <section className="trust-report-section">
              <h3 className="trust-report-heading">Recruiter replay (~30s)</h3>
              <ul className="trust-report-replay">
                {report.recruiterReplay.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="trust-report-conf">Trust: {report.confidence}</p>
            </section>
          ) : null}

          {report.jdCoverage.capabilityMap.length > 0 || report.jdCoverage.weightedPct != null ? (
            <section className="trust-report-section">
              <h3 className="trust-report-heading">JD coverage map</h3>
              {report.jdCoverage.weightedPct != null ? (
                <p className="trust-report-stat">Keyword coverage ~{report.jdCoverage.weightedPct}%</p>
              ) : null}
              {report.jdCoverage.capabilityMap.length > 0 ? (
                <ul className="trust-capability-map">
                  {report.jdCoverage.capabilityMap.map((c) => (
                    <li key={c.node} className="trust-capability-row">
                      <span className="trust-capability-label">{c.node}</span>
                      <span className="trust-capability-bar" aria-hidden>
                        <span className="trust-capability-fill" style={{ width: `${Math.round(c.strength * 100)}%` }} />
                      </span>
                      <span className="trust-capability-pct">{Math.round(c.strength * 100)}%</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {report.jdCoverage.missingClaimable.length > 0 ? (
                <p className="trust-report-gaps">
                  <strong>Missing (claimable):</strong> {report.jdCoverage.missingClaimable.join(", ")}
                </p>
              ) : null}
              {report.jdCoverage.unclaimable.length > 0 ? (
                <p className="trust-report-gaps trust-report-gaps--muted">
                  <strong>Unsupported JD terms:</strong> {report.jdCoverage.unclaimable.join(", ")}
                </p>
              ) : null}
            </section>
          ) : null}

          {report.rejections.length > 0 ? (
            <section className="trust-report-section">
              <h3 className="trust-report-heading">Selection rejections ({report.rejections.length})</h3>
              <ul className="trust-rejection-list">
                {report.rejections.map((r) => (
                  <li key={`${r.rejected}-${r.selected}-${r.role}`}>
                    <code>{r.rejected}</code>
                    <span className="trust-rejection-vs"> lost to </span>
                    <code>{r.selected}</code>
                    <span className="trust-rejection-role"> · {r.role}</span>
                    {r.reasons[0] ? <span className="trust-rejection-reason"> — {r.reasons[0]}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {report.hiringManager && !compact ? (
            <section className="trust-report-section">
              <h3 className="trust-report-heading">Hiring manager test</h3>
              <p className="trust-report-stat">
                {report.hiringManager.wouldInterview == null
                  ? "No verdict"
                  : report.hiringManager.wouldInterview
                    ? "Would interview"
                    : "Would pass"}
              </p>
              {report.hiringManager.because.map((b) => (
                <p key={b} className="trust-report-note">+ {b}</p>
              ))}
              {report.hiringManager.concerns.map((c) => (
                <p key={c} className="trust-report-note trust-report-note--warn">− {c}</p>
              ))}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
