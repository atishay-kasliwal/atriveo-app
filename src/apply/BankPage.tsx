import { useEffect, useMemo, useRef, useState } from "react";
import { getTailorServerBase } from "../utils/tailorServer";
import { TRACK_LABEL } from "./tracks";
import "./review-pages.css";
import "./bank.css";

// Bank (/bank): every bullet in the resume bank on one screen. Five columns (Stony Brook, Wake Forest, Accolite,
// Atriveo, other projects) with "Needs your input" (wordings under 9/10) above them; click a card for its fact and
// every wording, with the tracks whose tested resume prints it. Read-only for now. Server: scripts/bank-page.mjs
// (GET /resume-builder/bank). Design and phases: docs/bank-page.md.

interface Pin { track: string; set: string }
interface Variant { facet: string; text: string; strength: number | null; note: string | null; tracks: string[]; retired: boolean; pinned: Pin[] }
interface Entry { id: string; role: string; label: string; kind: "experience" | "project"; theme: string; fact: string; confirmedAt: string | null; tracks: string[]; retired: boolean; variants: Variant[] }
interface Bank { version: string; updatedAt: string | null; tracks: Array<{ id: string; label: string; hasSet: boolean }>; entries: Entry[] }

const TRACKS = ["software-engineer", "ai-engineer", "data-science", "data-analytics", "forward-deployed"];
/** One column each; every other project shares the last. */
const OWN_COLUMN: Record<string, string> = { "stony-brook": "Stony Brook", "wake-forest": "Wake Forest", accolite: "Accolite", atriveo: "Atriveo" };
const COLUMNS = [...Object.entries(OWN_COLUMN).map(([id, label]) => ({ id, label })), { id: "projects", label: "Projects" }];
const columnOf = (role: string) => (role in OWN_COLUMN ? role : "projects");
const NINE = 9;
const FILTER_KEY = "bank-filters";

const store = {
  get(): Partial<{ track: string; under: boolean; retired: boolean }> { try { return JSON.parse(localStorage.getItem(FILTER_KEY) || "{}"); } catch { return {}; } },
  set(v: object) { try { localStorage.setItem(FILTER_KEY, JSON.stringify(v)); } catch { /* private window */ } },
};

/** A wording is on a track unless it, or its entry, is tagged for other tracks only (bankForTrack's rule). */
const onTrack = (e: Entry, v: Variant, track: string) => (!e.tracks.length || e.tracks.includes(track)) && (!v.tracks.length || v.tracks.includes(track));
/** The wordings the board shows for an entry (track and retired filters applied). */
const shownWordings = (e: Entry, track: string, retired: boolean) => e.variants.filter((v) => (retired || (!v.retired && !e.retired)) && (track === "all" || onTrack(e, v, track)));
const lowest = (vs: Variant[]) => vs.reduce<number | null>((m, v) => (v.strength == null ? m : m == null ? v.strength : Math.min(m, v.strength)), null);
/** The note on the lowest-scoring wording: what it needs from you. */
const lowestNote = (vs: Variant[]) => [...vs].sort((a, b) => (a.strength ?? 10) - (b.strength ?? 10))[0]?.note ?? null;
const pinnedOn = (vs: Variant[], track: string) => vs.some((v) => v.pinned.some((p) => p.track === track));
const theme = (e: Entry) => e.theme.replace(/[-_]/g, " ");
const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
const shortDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };

function Score({ s }: { s: number | null }) {
  if (s == null) return <span className="bk-score is-none" title="Not rated">–</span>;
  return <span className={`bk-score ${s >= NINE ? "is-good" : s >= 8 ? "is-near" : "is-low"}`} title="Score out of 10">{s}/10</span>;
}
const Track = ({ id, set }: { id: string; set?: string }) => (
  <span className={`bk-track is-${id}`} title={set && set !== "default" ? `${TRACK_LABEL[id] ?? id} resume, ${set} set` : `${TRACK_LABEL[id] ?? id} resume`}>
    {TRACK_LABEL[id] ?? id}{set && set !== "default" ? ` · ${set}` : ""}
  </span>
);

export default function BankPage({ header }: { header?: React.ReactNode }) {
  const [bank, setBank] = useState<Bank | null>(null);
  const [error, setError] = useState("");
  const saved = useMemo(() => store.get(), []);
  const [track, setTrack] = useState<string>(saved.track && TRACKS.includes(saved.track) ? saved.track : "all");
  const [under, setUnder] = useState(Boolean(saved.under));
  const [retired, setRetired] = useState(Boolean(saved.retired));
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    fetch(`${getTailorServerBase()}/resume-builder/bank`, { credentials: "include", cache: "no-store" })
      .then(async (r) => { const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` })); if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`); return j as Bank; })
      .then((b) => { if (live) setBank(b); }, (e) => { if (live) setError(String(e.message || e)); });
    return () => { live = false; };
  }, []);
  useEffect(() => { store.set({ track, under, retired }); }, [track, under, retired]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (e.key === "/" && !typing) { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "Escape") { if (typing && e.target === searchRef.current) { setQuery(""); searchRef.current?.blur(); } else setSelected(null); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const shown = (e: Entry) => shownWordings(e, track, retired);

  const visible = useMemo(() => {
    if (!bank) return [];
    const q = words(query);
    return bank.entries
      .filter((e) => retired || !e.retired)
      .map((e) => ({ e, vs: shownWordings(e, track, retired) }))
      .filter(({ e, vs }) => vs.length > 0
        && (!under || (lowest(vs) ?? NINE) < NINE)
        && (!q.length || q.every((w) => `${e.id} ${e.label} ${e.theme} ${e.fact} ${vs.map((v) => v.text).join(" ")}`.toLowerCase().includes(w))))
      // On a track, the bullets its tested resume prints come first.
      .sort((a, b) => (track === "all" ? 0 : Number(pinnedOn(b.vs, track)) - Number(pinnedOn(a.vs, track))));
  }, [bank, track, under, retired, query]);

  const stats = useMemo(() => {
    const live = (bank?.entries ?? []).filter((e) => !e.retired).flatMap((e) => e.variants.filter((v) => !v.retired));
    return { live: live.length, nine: live.filter((v) => (v.strength ?? 0) >= NINE).length };
  }, [bank]);
  const needs = visible.filter(({ vs }) => (lowest(vs) ?? NINE) < NINE).sort((a, b) => (lowest(a.vs) ?? 0) - (lowest(b.vs) ?? 0));
  const open = bank?.entries.find((e) => e.id === selected) ?? null;

  const card = (e: Entry, vs: Variant[], needs = false) => {
    const main = vs.find((v) => !v.tracks.length) ?? vs[0];
    const pins = [...new Map(vs.flatMap((v) => v.pinned).map((p) => [p.track, p])).values()];
    return (
      <button key={e.id} type="button" className={`bk-card ${selected === e.id ? "is-open" : ""} ${e.retired || main.retired ? "is-retired" : ""}`} onClick={() => setSelected(selected === e.id ? null : e.id)} aria-pressed={selected === e.id}>
        <span className="bk-card-top">
          <Score s={lowest(vs)} />
          <span className="bk-id">{e.id}</span>
          {columnOf(e.role) === "projects" ? <span className="bk-id">{e.label}</span> : null}
          {vs.length > 1 ? <span className="bk-id">{vs.length} wordings</span> : null}
        </span>
        <span className="bk-text">{main.text}</span>
        {needs && lowestNote(vs) ? <span className="bk-note">{lowestNote(vs)}</span> : null}
        {pins.length ? <span className="bk-pins">{pins.map((p) => <Track key={p.track} id={p.track} />)}</span> : null}
      </button>
    );
  };

  return (
    <div className="rv-page bk-page">
      {header}
      <div className="rv-bar bk-bar">
        <div className="rv-bar-title">
          <h1>Bank</h1>
          {bank ? <span className="apps-muted"><b className="bk-num">{stats.nine}</b> of <b className="bk-num">{stats.live}</b> wordings at 9+ · v{bank.version}</span> : null}
          {bank ? <span className="bk-meter" aria-hidden="true"><i style={{ width: `${(100 * stats.nine) / Math.max(stats.live, 1)}%` }} /></span> : null}
        </div>
        <div className="bk-filters">
          <div className="bk-pills" role="group" aria-label="Track">
            {["all", ...TRACKS].map((t) => (
              <button key={t} type="button" className={`bk-pill is-${t} ${track === t ? "is-on" : ""}`} aria-pressed={track === t} onClick={() => setTrack(t)}>{t === "all" ? "All" : TRACK_LABEL[t] ?? t}</button>
            ))}
          </div>
          <label className="bk-check"><input type="checkbox" checked={under} onChange={(e) => setUnder(e.target.checked)} /> Under 9</label>
          <label className="bk-check"><input type="checkbox" checked={retired} onChange={(e) => setRetired(e.target.checked)} /> Retired</label>
          <input ref={searchRef} className="bk-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search bullets  /" aria-label="Search bullets" autoComplete="off" spellCheck={false} />
        </div>
      </div>

      {error ? <div className="rv-main"><div className="rv-empty"><b>The bank didn't load.</b><span>{error}. Check that the resume server is running, then reload.</span></div></div>
        : !bank ? <div className="rv-main"><div className="rv-wait apps-muted">Loading the bank…</div></div>
        : (
          <div className={`bk-main ${open ? "has-detail" : ""}`}>
            <div className="bk-board">
              {needs.length ? (
                <section className="bk-needs" aria-label="Needs your input">
                  <header><h2>Needs your input</h2><span className="apps-muted">{needs.length} bullet{needs.length === 1 ? "" : "s"} under 9/10. Each needs a real number or result from you.</span></header>
                  <div className="bk-needs-row">{needs.slice(0, 4).map(({ e, vs }) => card(e, vs, true))}</div>
                </section>
              ) : null}
              <div className="bk-cols">
                {COLUMNS.map((c) => {
                  const list = visible.filter(({ e }) => columnOf(e.role) === c.id);
                  return (
                    <section key={c.id} className="bk-col" aria-label={c.label}>
                      <header><h3>{c.label}</h3><span className="bk-id">{list.length}</span></header>
                      <div className="bk-list">{list.length ? list.map(({ e, vs }) => card(e, vs)) : <p className="apps-muted bk-none">Nothing matches.</p>}</div>
                    </section>
                  );
                })}
              </div>
            </div>
            {open ? <Detail entry={open} show={shown(open)} onClose={() => setSelected(null)} /> : null}
          </div>
        )}
    </div>
  );
}

function Detail({ entry: e, show, onClose }: { entry: Entry; show: Variant[]; onClose: () => void }) {
  const hidden = e.variants.length - show.length;
  return (
    <aside className="bk-detail" aria-label={`${e.id} details`}>
      <header>
        <div>
          <h2>{e.label}</h2>
          <p className="apps-muted"><span className="bk-id">{e.id}</span> · {e.kind} · {theme(e)}{e.retired ? " · retired" : ""}</p>
        </div>
        <button type="button" className="bk-close" onClick={onClose} aria-label="Close">×</button>
      </header>
      <div className="bk-fact">
        <span className="bk-label">Fact behind it</span>
        <p>{e.fact || "No fact written for this entry yet."}</p>
        {e.confirmedAt ? <span className="bk-confirmed">Confirmed by you · {shortDate(e.confirmedAt)}</span> : null}
      </div>
      <span className="bk-label">Wordings{hidden > 0 ? ` (${hidden} more hidden by your filters)` : ""}</span>
      <div className="bk-variants">
        {show.map((v) => (
          <div key={v.facet} className={`bk-variant ${v.retired ? "is-retired" : ""}`}>
            <div className="bk-card-top">
              <Score s={v.strength} />
              {v.tracks.length ? v.tracks.map((t) => <span key={t} className="bk-tag">{TRACK_LABEL[t] ?? t} only</span>) : <span className="bk-tag">Every track</span>}
              <span className="bk-id">{v.facet}</span>
              {v.retired ? <span className="bk-id">retired</span> : null}
            </div>
            <p>{v.text}</p>
            {v.note ? <p className="bk-note">{v.note}</p> : null}
            {v.pinned.length ? <div className="bk-pins"><span className="apps-muted">Printed on</span>{v.pinned.map((p) => <Track key={`${p.track}-${p.set}`} id={p.track} set={p.set} />)}</div> : null}
          </div>
        ))}
      </div>
    </aside>
  );
}
