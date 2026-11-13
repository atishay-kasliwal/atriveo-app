import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { getJson } from "./engine";
import LoopsDoNow from "./LoopsDoNow";
import { loadReminders, type Reminder } from "./network";
import { markRepliesSeen, readSeenReplies as readSeen } from "./phoneSeen";
import { useReviewCounts } from "./reviewQueue";
import { GOALS, readPref, streakOf, useApplyHistory, useAppliedToday } from "./todayGoal";
import "./phone.css";

// Home on a phone: what needs you while you're away from the laptop. Each tile leads to the tab that handles it;
// every number comes from a light count call, never a full queue.


interface Triage { matching: number | null; staffing: number | null; saved: { matching: number; staffing: number } }
interface Replies { replied: number; interview: number; last7: number }

function useTriage(): Triage {
  const [t, setT] = useState<Triage>({ matching: null, staffing: null, saved: { matching: 0, staffing: 0 } });
  useEffect(() => {
    let alive = true;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Matching's own defaults (last 7 days, newest first), so the number matches what Triage opens on.
    getJson<{ total: number; stats?: { saved?: number } }>(`/applications/matching-queue?${new URLSearchParams({ limit: "1", learn: "0", period: "7d", sources: "", role: "", q: "", sort: "latest", tz })}`)
      .then((q) => { if (alive) setT((c) => ({ ...c, matching: q.total, saved: { ...c.saved, matching: q.stats?.saved ?? 0 } })); }, () => {});
    getJson<{ counts: Record<string, number> }>("/staffing/workspace?view=recommended&offset=0&limit=1&track=all&q=&source=")
      .then((w) => { if (alive) setT((c) => ({ ...c, staffing: w.counts.recommended ?? 0, saved: { ...c.saved, staffing: w.counts.saved ?? 0 } })); }, () => {});
    return () => { alive = false; };
  }, []);
  return t;
}

function useReplies(): Replies | null {
  const [r, setR] = useState<Replies | null>(null);
  useEffect(() => {
    let alive = true;
    getJson<{ counts: Record<string, number>; last7: number }>("/applications/applied?outcome=replied&q=&skip=0&limit=1")
      .then((l) => { if (alive) setR({ replied: l.counts.replied ?? 0, interview: l.counts.interview ?? 0, last7: l.last7 ?? 0 }); }, () => {});
    return () => { alive = false; };
  }, []);
  return r;
}

function useReminders(): Reminder[] | null {
  const [r, setR] = useState<Reminder[] | null>(null);
  useEffect(() => { let alive = true; loadReminders().then((x) => { if (alive) setR(x); }, () => { if (alive) setR([]); }); return () => { alive = false; }; }, []);
  return r;
}

function Tile({ to, n, label, detail, tone, onOpen }: { to: string; n: number | null; label: string; detail: ReactNode; tone?: "hot"; onOpen?: () => void }) {
  return (
    <Link to={to} className={`ph-tile${tone ? ` is-${tone}` : ""}`} onClick={onOpen}>
      <b>{n ?? "…"}</b>
      <span className="ph-tile-label">{label}</span>
      <span className="ph-tile-detail">{detail}</span>
    </Link>
  );
}

export default function PhoneHome({ header }: { header: ReactNode }) {
  const goal = (() => { const g = readPref<number>("goal", 15); return GOALS.includes(g) ? g : 15; })();
  const today = useAppliedToday();
  const history = useApplyHistory();
  const streak = history ? streakOf(history, today.applied ?? 0) : null;
  const triage = useTriage();
  const replies = useReplies();
  const reminders = useReminders();
  const counts = useReviewCounts();
  const [seen] = useState(readSeen);

  const triageN = triage.matching == null && triage.staffing == null ? null : (triage.matching ?? 0) + (triage.staffing ?? 0);
  const fresh = replies && seen != null ? Math.max(0, replies.replied - seen) : 0;
  // The first visit sets the baseline; opening the tile clears "new".
  useEffect(() => { if (replies && seen == null) markRepliesSeen(replies.replied); }, [replies, seen]);
  const laptop = counts ? (counts.fillable ?? 0) + counts.ready : null;
  const saved = triage.saved.matching + triage.saved.staffing;
  const applied = today.applied;

  return (
    <div className="ph-page">
      {header}
      <main className="ph-home">
        <section className="ph-goal" aria-label={`Applied today: ${applied ?? "loading"} of ${goal}`}>
          <div className="ph-goal-row">
            <span><b>{applied ?? "–"}</b> / {goal} applied today</span>
            {streak != null && streak > 0 && <span className="ph-streak" title="Days in a row with an application; weekends don't break it">🔥 {streak}</span>}
          </div>
          <div className={`ph-goal-bar${(applied ?? 0) >= goal ? " is-done" : ""}`}><i style={{ width: `${Math.min(100, ((applied ?? 0) / goal) * 100)}%` }} /></div>
        </section>

        <LoopsDoNow />

        <div className="ph-tiles">
          <Tile to="/job-matching" n={triageN} label="to triage"
            detail={triageN == null ? "Loading…" : `Matching ${triage.matching ?? "…"} · Staffing ${triage.staffing ?? "…"}`} />
          <Tile to="/applied?show=replies" n={replies?.replied ?? null} label="replies" tone={fresh ? "hot" : undefined} onOpen={() => { if (replies) markRepliesSeen(replies.replied); }}
            detail={!replies ? "Loading…" : fresh ? `${fresh} new since you last looked` : `${replies.interview} interview${replies.interview === 1 ? "" : "s"} · ${replies.last7} applied this week`} />
          <Tile to="/network" n={reminders?.length ?? null} label={reminders?.length === 1 ? "follow-up" : "follow-ups"} tone={reminders?.length ? "hot" : undefined}
            detail={!reminders ? "Loading…" : reminders[0] ? reminders[0].title : "Nobody is waiting on you"} />
        </div>

        <Link to="/today" className="ph-laptop">
          <span><b>{laptop == null ? "…" : laptop + saved}</b> waiting on your laptop</span>
          <small>{laptop ?? "…"} ready to Open &amp; Fill · {saved} saved from triage</small>
        </Link>
      </main>
    </div>
  );
}
