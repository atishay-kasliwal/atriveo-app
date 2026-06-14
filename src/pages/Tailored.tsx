import { useCallback, useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
import PageIntro from "../components/PageIntro";
import { useApplyTracker } from "../hooks/useApplyTracker";
import { openTailorPath, listTailoredResumes, type TailoredResumeOnDisk } from "../utils/tailorRun";
import { loadJobDescriptions } from "../utils/jobDescriptionBuckets";

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

export default function Tailored() {
  const { recordClick, getRecord } = useApplyTracker();
  const [resumes, setResumes] = useState<TailoredResumeOnDisk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [openJd, setOpenJd] = useState<string | null>(null);
  const [jdText, setJdText] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const list = await listTailoredResumes();
    setResumes(list);
    setError(list.length === 0 ? "No resumes found on your Mac — is the tailor server running (npm run tailor)?" : "");
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    // light auto-refresh so new resumes appear as the queue finishes them
    const id = window.setInterval(() => { void refresh(); }, 60_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return resumes;
    return resumes.filter((r) => r.company.toLowerCase().includes(q) || r.title.toLowerCase().includes(q));
  }, [resumes, query]);

  // Lazy-load JD text for the expanded job (by URL → bucket).
  useEffect(() => {
    if (!openJd) return;
    const rec = resumes.find((r) => r.dir === openJd);
    if (!rec?.jobUrl || jdText[openJd] != null) return;
    let cancelled = false;
    loadJobDescriptions([{ job_url: rec.jobUrl } as Parameters<typeof loadJobDescriptions>[0][number]])
      .then((byUrl) => { if (!cancelled) setJdText((p) => ({ ...p, [openJd]: byUrl[rec.jobUrl] || "" })); })
      .catch(() => { if (!cancelled) setJdText((p) => ({ ...p, [openJd]: "" })); });
    return () => { cancelled = true; };
  }, [openJd, resumes, jdText]);

  const todayCount = useMemo(() => {
    const today = new Date().toLocaleDateString("en-US", { timeZone: TZ });
    return resumes.filter((r) => r.tailoredAt && new Date(r.tailoredAt).toLocaleDateString("en-US", { timeZone: TZ }) === today).length;
  }, [resumes]);

  const handleApply = (r: TailoredResumeOnDisk) => {
    if (r.jobUrl) {
      recordClick(r.jobUrl, r.title, r.company, {});
      window.open(r.jobUrl, "_blank", "noopener");
    }
  };

  const handleCopyJd = async (key: string) => {
    const text = jdText[key];
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((k) => (k === key ? null : k)), 1500);
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
          description="Read straight from your Mac — every job whose tailored PDF exists. Open the resume, read the JD, and apply. New resumes appear automatically as the queue finishes them."
          stats={[
            { label: "Tailored", value: resumes.length, tone: "green" },
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
          <button type="button" className="sort-btn" onClick={() => void refresh()}>↻ Refresh</button>
          <a href="/" className="sort-btn">← Back to Live Feed</a>
        </div>

        {loading && resumes.length === 0 ? (
          <div className="tailored-empty">Loading tailored resumes from your Mac…</div>
        ) : filtered.length === 0 ? (
          <div className="tailored-empty">{error || "No tailored jobs match your search."}</div>
        ) : (
          <ul className="tailored-list" aria-label="Tailored resumes">
            {filtered.map((r) => {
              const applied = r.jobUrl ? getRecord(r.jobUrl) : null;
              const isOpen = openJd === r.dir;
              const jd = jdText[r.dir];
              return (
                <li key={r.dir} className={`tailored-card${isOpen ? " is-open" : ""}`}>
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
                        onClick={() => setOpenJd(isOpen ? null : r.dir)}
                        disabled={!r.jobUrl}
                      >
                        {isOpen ? "Hide JD" : "View JD"}
                      </button>
                      <button
                        type="button"
                        className="tailored-btn"
                        onClick={() => { void openTailorPath(r.pdfPath); }}
                        title="Reveal the PDF in Finder"
                      >
                        Open resume
                      </button>
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
                            <button type="button" className="tailored-btn tailored-btn--small" onClick={() => handleCopyJd(r.dir)}>
                              {copied === r.dir ? "Copied ✓" : "Copy JD"}
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
