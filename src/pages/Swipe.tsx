import {
  useState,
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useNavigate, Link } from "react-router-dom";
import type { Job } from "../types";
import "./Swipe.css";

const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:8000"
    : "https://swipe-api-katishay-dev.apps.rm1.0a51.p1.openshiftapps.com";

function todayLocal() {
  return new Date().toLocaleDateString("en-CA");
}

const AVATAR_PAL = [
  { bg: "rgba(34,189,140,0.2)",  color: "#5ee8a8" },
  { bg: "rgba(94,180,255,0.2)",  color: "#5bc8f5" },
  { bg: "rgba(255,160,80,0.2)",  color: "#ffc57d" },
  { bg: "rgba(200,130,255,0.2)", color: "#c57dff" },
  { bg: "rgba(52,211,196,0.2)",  color: "#62eee1" },
  { bg: "rgba(255,200,66,0.2)",  color: "#f5e87d" },
  { bg: "rgba(255,120,120,0.2)", color: "#ff8a8a" },
  { bg: "rgba(160,200,255,0.2)", color: "#9bc8ff" },
];

function avatarPal(company: string) {
  return AVATAR_PAL[(company || "?").toUpperCase().charCodeAt(0) % AVATAR_PAL.length];
}

function formatPosted(v?: string | null, fallback?: string | null): string {
  const raw = v || fallback;
  if (!raw) return null as unknown as string;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null as unknown as string;
  const h = Math.floor((Date.now() - d.getTime()) / 3_600_000);
  if (h >= 0 && h < 24) return h === 0 ? "just now" : `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function scoreClass(s: number) {
  return s >= 5 ? "high" : s >= 2 ? "medium" : "low";
}

// ── Swipe card ────────────────────────────────────────────────────────────────

interface SwipeCardHandle {
  animateOut: (dir: "left" | "right") => Promise<void>;
}

interface SwipeCardProps {
  job: Job;
  isNext?: boolean;
  onSwipe: (dir: "left" | "right") => void;
}

const SwipeCard = forwardRef<SwipeCardHandle, SwipeCardProps>(({ job, isNext, onSwipe }, ref) => {
  const cardRef  = useRef<HTMLDivElement>(null);
  const overlayR = useRef<HTMLDivElement>(null);
  const overlayL = useRef<HTMLDivElement>(null);
  const drag     = useRef({ startX: 0, active: false });
  const THRESHOLD = 80;

  useImperativeHandle(ref, () => ({
    async animateOut(dir: "left" | "right") {
      const el = cardRef.current;
      if (!el) return;
      const dx = dir === "right" ? window.innerWidth * 1.2 : -window.innerWidth * 1.2;
      el.style.transition = "transform 320ms ease, opacity 320ms ease";
      el.style.transform  = `translateX(${dx}px) rotate(${dir === "right" ? 15 : -15}deg)`;
      el.style.opacity    = "0";
      await new Promise((r) => setTimeout(r, 320));
    },
  }));

  const onStart = useCallback((x: number) => {
    drag.current = { startX: x, active: true };
    if (cardRef.current) cardRef.current.style.transition = "none";
  }, []);

  const onMove = useCallback((x: number) => {
    if (!drag.current.active || !cardRef.current) return;
    const dx   = x - drag.current.startX;
    const frac = Math.min(Math.abs(dx) / THRESHOLD, 1);
    cardRef.current.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
    if (overlayR.current) overlayR.current.style.opacity = dx > 0 ? String(frac * 0.9) : "0";
    if (overlayL.current) overlayL.current.style.opacity = dx < 0 ? String(frac * 0.9) : "0";
  }, []);

  const onEnd = useCallback((x: number) => {
    if (!drag.current.active) return;
    drag.current.active = false;
    const dx = x - drag.current.startX;
    if (overlayR.current) overlayR.current.style.opacity = "0";
    if (overlayL.current) overlayL.current.style.opacity = "0";
    if (Math.abs(dx) >= THRESHOLD) {
      onSwipe(dx > 0 ? "right" : "left");
    } else if (cardRef.current) {
      cardRef.current.style.transition = "transform 300ms ease";
      cardRef.current.style.transform  = "";
    }
  }, [onSwipe]);

  useEffect(() => {
    if (isNext) return;
    const mm = (e: MouseEvent) => onMove(e.clientX);
    const mu = (e: MouseEvent) => onEnd(e.clientX);
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup",   mu);
    return () => {
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mouseup",   mu);
    };
  }, [isNext, onMove, onEnd]);

  const score    = job.score ?? 0;
  const pal      = avatarPal(job.company || "?");
  const initial  = (job.company || "?")[0].toUpperCase();
  const level    = job.level || "";
  const lvlCls   = ({ "New Grad": "sw-badge-ng", "Entry": "sw-badge-entry", "Mid": "sw-badge-mid" } as Record<string, string>)[level] || "sw-badge-unknown";
  const match    = Math.max(0, Math.round(job.score_pct ?? 0));
  const matchCls = match >= 70 ? "sw-badge-mh" : match >= 40 ? "sw-badge-mm" : "sw-badge-ml";
  const mn       = job.min_exp ?? null;
  const mx       = job.max_exp ?? mn;
  const expLabel = mn !== null ? (mx !== null && mx > mn ? `${mn}–${mx}y` : `${mn}y`) : null;
  const comp     = job.competition_score ?? 0;
  const compCls  = comp >= 7 ? "sw-badge-ch" : comp >= 4 ? "sw-badge-cm" : "sw-badge-cl";
  const compLabel = comp >= 7 ? "High comp" : comp >= 4 ? "Med comp" : "Low comp";
  const ats      = job.ats_score ?? null;
  const fit      = job.fit_score ?? null;
  const postedAt = formatPosted(job.date_posted, job.batch_time);

  return (
    <div
      ref={cardRef}
      className={`sw-card ${isNext ? "sw-card-next" : "sw-card-current"}`}
      onTouchStart={(e) => onStart(e.touches[0].clientX)}
      onTouchMove={(e)  => onMove(e.touches[0].clientX)}
      onTouchEnd={(e)   => onEnd(e.changedTouches[0].clientX)}
      onTouchCancel={(e)=> onEnd(e.changedTouches[0]?.clientX ?? drag.current.startX)}
      onMouseDown={(e)  => { e.preventDefault(); onStart(e.clientX); }}
    >
      <div ref={overlayR} className="sw-overlay-r"><span className="sw-overlay-label">SAVE</span></div>
      <div ref={overlayL} className="sw-overlay-l"><span className="sw-overlay-label">SKIP</span></div>

      {/* Header */}
      <div className="sw-card-header">
        <div className="sw-avatar" style={{ background: pal.bg, color: pal.color }}>{initial}</div>
        <div className="sw-card-header-right">
          <span className={`sw-score sw-score-${scoreClass(score)}`}>★ {score}</span>
          {postedAt && <span className="sw-posted-chip">🕐 {postedAt}</span>}
        </div>
      </div>

      {/* Identity */}
      <div className="sw-title">{job.title || "Untitled role"}</div>
      <div className="sw-company-row">
        <span className="sw-company">{job.company || "—"}</span>
        {job.location && <span className="sw-location">· 📍 {job.location}</span>}
      </div>

      <div className="sw-rule" />

      {/* Badges */}
      <div className="sw-badges">
        <span className={`sw-badge ${lvlCls}`}>{level || "Unknown"}</span>
        <span className={`sw-badge ${matchCls}`}>{match}% match</span>
        {expLabel && <span className="sw-badge sw-badge-exp">{expLabel} exp</span>}
        {job.site && <span className="sw-badge sw-badge-site">{job.site}</span>}
        <span className={`sw-badge ${compCls}`}>{compLabel}</span>
      </div>

      {/* Summary */}
      {job.summary && (
        <>
          <div className="sw-rule" />
          <p className="sw-summary">{job.summary}</p>
        </>
      )}

      {/* ATS / Fit score bars */}
      {(ats != null || fit != null) && (
        <>
          <div className="sw-rule" />
          <div className="sw-score-bars">
            {ats != null && (
              <div className="sw-bar-row">
                <span className="sw-bar-label">ATS</span>
                <div className="sw-bar-track">
                  <div className="sw-bar-fill sw-bar-ats" style={{ width: `${Math.min(ats, 100)}%` }} />
                </div>
                <span className="sw-bar-pct">{ats}%</span>
              </div>
            )}
            {fit != null && (
              <div className="sw-bar-row">
                <span className="sw-bar-label">Fit</span>
                <div className="sw-bar-track">
                  <div className="sw-bar-fill sw-bar-fit" style={{ width: `${Math.min(fit, 100)}%` }} />
                </div>
                <span className="sw-bar-pct">{fit}%</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Apply button */}
      {job.job_url && (
        <a
          href={job.job_url}
          target="_blank"
          rel="noopener noreferrer"
          className="sw-apply-btn"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          Apply ↗
        </a>
      )}
    </div>
  );
});
SwipeCard.displayName = "SwipeCard";

// ── Picks sidebar card ────────────────────────────────────────────────────────

function PickCard({ job }: { job: Job }) {
  const pal     = avatarPal(job.company || "?");
  const initial = (job.company || "?")[0].toUpperCase();
  const score   = job.score ?? 0;
  const match   = Math.max(0, Math.round(job.score_pct ?? 0));
  const url     = job.job_url || null;

  return (
    <div className="sw-pick">
      <div className="sw-pick-avatar" style={{ background: pal.bg, color: pal.color }}>{initial}</div>
      <div className="sw-pick-info">
        <div className="sw-pick-title">{job.title || "Untitled"}</div>
        <div className="sw-pick-company">{job.company || "—"}</div>
        <div className="sw-pick-meta">★ {score} · {match}% match</div>
      </div>
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="sw-pick-apply">↗</a>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type PageState = "loading" | "error" | "done" | "swiping";

export default function Swipe() {
  const navigate       = useNavigate();
  const [pageState,  setPageState]  = useState<PageState>("loading");
  const [errorMsg,   setErrorMsg]   = useState("");
  const [queue,      setQueue]      = useState<Job[]>([]);
  const [total,      setTotal]      = useState(0);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [picks,      setPicks]      = useState<Job[]>([]);
  const isSwipingRef   = useRef(false);
  const currentCardRef = useRef<SwipeCardHandle>(null);

  useEffect(() => {
    async function load() {
      try {
        const [queueRes, picksRes] = await Promise.all([
          fetch(`${API_BASE}/api/swipe-queue?date=${todayLocal()}`),
          fetch(`${API_BASE}/api/swipes?direction=right&date=${todayLocal()}`),
        ]);
        if (!queueRes.ok) throw new Error(`HTTP ${queueRes.status}`);
        const queueData = await queueRes.json();
        const jobs: Job[] = queueData.jobs || [];
        setQueue(jobs);
        setTotal(queueData.count || jobs.length);
        setCurrentIdx(0);

        if (picksRes.ok) {
          const picksData = await picksRes.json();
          setPicks(picksData.jobs || []);
        }

        if (jobs.length === 0) {
          setPageState("done");
          setTimeout(() => navigate("/dashboard"), 2200);
        } else {
          setPageState("swiping");
        }
      } catch (err) {
        setErrorMsg((err as Error).message);
        setPageState("error");
      }
    }
    load();
  }, [navigate]);

  const doSwipe = useCallback(async (dir: "left" | "right") => {
    if (isSwipingRef.current) return;
    isSwipingRef.current = true;

    const job = queue[currentIdx];
    if (!job) { isSwipingRef.current = false; return; }

    fetch(`${API_BASE}/api/swipe`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ job_url: job.job_url, direction: dir, date: todayLocal() }),
    }).catch(() => {});

    if (dir === "right") {
      setPicks((prev) => [job, ...prev]);
    }

    await currentCardRef.current?.animateOut(dir);
    isSwipingRef.current = false;

    const next = currentIdx + 1;
    setCurrentIdx(next);
    if (next >= queue.length) {
      setPageState("done");
      setTimeout(() => navigate("/dashboard"), 2200);
    }
  }, [queue, currentIdx, navigate]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (pageState !== "swiping") return;
      if (e.key === "ArrowRight" || e.key === "l") doSwipe("right");
      if (e.key === "ArrowLeft"  || e.key === "h") doSwipe("left");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageState, doSwipe]);

  const remaining = queue.length - currentIdx;
  const pct       = total > 0 ? ((total - remaining) / total) * 100 : 0;

  return (
    <div className="sw-root">
      {/* Header */}
      <div className="sw-topbar">
        <div className="sw-brand">
          <div className="sw-brand-mark">A</div>
          <span className="sw-brand-name">Atriveo</span>
        </div>
        <nav className="sw-nav">
          <Link to="/dashboard" className="sw-nav-link">Live Feed</Link>
          <Link to="/weekly" className="sw-nav-link">Weekly</Link>
          <Link to="/unclicked-100" className="sw-nav-link">100+ Unclicked</Link>
        </nav>
        <Link to="/dashboard" className="sw-skip">Skip →</Link>
      </div>

      {/* Body */}
      <div className="sw-body">

        {/* Left: card area */}
        <div className="sw-main">
          {pageState === "loading" && (
            <div className="sw-state">
              <div className="sw-state-icon">⏳</div>
              <div className="sw-state-title">Loading today's jobs…</div>
              <div className="sw-state-sub">Fetching your queue</div>
            </div>
          )}

          {pageState === "error" && (
            <div className="sw-state">
              <div className="sw-state-icon">⚠️</div>
              <div className="sw-state-title">Couldn't load jobs</div>
              <div className="sw-state-sub">{errorMsg}</div>
              <button className="sw-state-btn" onClick={() => window.location.reload()}>Retry</button>
            </div>
          )}

          {pageState === "done" && (
            <div className="sw-state">
              <div className="sw-state-icon">🎉</div>
              <div className="sw-state-title">All caught up!</div>
              <div className="sw-state-sub">
                No more jobs to review.<br />Redirecting to your picks…
              </div>
            </div>
          )}

          {pageState === "swiping" && (
            <div className="sw-ui">
              <div className="sw-progress-row">
                <div className="sw-progress-bar">
                  <div className="sw-progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="sw-progress-label">{remaining} left</div>
              </div>

              <div className="sw-stack">
                {currentIdx + 1 < queue.length && (
                  <SwipeCard
                    key={`next-${currentIdx + 1}`}
                    job={queue[currentIdx + 1]}
                    isNext
                    onSwipe={doSwipe}
                  />
                )}
                {currentIdx < queue.length && (
                  <SwipeCard
                    ref={currentCardRef}
                    key={`current-${currentIdx}`}
                    job={queue[currentIdx]}
                    onSwipe={doSwipe}
                  />
                )}
              </div>

              <div className="sw-actions">
                <button className="sw-btn-nope" onClick={() => doSwipe("left")}>
                  <span>✕</span><span className="sw-btn-label">Skip</span>
                </button>
                <button className="sw-btn-like" onClick={() => doSwipe("right")}>
                  <span className="sw-btn-label">Save</span><span>✓</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: picks sidebar (desktop only) */}
        <aside className="sw-picks-panel">
          <div className="sw-picks-header">
            <span className="sw-picks-title">★ Your Picks Today</span>
            <span className="sw-picks-count">{picks.length}</span>
          </div>
          <div className="sw-picks-list">
            {picks.length === 0 ? (
              <div className="sw-picks-empty">Swipe right on jobs you like — they'll appear here.</div>
            ) : (
              picks.map((job, i) => <PickCard key={job.job_url || i} job={job} />)
            )}
          </div>
        </aside>

      </div>
    </div>
  );
}
