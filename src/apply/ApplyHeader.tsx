import AiUsage from './AiUsage';
import ResumePipeline from './ResumePipeline';
import { Link, useLocation } from "react-router-dom";
import ApplyLogo from "./ApplyLogo";
import { useFillableQueue, useReadyQueue, useReviewCounts } from "./reviewQueue";
import type { User } from "../types";

async function signOut() {
  try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* the cookie clears server-side */ }
  window.location.replace("/login");
}

export default function ApplyHeader({ todayCount }: { user: User; todayCount?: number | null }) {
  const path = useLocation().pathname.replace(/\/+$/, "");
  const counts = useReviewCounts();
  const queue = useFillableQueue(60_000);
  const ready = useReadyQueue(60_000);
  const worker = queue.data?.worker ?? ready.data?.worker ?? null;
  const page = path === "/stats" || path === "/overview" ? "stats" : path === "/ready" || path === "/review" ? "work" : "today";
  // Today's application cards: Open & Fill from blocked applications, plus approve / you submit (LinkedIn postings aside).
  const waiting = counts ? (counts.fillable ?? 0) + counts.ready : null;
  return (
    <div className="apply-header">
      <a className="apply-brand" href="/" aria-label="Atriveo home">
        <ApplyLogo height={32} />

      </a>
      <nav className="apply-nav" aria-label="Console">
        <Link to="/" aria-current={page === "today" && path !== "/staffing" && path !== "/resume_builder" && path !== "/bank" && path !== "/outreach" && path !== "/job-matching" && !path.startsWith("/applied") && path !== "/settings" && path !== "/general" && path !== "/usage" && path !== "/assessments" ? "page" : undefined}>
          Today{waiting !== null ? <span className="apply-nav-n">{waiting}</span> : null}
        </Link>
        <Link to="/job-matching" aria-current={path === "/job-matching" ? "page" : undefined}>Matching</Link>
        <Link to="/applied" aria-current={path === "/applied" || path.startsWith("/applied/") ? "page" : undefined}>Applied</Link>
        <Link to="/general" aria-current={path === "/general" ? "page" : undefined}>General</Link>
        <Link to="/assessments" aria-current={path === "/assessments" ? "page" : undefined}>Assessments</Link>
        <Link to="/staffing" aria-current={path === "/staffing" ? "page" : undefined}>Staffing</Link>
        <Link to="/resume_builder" aria-current={path === "/resume_builder" ? "page" : undefined}>Resumes</Link>
        <Link to="/bank" aria-current={path === "/bank" ? "page" : undefined}>Bank</Link>
        <Link to="/outreach" aria-current={path === "/outreach" ? "page" : undefined}>Outreach</Link>
        <Link to="/stats" aria-current={page === "stats" ? "page" : undefined}>Stats</Link>
      </nav>
      <div className="apply-header-right">
        <ResumePipeline online={worker ? worker.online : null} />
        {todayCount !== undefined && <span className="apply-today-count" aria-label={`Today: ${todayCount ?? "loading"} applications waiting`}>Today <b>{todayCount ?? "…"}</b></span>}
        <AiUsage />
        <a className="apply-ext" href="https://application.atriveo.com" target="_blank" rel="noreferrer">Job feed ↗</a>
        <Link className="apply-ext apply-settings" to="/settings" aria-label="Settings" title="Settings" aria-current={path === "/settings" ? "page" : undefined}>⚙</Link>
        <button type="button" className="apply-signout" onClick={() => void signOut()} aria-label="Sign out" title="Sign out"><span aria-hidden="true">🚪</span></button>
      </div>
    </div>
  );
}
