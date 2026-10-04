import { useEffect, useMemo, useState } from "react";
import { IN_BROWSER_LABEL, inBrowserSummary } from "./InBrowser";
import { createPortal } from "react-dom";
import PdfPreviewModal from "../components/PdfPreviewModal";
import { getTailorServerBase } from "../utils/tailorServer";
import { loadDetail, type Detail, type ResumeReport } from "./detail";
import { humanize, when } from "./engine";

const bytesLabel = (n: number | null) => (n == null ? "—" : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function answerText(q: Detail["questions"][number]): { text: string; muted: boolean } {
  switch (q.answerKind) {
    case "value": return { text: q.answer ?? "", muted: false };
    case "declined": return { text: "Decline to self-identify", muted: false };
    case "withheld": return { text: q.verified ? "Filled (value not stored: sensitive)" : "Answer resolved from saved source (sensitive value withheld)", muted: true };
    case "blank": return { text: "Left blank", muted: true };
    default: return { text: q.resolution === "needs_review" ? "Waiting for your answer" : "—", muted: true };
  }
}

/** Score tile: a big number, what it means, and an optional tone. */
function Score({ label, value, sub, tone, children }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad"; children?: React.ReactNode }) {
  return (
    <div className={`apps-score ${tone ?? ""}`}>
      <span className="apps-score-label">{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
      {children}
    </div>
  );
}

const toneFor = (v: number | null, good: number, ok: number) => (v == null ? undefined : v >= good ? "good" : v >= ok ? "warn" : "bad");

const PART_LABELS: Array<[keyof NonNullable<ResumeReport["human"]>["parts"], string]> = [
  ["technical", "Technical depth"], ["impact", "Business impact"], ["execution", "Execution"], ["uniqueness", "Uniqueness"],
];

/**
 * Everything about one application: scores (ATS, hiring manager, JD coverage), what the resume
 * covers and misses, the hiring-manager read, every question with its answer, and the timeline.
 * Used by the History drawer and the Ready page. `version` (the record's updatedAt) refreshes it.
 */
export default function ApplicationDetail({ id, version }: { id: string; version: string }) {
  const [loaded, setLoaded] = useState<{ key: string; detail: Detail | null; error: string | null } | null>(null);
  const [filter, setFilter] = useState("");
  const [showAllKeywords, setShowAllKeywords] = useState(false);
  const key = `${id}@${version}`;
  useEffect(() => {
    let live = true;
    loadDetail(id, version)
      .then((d) => { if (live) setLoaded({ key, detail: d, error: null }); })
      .catch((e) => { if (live) setLoaded({ key, detail: null, error: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [id, version, key]);
  const current = loaded?.key === key ? loaded : null;
  const detail = current?.detail ?? null;
  const error = current?.error ?? null;

  const qs = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (detail?.questions ?? []).filter((q) => !f || `${q.label} ${q.answer ?? ""} ${q.source}`.toLowerCase().includes(f));
  }, [detail, filter]);
  const answered = detail?.questions.filter((q) => q.resolution === "answered").length ?? 0;
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  // Phones show only the first page of a PDF inside a frame, so open it in its own tab there.
  const openResume = (path: string) => {
    if (window.matchMedia("(max-width: 720px)").matches) window.open(`${getTailorServerBase()}/serve-pdf?path=${encodeURIComponent(path)}`, "_blank", "noopener");
    else setPdfPath(path);
  };

  const rep = detail?.resumeReport ?? null;
  const human = rep?.human ?? null;
  const notCovered = rep ? [
    ...rep.coverage.missingClaimable.map((t) => ({ term: t, kind: "missing" as const })),
    ...rep.coverage.gaps.filter((g) => !rep.coverage.missingClaimable.includes(g.term)).map((g) => ({ term: g.term, kind: "missing" as const })),
    ...rep.coverage.unclaimable.map((t) => ({ term: t, kind: "no-evidence" as const })),
  ] : [];
  const overUsed = rep?.keywords.filter((k) => k.status === "over") ?? [];
  const underUsed = rep?.keywords.filter((k) => k.status === "under" || k.status === "missing") ?? [];

  return (
    <>
      {error && <p className="apps-error">Couldn't load this application: {error}</p>}
      {!detail && !error && <p className="apps-muted">Loading…</p>}
      {detail && (
        <>
          {detail.owner === "extension" && detail.inBrowser && (
            <p className="apps-note ib-banner" role="status"><strong>{IN_BROWSER_LABEL}.</strong> Opened with Apply with Atriveo · {inBrowserSummary(detail.inBrowser)}. The worker never touches it.</p>
          )}
          <section className="apps-scores" aria-label="Scores">
            <Score
              label="ATS score"
              value={rep?.ats.after != null ? `${rep.ats.after}` : "—"}
              sub={rep?.ats.before != null && rep.ats.after != null ? `${rep.ats.before} before tailoring (${rep.ats.after - rep.ats.before >= 0 ? "+" : ""}${rep.ats.after - rep.ats.before})` : rep ? "keyword match to the JD" : "no scoring report"}
              tone={toneFor(rep?.ats.after ?? null, 75, 60)}
            />
            <Score
              label="Hiring manager"
              value={human?.score != null ? `${human.score}/10` : "—"}
              sub={human?.wouldInterview == null ? "human read" : human.wouldInterview ? "✓ would interview" : "✕ would not interview"}
              tone={human?.score != null ? (human.score >= 8 ? "good" : human.score >= 6 ? "warn" : "bad") : undefined}
            />
            <Score
              label="JD coverage"
              value={rep?.coverage.pct != null ? `${rep.coverage.pct}%` : "—"}
              sub={rep ? `${rep.coverage.covered.length} covered · ${notCovered.length} not covered` : "weighted by importance"}
              tone={toneFor(rep?.coverage.pct ?? null, 70, 50)}
            >
              {notCovered.length > 0 && (
                <span className="apps-score-missing">
                  <span className="apps-score-missing-label">Missing:</span>{" "}
                  {notCovered.slice(0, 6).map((c) => c.term).join(", ")}
                  {notCovered.length > 6 && (
                    <> · <button type="button" className="apps-link" onClick={() => document.getElementById("apps-not-covered")?.scrollIntoView({ behavior: "smooth", block: "center" })}>+{notCovered.length - 6} more</button></>
                  )}
                </span>
              )}
            </Score>
            <Score label="Resume confidence" value={rep?.confidence != null ? `${rep.confidence}` : "—"} sub="overall, out of 100" tone={toneFor(rep?.confidence ?? null, 75, 60)} />
            <Score label="Questions" value={`${answered}/${detail.questions.length}`} sub="answered on the form" tone={answered === detail.questions.length ? "good" : "warn"} />
          </section>

          <div className="apps-full-grid">
            <div className="apps-full-col">
              <section className="apps-block">
                <div className="apps-block-head"><h3>Resume</h3>
                  {detail.resume.path && (
                    <div className="apps-resume-open">
                      <button type="button" className="apps-btn accent" onClick={() => openResume(detail.resume.path!)} title={detail.resume.path}>Open resume</button>
                      <a className="apps-link" href={`${getTailorServerBase()}/serve-pdf?path=${encodeURIComponent(detail.resume.path)}&dl=1`} download="Atishay Kasliwal.pdf">Download</a>
                    </div>
                  )}
                </div>
                {rep?.thesis && <p className="apps-thesis">“{rep.thesis}”</p>}
                <p className="apps-muted">
                  {detail.resume.fileName ?? "No resume recorded"}{detail.resume.bytes ? ` · ${bytesLabel(detail.resume.bytes)}` : ""}
                  {detail.resume.verifiedAt ? ` · uploaded ${when(detail.resume.verifiedAt)}` : ""}
                  {detail.resume.sourceJobUrl && <> · <a href={detail.resume.sourceJobUrl} target="_blank" rel="noreferrer">tailored job ↗</a></>}
                </p>
                {rep?.jdNote && <p className="apps-muted">{rep.jdNote}</p>}
              </section>

              <section className="apps-block">
                <h3>What the resume covers</h3>
                {!rep ? <p className="apps-muted">No coverage report was saved for this resume.</p> : (
                  <>
                    <div className="apps-chips-group">
                      <span className="apps-chips-title good">Covered · {rep.coverage.covered.length}</span>
                      <div className="apps-chips">
                        {rep.coverage.covered.map((c) => <span key={c.term} className="apps-chip2 good" title={c.where ? `in ${c.where}` : undefined}>{c.term}{c.where && c.where !== "none" ? <em>{c.where}</em> : null}</span>)}
                        {rep.coverage.covered.length === 0 && <span className="apps-muted">Nothing matched.</span>}
                      </div>
                    </div>
                    <div className="apps-chips-group" id="apps-not-covered">
                      <span className="apps-chips-title warn">Not covered · {notCovered.length}</span>
                      <div className="apps-chips">
                        {notCovered.map((c) => <span key={`${c.kind}-${c.term}`} className={`apps-chip2 ${c.kind === "missing" ? "warn" : "muted"}`} title={c.kind === "missing" ? "You have evidence for this but it is not on the resume" : "No evidence in your experience bank"}>{c.term}{c.kind === "no-evidence" ? <em>no evidence</em> : null}</span>)}
                        {notCovered.length === 0 && <span className="apps-muted">Every JD term is covered.</span>}
                      </div>
                    </div>
                    {(overUsed.length > 0 || underUsed.length > 0) && (
                      <div className="apps-chips-group">
                        <span className="apps-chips-title">Keyword balance</span>
                        <div className="apps-chips">
                          {overUsed.map((k) => <span key={k.keyword} className="apps-chip2 muted" title={`Used ${k.count}× (target ${k.min ?? 0}–${k.max ?? "?"})`}>{k.keyword}<em>{k.count}× over</em></span>)}
                          {underUsed.map((k) => <span key={k.keyword} className="apps-chip2 warn" title={`Used ${k.count}× (target ${k.min ?? 0}–${k.max ?? "?"})`}>{k.keyword}<em>{k.count}× under</em></span>)}
                        </div>
                      </div>
                    )}
                    {rep.keywords.length > 0 && (
                      <>
                        <button className="apps-link" onClick={() => setShowAllKeywords((v) => !v)}>{showAllKeywords ? "Hide keyword table" : `All ${rep.keywords.length} ATS keywords`}</button>
                        {showAllKeywords && (
                          <div className="apps-table-wrap"><table className="apps-table">
                            <thead><tr><th>Keyword</th><th>Used</th><th>Target</th><th>Status</th></tr></thead>
                            <tbody>{rep.keywords.map((k) => <tr key={k.keyword}><td>{k.keyword}</td><td>{k.count}</td><td>{k.min ?? 0}–{k.max ?? "?"}</td><td>{k.status}</td></tr>)}</tbody>
                          </table></div>
                        )}
                      </>
                    )}
                  </>
                )}
              </section>

              <section className="apps-block">
                <h3>Hiring manager read</h3>
                {!human ? <p className="apps-muted">No hiring-manager review was saved for this resume.</p> : (
                  <>
                    {human.diagnosis && <p className="apps-diagnosis">{human.diagnosis}</p>}
                    <ul className="apps-bars">
                      {PART_LABELS.map(([k, label]) => {
                        const v = human.parts[k];
                        return v == null ? null : (
                          <li key={k}><span>{label}</span><span className="apps-meter"><i style={{ width: `${Math.max(2, v * 10)}%` }} /></span><b>{v}</b></li>
                        );
                      })}
                      {human.parts.overclaimRisk != null && <li><span>Overclaim risk</span><span className="apps-meter risk"><i style={{ width: `${Math.max(2, human.parts.overclaimRisk * 10)}%` }} /></span><b>{human.parts.overclaimRisk}</b></li>}
                    </ul>
                    <div className="apps-proscons">
                      <ul className="pros">{human.because.map((b) => <li key={b}>{b}</li>)}</ul>
                      {human.concerns.length > 0 && <ul className="cons">{human.concerns.map((c) => <li key={c}>{c}</li>)}</ul>}
                    </div>
                  </>
                )}
              </section>
            </div>

            <div className="apps-full-col">
              <section className="apps-block">
                <div className="apps-block-head">
                  <h3>Questions and answers <span className="apps-count">{answered}/{detail.questions.length}</span></h3>
                  <input className="apps-hist-search" placeholder="Filter" aria-label="Filter questions" value={filter} onChange={(e) => setFilter(e.target.value)} />
                </div>
                {qs.length === 0 ? <p className="apps-muted">No questions recorded.</p> : (
                  <ul className="apps-qa2">
                    {qs.map((q, i) => {
                      const a = answerText(q);
                      return (
                        <li key={`${q.label}-${i}`} className={q.resolution === "needs_review" ? "needs" : ""}>
                          <span className="q">{q.label}{q.required ? " *" : ""}</span>
                          <span className={`a ${a.muted ? "muted" : ""}`}>{a.text}</span>
                          <span className="m" title={q.source}>
                            {q.resolution === "answered" ? (q.verified ? <b className="ok">✓</b> : <b className="warn">?</b>) : q.resolution === "needs_review" ? <b className="warn">!</b> : null}
                            {q.source !== "—" ? q.source.split(" · ")[0] : ""}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="apps-block">
                <h3>Timeline</h3>
                <ol className="apps-timeline">
                  {detail.timeline.map((t, i) => (
                    <li key={i}>
                      <span className="apps-muted">{when(t.at)}</span>
                      <span>{t.from ? `${humanize(t.from)} → ` : ""}<strong>{humanize(t.to)}</strong> <span className="apps-muted">· {t.actor}</span></span>
                      {t.reason && <span className="apps-muted">{t.reason}</span>}
                    </li>
                  ))}
                </ol>
                {detail.submission.confirmation && <p className="apps-muted">Confirmation: {detail.submission.confirmation}</p>}
                {detail.failure && <p className="apps-muted">Last failure: {humanize(detail.failure.code)} — {detail.failure.message}</p>}
              </section>
            </div>
          </div>
        </>
      )}
      {pdfPath && createPortal(<PdfPreviewModal pdfPath={pdfPath} onClose={() => setPdfPath(null)} />, document.body)}
    </>
  );
}
