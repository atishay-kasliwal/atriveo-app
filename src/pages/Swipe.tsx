import {
  useState,
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useMemo,
  Fragment,
} from "react";
import type { ReactNode, JSX } from "react";
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
  { bg: "rgba(34,189,140,0.22)",  color: "#5ee8a8" },
  { bg: "rgba(94,180,255,0.22)",  color: "#5bc8f5" },
  { bg: "rgba(255,160,80,0.22)",  color: "#ffc57d" },
  { bg: "rgba(200,130,255,0.22)", color: "#c57dff" },
  { bg: "rgba(52,211,196,0.22)",  color: "#62eee1" },
  { bg: "rgba(255,200,66,0.22)",  color: "#f5e87d" },
  { bg: "rgba(255,120,120,0.22)", color: "#ff8a8a" },
  { bg: "rgba(160,200,255,0.22)", color: "#9bc8ff" },
];

function avatarPal(company: string) {
  return AVATAR_PAL[(company || "?").toUpperCase().charCodeAt(0) % AVATAR_PAL.length];
}

function formatPosted(v?: string | null, fallback?: string | null): string | null {
  const raw = v || fallback;
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  const h = Math.floor((Date.now() - d.getTime()) / 3_600_000);
  if (h >= 0 && h < 24) return h === 0 ? "just now" : `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function scoreClass(s: number) {
  return s >= 5 ? "high" : s >= 2 ? "medium" : "low";
}

function formatSwipeTime(iso?: string | null): string {
  if (!iso) return "";
  const normalized = /[zZ]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso + "Z";
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// ── Lightweight markdown renderer ────────────────────────────────────────────

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const regex = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) out.push(text.slice(lastIndex, m.index));
    if (m[1]) out.push(<strong key={`${keyBase}-${k++}`}>{m[1]}</strong>);
    else if (m[2]) out.push(<em key={`${keyBase}-${k++}`}>{m[2]}</em>);
    else if (m[3]) out.push(<code key={`${keyBase}-${k++}`}>{m[3]}</code>);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

function renderDescription(text: string): JSX.Element[] {
  if (!text) return [];
  // Normalize: literal "\n" → newline, CRLF, collapse blank lines,
  // unescape markdown backslash-escapes (\&, \-, \(, \), \., \_, etc.)
  const cleaned = text
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\\([\\`*_{}\[\]()#+\-.!&|<>~/])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const blocks = cleaned.split(/\n\n+/);
  const nodes: JSX.Element[] = [];

  blocks.forEach((block, i) => {
    const trimmed = block.trim();
    if (!trimmed) return;

    // Heading
    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const lvl = Math.min(heading[1].length + 2, 6);
      const Tag = `h${lvl}` as keyof JSX.IntrinsicElements;
      nodes.push(<Tag key={`b-${i}`} className="md-h">{renderInline(heading[2], `b-${i}`)}</Tag>);
      return;
    }

    // Bullet list
    const lines = trimmed.split("\n");
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      nodes.push(
        <ul key={`b-${i}`} className="md-ul">
          {lines.map((l, j) => (
            <li key={`b-${i}-${j}`}>{renderInline(l.replace(/^\s*[-*•]\s+/, ""), `b-${i}-${j}`)}</li>
          ))}
        </ul>
      );
      return;
    }

    // Numbered list
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
      nodes.push(
        <ol key={`b-${i}`} className="md-ol">
          {lines.map((l, j) => (
            <li key={`b-${i}-${j}`}>{renderInline(l.replace(/^\s*\d+[.)]\s+/, ""), `b-${i}-${j}`)}</li>
          ))}
        </ol>
      );
      return;
    }

    // Paragraph (with line breaks)
    const para: ReactNode[] = [];
    lines.forEach((line, j) => {
      if (j > 0) para.push(<br key={`b-${i}-br-${j}`} />);
      para.push(...renderInline(line, `b-${i}-l-${j}`));
    });
    nodes.push(<p key={`b-${i}`} className="md-p">{para}</p>);
  });

  return nodes;
}

// ── Swipe card ────────────────────────────────────────────────────────────────

interface SwipeCardHandle {
  animateOut: (dir: "left" | "right") => Promise<void>;
}

interface SwipeCardProps {
  job: Job;
  description: string | null | undefined;
  descriptionLoading: boolean;
  isNext?: boolean;
  onSwipe: (dir: "left" | "right") => void;
}

const SwipeCard = forwardRef<SwipeCardHandle, SwipeCardProps>(
  ({ job, description, descriptionLoading, isNext, onSwipe }, ref) => {
    const cardRef  = useRef<HTMLDivElement>(null);
    const overlayR = useRef<HTMLDivElement>(null);
    const overlayL = useRef<HTMLDivElement>(null);
    const drag     = useRef({ startX: 0, startY: 0, active: false, decided: false, horizontal: false });
    const THRESHOLD = 100;

    useImperativeHandle(ref, () => ({
      async animateOut(dir: "left" | "right") {
        const el = cardRef.current;
        if (!el) return;
        const dx = dir === "right" ? window.innerWidth * 1.2 : -window.innerWidth * 1.2;
        el.style.transition = "transform 360ms ease, opacity 360ms ease";
        el.style.transform  = `translateX(${dx}px) rotate(${dir === "right" ? 14 : -14}deg)`;
        el.style.opacity    = "0";
        await new Promise((r) => setTimeout(r, 360));
      },
    }));

    const onStart = useCallback((x: number, y: number) => {
      drag.current = { startX: x, startY: y, active: true, decided: false, horizontal: false };
      if (cardRef.current) cardRef.current.style.transition = "none";
    }, []);

    const onMove = useCallback((x: number, y: number) => {
      if (!drag.current.active || !cardRef.current) return;
      const dx = x - drag.current.startX;
      const dy = y - drag.current.startY;

      // Decide direction once user moves enough — don't hijack vertical scroll
      if (!drag.current.decided) {
        const total = Math.hypot(dx, dy);
        if (total > 10) {
          drag.current.decided = true;
          drag.current.horizontal = Math.abs(dx) > Math.abs(dy);
        } else {
          return;
        }
      }
      if (!drag.current.horizontal) return;

      const frac = Math.min(Math.abs(dx) / THRESHOLD, 1);
      cardRef.current.style.transform = `translateX(${dx}px) rotate(${dx / 24}deg)`;
      if (overlayR.current) overlayR.current.style.opacity = dx > 0 ? String(frac) : "0";
      if (overlayL.current) overlayL.current.style.opacity = dx < 0 ? String(frac) : "0";
    }, []);

    const onEnd = useCallback((x: number) => {
      if (!drag.current.active) return;
      const wasHorizontal = drag.current.horizontal;
      const dx = x - drag.current.startX;
      drag.current = { startX: 0, startY: 0, active: false, decided: false, horizontal: false };
      if (overlayR.current) overlayR.current.style.opacity = "0";
      if (overlayL.current) overlayL.current.style.opacity = "0";
      if (!wasHorizontal) return;
      if (Math.abs(dx) >= THRESHOLD) {
        onSwipe(dx > 0 ? "right" : "left");
      } else if (cardRef.current) {
        cardRef.current.style.transition = "transform 280ms ease";
        cardRef.current.style.transform  = "";
      }
    }, [onSwipe]);

    useEffect(() => {
      if (isNext) return;
      const mm = (e: MouseEvent) => onMove(e.clientX, e.clientY);
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

    const descBody = description || job.summary || "";
    const descNodes = useMemo(() => renderDescription(descBody), [descBody]);

    return (
      <div
        ref={cardRef}
        className={`sw-card ${isNext ? "sw-card-next" : "sw-card-current"}`}
        onTouchStart={(e) => onStart(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchMove={(e)  => onMove(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchEnd={(e)   => onEnd(e.changedTouches[0].clientX)}
        onTouchCancel={(e)=> onEnd(e.changedTouches[0]?.clientX ?? 0)}
      >
        <div ref={overlayR} className="sw-overlay-r"><span className="sw-overlay-label">SAVE</span></div>
        <div ref={overlayL} className="sw-overlay-l"><span className="sw-overlay-label">SKIP</span></div>

        <div className="sw-card-inner">

          {/* ── Left: identity rail ──────────────────────────────────────── */}
          <div
            className="sw-card-rail"
            onMouseDown={(e) => { e.preventDefault(); onStart(e.clientX, e.clientY); }}
          >
            <div className="sw-rail-top">
              <div className="sw-avatar-lg" style={{ background: pal.bg, color: pal.color }}>{initial}</div>
              <div className="sw-rail-meta">
                <span className={`sw-score sw-score-${scoreClass(score)}`}>★ {score}</span>
                {postedAt && <span className="sw-posted-chip">🕐 {postedAt}</span>}
              </div>
            </div>

            <div className="sw-title">{job.title || "Untitled role"}</div>

            <div className="sw-company-row">
              <span className="sw-company">{job.company || "—"}</span>
            </div>
            {job.location && <div className="sw-location">📍 {job.location}</div>}

            <div className="sw-badges">
              <span className={`sw-badge ${lvlCls}`}>{level || "Unknown"}</span>
              <span className={`sw-badge ${matchCls}`}>{match}% match</span>
              {expLabel && <span className="sw-badge sw-badge-exp">{expLabel} exp</span>}
              {job.site && <span className="sw-badge sw-badge-site">{job.site}</span>}
              <span className={`sw-badge ${compCls}`}>{compLabel}</span>
            </div>

            {(ats != null || fit != null) && (
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
            )}

            <div className="sw-rail-spacer" />

            {job.job_url && (
              <a
                href={job.job_url}
                target="_blank"
                rel="noopener noreferrer"
                className="sw-apply-btn"
                onClick={(e)      => e.stopPropagation()}
                onMouseDown={(e)  => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                <span>Apply on {job.site || "site"}</span>
                <span aria-hidden>↗</span>
              </a>
            )}
          </div>

          {/* ── Right: description ───────────────────────────────────────── */}
          <div className="sw-card-body">
            <div className="sw-body-head">
              <span className="sw-body-eyebrow">About this role</span>
            </div>

            <div className="sw-body-content">
              {descriptionLoading && !description ? (
                <div className="sw-desc-loading">
                  <div className="sw-skel sw-skel-h" />
                  <div className="sw-skel sw-skel-line" />
                  <div className="sw-skel sw-skel-line" />
                  <div className="sw-skel sw-skel-line sw-skel-short" />
                  <div className="sw-skel sw-skel-h" />
                  <div className="sw-skel sw-skel-line" />
                  <div className="sw-skel sw-skel-line sw-skel-short" />
                </div>
              ) : descBody ? (
                <Fragment>{descNodes}</Fragment>
              ) : (
                <p className="sw-desc-empty">No description available for this role.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
);
SwipeCard.displayName = "SwipeCard";

// ── Picks sidebar ─────────────────────────────────────────────────────────────

function PickRow({ job, index }: { job: Job; index: number }) {
  const pal     = avatarPal(job.company || "?");
  const initial = (job.company || "?")[0].toUpperCase();
  const match   = Math.max(0, Math.round(job.score_pct ?? 0));
  const url     = job.job_url || null;
  const time    = formatSwipeTime(job.swiped_at);

  return (
    <div className="sw-pick">
      <div className="sw-pick-head">
        <span className="sw-pick-idx">#{index}</span>
        {time && <span className="sw-pick-time">{time}</span>}
      </div>

      <div className="sw-pick-body">
        <div className="sw-pick-avatar" style={{ background: pal.bg, color: pal.color }}>{initial}</div>
        <div className="sw-pick-info">
          <div className="sw-pick-title">{job.title || "Untitled"}</div>
          <div className="sw-pick-company">{job.company || "—"}</div>
        </div>
      </div>

      <div className="sw-pick-foot">
        <span className="sw-pick-meta">★ {job.score ?? 0} · {match}%</span>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="sw-pick-apply" title="Apply">↗</a>
        )}
      </div>
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
  const [currentIdx, setCurrentIdx] = useState(0);
  const [picks,      setPicks]      = useState<Job[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [descCache,  setDescCache]  = useState<Record<string, string | null>>({});
  const fetchingRef    = useRef<Set<string>>(new Set());
  const isSwipingRef   = useRef(false);
  const currentCardRef = useRef<SwipeCardHandle>(null);

  // Initial load: queue + picks + already-skipped count
  useEffect(() => {
    async function load() {
      try {
        const [queueRes, picksRes, skippedRes] = await Promise.all([
          fetch(`${API_BASE}/api/swipe-queue?date=${todayLocal()}`),
          fetch(`${API_BASE}/api/swipes?direction=right&date=${todayLocal()}`),
          fetch(`${API_BASE}/api/swipes?direction=left&date=${todayLocal()}`),
        ]);
        if (!queueRes.ok) throw new Error(`HTTP ${queueRes.status}`);
        const queueData = await queueRes.json();
        const jobs: Job[] = queueData.jobs || [];
        setQueue(jobs);
        setCurrentIdx(0);

        if (picksRes.ok) {
          const picksData = await picksRes.json();
          setPicks(picksData.jobs || []);
        }
        if (skippedRes.ok) {
          const skippedData = await skippedRes.json();
          setSkippedCount(skippedData.count || 0);
        }

        if (jobs.length === 0) {
          setPageState("done");
          setTimeout(() => navigate("/dashboard"), 2400);
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

  // Lazy-fetch full descriptions for current + next card
  const fetchDescription = useCallback(async (url: string) => {
    if (!url || fetchingRef.current.has(url) || descCache[url] !== undefined) return;
    fetchingRef.current.add(url);
    try {
      const res = await fetch(`${API_BASE}/api/job-description?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      setDescCache((prev) => ({ ...prev, [url]: data.description || null }));
    } catch {
      setDescCache((prev) => ({ ...prev, [url]: null }));
    } finally {
      fetchingRef.current.delete(url);
    }
  }, [descCache]);

  useEffect(() => {
    if (pageState !== "swiping") return;
    const cur  = queue[currentIdx]?.job_url;
    const next = queue[currentIdx + 1]?.job_url;
    if (cur)  fetchDescription(cur);
    if (next) fetchDescription(next);
  }, [pageState, currentIdx, queue, fetchDescription]);

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
      const stamped: Job = { ...job, swiped_at: new Date().toISOString() };
      setPicks((prev) => [stamped, ...prev]);
    } else {
      setSkippedCount((c) => c + 1);
    }

    await currentCardRef.current?.animateOut(dir);
    isSwipingRef.current = false;

    const next = currentIdx + 1;
    setCurrentIdx(next);
    if (next >= queue.length) {
      setPageState("done");
      setTimeout(() => navigate("/dashboard"), 2400);
    }
  }, [queue, currentIdx, navigate]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (pageState !== "swiping") return;
      if (e.key === "ArrowRight" || e.key === "l" || e.key === "L") doSwipe("right");
      if (e.key === "ArrowLeft"  || e.key === "h" || e.key === "H") doSwipe("left");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageState, doSwipe]);

  const remaining = queue.length - currentIdx;
  const savedToday = picks.length;
  const reviewedToday = savedToday + skippedCount;
  const denom = reviewedToday + remaining;
  const pct = denom > 0 ? (reviewedToday / denom) * 100 : 0;

  const currentJob = queue[currentIdx];
  const nextJob    = queue[currentIdx + 1];
  const currentUrl = currentJob?.job_url || "";
  const nextUrl    = nextJob?.job_url || "";
  const currentDesc = currentUrl ? descCache[currentUrl] : undefined;
  const nextDesc    = nextUrl    ? descCache[nextUrl]    : undefined;

  return (
    <div className="sw-root">
      {/* Header */}
      <div className="sw-topbar">
        <Link to="/" className="sw-brand">
          <div className="sw-brand-mark">A</div>
          <span className="sw-brand-name">Atriveo</span>
        </Link>
        <nav className="sw-nav">
          <Link to="/dashboard"    className="sw-nav-link">Live Feed</Link>
          <Link to="/weekly"       className="sw-nav-link">Weekly</Link>
          <Link to="/unclicked-100" className="sw-nav-link">100+ Unclicked</Link>
        </nav>
        <div className="sw-header-keys" aria-hidden>
          <kbd>←</kbd> Skip · <kbd>→</kbd> Save
        </div>
        <Link to="/dashboard" className="sw-skip">Skip queue →</Link>
      </div>

      {/* Stats strip */}
      {pageState === "swiping" && (
        <div className="sw-stats-strip">
          <div className="sw-stats-progress">
            <div className="sw-stats-bar">
              <div className="sw-stats-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="sw-stats-pct">{Math.round(pct)}%</span>
          </div>
          <div className="sw-stats-counts">
            <span className="sw-stat-pill sw-stat-saved">✓ {savedToday} saved</span>
            <span className="sw-stat-pill sw-stat-skipped">✕ {skippedCount} skipped</span>
            <span className="sw-stat-pill sw-stat-left">{remaining} left</span>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="sw-body">

        {/* Main card area */}
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
                You reviewed {reviewedToday} jobs today.<br />
                Heading to your picks…
              </div>
            </div>
          )}

          {pageState === "swiping" && (
            <Fragment>
              <div className="sw-stack">
                {nextJob && (
                  <SwipeCard
                    key={`next-${currentIdx + 1}`}
                    job={nextJob}
                    description={nextDesc}
                    descriptionLoading={nextUrl !== "" && nextDesc === undefined}
                    isNext
                    onSwipe={doSwipe}
                  />
                )}
                {currentJob && (
                  <SwipeCard
                    ref={currentCardRef}
                    key={`current-${currentIdx}`}
                    job={currentJob}
                    description={currentDesc}
                    descriptionLoading={currentUrl !== "" && currentDesc === undefined}
                    onSwipe={doSwipe}
                  />
                )}
              </div>

              <div className="sw-actions">
                <button className="sw-btn-nope" onClick={() => doSwipe("left")}>
                  <span aria-hidden>✕</span>
                  <span className="sw-btn-label">Skip</span>
                  <kbd className="sw-btn-kbd">←</kbd>
                </button>
                <button className="sw-btn-like" onClick={() => doSwipe("right")}>
                  <kbd className="sw-btn-kbd">→</kbd>
                  <span className="sw-btn-label">Save</span>
                  <span aria-hidden>✓</span>
                </button>
              </div>
            </Fragment>
          )}
        </div>

        {/* Picks sidebar */}
        <aside className="sw-picks-panel">
          <div className="sw-picks-header">
            <div>
              <div className="sw-picks-title">★ Your Picks</div>
              <div className="sw-picks-sub">Today · {todayLocal()}</div>
            </div>
            <span className="sw-picks-count">{picks.length}</span>
          </div>

          <div className="sw-picks-list">
            {picks.length === 0 ? (
              <div className="sw-picks-empty">
                <div className="sw-picks-empty-icon">📥</div>
                <div className="sw-picks-empty-title">No picks yet</div>
                <div className="sw-picks-empty-sub">Swipe right or press → to save jobs you like.</div>
              </div>
            ) : (
              picks.map((job, i) => <PickRow key={job.job_url || i} job={job} index={i + 1} />)
            )}
          </div>
        </aside>

      </div>
    </div>
  );
}
