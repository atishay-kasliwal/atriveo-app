import { useEffect, useRef, useState } from "react";
import { useAuth } from "../hooks/useAuth";

const TOOLS_LINKS = [
  { href: "/manual-tailor", label: "Manual Tailor", note: "Paste JD debug" },
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

const PRIMARY: NavItem[] = [
  { href: "/", label: "Feed", match: (p) => p === "/" || p.startsWith("/dashboard") || p.startsWith("/today") },
  { href: "/resumes", label: "Resumes", match: (p) => p.startsWith("/resumes") || p.startsWith("/tailored") },
  { href: "/activity", label: "Activity", match: (p) => p.startsWith("/activity") || p.startsWith("/clickedjobs") },
];

function toolsActive(path: string): boolean {
  return TOOLS_LINKS.some((t) => path.startsWith(t.href)) || path.startsWith("/tools");
}

export default function AppHeader({ hideLogo = false }: { hideLogo?: boolean }) {
  const { user, logout } = useAuth();
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!toolsOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) setToolsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [toolsOpen]);

  return (
    <header>
      <div className={`wrapper header-inner${hideLogo ? " header-inner--board" : ""}`}>
        {!hideLogo && (
          <a href="/" className="logo">
            <div className="logo-icon">A</div>
            <div>
              <div className="logo-name">Atriveo</div>
              <div className="logo-sub">Evidence compiler</div>
            </div>
          </a>
        )}

        <div className="header-right">
          <nav className="nav-tabs">
            {PRIMARY.map((n) => (
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
          <span className="header-user">{user ? `Hi, ${user.name}` : " "}</span>
          <button className="logout-btn" type="button" onClick={logout}>Sign out</button>
        </div>
      </div>
    </header>
  );
}
