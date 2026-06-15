import { useState, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import AppHeader from "../components/AppHeader";
import PageIntro from "../components/PageIntro";
import { useExclusions } from "../hooks/useExclusions";
import { assertTailorServerReady, listTailoredResumes } from "../utils/tailorRun";

const RESUME_KEY = "atriveo_resume";
const BANK_VERSION = 51;
const PLANNER = "v2";

export default function Settings() {
  const { user } = useAuth();
  const { exclusions, excludeCompany, excludeKeyword, removeExclusion } = useExclusions();

  const [companyInput, setCompanyInput] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [resumeSaved, setResumeSaved] = useState(false);
  const [sidecarOk, setSidecarOk] = useState<boolean | null>(null);
  const [bucketFresh, setBucketFresh] = useState<string>("…");
  const [artifactsToday, setArtifactsToday] = useState<number | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(RESUME_KEY) || "";
    setResumeText(saved);
    assertTailorServerReady()
      .then(() => setSidecarOk(true))
      .catch(() => setSidecarOk(false));
    fetch("/job_descriptions/manifest.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((m: { generated_at?: string; descriptions_found?: number }) => {
        if (!m.generated_at) return;
        const h = (Date.now() - Date.parse(m.generated_at)) / 3_600_000;
        setBucketFresh(h < 2 ? `fresh (${Math.round(h * 60) || 1}m ago)` : `stale (${Math.round(h)}h)`);
      })
      .catch(() => setBucketFresh("unknown"));
    listTailoredResumes().then((list) => {
      const tz = "America/New_York";
      const today = new Date().toLocaleDateString("en-US", { timeZone: tz });
      setArtifactsToday(list.filter((r) => r.tailoredAt && new Date(r.tailoredAt).toLocaleDateString("en-US", { timeZone: tz }) === today).length);
    });
  }, []);

  function saveResume() {
    localStorage.setItem(RESUME_KEY, resumeText);
    setResumeSaved(true);
    setTimeout(() => setResumeSaved(false), 2500);
  }

  function addCompany() {
    const v = companyInput.trim();
    if (!v) return;
    excludeCompany(v);
    setCompanyInput("");
  }

  function addKeyword() {
    const v = keywordInput.trim();
    if (!v) return;
    excludeKeyword(v);
    setKeywordInput("");
  }

  return (
    <div>
      <AppHeader />

      <div className="wrapper page-shell page-shell-narrow">
        <PageIntro
          kicker="Settings"
          title="Compiler & feed filters"
          description="Evidence compiler health, blocked companies, and legacy skills-analysis resume text."
          stats={[
            { label: "Bank", value: `v${BANK_VERSION}`, tone: "blue" },
            { label: "Sidecar", value: sidecarOk === null ? "…" : sidecarOk ? "OK" : "Down", tone: sidecarOk ? "green" : "orange" },
            { label: "Today", value: artifactsToday ?? "…", tone: "green" },
          ]}
        />

        <div className="settings-section compiler-settings">
          <div className="settings-section-header">
            <div>
              <div className="settings-section-title">Evidence compiler</div>
              <div className="settings-section-sub">
                AC pipeline — fixed 15-bullet layout. Resumes compile from the AC bank, not the textarea below.
              </div>
            </div>
          </div>
          <ul className="compiler-health-list">
            <li className={sidecarOk ? "is-ok" : sidecarOk === false ? "is-bad" : ""}>
              Sidecar {sidecarOk ? "✓" : sidecarOk === false ? "✗" : "…"}
            </li>
            <li className={bucketFresh.startsWith("fresh") ? "is-ok" : bucketFresh !== "…" ? "is-warn" : ""}>
              JD buckets {bucketFresh}
            </li>
            <li>Bank v{BANK_VERSION} · Planner {PLANNER} · Optimizer global-v3</li>
            <li>Artifacts today: {artifactsToday ?? "…"}</li>
          </ul>
          <p className="compiler-settings-hint">
            Run <code>npm run pipeline:status</code> on your Mac for full diagnostics.
          </p>
        </div>

        {/* ── Excluded companies ── */}
        <div className="settings-section">
          <div className="settings-section-header">
            <div>
              <div className="settings-section-title">Blocked Companies</div>
              <div className="settings-section-sub">
                Jobs from these companies are hidden everywhere. Matched as substring, case-insensitive.
              </div>
            </div>
            <span className="settings-count">{exclusions.companies.length}</span>
          </div>

          <div className="settings-add-row">
            <input
              className="settings-input"
              type="text"
              placeholder="Company name…"
              value={companyInput}
              onChange={(e) => setCompanyInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCompany()}
            />
            <button className="settings-add-btn" type="button" onClick={addCompany}>Add</button>
          </div>

          {exclusions.companies.length === 0 ? (
            <div className="settings-empty">No companies blocked yet. Click ⊘ on any job row to block instantly.</div>
          ) : (
            <div className="settings-tags">
              {exclusions.companies.map((c) => (
                <span key={c} className="settings-tag">
                  {c}
                  <button
                    className="settings-tag-remove"
                    type="button"
                    onClick={() => removeExclusion("company", c)}
                    title="Remove"
                  >×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="settings-section">
          <div className="settings-section-header">
            <div>
              <div className="settings-section-title">Blocked Title Keywords</div>
              <div className="settings-section-sub">
                Jobs whose title contains any of these words are hidden.
              </div>
            </div>
            <span className="settings-count">{exclusions.keywords.length}</span>
          </div>

          <div className="settings-add-row">
            <input
              className="settings-input"
              type="text"
              placeholder="e.g. embedded, mobile, ios…"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addKeyword()}
            />
            <button className="settings-add-btn" type="button" onClick={addKeyword}>Add</button>
          </div>

          {exclusions.keywords.length === 0 ? (
            <div className="settings-empty">No keywords blocked yet.</div>
          ) : (
            <div className="settings-tags">
              {exclusions.keywords.map((k) => (
                <span key={k} className="settings-tag">
                  {k}
                  <button
                    className="settings-tag-remove"
                    type="button"
                    onClick={() => removeExclusion("keyword", k)}
                    title="Remove"
                  >×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="settings-section">
          <div className="settings-section-header">
            <div>
              <div className="settings-section-title">Legacy resume text</div>
              <div className="settings-section-sub">
                Optional — used only by Skills gap analysis and Legacy Optimizer. The AC compiler does not use this.
              </div>
            </div>
            {resumeText && (
              <span className="settings-count">{resumeText.length.toLocaleString()} chars</span>
            )}
          </div>
          <textarea
            className="skills-resume-input"
            style={{ minHeight: 120, marginBottom: 10 }}
            placeholder="Optional plain text for Skills page…"
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="settings-add-btn" type="button" onClick={saveResume}>
              Save
            </button>
            {resumeSaved && (
              <span style={{ fontSize: 12, color: "var(--green)" }}>Saved ✓</span>
            )}
          </div>
        </div>

        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
          Filters stored locally for <strong>{user?.email}</strong>.
        </div>
      </div>

      <footer>
        <div className="wrapper">Atriveo · Settings</div>
      </footer>
    </div>
  );
}
