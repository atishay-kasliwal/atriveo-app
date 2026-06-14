import { useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
import PageIntro from "../components/PageIntro";
import { useTailorStatus } from "../hooks/useTailorStatus";
import { useApplyTracker } from "../hooks/useApplyTracker";
import { openTailorPath } from "../utils/tailorRun";
import { loadJobDescriptions } from "../utils/jobDescriptionBuckets";
import type { TailorRecord } from "../types/tailorQueue";

const TZ = "America/New_York";

function fmtWhen(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const sameDay = now.toLocaleDateString("en-US", { timeZone: TZ }) === d.toLocaleDateString("en-US", { timeZone: TZ });
  return sameDay
    ? d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" })
    : d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function Tailored() {
  const { records } = useTailorStatus();
  const { recordClick, getRecord } = useApplyTracker();
  const [query, setQuery] = useState("");
  const [openJd, setOpenJd] = useState<string | null>(null);
  const [jdText, setJdText] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  // Only jobs that actually have a created resume (PDF on disk).
  const done = useMemo(
    () => Object.values(records)
      .filter((r): r is TailorRecord => r.status === "done" && Boolean(r.pdfPath))
      .sort((a, b) => new Date(b.tailoredAt || 0).getTime() - new Date(a.tailoredAt || 0).getTime()),
    [records],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return done;
    return done.filter(
      (r) => r.company.toLowerCase().includes(q) || r.title.toLowerCase().includes(q),
    );
  }, [done, query]);

  // Lazy-load JD text from the bucket for the currently expanded job.
  useEffect(() => {
    if (!openJd) return;
    const rec = done.find((r) => r.jobKey === openJd);
    if (!rec?.jobUrl || jdText[openJd] != null) return;
    let cancelled = false;
    loadJobDescriptions([{ job_url: rec.jobUrl } as Parameters<typeof loadJobDescriptions>[0][number]])
      .then((byUrl) => {
        if (cancelled) return;
        setJdText((prev) => ({ ...prev, [openJd]: byUrl[rec.jobUrl] || "" }));
      })
      .catch(() => {
        if (!cancelled) setJdText((prev) => ({ ...prev, [openJd]: "" }));
      });
    return () => { cancelled = true; };
  }, [openJd, done, jdText]);

  const todayCount = useMemo(() => {
    const today = new Date().toLocaleDateString("en-US", { timeZone: TZ });
    return done.filter((r) => r.tailoredAt && new Date(r.tailoredAt).toLocaleDateString("en-US", { timeZone: TZ }) === today).length;
  }, [done]);

  const handleApply = (r: TailorRecord) => {
    if (r.jobUrl) {
      recordClick(r.jobUrl, r.title, r.company, {});
      window.open(r.jobUrl, "_blank", "noopener");
    }
  };

  const handleCopyJd = async (jobKey: string) => {
    const text = jdText[jobKey];
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(jobKey);
      window.setTimeout(() => setCopied((k) => (k === jobKey ? null : k)), 1500);
    } catch { /* clipboard blocked */ }
  };

  return (
    <div>
      <AppHeader />
      <div className="wrapper page-shell page-shell-wide tailored-page">
        <PageIntro
          compact
          kicker="Tailored"
          title="Jobs with a resume already created"
          description="Synced from your tailor runs. Each row is a job whose tailored PDF is on your Mac — open the resume, read the JD, and apply. Resumes appear here automatically as the queue finishes them."
          stats={[
            { label: "Tailored", value: done.length, tone: "green" },
            { label: "Today", value: todayCount, tone: "blue" },
            { label: "Visible", value: filtered.length, tone: "orange" },
          ]}
        />

        <div className="top-bar tailored-toolbar">
          <div className="search-wrap">
            <span className="search-icon">⌕</span>
            <input
              className="search-input"
              type="search"
              placeholder="Search tailored jobs…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <a href="/" className="sort-btn">← Back to Live Feed</a>
        </div>

        {filtered.length === 0 ? (
          <div className="tailored-empty">
            {done.length === 0
              ? "No tailored resumes yet. Select jobs in the feed and tailor them — they'll show up here when the PDF is ready."
              : "No tailored jobs match your search."}
          </div>
        ) : (
          <ul className="tailored-list" aria-label="Tailored resumes">
            {filtered.map((r) => {
              const applied = r.jobUrl ? getRecord(r.jobUrl) : null;
              const isOpen = openJd === r.jobKey;
              const jd = jdText[r.jobKey];
              return (
                <li key={r.jobKey} className={`tailored-card${isOpen ? " is-open" : ""}`}>
                  <div className="tailored-card-main">
                    <div className="tailored-card-info">
                      <div className="tailored-card-title">
                        <strong>{r.company}</strong>
                        <span className="tailored-card-role">{r.title}</span>
                      </div>
                      <div className="tailored-card-meta">
                        {r.ats ? <span className="tailored-tag tailored-tag--ats">ATS {r.ats}</span> : null}
                        <span className="tailored-card-when">Tailored {fmtWhen(r.tailoredAt)}</span>
                        {applied ? <span className="tailored-tag tailored-tag--applied">Applied{applied.clicks > 1 ? ` ×${applied.clicks}` : ""}</span> : null}
                      </div>
                    </div>
                    <div className="tailored-card-actions">
                      <button
                        type="button"
                        className="tailored-btn"
                        onClick={() => setOpenJd(isOpen ? null : r.jobKey)}
                      >
                        {isOpen ? "Hide JD" : "View JD"}
                      </button>
                      {r.pdfPath ? (
                        <button
                          type="button"
                          className="tailored-btn"
                          onClick={() => { void openTailorPath(r.pdfPath as string); }}
                          title="Reveal the PDF in Finder"
                        >
                          Open resume
                        </button>
                      ) : null}
                      {r.jobUrl ? (
                        <button
                          type="button"
                          className="tailored-btn tailored-btn--primary"
                          onClick={() => handleApply(r)}
                        >
                          Apply ↗
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {isOpen ? (
                    <div className="tailored-jd">
                      {jd == null ? (
                        <div className="tailored-jd-loading">Loading job description…</div>
                      ) : jd ? (
                        <>
                          <div className="tailored-jd-bar">
                            <span>{jd.length.toLocaleString()} chars</span>
                            <button type="button" className="tailored-btn tailored-btn--small" onClick={() => handleCopyJd(r.jobKey)}>
                              {copied === r.jobKey ? "Copied ✓" : "Copy JD"}
                            </button>
                          </div>
                          <pre className="tailored-jd-text">{jd}</pre>
                        </>
                      ) : (
                        <div className="tailored-jd-loading">No full JD captured for this job.</div>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
