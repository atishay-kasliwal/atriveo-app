import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { loopDone, loopSnooze, loopsSummary, waiting, type LoopOpen } from "./loops";
import "./loops-donow.css";

/** Today's "Do now": the unfinished intentions that matter right now, one slim row. Its own small fetch, so it never slows Today's cards down. */
export function useLoopsOpen(intervalMs = 60_000) {
  const [open, setOpen] = useState<LoopOpen[]>([]);
  const refresh = useCallback(async () => { try { setOpen((await loopsSummary()).open); } catch { setOpen([]); } }, []);
  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, intervalMs);
    const v = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", v);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", v); };
  }, [refresh, intervalMs]);
  return { open, refresh };
}

export default function LoopsDoNow() {
  const { open, refresh } = useLoopsOpen();
  const [busy, setBusy] = useState<string | null>(null);
  if (!open.length) return null; // calm when there is nothing to do: no empty strip
  const now = Date.now();
  // Due ones (their reminder time has passed) first, then the longest waiting.
  const sorted = [...open].sort((a, b) => Number(Date.parse(b.nextAt ?? "") <= now) - Number(Date.parse(a.nextAt ?? "") <= now) || Date.parse(a.waitingSince) - Date.parse(b.waitingSince));
  const shown = sorted.slice(0, 3);
  const act = async (id: string, fn: () => Promise<unknown>) => { setBusy(id); try { await fn(); } catch { /* the refresh shows what is still true */ } finally { setBusy(null); void refresh(); } };
  return (
    <section className="dn" aria-label="Do now">
      <h2 className="dn-label">Do now</h2>
      <ul className="dn-list">
        {shown.map((o) => {
          const where = [o.view?.company, o.view?.position].filter(Boolean).join(" · ");
          return (
            <li key={o.id} className="dn-item">
              <Link className="dn-text" to={`/loops?id=${encodeURIComponent(o.id)}`}><b>{o.firstTask ?? o.view?.summary ?? "Something you wanted to do"}</b><span>{[where, o.view?.person, waiting(o.waitingSince, now)].filter(Boolean).join(" · ")}</span></Link>
              <span className="dn-acts"><button type="button" disabled={busy === o.id} onClick={() => void act(o.id, () => loopDone(o.id))}>Done</button><button type="button" disabled={busy === o.id} title="Remind me in 6 hours" aria-label="Remind me in 6 hours" onClick={() => void act(o.id, () => loopSnooze(o.id, 6))}>Later</button></span>
            </li>
          );
        })}
      </ul>
      <Link className="dn-all" to="/loops">{open.length > shown.length ? `+${open.length - shown.length} more · ` : ""}All loops</Link>
    </section>
  );
}
