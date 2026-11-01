import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import ApplyLogo from "./ApplyLogo";
import { signOut } from "./signOut";
import { CAPTURE_EVENT } from "./CaptureDock";
import "./phone.css";

// The phone shell: a short top bar, the bottom tabs for the four phone jobs (triage, what happened, people, capture),
// and a menu sheet for every other page. Desktop keeps ApplyHeader.

const TABS: { to: string; label: string; icon: string; match: (p: string) => boolean }[] = [
  { to: "/", label: "Home", icon: "M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1Z", match: (p) => p === "" || p === "/" },
  { to: "/job-matching", label: "Triage", icon: "M7 4h10a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM9.5 9h5M9.5 12.5h5M9.5 16h3", match: (p) => p === "/job-matching" || p === "/staffing" },
  { to: "/applied", label: "Activity", icon: "M3 12h4l2.5-6 5 12 2.5-6h4", match: (p) => p === "/applied" || p.startsWith("/applied/") },
  { to: "/network", label: "People", icon: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5a6.5 6.5 0 0 1 3.5 5.5", match: (p) => p === "/network" || p === "/outreach" },
];

const PAGES: [string, string][] = [
  ["/today", "Today queue"], ["/staffing", "Staffing"], ["/general", "General"], ["/assessments", "Assessments"],
  ["/resume_builder", "Resumes"], ["/bank", "Bank"], ["/outreach", "Outreach"], ["/loops", "Loops"],
  ["/day-plan", "Day plan"], ["/stats", "Stats"], ["/usage", "Usage"], ["/settings", "Settings"],
];

const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;

export function PhoneTopBar() {
  const [menu, setMenu] = useState(false);
  const path = useLocation().pathname;
  return (
    <>
      <header className="ph-top">
        <Link className="ph-brand" to="/" aria-label="Atriveo home"><ApplyLogo height={26} /></Link>
        <button type="button" className="ph-icon-btn" aria-label="All pages and settings" aria-expanded={menu} onClick={() => setMenu(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
        </button>
      </header>
      {menu && <PhoneMenu path={path} onClose={() => setMenu(false)} />}
    </>
  );
}

function PhoneMenu({ path, onClose }: { path: string; onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    sheet.current?.querySelector<HTMLElement>("a, button")?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="ph-sheet-wrap" onClick={onClose}>
      <div className="ph-sheet" role="dialog" aria-modal="true" aria-label="All pages" ref={sheet} onClick={(e) => e.stopPropagation()}>
        <i className="ph-grab" aria-hidden="true" />
        <p className="ph-sheet-note">These pages are built for the laptop; they open here as they are.</p>
        <nav className="ph-pages" aria-label="All pages">
          {PAGES.map(([to, label]) => <Link key={to} to={to} aria-current={path === to ? "page" : undefined} onClick={onClose}>{label}</Link>)}
        </nav>
        <button type="button" className="ph-signout" onClick={() => void signOut()}>Sign out</button>
      </div>
    </div>
  );
}

const HOLD_MS = 450;

/** Tap to type a capture; hold to start speaking straight away. */
function CaptureButton() {
  const timer = useRef<number | undefined>(undefined);
  const held = useRef(false);
  const [holding, setHolding] = useState(false);
  const open = (voice: boolean) => window.dispatchEvent(new CustomEvent(CAPTURE_EVENT, { detail: { voice } }));
  const release = () => { window.clearTimeout(timer.current); setHolding(false); };
  return (
    <button
      type="button" className={`ph-capture${holding ? " is-holding" : ""}`} aria-label="Capture a note" aria-description="Hold to speak"
      onPointerDown={() => { held.current = false; setHolding(true); timer.current = window.setTimeout(() => { held.current = true; setHolding(false); open(true); }, HOLD_MS); }}
      onPointerUp={release} onPointerLeave={release} onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => { if (held.current) { held.current = false; return; } open(false); }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
    </button>
  );
}

export function PhoneTabBar() {
  const path = useLocation().pathname.replace(/\/+$/, "");
  const tab = (t: (typeof TABS)[number]) => (
    <Link key={t.to} to={t.to} className="ph-tab" aria-current={t.match(path) ? "page" : undefined}><Icon d={t.icon} /><span>{t.label}</span></Link>
  );
  return (
    <nav className="ph-tabs" aria-label="Main">
      {TABS.slice(0, 2).map(tab)}
      <CaptureButton />
      {TABS.slice(2).map(tab)}
    </nav>
  );
}
