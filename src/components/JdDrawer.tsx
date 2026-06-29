import { useEffect, useState } from "react";
import { loadJobDescriptions } from "../utils/jobDescriptionBuckets";
import type { Job } from "../types";

interface Props {
  job: Job;
  onClose: () => void;
}

export default function JdDrawer({ job, onClose }: Props) {
  const [body, setBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    setLoading(true);
    setBody(null);
    loadJobDescriptions([job]).then((map) => {
      const full = job.job_url ? map[job.job_url] : undefined;
      setBody(full?.trim() || job.summary?.trim() || null);
      setLoading(false);
    });
  }, [job]);

  function handleCopy() {
    const text = body || "";
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <>
      <div className="jd-drawer-overlay" onClick={onClose} />
      <div className="jd-drawer" role="dialog" aria-label="Job description">
        <div className="jd-drawer-header">
          <div className="jd-drawer-meta">
            <span className="jd-drawer-company">{job.company}</span>
            <span className="jd-drawer-title">{job.title}</span>
          </div>
          <div className="jd-drawer-actions">
            <button
              type="button"
              className={`jd-drawer-btn${copied ? " jd-drawer-btn--done" : ""}`}
              disabled={!body || loading}
              onClick={handleCopy}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            {job.job_url && (
              <a
                className="jd-drawer-btn"
                href={job.job_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open ↗
              </a>
            )}
            <button type="button" className="jd-drawer-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="jd-drawer-body">
          {loading ? (
            <div className="jd-drawer-state">Loading…</div>
          ) : body ? (
            <pre className="jd-drawer-text">{body}</pre>
          ) : (
            <div className="jd-drawer-state">No job description available.</div>
          )}
        </div>
      </div>
    </>
  );
}
