import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Search,
  Command,
  Bell,
  Radio,
  Crosshair,
  Mail,
  Radar,
  Wrench,
  Dumbbell,
  Settings as SettingsIcon,
} from "lucide-react";

type NavItem = {
  to: string;
  label: string;
  sub?: string;
  icon: typeof Radio;
};

// Daily core — what you check every day
const DAILY: NavItem[] = [
  { to: "/feed", label: "Signal", sub: "Feed", icon: Radio },
];

// Workbench — operator tools
const WORKBENCH: NavItem[] = [
  { to: "/weekly", label: "Dispatch", sub: "Weekly", icon: Crosshair },
  { to: "/unclicked-100", label: "Backlog", sub: "Unclicked", icon: Radar },
  { to: "/tailor", label: "Loadout", sub: "Tailor", icon: Wrench },
  { to: "/emailfinder", label: "Recon", sub: "Email Finder", icon: Mail },
  { to: "/skills", label: "Arsenal", sub: "Skills", icon: Dumbbell },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      title={item.sub}
      className={`group relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] transition ${
        active
          ? "text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      }`}
    >
      <Icon
        className={`h-3.5 w-3.5 transition ${
          active ? "text-primary" : "text-muted-foreground/70 group-hover:text-foreground"
        }`}
      />
      {item.label}
      {active && (
        <span className="absolute inset-x-2 -bottom-[13px] h-[2px] rounded-full bg-primary" />
      )}
    </Link>
  );
}

export function TopNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [userOpen, setUserOpen] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!userRef.current?.contains(e.target as Node)) setUserOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  const settingsActive = pathname === "/settings";

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-12 max-w-[1400px] items-center gap-2 px-4">
        {/* Compact brand mark only */}
        <Link
          to="/feed"
          aria-label="Atriveo home"
          className="group relative grid h-8 w-8 shrink-0 place-items-center rounded-md bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-md shadow-primary/30 transition hover:shadow-primary/50"
        >
          <span className="font-mono text-sm font-bold leading-none">A</span>
          <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 ring-2 ring-background" />
        </Link>

        {/* Primary nav — grouped: DAILY · WORKBENCH */}
        <nav className="ml-2 flex items-center gap-0.5">
          <span className="mr-1 hidden font-mono text-[9px] font-semibold tracking-[0.18em] text-muted-foreground/60 lg:inline">
            DAILY
          </span>
          {DAILY.map((item) => (
            <NavLink key={item.to} item={item} active={pathname === item.to} />
          ))}

          <span className="mx-2 h-5 w-px bg-border/60" />

          <span className="mr-1 hidden font-mono text-[9px] font-semibold tracking-[0.18em] text-muted-foreground/60 lg:inline">
            WORKBENCH
          </span>
          {WORKBENCH.map((item) => (
            <NavLink key={item.to} item={item} active={pathname === item.to} />
          ))}
        </nav>



        {/* Right cluster */}
        <div className="ml-auto flex items-center gap-1.5">
          <button className="hidden h-8 items-center gap-2 rounded-md border border-border bg-card/60 pl-2.5 pr-1.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground md:flex">
            <Search className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Search jobs, companies…</span>
            <span className="ml-1 flex items-center gap-0.5 rounded border border-border/80 bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/80">
              <Command className="h-2.5 w-2.5" />K
            </span>
          </button>

          <button
            aria-label="Notifications"
            className="relative grid h-8 w-8 place-items-center rounded-md border border-border bg-card/60 text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-rose-500" />
          </button>

          <Link
            to="/settings"
            aria-label="Console (Settings)"
            title="Console"
            className={`grid h-8 w-8 place-items-center rounded-md border bg-card/60 transition hover:border-primary/40 hover:text-foreground ${
              settingsActive
                ? "border-primary/50 text-primary"
                : "border-border text-muted-foreground"
            }`}
          >
            <SettingsIcon className="h-4 w-4" />
          </Link>

          {/* User menu */}
          <div ref={userRef} className="relative">
            <button
              onClick={() => setUserOpen((o) => !o)}
              className="flex h-8 items-center gap-2 rounded-full border border-border bg-card/60 py-0 pl-0.5 pr-2.5 transition hover:border-primary/40"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-primary/80 to-primary/40 text-[11px] font-bold text-primary-foreground">
                A
              </span>
              <span className="text-xs font-medium text-foreground/90">Atishay</span>
              <ChevronDown
                className={`h-3 w-3 text-muted-foreground transition ${userOpen ? "rotate-180" : ""}`}
              />
            </button>
            {userOpen && (
              <div className="absolute right-0 top-full z-40 mt-2 w-52 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-2xl shadow-black/40">
                <div className="px-2.5 py-2">
                  <div className="text-sm font-semibold text-foreground">Atishay</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    atishay@atriveo.com
                  </div>
                </div>
                <div className="my-1 h-px bg-border/60" />
                <Link
                  to="/settings"
                  onClick={() => setUserOpen(false)}
                  className="flex items-center rounded-md px-2.5 py-1.5 text-sm text-foreground/85 transition hover:bg-accent hover:text-foreground"
                >
                  Settings
                </Link>
                <Link
                  to="/"
                  onClick={() => setUserOpen(false)}
                  className="flex items-center rounded-md px-2.5 py-1.5 text-sm text-foreground/85 transition hover:bg-rose-500/10 hover:text-rose-400"
                >
                  Sign out
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
