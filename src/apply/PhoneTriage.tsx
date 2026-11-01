import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getTailorServerBase } from "../utils/tailorServer";
import { fetchJson, getJson, type ApiBody } from "./engine";
import "./phone.css";

// Triage on a phone: one job at a time from Matching and Staffing. Swipe right (or Save) keeps it for the laptop,
// swipe left (or Skip) passes; both write exactly what the desktop buttons write. Tap the card for the whole posting.

type Kind = "matching" | "staffing";
type Source = "all" | Kind;
interface Card {
  kind: Kind; id: string; key: string; title: string; company: string; location: string | null; posted: string | null;
  fit: number | null; lines: string[]; warning: string | null; url: string;
  about: string; requirements: string[]; duties: string[]; chips: string[];
}

interface MatchingJob {
  id: string; key: string; title: string; company: string; location: string | null; postedAt: string | null; foundAt: string | null; postingUrl: string;
  jd: { full: string; about: string; requirements: string[]; duties: string[]; work: string | null; salary: string | null };
  fit: { score: number | null; ledger: { required: { matched: number; total: number }; skills: { label: string; class: string; status: string }[] }; knockouts: { verdict: string; items: { status: string; reason: string }[] } } | null;
}
interface StaffingJob { _id: string; title: string; company: string; location: string; job_url: string; summary: string; description?: string; first_seen_at: string; reasons: string[]; warning?: string }

const SOURCES: [Source, string][] = [["all", "All"], ["matching", "Matching"], ["staffing", "Staffing"]];
const SWIPE = 96;

function fromMatching(j: MatchingJob): Card {
  const skills = (j.fit?.ledger?.skills ?? []).filter((s) => s.status !== "missing").map((s) => s.label);
  const req = j.fit?.ledger?.required;
  const blocked = j.fit?.knockouts?.verdict === "blocked" ? j.fit.knockouts.items.find((i) => i.status !== "pass")?.reason ?? "A requirement rules this out" : null;
  return {
    kind: "matching", id: j.id, key: j.key, title: j.title, company: j.company, location: j.location, posted: j.postedAt ?? j.foundAt,
    fit: j.fit?.score ?? null, warning: blocked, url: j.postingUrl,
    lines: [req?.total ? `Core skills ${req.matched}/${req.total}` : "", skills.length ? `You have ${skills.slice(0, 3).join(", ")}` : ""].filter(Boolean),
    about: j.jd?.about || j.jd?.full || "", requirements: j.jd?.requirements ?? [], duties: j.jd?.duties ?? [],
    chips: [j.jd?.work, j.jd?.salary].filter((c): c is string => Boolean(c) && c !== j.location),
  };
}

function fromStaffing(j: StaffingJob): Card {
  return {
    kind: "staffing", id: j._id, key: j._id, title: j.title, company: j.company, location: j.location || null, posted: j.first_seen_at,
    fit: null, warning: j.warning || null, url: j.job_url, lines: j.reasons.slice(0, 3),
    about: j.description || j.summary || "", requirements: [], duties: [], chips: ["Staffing"],
  };
}

const ago = (iso: string | null) => {
  if (!iso) return "";
  const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000));
  return h < 1 ? "just now" : h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

async function post(path: string, body: object): Promise<void> {
  const { res, json } = await fetchJson<ApiBody>(`${getTailorServerBase()}${path}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || json.ok === false) throw new Error(json.error || `Not saved (${res.status})`);
}

/** The same writes as the desktop buttons: Matching Later / not apply / undo, Staffing Save / Pass / back to new. */
function decide(card: Card, choice: "keep" | "skip" | "undo"): Promise<void> {
  if (card.kind === "matching") return post("/applications/job-decision", { jobUrl: card.id, decision: { keep: "later", skip: "skip", undo: "undo" }[choice] });
  return post("/staffing/decision", { id: card.id, state: { keep: "saved", skip: "passed", undo: "new" }[choice] });
}

function useDeck(source: Source) {
  const [cards, setCards] = useState<Card[]>([]);
  const [totals, setTotals] = useState<{ matching: number | null; staffing: number | null }>({ matching: null, staffing: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const seen = useRef(new Set<string>());
  const busy = useRef(false);

  const more = useCallback(async (reset = false) => {
    if (busy.current && !reset) return;
    busy.current = true;
    if (reset) { seen.current.clear(); setCards([]); setLoading(true); }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const wantM = source !== "staffing", wantS = source !== "matching";
    try {
      const [m, s] = await Promise.all([
        wantM ? getJson<{ total: number; jobs: MatchingJob[] }>(`/applications/matching-queue?${new URLSearchParams({ limit: "8", learn: "0", period: "7d", sources: "", role: "", q: "", sort: "latest", tz, exclude: [...seen.current].filter((k) => /^[a-f0-9]{16}$/.test(k)).slice(-512).join(",") })}`) : null,
        wantS ? getJson<{ total: number; jobs: StaffingJob[] }>("/staffing/workspace?view=recommended&offset=0&limit=12&track=all&q=&source=") : null,
      ]);
      const ms = (m?.jobs ?? []).map(fromMatching), ss = (s?.jobs ?? []).map(fromStaffing);
      // All: take them in turn, so both sources get looked at.
      const mixed: Card[] = [];
      for (let i = 0; i < Math.max(ms.length, ss.length); i++) { if (ms[i]) mixed.push(ms[i]!); if (ss[i]) mixed.push(ss[i]!); }
      const fresh = mixed.filter((c) => !seen.current.has(c.key));
      fresh.forEach((c) => seen.current.add(c.key));
      setCards((cur) => (reset ? fresh : [...cur, ...fresh]));
      setTotals({ matching: m ? m.total : null, staffing: s ? s.total : null });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { busy.current = false; setLoading(false); }
  }, [source]);

  useEffect(() => { void more(true); }, [more]);
  return { cards, setCards, totals, setTotals, loading, error, setError, more };
}

export default function PhoneTriage({ header }: { header: ReactNode }) {
  const [source, setSource] = useState<Source>(() => { try { const s = localStorage.getItem("phone.triageSource"); return s === "matching" || s === "staffing" ? s : "all"; } catch { return "all"; } });
  const deck = useDeck(source);
  const { cards, setCards, totals, setTotals, more } = deck;
  const [last, setLast] = useState<{ card: Card; choice: "keep" | "skip" } | null>(null);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState<{ x: number; start: number; id: number } | null>(null);
  const [leaving, setLeaving] = useState<"keep" | "skip" | null>(null);
  const card = cards[0] ?? null;

  useEffect(() => { if (!deck.loading && cards.length > 0 && cards.length <= 3) void more(); }, [cards.length, deck.loading, more]);

  const pick = (s: Source) => { setSource(s); setLast(null); try { localStorage.setItem("phone.triageSource", s); } catch { /* not remembered */ } };

  const act = useCallback(async (choice: "keep" | "skip") => {
    if (!card || leaving) return;
    setLeaving(choice); setOpen(false);
    // Let the card fly out, then drop it; the write runs meanwhile and puts the card back if it fails.
    window.setTimeout(() => { setCards((c) => c.filter((x) => x.key !== card.key)); setLeaving(null); setDrag(null); }, 180);
    setTotals((t) => ({ ...t, [card.kind]: Math.max(0, (t[card.kind] ?? 1) - 1) }));
    try {
      await decide(card, choice);
      setLast({ card, choice });
      setNote(choice === "keep" ? `Saved: ${card.company} waits on the laptop.` : `Skipped ${card.company}.`);
    } catch (e) {
      setCards((c) => [card, ...c.filter((x) => x.key !== card.key)]);
      setTotals((t) => ({ ...t, [card.kind]: (t[card.kind] ?? 0) + 1 }));
      setNote(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [card, leaving, setCards, setTotals]);

  const undo = async () => {
    if (!last) return;
    const { card: c } = last;
    setLast(null);
    try {
      await decide(c, "undo");
      setCards((cur) => [c, ...cur.filter((x) => x.key !== c.key)]);
      setTotals((t) => ({ ...t, [c.kind]: (t[c.kind] ?? 0) + 1 }));
      setNote(`${c.company} is back.`);
    } catch (e) { setNote(`Could not undo: ${e instanceof Error ? e.message : String(e)}`); }
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "ArrowRight") { e.preventDefault(); void act("keep"); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); void act("skip"); }
      else if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [act]);

  const dx = drag ? drag.x - drag.start : 0;
  const left = (totals.matching ?? 0) + (totals.staffing ?? 0);
  const style = leaving ? { transform: `translateX(${leaving === "keep" ? 130 : -130}%) rotate(${leaving === "keep" ? 12 : -12}deg)`, transition: "transform .18s ease-in" }
    : drag ? { transform: `translateX(${dx}px) rotate(${dx / 24}deg)`, transition: "none" } : undefined;

  return (
    <div className="ph-page ph-triage-page">
      {header}
      <div className="ph-triage">
        <div className="ph-seg" role="tablist" aria-label="Which jobs">
          {SOURCES.map(([s, label]) => <button key={s} type="button" role="tab" aria-selected={source === s} onClick={() => pick(s)}>{label}</button>)}
        </div>
        <p className="ph-triage-count" aria-live="polite">{deck.loading && !cards.length ? "Loading…" : `${left} to triage`}</p>

        <div className="ph-deck">
          {deck.error && !cards.length && <div className="ph-empty"><strong>Couldn't load jobs</strong><span>{deck.error}</span><button type="button" className="ph-btn" onClick={() => void more(true)}>Try again</button></div>}
          {!deck.loading && !deck.error && !card && <div className="ph-empty"><strong>You're caught up</strong><span>Nothing new to triage here.</span></div>}
          {cards[1] && <article className="ph-card is-behind" aria-hidden="true"><h2>{cards[1].title}</h2></article>}
          {card && (
            <article
              key={card.key} className={`ph-card${dx > SWIPE / 2 ? " is-keep" : dx < -SWIPE / 2 ? " is-skip" : ""}`} style={style}
              aria-label={`${card.title} at ${card.company}`}
              onPointerDown={(e) => { if (e.button === 0) { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag({ x: e.clientX, start: e.clientX, id: e.pointerId }); } }}
              onPointerMove={(e) => { if (drag && e.pointerId === drag.id) setDrag({ ...drag, x: e.clientX }); }}
              onPointerUp={() => { if (!drag) return; if (dx > SWIPE) void act("keep"); else if (dx < -SWIPE) void act("skip"); else { if (Math.abs(dx) < 6) setOpen(true); setDrag(null); } }}
              onPointerCancel={() => setDrag(null)}
            >
              <span className="ph-stamp is-keep" aria-hidden="true">Save</span><span className="ph-stamp is-skip" aria-hidden="true">Skip</span>
              <div className="ph-card-top">
                <span className="ph-company">{card.company}</span>
                {card.fit != null && <span className="ph-fit" title="Fit: your whole bank against this posting"><b>{card.fit}</b> fit</span>}
              </div>
              <h2>{card.title}</h2>
              <p className="ph-meta">{[card.location, ago(card.posted), ...card.chips].filter(Boolean).join(" · ")}</p>
              {card.warning && <p className="ph-warn">{card.warning}</p>}
              <ul className="ph-why">{card.lines.map((l) => <li key={l}>{l}</li>)}</ul>
              <p className="ph-about">{card.about}</p>
              <span className="ph-more">Tap for the whole posting</span>
            </article>
          )}
        </div>

        <div className="ph-actions">
          <button type="button" className="ph-act is-skip" aria-label="Skip" disabled={!card || Boolean(leaving)} onClick={() => void act("skip")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
          <button type="button" className="ph-act is-undo" aria-label="Undo" disabled={!last} onClick={() => void undo()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" /></svg></button>
          <button type="button" className="ph-act is-keep" aria-label="Save for the laptop" disabled={!card || Boolean(leaving)} onClick={() => void act("keep")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z" /></svg></button>
        </div>
        <p className="ph-note" role="status">{note}</p>
      </div>

      {open && card && (
        <div className="ph-sheet-wrap" onClick={() => setOpen(false)}>
          <div className="ph-sheet ph-posting" role="dialog" aria-modal="true" aria-label={`${card.title} at ${card.company}`} onClick={(e) => e.stopPropagation()}>
            <i className="ph-grab" aria-hidden="true" />
            <p className="ph-company">{card.company}</p>
            <h2>{card.title}</h2>
            <p className="ph-meta">{[card.location, ago(card.posted), ...card.chips].filter(Boolean).join(" · ")}</p>
            {card.about && <p className="ph-posting-text">{card.about}</p>}
            {card.requirements.length > 0 && <><h3>Requirements</h3><ul>{card.requirements.map((r, i) => <li key={i}>{r}</li>)}</ul></>}
            {card.duties.length > 0 && <><h3>What you'd do</h3><ul>{card.duties.map((r, i) => <li key={i}>{r}</li>)}</ul></>}
            <a className="ph-btn ph-posting-link" href={card.url} target="_blank" rel="noreferrer">Open the posting</a>
            <div className="ph-posting-actions">
              <button type="button" className="ph-btn" onClick={() => void act("skip")}>Skip</button>
              <button type="button" className="ph-btn is-primary" onClick={() => void act("keep")}>Save for the laptop</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
