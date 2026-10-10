import { useEffect, useMemo, useRef, useState } from "react";
import { getTailorServerBase } from "../utils/tailorServer";
import { TRACK_LABEL } from "./tracks";
import "./review-pages.css";
import "./bank.css";

// Bank (/bank): every bullet in the resume bank on one screen. Five columns (Stony Brook, Wake Forest, Accolite,
// Atriveo, other projects) with "Needs your input" (wordings under 9/10) above them; click a card for its fact and
// every wording, with the tracks whose tested resume prints it. Edit a wording (the builder's rules and save), retire or
// restore one. Server: scripts/bank-page.mjs (GET /resume-builder/bank, POST bank-retire; edits: POST check and bullet).
// Design and phases: docs/bank-page.md.

interface Pin { track: string; set: string }
interface Variant { facet: string; text: string; strength: number | null; note: string | null; tracks: string[]; retired: boolean; pinned: Pin[]; edited: boolean; retiredHere: string | null }
interface Entry { id: string; role: string; label: string; kind: "experience" | "project"; theme: string; fact: string; confirmedAt: string | null; tracks: string[]; retired: boolean; retiredHere: string | null; yours: boolean; variants: Variant[] }
interface Bank { stale?: boolean; version: string; updatedAt: string | null; tracks: Array<{ id: string; label: string; hasSet: boolean }>; entries: Entry[] }

const TRACKS = ["software-engineer", "ai-engineer", "data-science", "data-analytics", "forward-deployed"];
/** One column each; every other project shares the last. */
const OWN_COLUMN: Record<string, string> = { "stony-brook": "Stony Brook", "wake-forest": "Wake Forest", accolite: "Accolite", atriveo: "Atriveo" };
const COLUMNS = [...Object.entries(OWN_COLUMN).map(([id, label]) => ({ id, label })), { id: "projects", label: "Projects" }];
const columnOf = (role: string) => (role in OWN_COLUMN ? role : "projects");
const NINE = 9;
async function call<T>(op: string, body?: object): Promise<T> {
  const res = await fetch(`${getTailorServerBase()}/resume-builder/${op}`, body ? { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "include", cache: "no-store" });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json as T;
}
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
    call<Bank>("bank").then((b) => { if (live) setBank(b); }, (e) => { if (live) setError(String(e.message || e)); });
    return () => { live = false; };
  }, []);
  const reload = () => call<Bank>("bank").then(setBank);
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
          {bank?.stale ? <span className="bk-stale" role="status">Your unsaved-to-git edits couldn't be loaded; showing the git bank.</span> : null}
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
            {open ? <Detail key={open.id} entry={open} track={track} onClose={() => setSelected(null)} onBank={setBank} reload={reload} /> : null}
          </div>
        )}
    </div>
  );
}

interface Edit { facet: string; text: string; issues: string[] | null; verbs: string[] }
interface Retire { facet: string | null; reason: string }

function Detail({ entry: e, track, onClose, onBank, reload }: { entry: Entry; track: string; onClose: () => void; onBank: (b: Bank) => void; reload: () => Promise<void> }) {
  // Retired wordings stay listed here (dimmed) so they can be restored; the track filter still applies.
  const show = e.variants.filter((v) => track === "all" || v.retired || onTrack(e, v, track));
  const hidden = e.variants.length - show.length;
  const [edit, setEdit] = useState<Edit | null>(null);
  const [retire, setRetire] = useState<Retire | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  // The builder's rules on what you type (nothing saved), a moment after you stop.
  useEffect(() => {
    if (!edit) return;
    const t = setTimeout(() => {
      call<{ issues: string[]; freeVerbs: string[] }>("check", { role: e.role, text: edit.text, acId: e.id })
        .then((r) => setEdit((x) => (x && x.text === edit.text ? { ...x, issues: r.issues, verbs: r.freeVerbs } : x)), () => {});
    }, 350);
    return () => clearTimeout(t);
  }, [edit?.text]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (what: () => Promise<unknown>, message: string) => {
    setBusy(true); setError("");
    try { await what(); setDone(message); setEdit(null); setRetire(null); } catch (err) { setError(String((err as Error).message || err)); } finally { setBusy(false); }
  };
  const save = () => edit && run(async () => { await call("bullet", { role: e.role, text: edit.text, mode: "reword", acId: e.id, facet: edit.facet }); await reload(); }, "Saved. Every future resume uses the new wording.");
  const doRetire = (facet: string | null, reason: string, restore = false) => run(async () => onBank(await call<Bank>("bank-retire", { acId: e.id, facet, reason, restore })),
    restore ? "Restored." : facet == null ? "Retired. No future resume uses this entry." : "Retired. No future resume uses this wording.");
  const pinnedSets = (vs: Variant[]) => [...new Set(vs.flatMap((v) => v.pinned).map((p) => TRACK_LABEL[p.track] ?? p.track))];
  const entryPins = pinnedSets(e.variants);
  const words = edit ? edit.text.trim().split(/\s+/).filter(Boolean).length : 0;

  return (
    <aside className="bk-detail" aria-label={`${e.id} details`}>
      <header>
        <div>
          <h2>{e.label}</h2>
          <p className="apps-muted"><span className="bk-id">{e.id}</span> · {e.kind} · {theme(e)}{e.yours ? " · yours" : ""}{e.retired ? " · retired" : ""}</p>
        </div>
        <button type="button" className="bk-close" onClick={onClose} aria-label="Close">×</button>
      </header>
      {error ? <p className="bk-error" role="alert">{error}</p> : done ? <p className="bk-done" role="status">{done}</p> : null}
      <div className="bk-fact">
        <span className="bk-label">Fact behind it</span>
        <p>{e.fact || "No fact written for this entry yet."}</p>
        {e.confirmedAt ? <span className="bk-confirmed">Confirmed by you · {shortDate(e.confirmedAt)}</span> : null}
      </div>
      <span className="bk-label">Wordings{hidden > 0 ? ` (${hidden} more hidden by your filters)` : ""}</span>
      <div className="bk-variants">
        {show.map((v) => {
          const editing = edit?.facet === v.facet;
          const retiring = retire?.facet === v.facet;
          return (
            <div key={v.facet} className={`bk-variant ${v.retired ? "is-retired" : ""}`}>
              <div className="bk-card-top">
                <Score s={v.strength} />
                {v.tracks.length ? v.tracks.map((t) => <span key={t} className="bk-tag">{TRACK_LABEL[t] ?? t} only</span>) : <span className="bk-tag">Every track</span>}
                <span className="bk-id">{v.facet}</span>
                {v.edited ? <span className="bk-tag is-edited" title="The score is the old wording's until it is re-scored">Edited · score is from before</span> : null}
                {v.retired ? <span className="bk-id">retired{v.retiredHere ? ` · ${v.retiredHere}` : ""}</span> : null}
              </div>
              {editing ? (
                <div className="bk-edit">
                  <textarea id={`bk-edit-${e.id}-${v.facet}`} aria-label="Wording" rows={4} value={edit.text} autoFocus
                    onChange={(ev) => setEdit({ ...edit, text: ev.target.value, issues: null })}
                    onKeyDown={(ev) => { if (ev.key === "Escape") { ev.stopPropagation(); setEdit(null); } }} />
                  <div className="bk-verdict">
                    <span className={`bk-words ${words && (words < 12 || words > 35) ? "is-off" : ""}`}>{words} words</span>
                    {edit.issues == null ? <span className="apps-muted">Checking…</span>
                      : !edit.issues.length ? <span className="bk-ok">Passes every bullet rule</span>
                      : <ul>{edit.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
                    {edit.issues?.some((i) => /already opens/.test(i)) && edit.verbs.length ? <span className="apps-muted">Free verbs: {edit.verbs.slice(0, 8).join(", ")}</span> : null}
                  </div>
                  <div className="bk-actions">
                    <button type="button" className="rv-primary" disabled={busy || !edit.issues || edit.issues.length > 0 || edit.text.trim() === v.text} onClick={() => void save()}>{busy ? "Saving…" : "Save wording"}</button>
                    <button type="button" className="bk-btn" onClick={() => setEdit(null)}>Cancel</button>
                  </div>
                </div>
              ) : <p>{v.text}</p>}
              {v.note && !editing ? <p className="bk-note">{v.note}</p> : null}
              {v.pinned.length ? <div className="bk-pins"><span className="apps-muted">Printed on</span>{v.pinned.map((p) => <Track key={`${p.track}-${p.set}`} id={p.track} set={p.set} />)}</div> : null}
              {retiring ? (
                <div className="bk-edit">
                  <input id={`bk-why-${e.id}-${v.facet}`} type="text" className="bk-search bk-why" placeholder="Why (optional), e.g. duplicate of AC-232" aria-label="Why retire it" value={retire.reason} onChange={(ev) => setRetire({ ...retire, reason: ev.target.value })} />
                  <div className="bk-actions">
                    <button type="button" className="bk-btn is-danger" disabled={busy} onClick={() => void doRetire(v.facet, retire.reason)}>Retire this wording</button>
                    <button type="button" className="bk-btn" onClick={() => setRetire(null)}>Cancel</button>
                  </div>
                </div>
              ) : !editing && !e.retired ? (
                <div className="bk-actions">
                  {!v.retired ? <button type="button" className="bk-btn" onClick={() => { setDone(""); setError(""); setRetire(null); setEdit({ facet: v.facet, text: v.text, issues: null, verbs: [] }); }}>Edit</button> : null}
                  {v.retiredHere != null ? <button type="button" className="bk-btn" disabled={busy} onClick={() => void doRetire(v.facet, "", true)}>Restore</button>
                    : !v.retired ? <button type="button" className="bk-btn" disabled={busy || v.pinned.length > 0} title={v.pinned.length ? `Printed on the ${pinnedSets([v]).join(", ")} resume: take it out of that set in TRACKS.yaml first` : undefined}
                        onClick={() => { setDone(""); setError(""); setEdit(null); setRetire({ facet: v.facet, reason: "" }); }}>Retire</button> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="bk-entry-actions">
        {e.retiredHere != null ? <button type="button" className="bk-btn" disabled={busy} onClick={() => void doRetire(null, "", true)}>Restore this entry</button>
          : e.retired ? <span className="apps-muted">Retired in git.</span>
          : retire?.facet === null ? (
            <div className="bk-edit">
              <input id={`bk-why-${e.id}`} type="text" className="bk-search bk-why" placeholder="Why (optional), e.g. duplicate of AC-232" aria-label="Why retire the entry" value={retire.reason} onChange={(ev) => setRetire({ ...retire, reason: ev.target.value })} />
              <div className="bk-actions">
                <button type="button" className="bk-btn is-danger" disabled={busy} onClick={() => void doRetire(null, retire.reason)}>Retire all {e.variants.length} wording{e.variants.length === 1 ? "" : "s"}</button>
                <button type="button" className="bk-btn" onClick={() => setRetire(null)}>Cancel</button>
              </div>
            </div>
          ) : <button type="button" className="bk-btn" disabled={busy || entryPins.length > 0} title={entryPins.length ? `Printed on the ${entryPins.join(", ")} resume: take it out of that set in TRACKS.yaml first` : undefined}
              onClick={() => { setDone(""); setError(""); setEdit(null); setRetire({ facet: null, reason: "" }); }}>Retire this entry</button>}
        {entryPins.length && !e.retired ? <span className="apps-muted">Printed on the {entryPins.join(", ")} resume, so it can't be retired here.</span> : null}
      </div>
    </aside>
  );
}
