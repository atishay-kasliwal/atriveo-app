import AiUsage from './AiUsage';
import { Link, useLocation } from "react-router-dom";
import ApplyLogo from "./ApplyLogo";
import { blocking } from "./questionGroups";
import { useReadyQueue, useReviewCounts, useUnansweredCards, useUnansweredQueue } from "./reviewQueue";
import type { User } from "../types";

async function signOut() {
  try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* the cookie clears server-side */ }
  window.location.replace("/login");
}

export default function ApplyHeader({ todayCount }: { user: User; todayCount?: number | null }) {
  const path = useLocation().pathname.replace(/\/+$/, "");
  const counts = useReviewCounts();
  // Required questions nobody answered, once every application's questions have loaded (else the server's count).
  const queue = useUnansweredQueue(60_000);
  const ready = useReadyQueue(60_000);
  const worker = queue.data?.worker ?? ready.data?.worker ?? null;
  const { cards } = useUnansweredCards();
  const waitingRows = (queue.data?.unanswered ?? []).filter((r) => (r.needsInput ?? 0) > 0);
  const loaded = waitingRows.every((r) => cards[r.id] && cards[r.id]!.updatedAt >= r.updatedAt);
  const toAnswer = queue.data && loaded ? waitingRows.reduce((n, r) => n + cards[r.id]!.questions.filter(blocking).length, 0) : counts?.needsInput;
  const page = path === "/stats" || path === "/overview" ? "stats" : path === "/unanswered" ? "answer" : path === "/answers" || path === "/ready" || path === "/review" ? "work" : "today";
  const waiting = counts ? counts.unanswered + counts.ready : null;
  return (
    <div className="apply-header">
      <a className="apply-brand" href="/" aria-label="Atriveo Apply home">
        <ApplyLogo height={22} />
        <span className="apply-brand-by">by Atriveo</span>
      </a>
      <nav className="apply-nav" aria-label="Console">
        <Link to="/" aria-current={page === "today" && path !== "/staffing" && path !== "/resume_builder" && path !== "/bank" && path !== "/outreach" ? "page" : undefined}>
          Today{waiting !== null ? <span className="apply-nav-n">{waiting}</span> : null}
        </Link>
        <Link to="/unanswered" aria-current={page === "answer" ? "page" : undefined}>
          To answer{toAnswer !== undefined ? <span className="apply-nav-n">{toAnswer}</span> : null}
        </Link>
        <Link to="/staffing" aria-current={path === "/staffing" ? "page" : undefined}>Staffing</Link>
        <Link to="/resume_builder" aria-current={path === "/resume_builder" ? "page" : undefined}>Resumes</Link>
        <Link to="/bank" aria-current={path === "/bank" ? "page" : undefined}>Bank</Link>
        <Link to="/outreach" aria-current={path === "/outreach" ? "page" : undefined}>Outreach</Link>
        <Link to="/stats" aria-current={page === "stats" ? "page" : undefined}>Stats</Link>
      </nav>
      <div className="apply-header-right">
        {worker && <span className={`apply-worker ${worker.online ? "is-online" : "is-offline"}`} role="status"><i aria-hidden="true" />{worker.online ? "Worker running" : "Worker offline"}</span>}
        {todayCount !== undefined && <span className="apply-today-count" aria-label={`Today: ${todayCount ?? "loading"} applications waiting`}>Today <b>{todayCount ?? "…"}</b></span>}
        <AiUsage />
        <a className="apply-ext" href="https://application.atriveo.com" target="_blank" rel="noreferrer">Job feed ↗</a>
        <button type="button" className="apply-signout" onClick={() => void signOut()} aria-label="Sign out" title="Sign out"><span aria-hidden="true">🚪</span></button>
      </div>
    </div>
  );
}
