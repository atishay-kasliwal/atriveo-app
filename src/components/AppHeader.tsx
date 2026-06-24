import { useEffect, useRef, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import AtriveoLogo from "./AtriveoLogo";

const TOOLS_LINKS = [
  { href: "/optimizer", label: "Legacy Optimizer", note: "Gemma rewrites — not AC compiler" },
  { href: "/skills", label: "Skills gap" },
  { href: "/weekly", label: "Weekly feed" },
  { href: "/cart", label: "Cart" },
  { href: "/states", label: "States" },
  { href: "/unclicked-100", label: "100+ Unclicked" },
  { href: "/emailfinder", label: "Email Finder" },
  { href: "/settings", label: "Settings" },
];

interface NavItem {
  href: string;
  label: string;
  match: (path: string) => boolean;
}

const DAILY: NavItem[] = [
  { href: "/", label: "Signal", match: (p) => p === "/" || p.startsWith("/dashboard") || p.startsWith("/today") },
];

const WORKBENCH: NavItem[] = [
  { href: "/manual-tailor", label: "Loadout", match: (p) => p.startsWith("/manual-tailor") },
  { href: "/resumes", label: "Resumes", match: (p) => p.startsWith("/resumes") || p.startsWith("/tailored") },
  { href: "/skills", label: "Arsenal", match: (p) => p.startsWith("/skills") },
  { href: "/emailfinder", label: "Recon", match: (p) => p.startsWith("/emailfinder") },
  { href: "/activity", label: "Activity", match: (p) => p.startsWith("/activity") || p.startsWith("/clickedjobs") },
];

function toolsActive(path: string): boolean {
  return TOOLS_LINKS.some((t) => path.startsWith(t.href)) || path.startsWith("/tools");
}

export default function AppHeader({ hideLogo: _hideLogo = false }: { hideLogo?: boolean }) {
  const { user, logout } = useAuth();
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!toolsOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) setToolsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setToolsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [toolsOpen]);

  return (
    <header className={toolsOpen ? "header--tools-open" : undefined}>
      <div className="header-inner">
        {/* Brand mark */}
        <a href="/" className="logo" aria-label="Atriveo home">
          <div className="logo-icon">
            <AtriveoLogo size={18} fill="var(--primary-foreground)" />
          </div>
          <span className="logo-status-dot" />
        </a>

        {/* Nav */}
        <div className={`header-right${toolsOpen ? " header-right--tools-open" : ""}`}>
          <nav className={`nav-tabs${toolsOpen ? " nav-tabs--tools-open" : ""}`}>
            <span className="nav-group-label">DAILY</span>
            {DAILY.map((n) => (
              <a key={n.href} href={n.href} className={`nav-tab${n.match(path) ? " active" : ""}`}>
                {n.label}
              </a>
            ))}

            <span className="nav-separator" aria-hidden />

            <span className="nav-group-label">WORKBENCH</span>
            {WORKBENCH.map((n) => (
              <a key={n.href} href={n.href} className={`nav-tab${n.match(path) ? " active" : ""}`}>
                {n.label}
              </a>
            ))}

            <div className="nav-tools-wrap" ref={toolsRef}>
              <button
                type="button"
                className={`nav-tab nav-tab--tools${toolsActive(path) ? " active" : ""}`}
                onClick={() => setToolsOpen((v) => !v)}
                aria-expanded={toolsOpen}
              >
                Tools ▾
              </button>
              {toolsOpen ? (
                <div className="nav-tools-menu" role="menu">
                  {TOOLS_LINKS.map((t) => (
                    <a key={t.href} href={t.href} className="nav-tools-item" role="menuitem">
                      <span>{t.label}</span>
                      {t.note ? <small>{t.note}</small> : null}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          </nav>

          {/* Right cluster */}
          <div className="nav-right-cluster">
            {user && (
              <span className="nav-user-pill">
                <span className="nav-user-avatar">{user.name?.[0]?.toUpperCase() ?? "A"}</span>
                <span className="nav-user-name">{user.name}</span>
              </span>
            )}
            <button className="logout-btn" type="button" onClick={logout}>Sign out</button>
          </div>
        </div>
      </div>
    </header>
  );
}
