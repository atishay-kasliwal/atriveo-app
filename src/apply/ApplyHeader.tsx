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
        <Link to="/" aria-current={page === "today" && path !== "/staffing" && path !== "/resume_builder" && path !== "/bank" && path !== "/outreach" && path !== "/network" && path !== "/loops" && path !== "/job-matching" && !path.startsWith("/applied") && path !== "/settings" && path !== "/general" && path !== "/usage" && path !== "/assessments" ? "page" : undefined}>
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
        <Link to="/network" aria-current={path === "/network" ? "page" : undefined}>Network</Link>
        <Link to="/loops" aria-current={path === "/loops" ? "page" : undefined}>Loops</Link>
        <Link to="/stats" aria-current={page === "stats" ? "page" : undefined}>Stats</Link>
      </nav>
      <div className="apply-header-right">
        <ResumePipeline online={worker ? worker.online : null} />
        {todayCount !== undefined && <span className="apply-today-count" aria-label={`Today: ${todayCount ?? "loading"} applications waiting`}>Today <b>{todayCount ?? "…"}</b></span>}
        <AiUsage />
        <Link className="apply-header-action apply-settings" to="/settings" aria-label="Settings" title="Settings" aria-current={path === "/settings" ? "page" : undefined}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.2 2h-.4a2 2 0 0 0-2 1.7l-.2 1.2a2 2 0 0 1-1 1.4l-.4.2a2 2 0 0 1-1.7.1l-1.1-.4a2 2 0 0 0-2.5.9l-.2.4a2 2 0 0 0 .5 2.6l.9.7a2 2 0 0 1 .7 1.5v.5a2 2 0 0 1-.7 1.5l-.9.7a2 2 0 0 0-.5 2.6l.2.4a2 2 0 0 0 2.5.9l1.1-.4a2 2 0 0 1 1.7.1l.4.2a2 2 0 0 1 1 1.4l.2 1.2a2 2 0 0 0 2 1.7h.4a2 2 0 0 0 2-1.7l.2-1.2a2 2 0 0 1 1-1.4l.4-.2a2 2 0 0 1 1.7-.1l1.1.4a2 2 0 0 0 2.5-.9l.2-.4a2 2 0 0 0-.5-2.6l-.9-.7a2 2 0 0 1-.7-1.5v-.5a2 2 0 0 1 .7-1.5l.9-.7a2 2 0 0 0 .5-2.6l-.2-.4a2 2 0 0 0-2.5-.9l-1.1.4a2 2 0 0 1-1.7-.1l-.4-.2a2 2 0 0 1-1-1.4l-.2-1.2a2 2 0 0 0-2-1.7Z"/><circle cx="12" cy="12" r="3"/></svg>
        </Link>
        <button type="button" className="apply-header-action apply-signout" onClick={() => void signOut()} aria-label="Sign out" title="Sign out"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M14 8l4 4-4 4M8 12h13"/></svg></button>
      </div>
    </div>
  );
}
