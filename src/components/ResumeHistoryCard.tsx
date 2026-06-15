import { useState } from "react";
import TrustReportPanel from "./TrustReportPanel";
import ResumeDiffPanel from "./ResumeDiffPanel";
import type { TailoredResumeOnDisk } from "../utils/tailorRun";
import { fetchResumeArtifacts } from "../utils/tailorRun";
import { diffResumeArtifacts } from "../utils/resumeDiff";
import type { ApplyRecord } from "../hooks/useApplyTracker";

const TZ = "America/New_York";

function fmtWhen(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const sameDay = now.toLocaleDateString("en-US", { timeZone: TZ }) === d.toLocaleDateString("en-US", { timeZone: TZ });
  return sameDay
    ? d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" })
    : d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

interface Props {
  resume: TailoredResumeOnDisk;
  previous?: TailoredResumeOnDisk | null;
  applied?: ApplyRecord | null;
  isFirstInGroup?: boolean;
  showCompanyHeader?: boolean;
  onOpenPdf: () => void;
  onApply: () => void;
  onToggleJd: () => void;
  jdOpen: boolean;
  jdContent?: string | null;
  jdLoading?: boolean;
  onCopyJd?: () => void;
  copied?: boolean;
}

export default function ResumeHistoryCard({
  resume: r,
  previous,
  applied,
  isFirstInGroup,
  showCompanyHeader,
  onOpenPdf,
  onApply,
  onToggleJd,
  jdOpen,
  jdContent,
  jdLoading,
  onCopyJd,
  copied,
}: Props) {
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explain, setExplain] = useState<Awaited<ReturnType<typeof fetchResumeArtifacts>>>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffResult, setDiffResult] = useState<ReturnType<typeof diffResumeArtifacts> | null>(null);

  const loadExplain = async () => {
    if (explain) {
      setExplainOpen((v) => !v);
      return;
    }
    setExplainLoading(true);
    const artifacts = await fetchResumeArtifacts(r.dir);
    setExplain(artifacts);
    setExplainLoading(false);
    setExplainOpen(true);
  };

  const loadDiff = async () => {
    if (!previous) return;
    setDiffLoading(true);
    const [fromArt, toArt] = await Promise.all([
      fetchResumeArtifacts(previous.dir),
      fetchResumeArtifacts(r.dir),
    ]);
    if (fromArt && toArt) setDiffResult(diffResumeArtifacts(fromArt, toArt));
    setDiffLoading(false);
    setDiffOpen(true);
  };

  return (
    <>
      {showCompanyHeader && isFirstInGroup ? (
        <li className="resume-history-company" aria-hidden>
          <strong>{r.company}</strong>
        </li>
      ) : null}
      <li className={`resume-history-item${jdOpen ? " is-open" : ""}`}>
        <div className="resume-history-rail" aria-hidden>
          <span className="resume-history-dot" />
          <span className="resume-history-line" />
        </div>
        <div className="resume-history-card">
          <div className="resume-history-head">
            <div className="resume-history-meta">
              <time className="resume-history-when">{fmtWhen(r.tailoredAt)}</time>
              {!showCompanyHeader || !isFirstInGroup ? (
                <span className="resume-history-company-inline">{r.company}</span>
              ) : null}
              <span className="resume-history-role">{r.title}</span>
            </div>
            <div className="resume-history-badges">
              {r.identity ? <span className="resume-history-badge resume-history-badge--id">{r.identity}</span> : null}
              {r.informationGain != null ? (
                <span className="resume-history-badge">IG {Number(r.informationGain).toFixed(1)}</span>
              ) : null}
              {r.borderline ? <span className="resume-history-badge resume-history-badge--warn">Borderline</span> : null}
              {applied ? <span className="resume-history-badge resume-history-badge--applied">Applied</span> : null}
            </div>
          </div>

          <div className="resume-history-actions">
            <button type="button" className="tailored-btn" onClick={() => void loadExplain()} disabled={explainLoading}>
              {explainLoading ? "Loading…" : explainOpen ? "Hide trust" : "Trust"}
            </button>
            {previous ? (
              <button type="button" className="tailored-btn" onClick={() => void loadDiff()} disabled={diffLoading}>
                {diffLoading ? "Diff…" : "Diff"}
              </button>
            ) : null}
            <button type="button" className="tailored-btn" onClick={onToggleJd} disabled={!r.jobUrl}>
              {jdOpen ? "Hide JD" : "JD"}
            </button>
            <button type="button" className="tailored-btn" onClick={onOpenPdf}>PDF</button>
            {r.jobUrl ? (
              <button type="button" className="tailored-btn tailored-btn--primary" onClick={onApply}>Apply ↗</button>
            ) : null}
          </div>

          {explainOpen && (explain?.explain || explainLoading) ? (
            <div className="resume-history-explain">
              <TrustReportPanel explain={explain?.explain} dir={r.dir} />
            </div>
          ) : null}

          {jdOpen ? (
            <div className="tailored-jd">
              {jdLoading ? (
                <div className="tailored-jd-loading">Loading job description…</div>
              ) : jdContent ? (
                <>
                  <div className="tailored-jd-bar">
                    <span>{jdContent.length.toLocaleString()} chars</span>
                    {onCopyJd ? (
                      <button type="button" className="tailored-btn tailored-btn--small" onClick={onCopyJd}>
                        {copied ? "Copied ✓" : "Copy JD"}
                      </button>
                    ) : null}
                  </div>
                  <pre className="tailored-jd-text">{jdContent}</pre>
                </>
              ) : (
                <div className="tailored-jd-loading">No full JD captured for this job.</div>
              )}
            </div>
          ) : null}
        </div>
      </li>
      {diffOpen && diffResult && previous ? (
        <ResumeDiffPanel
          diff={diffResult}
          fromLabel={`${previous.company} · ${fmtWhen(previous.tailoredAt)}`}
          toLabel={`${r.company} · ${fmtWhen(r.tailoredAt)}`}
          onClose={() => setDiffOpen(false)}
        />
      ) : null}
    </>
  );
}
