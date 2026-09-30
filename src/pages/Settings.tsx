import { useState, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import AppHeader from "../components/AppHeader";
import PageIntro from "../components/PageIntro";
import { useExclusions } from "../hooks/useExclusions";
import { assertTailorServerReady, listTailoredResumes } from "../utils/tailorRun";
import { useNotifications } from "../hooks/useNotifications";
import {
  fetchResumeProfile,
  saveResumeProfile,
  RESUME_PROFILE_FIELDS,
  type ResumeProfile,
} from "../utils/resumeProfile";

const RESUME_KEY = "atriveo_resume";
const BANK_VERSION = 51;
const PLANNER = "v2";

export default function Settings() {
  const { user } = useAuth();
  const { exclusions, excludeCompany, excludeKeyword, removeExclusion } = useExclusions();
  const { supported: notifSupported, permission: notifPerm, requestPermission, notify } = useNotifications();

  const [companyInput, setCompanyInput] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [resumeSaved, setResumeSaved] = useState(false);
  const [sidecarOk, setSidecarOk] = useState<boolean | null>(null);
  const [bucketFresh, setBucketFresh] = useState<string>("…");
  const [artifactsToday, setArtifactsToday] = useState<number | null>(null);

  // Resume header identity — lives in the sidecar, not localStorage, so the
  // dock and the compiler see the same values.
  const [profile, setProfile] = useState<ResumeProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);

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
    fetchResumeProfile()
      .then(({ profile: p }) => setProfile(p))
      .catch((err: unknown) => setProfileError(err instanceof Error ? err.message : String(err)));
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

  async function saveProfile() {
    if (!profile) return;
    setProfileSaving(true);
    setProfileError(null);
    try {
      setProfile(await saveResumeProfile(profile));
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2500);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : String(err));
    } finally {
      setProfileSaving(false);
    }
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

        {/* ── Resume header ── */}
        <div className="settings-section">
          <div className="settings-section-header">
            <div>
              <div className="settings-section-title">Resume header</div>
              <div className="settings-section-sub">
                The contact line printed at the top of every tailored resume. Saved on your Mac by the
                tailor sidecar and picked up by the next build — no recompile needed.
              </div>
            </div>
          </div>

          {profileError && !profile ? (
            <div className="settings-empty">{profileError}</div>
          ) : !profile ? (
            <div className="settings-empty">Loading…</div>
          ) : (
            <>
              <div className="settings-profile-grid">
                {RESUME_PROFILE_FIELDS.map(({ key, label, hint, type }) => (
                  <label key={key} className="settings-profile-field">
                    <span className="settings-profile-label">{label}</span>
                    <input
                      className="settings-input"
                      type={type ?? "text"}
                      value={profile[key]}
                      onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
                    />
                    <span className="settings-profile-hint">{hint}</span>
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                <button
                  className="settings-add-btn"
                  type="button"
                  onClick={() => void saveProfile()}
                  disabled={profileSaving}
                >
                  {profileSaving ? "Saving…" : "Save"}
                </button>
                {profileSaved && <span style={{ fontSize: 12, color: "var(--green)" }}>Saved ✓</span>}
                {profileError && <span style={{ fontSize: 12, color: "var(--red)" }}>{profileError}</span>}
              </div>
              <p className="compiler-settings-hint">
                Leave a field blank and save to restore its shipped default. The location here is only a
                fallback — a posting that names one office still wins.
              </p>
            </>
          )}
        </div>

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
              <div className="settings-section-title">Batch notifications</div>
              <div className="settings-section-sub">
                Get a browser notification when a new hourly job batch lands — even if the tab is in the background.
              </div>
            </div>
            {notifPerm === "granted" && (
              <span className="settings-count" style={{ color: "oklch(72% 0.18 145)" }}>On</span>
            )}
          </div>
          {!notifSupported ? (
            <div className="settings-empty">Browser notifications not supported in this browser.</div>
          ) : notifPerm === "denied" ? (
            <div className="settings-empty">Notifications blocked — allow them in your browser site settings, then refresh.</div>
          ) : notifPerm === "granted" ? (
            <div className="settings-notif-row">
              <span className="settings-notif-status">Notifications enabled</span>
              <button
                type="button"
                className="settings-btn settings-btn--ghost"
                onClick={() => notify("Atriveo", "Test — notifications are working!")}
              >
                Send test
              </button>
            </div>
          ) : (
            <button type="button" className="settings-btn" onClick={requestPermission}>
              Enable batch notifications
            </button>
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
