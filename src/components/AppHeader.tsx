import { useAuth } from "../hooks/useAuth";

/**
 * One canonical app header used by every page.
 *
 * Navigation is intentionally full-page (`<a href>`): each page is an
 * independent document, but because every page renders this exact same
 * component the header, nav bar and active state are byte-identical on
 * every load — so nothing shifts between pages.
 */

interface NavItem {
  href: string;
  label: string;
  match: (path: string) => boolean;
}

const NAV: NavItem[] = [
  { href: "/",              label: "Live Feed",      match: (p) => p === "/" || p.startsWith("/dashboard") || p.startsWith("/today") },
  { href: "/weekly",        label: "Weekly",         match: (p) => p.startsWith("/weekly") },
  { href: "/unclicked-100", label: "100+ Unclicked", match: (p) => p.startsWith("/unclicked-100") },
  { href: "/cart",          label: "Cart",           match: (p) => p.startsWith("/cart") },
  { href: "/skills",        label: "Skills",         match: (p) => p.startsWith("/skills") },
  { href: "/states",        label: "States",         match: (p) => p.startsWith("/states") },
  { href: "/emailfinder",   label: "Email Finder",   match: (p) => p.startsWith("/emailfinder") },
  { href: "/settings",      label: "Settings",       match: (p) => p.startsWith("/settings") },
];

export default function AppHeader() {
  const { user, logout } = useAuth();
  const path = typeof window !== "undefined" ? window.location.pathname : "/";

  return (
    <header>
      <div className="wrapper header-inner">
        <a href="/" className="logo">
          <div className="logo-icon">A</div>
          <div>
            <div className="logo-name">Atriveo</div>
            <div className="logo-sub">Job Platform</div>
          </div>
        </a>

        <div className="header-right">
          <nav className="nav-tabs">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className={`nav-tab${n.match(path) ? " active" : ""}`}>
                {n.label}
              </a>
            ))}
          </nav>
          {/* fixed-width slot so the greeting popping in doesn't shift the row */}
          <span className="header-user">{user ? `Hi, ${user.name}` : " "}</span>
          <button className="logout-btn" onClick={logout}>Sign out</button>
        </div>
      </div>
    </header>
  );
}
