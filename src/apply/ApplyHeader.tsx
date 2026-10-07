import { Link, useLocation } from "react-router-dom";
import ApplyLogo from "./ApplyLogo";
import { blocking } from "./questionGroups";
import { useReviewCounts, useUnansweredCards, useUnansweredQueue } from "./reviewQueue";
import type { User } from "../types";

async function signOut() {
  try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* the cookie clears server-side */ }
  window.location.replace("/login");
}

export default function ApplyHeader({ user }: { user: User }) {
  const initial = (user.name || user.email || "A").trim().charAt(0).toUpperCase();
  const path = useLocation().pathname.replace(/\/+$/, "");
  const counts = useReviewCounts();
  // Required questions nobody answered, once every application's questions have loaded (else the server's count).
  const queue = useUnansweredQueue(60_000);
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
        <Link to="/" aria-current={page === "today" && path !== "/staffing" ? "page" : undefined}>
          Today{waiting !== null ? <span className="apps-nav-n">{waiting}</span> : null}
        </Link>
        <Link to="/unanswered" aria-current={page === "answer" ? "page" : undefined}>
          To answer{toAnswer !== undefined ? <span className="apps-nav-n">{toAnswer}</span> : null}
        </Link>
        <Link to="/staffing" aria-current={path === "/staffing" ? "page" : undefined}>Staffing</Link>
        <Link to="/stats" aria-current={page === "stats" ? "page" : undefined}>Stats</Link>
      </nav>
      <div className="apply-header-right">
        <a className="apply-ext" href="https://application.atriveo.com" target="_blank" rel="noreferrer">Job feed ↗</a>
        <span className="apply-user" title={user.email}><span className="apply-avatar" aria-hidden>{initial}</span><span className="apply-user-name">{user.name || user.email}</span></span>
        <button type="button" className="apply-signout" onClick={() => void signOut()}>Sign out</button>
      </div>
    </div>
  );
}
