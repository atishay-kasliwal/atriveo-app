import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { useExclusions } from "../hooks/useExclusions";

export default function Settings() {
  const { user, logout } = useAuth();
  const { exclusions, excludeCompany, excludeKeyword, removeExclusion } = useExclusions();

  const [companyInput, setCompanyInput] = useState("");
  const [keywordInput, setKeywordInput] = useState("");

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
      <header>
        <div className="wrapper header-inner">
          <div className="logo">
            <div className="logo-icon">A</div>
            <div>
              <div className="logo-name">Atriveo</div>
              <div className="logo-sub">Settings</div>
            </div>
          </div>
          <div className="header-right">
            <nav className="nav-tabs">
              <a href="/" className="nav-tab">Live Feed</a>
              <a href="/weekly" className="nav-tab">Weekly</a>
              <a href="/settings" className="nav-tab active">Settings</a>
            </nav>
            <span className="header-user">Hi, {user?.name}</span>
            <button className="logout-btn" onClick={logout}>Sign out</button>
          </div>
        </div>
      </header>

      <div className="wrapper" style={{ maxWidth: 720, paddingTop: 28 }}>

        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>
            Feed Filters
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
            Jobs matching these rules are hidden from your Live Feed and Weekly view.
            Changes take effect immediately — no reload needed.
          </div>
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
            <button className="settings-add-btn" onClick={addCompany}>Add</button>
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
                    onClick={() => removeExclusion("company", c)}
                    title="Remove"
                  >×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── Excluded title keywords ── */}
        <div className="settings-section">
          <div className="settings-section-header">
            <div>
              <div className="settings-section-title">Blocked Title Keywords</div>
              <div className="settings-section-sub">
                Jobs whose title contains any of these words are hidden. Matched as substring, case-insensitive.
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
            <button className="settings-add-btn" onClick={addKeyword}>Add</button>
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
                    onClick={() => removeExclusion("keyword", k)}
                    title="Remove"
                  >×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
          Filters are stored locally in your browser, scoped to <strong>{user?.email}</strong>.
        </div>
      </div>

      <footer>
        <div className="wrapper">Atriveo · Settings</div>
      </footer>
    </div>
  );
}
