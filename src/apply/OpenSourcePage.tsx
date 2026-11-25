import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "./review-pages.css";
import "./open-source.css";
import { Analytics, LevelBar, ReadyPie, RoleCharts } from "./OpenSourceCharts";
import { FITS, LEVELS, RATING, ROLES, SEGMENTS, call, countLevels, dateOf, day, heading, pool, prsOf, rank, remember, roleLabel, stars, suggest, verb, when, whose, type Bullet, type Coverage, type Pr, type Rating, type View } from "./openSource";

// Open source (/open-source): your pull requests in other people's repositories, synced from GitHub, next to the bank
// bullets that cite them. Board: what is covered and what is not. By resume: the section each general resume could
// print. Analytics: the counts. Server: scripts/open-source.mjs; design and rules: docs/open-source-page.md.

type Tab = "board" | "resume" | "analytics";
type PieFilter = { role: string; seg: string } | null;
const TABS: Array<[Tab, string]> = [["board", "Board"], ["resume", "By resume"], ["analytics", "Analytics"]];
const COLUMNS: Array<{ id: Coverage; label: string }> = [{ id: "todo", label: "Not covered" }, { id: "draft", label: "Draft ready" }, { id: "covered", label: "In the bank" }];

function Logo({ owner, name, personal, big }: { owner: string; name: string; personal?: boolean | null; big?: boolean }) {
  const [broken, setBroken] = useState(false);
  const cls = `os-logo${big ? " is-big" : ""}`;
  // A personal account's picture is usually a photo of someone, so those show a letter. NVIDIA's dsx-ai-factory shows NVIDIA.
  if (personal !== false || broken) return <span className={`${cls} is-letter`} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
  return <img className={cls} src={`https://github.com/${owner === "dsx-ai-factory" ? "NVIDIA" : owner}.png?size=72`} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}
const Rate = ({ rating, score }: { rating: Rating | null; score: number | null }) => rating ? <span className={`os-rate is-${rating}`}>{RATING[rating]}{rating === "closed" || score == null ? "" : ` ${score}`}</span> : <span className="os-rate is-none" title="Its size isn't known yet: sync with a GitHub token">Not rated</span>;
const Pills = <T extends string>({ label, items, value, onChange }: { label: string; items: Array<[T, string]>; value: T; onChange: (v: T) => void }) => (
  <div className="os-pills" role="group" aria-label={label}>{items.map(([v, l]) => <button key={v} type="button" className="os-pill" aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>)}</div>
);

function Card({ p, open, onOpen }: { p: Pr; open: boolean; onOpen: () => void }) {
  return (
    <button type="button" className={`os-card${open ? " is-open" : ""}`} onClick={onOpen}>
      <span className="os-head"><Logo owner={p.owner} name={whose(p)} personal={p.personal} /><span className="os-who"><b>{whose(p)}</b><span className="os-mono">{p.id}</span></span></span>
      <span className="os-title">{p.title}</span>
      <span className="os-meta"><span className={`is-${p.state}`}>{when(p)}</span><span>{stars(p.stars)}</span><span>{p.lang}</span>{p.bullets.length ? <span>{p.bullets.join(", ")}</span> : null}{p.shared ? <span>shared</span> : null}<Rate rating={p.rating} score={p.score} /></span>
    </button>
  );
}

function Detail({ p, view, onView, onClose, pie }: { p: Pr; view: View; onView: (v: View) => void; onClose: () => void; pie: React.ReactNode }) {
  const [rating, setRating] = useState(p.ratedByYou ? p.rating : null);
  const [text, setText] = useState(p.text);
  const [fits, setFits] = useState(p.fits);
  const [issues, setIssues] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const inBank = p.bullets.length > 0;
  const closed = p.state === "CLOSED";
  // The bank's bullet rules on what you type, a moment after you stop (nothing saved).
  useEffect(() => {
    setIssues(null);
    if (inBank || !text.trim()) return;
    const t = setTimeout(() => { call<{ issues: string[] }>("oss-check", { text }).then((r) => setIssues(r.issues), () => {}); }, 400);
    return () => clearTimeout(t);
  }, [text, inBank]);
  const run = async (what: () => Promise<View>, done: string) => {
    setBusy(true); setNote(null);
    try { onView(await what()); setNote({ text: done }); } catch (e) { setNote({ text: String((e as Error).message || e), bad: true }); } finally { setBusy(false); setConfirm(false); }
  };
  const PARTS: Array<[string, "recognition" | "size" | "proof" | "status", number]> = [["Recognition", "recognition", 3], ["Size", "size", 3], ["Proof", "proof", 2], ["Status", "status", 2]];
  return (
    <aside className="os-detail" aria-label={`${p.id} details`}>
      <div className="os-head"><Logo owner={p.owner} name={whose(p)} personal={p.personal} big /><span className="os-who"><b>{whose(p)}</b><span className="os-mono">{p.id}</span></span><button type="button" className="os-btn" onClick={onClose}>Close</button></div>
      <h2>{p.title}</h2>
      <div className="os-meta"><span className={`is-${p.state}`}>{when(p)}</span>{p.state !== "OPEN" && p.openedAt ? <span>Opened {day(p.openedAt)}</span> : null}<span>{stars(p.stars)}</span><span>{p.lang}</span>{p.add != null ? <span>+{p.add} lines</span> : null}<a href={p.url} target="_blank" rel="noopener noreferrer">Open on GitHub</a></div>
      {p.parts ? <div className="os-parts">{PARTS.map(([l, k, max]) => <div key={k}><span>{l}</span><i>{Array.from({ length: max }, (_, i) => <s key={i} className={i < p.parts![k] ? "is-on" : ""} />)}</i><span>{p.parts![k]}/{max}</span></div>)}</div> : null}
      {p.shared ? <p className="os-warn">The maintainers wrote part of this pull request. Claim only your own commits.</p> : null}
      {closed ? <p className="os-warn">Closed without merging, so it can't go on a resume.</p> : null}
      {!closed ? <label className="os-field">Rating
        <select value={rating ?? "auto"} onChange={(e) => setRating(e.target.value === "auto" ? null : (e.target.value as Rating))}>
          <option value="auto">{p.autoRating ? `${RATING[p.autoRating]}, computed` : "Not rated yet"}</option>
          {LEVELS.map((l) => <option key={l} value={l}>{RATING[l]}, set by you</option>)}
        </select></label> : null}
      {inBank ? <div className="os-field"><span>In the bank as {p.bullets.join(", ")} · <Link to="/bank">edit on Bank</Link></span><p className="os-wording">{p.text}</p></div>
        : <label className="os-field">Resume bullet<textarea value={text} readOnly={closed} rows={4} placeholder="Write the bullet, or leave it empty" onChange={(e) => setText(e.target.value)} /></label>}
      {inBank ? null : issues?.length ? <ul className="os-issues">{issues.map((i) => <li key={i}>{i}</li>)}</ul> : issues ? <p className="os-ok">Passes every bullet rule</p> : null}
      <div className="os-field" role="group" aria-label="Fits">Fits<div className="os-pills">{FITS.map((f) => <button key={f} type="button" className="os-pill" disabled={inBank} aria-pressed={fits.includes(f)} onClick={() => setFits(fits.includes(f) ? fits.filter((x) => x !== f) : [...fits, f])}>{f}</button>)}</div></div>
      <div className="os-acts">
        <button type="button" className="os-btn is-main" disabled={busy || closed} onClick={() => run(() => call<View>("oss-save", { id: p.id, rating, ...(inBank ? {} : { text, fits }) }), "Saved")}>Save</button>
        {!closed ? <button type="button" className="os-btn" disabled={busy} onClick={() => run(() => call<View>("oss-save", { id: p.id, skip: p.coverage !== "skipped" }), p.coverage === "skipped" ? "Restored" : "Skipped")}>{p.coverage === "skipped" ? "Restore" : "Skip"}</button> : null}
        {p.coverage === "deleted" ? <button type="button" className="os-btn" disabled={busy} onClick={() => run(() => call<View>("oss-delete", { id: p.id, restore: true }), "Back on the page")}>Bring back</button>
          : <button type="button" className="os-btn is-danger" disabled={busy} onClick={() => (confirm ? run(() => call<View>("oss-delete", { id: p.id }), "Deleted") : setConfirm(true))}>{confirm ? "Delete it?" : "Delete"}</button>}
        {note ? <span className={note.bad ? "os-warn" : "os-ok"} role={note.bad ? "alert" : "status"}>{note.text}</span> : null}
      </div>
      {view.bullets.length ? pie : null}
    </aside>
  );
}

function ByResume({ view, role, setRole, drafts, setDrafts }: { view: View; role: string; setRole: (r: string) => void; drafts: boolean; setDrafts: (v: boolean) => void }) {
  const [picks, setPicks] = useState<Record<string, string[]>>(() => remember.get("os-picks", {}));
  const [slot, setSlot] = useState(2);
  const [show, setShow] = useState<"ready" | "open" | "all">("ready");
  const [hit, setHit] = useState("");
  const [copied, setCopied] = useState("");
  const sheet = useRef<HTMLDivElement>(null);
  const list = useMemo(() => pool(view, role, drafts), [view, role, drafts]);
  const best = useMemo(() => suggest(view, role, drafts), [view, role, drafts]);
  const byId = useMemo(() => new Map(view.bullets.map((b) => [b.id, b])), [view]);
  const picked = (picks[role] ?? []).map((i) => byId.get(i)).filter((b): b is Bullet => !!b);
  const lines = picked.length ? picked : best;
  const at = Math.min(slot, Math.max(0, lines.length - 1));
  const master = (view.masters[role] ?? []).filter((i) => byId.has(i));
  const same = (a: string[]) => a.length > 0 && lines.map((b) => b.id).join() === a.join();
  const isBest = same(best.map((b) => b.id)), isMaster = same(master);
  const ready = list.filter((b) => b.ready);
  const clash = lines.map(verb).find((v, i, a) => a.indexOf(v) !== i);
  const weak = lines.filter((b) => !b.ready);
  const keep = (ids: string[] | null) => { const next = { ...picks }; if (ids) next[role] = ids; else delete next[role]; setPicks(next); remember.set("os-picks", next); };
  const use = (id: string) => { const ids = lines.map((b) => b.id); ids[lines.length < 3 ? lines.length : at] = id; keep(ids); };
  const h = heading(lines);
  const message = clash ? `Two bullets start with ${clash}. Swap one.` : weak.length ? `${weak.map((b) => b.id).join(", ")} is ${!weak[0].merged ? "still an open PR" : weak[0].shared ? "shared work" : "not rated Good"}.` : isMaster ? "This is what your master prints today." : isBest ? "Suggested three, highest rated with different opening verbs." : "Your own selection, saved in this browser.";
  const others = list.filter((b) => !lines.includes(b));
  const shown = others.filter((b) => show === "all" || (show === "ready" ? b.ready : !b.merged)).sort((a, b) => Number(b.ready) - Number(a.ready) || rank(role)(a, b));
  const verdict = !ready.length ? "No open source for this resume." : ready.length >= 10 && ready.filter((b) => b.rating === "impressive").length >= 4 ? "Strong. You can pick and choose." : ready.length >= 6 ? "Solid. Enough for a general resume." : "Thin. One or two more merged PRs would help.";
  const pick = (r: string) => { setRole(r); setSlot(2); setHit(""); };
  useEffect(() => { if (hit) document.getElementById(`os-b-${hit}`)?.scrollIntoView({ block: "nearest" }); }, [hit, show]);
  const copy = async () => {
    try { await navigator.clipboard.writeText([`${h.name}${h.tools ? ` | ${h.tools}` : ""}`, ...lines.map((b) => `• ${b.text}`)].join("\n")); setCopied("Copied"); }
    catch { const r = document.createRange(); if (sheet.current) { r.selectNodeContents(sheet.current); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r); } setCopied("Selected, press copy"); }
    setTimeout(() => setCopied(""), 1600);
  };
  const owner = (b: Bullet) => view.prs.find((p) => p.id === b.prs[0]);
  return (
    <div className="os-roles">
      <div className="os-rcards">{ROLES.map((r) => { const p = pool(view, r.id, drafts); return (
        <button key={r.id} type="button" className="os-rcard" aria-pressed={r.id === role} style={{ "--c": r.hue } as React.CSSProperties} onClick={() => pick(r.id)}>
          <span className="os-rn"><i />{r.label}</span><span className="os-rv"><b>{p.filter((b) => b.ready).length}</b><span>ready of {p.length}</span></span><LevelBar counts={countLevels(p)} />
        </button>); })}</div>
      {!list.length ? <div className="os-empty"><h2>{roleLabel(role)}</h2><p>None of your open source work fits this resume, so it prints none.</p></div> : (
        <div className="os-rmain">
          <div className="os-rleft">
            <div className="os-rhead"><h2>{roleLabel(role)}</h2><span>{verdict}</span></div>
            {lines.length ? <div className="os-sheet" ref={sheet}><div className="os-sec">Projects</div><div className="os-ph"><span><b>{h.name}</b>{h.tools ? ` | ${h.tools}` : ""}</span><span>November 2026 – Present</span></div>
              {lines.map((b, i) => <button key={b.id} type="button" className="os-slot" aria-pressed={i === at} onClick={() => setSlot(i)}><span>•</span><span>{b.text}</span><span className="os-slot-t">{i === at ? "Replacing this" : ""}</span></button>)}</div> : <p className="os-note">Nothing is ready yet. Pick one on the right.</p>}
            <div className="os-acts">
              {lines.length ? <button type="button" className="os-btn is-main" onClick={() => void copy()}>{copied || "Copy section"}</button> : null}
              {!isBest && best.length ? <button type="button" className="os-btn" onClick={() => keep(null)}>Use suggested three</button> : null}
              {master.length && !isMaster ? <button type="button" className="os-btn" onClick={() => keep(master)}>Show what my master prints</button> : null}
              {lines.length ? <span className={clash || weak.length ? "os-warn" : "os-note"}>{message}</span> : null}
            </div>
            <div className="os-wall"><h3>All {list.length} bullets, best first</h3>
              <div className="os-tiles">{[...list].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || Number(b.merged) - Number(a.merged)).map((b) => { const n = lines.indexOf(b); return <button key={b.id} type="button" className={`os-tile is-${b.rating ?? "none"}${b.merged ? "" : " is-open"}${n >= 0 ? " is-in" : ""}`} title={`${b.project}, ${b.rating ? `${RATING[b.rating].toLowerCase()} ${b.score}` : "not rated"}, ${b.merged ? "merged" : "open"}`} onClick={() => { if (n >= 0) setSlot(n); else { setShow(b.ready ? "ready" : "all"); setHit(b.id); } }}>{b.score ?? "–"}</button>; })}</div>
              <div className="os-key"><span><i className="os-f-impressive" />Impressive, 8 and up</span><span><i className="os-f-good" />Good, 6 or 7</span><span><i className="os-f-average" />Average</span><span><i className="os-f-outline" />Open PR</span><span><i className="os-f-in" />In the section above</span></div></div>
            <RoleCharts view={view} role={role} bullets={list} />
          </div>
          <div className="os-bench">
            <div className="os-bench-t"><h3>Swap in another bullet</h3><div className="os-pills">
              {([["ready", "Ready"], ["open", "Open PRs"], ["all", "All"]] as const).map(([v, l]) => <button key={v} type="button" className="os-pill" aria-pressed={v === show} onClick={() => setShow(v)}>{l} {others.filter((b) => v === "all" || (v === "ready" ? b.ready : !b.merged)).length}</button>)}
              <button type="button" className="os-pill" aria-pressed={drafts} onClick={() => setDrafts(!drafts)}>Include drafts</button></div></div>
            <div className="os-blist">{shown.length ? shown.map((b) => { const pr = owner(b), dup = lines.some((x, i) => i !== at && verb(x) === verb(b)), name = b.org && !b.project.includes(b.org) ? `${b.org} ${b.project}` : b.project; return (
              <div key={b.id} id={`os-b-${b.id}`} className={`os-bl${b.id === hit ? " is-hit" : ""}`}>
                <div className="os-head"><Logo owner={pr?.owner ?? ""} name={name} personal={pr?.personal ?? true} /><span className="os-who"><b>{name}</b><span className="os-mono">{b.source === "draft" ? "" : `${b.id} `}{b.prs.map((id) => { const x = view.prs.find((q) => q.id === id); return x ? <a key={id} href={x.url} target="_blank" rel="noopener noreferrer">#{x.n}</a> : null; })}</span></span>
                  <button type="button" className="os-btn" onClick={() => use(b.id)}>{lines.length < 3 ? "Add" : `Use as line ${at + 1}`}</button></div>
                <span className="os-title">{b.text}</span>
                <span className="os-meta"><span className={b.merged ? "is-MERGED" : "is-OPEN"}>{b.merged ? "Merged" : "Open"}</span>{b.source === "draft" ? <span className="os-tag">Draft</span> : null}{master.includes(b.id) ? <span className="os-tag">On the master</span> : null}{b.shared ? <span className="os-tag">Shared work</span> : null}{dup ? <span className="os-tag">Also starts with {verb(b)}</span> : null}<Rate rating={b.rating} score={b.score} /></span>
              </div>); }) : <p className="os-note">Nothing else here. Try All.</p>}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function AddDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (v: View & { id: string }) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError("");
    try { onAdded(await call<View & { id: string }>("oss-add", { url: f.get("url"), title: f.get("title"), state: f.get("state"), date: f.get("date") || null })); } catch (err) { setError(String((err as Error).message || err)); setBusy(false); }
  };
  return (
    <dialog ref={ref} className="os-dialog" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        <h2>Add a pull request</h2>
        <p className="os-note">For one the sync can't find, such as from another account.</p>
        <label className="os-field">GitHub link<input name="url" required placeholder="https://github.com/owner/repo/pull/123" /></label>
        <label className="os-field">Title<input name="title" required maxLength={200} /></label>
        <label className="os-field">Status<select name="state"><option value="MERGED">Merged</option><option value="OPEN">Open</option></select></label>
        <label className="os-field">Date merged or opened<input name="date" type="date" /></label>
        {error ? <p className="os-warn" role="alert">{error}</p> : null}
        <div className="os-acts"><button className="os-btn is-main" disabled={busy}>Add PR</button><button type="button" className="os-btn" onClick={onClose}>Cancel</button></div>
      </form>
    </dialog>
  );
}

export default function OpenSourcePage({ header }: { header?: React.ReactNode }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>(() => remember.get<Tab>("os-tab", "board"));
  const [role, setRole] = useState("AI");
  const [drafts, setDrafts] = useState(true);
  const [status, setStatus] = useState<"all" | "MERGED" | "OPEN" | "CLOSED">("all");
  const [level, setLevel] = useState<"all" | (typeof LEVELS)[number]>("all");
  const [sort, setSort] = useState<"score" | "date">("score");
  const [query, setQuery] = useState("");
  const [pie, setPie] = useState<PieFilter>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [gone, setGone] = useState<boolean>(() => remember.get("os-gone", false));
  const [adding, setAdding] = useState(false);
  const [syncNote, setSyncNote] = useState("");
  const go = (t: Tab) => { setTab(t); remember.set("os-tab", t); };
  const load = useCallback(() => call<View>("oss"), []);
  useEffect(() => { let live = true; load().then((v) => { if (live) { setView(v); setSelected((s) => s ?? v.prs.filter((p) => p.state === "MERGED").sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]?.id ?? null); } }, (e) => { if (live) setError(String(e.message || e)); }); return () => { live = false; }; }, [load]);
  // While a sync runs (yours or the hourly one), look again until it ends.
  useEffect(() => {
    if (!view?.syncing) return;
    const was = view.sync?.at;
    const t = setTimeout(() => { load().then((v) => {
      setView(v);
      if (v.syncing) return;
      setSyncNote(v.sync?.error ? `Sync failed. ${v.sync.error}` : v.sync?.at === was ? "" : `${v.sync?.added?.length ?? 0} new, ${v.sync?.changed?.length ?? 0} changed status`);
    }, () => {}); }, 3000);
    return () => clearTimeout(t);
  }, [view, load]);
  const sync = async () => { setSyncNote(""); try { await call("oss-sync", {}); setView((v) => (v ? { ...v, syncing: true } : v)); } catch (e) { setSyncNote(String((e as Error).message || e)); } };

  const top = <div className="os-top"><h1>Open source</h1><div className="os-pills" role="group" aria-label="View">{TABS.map(([t, l]) => <button key={t} type="button" className="os-pill" aria-pressed={t === tab} onClick={() => go(t)}>{l}</button>)}</div>
    {view ? <Numbers view={view} /> : null}
    <span className="os-grow" />
    <span className="os-synced" role="status">{view?.syncing ? "Syncing…" : syncNote || (view?.sync?.error ? `Last sync failed. ${view.sync.error}` : view?.sync?.at ? `Synced ${new Date(view.sync.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${view.sync.full === false ? ", status only" : ""}` : "")}</span>
    <button type="button" className="os-btn" onClick={() => setAdding(true)}>Add PR</button><button type="button" className="os-btn is-main" disabled={!view || view.syncing} onClick={() => void sync()}>Sync from GitHub</button></div>;

  if (!view) return <div className="rv-page os-page">{header}<main className="os-main">{top}{error ? <p className="os-warn" role="alert">{error}</p> : <p className="os-note" aria-busy="true">Loading your pull requests…</p>}</main></div>;

  const seg = pie ? SEGMENTS.find((s) => s.id === pie.seg) : null;
  const only = pie ? new Set(prsOf(view, pool(view, pie.role, true).filter(seg!.has)).map((p) => p.id)) : null;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const list = view.prs.filter((p) => (status === "all" || p.state === status) && (level === "all" || p.rating === level) && (!only || only.has(p.id))
    && words.every((w) => `${p.id} ${p.title} ${p.lang ?? ""} ${p.company ?? ""} ${p.bullets.join(" ")}`.toLowerCase().includes(w)))
    .sort((a, b) => (sort === "date" ? dateOf(b).localeCompare(dateOf(a)) : 0) || (b.score ?? -1) - (a.score ?? -1) || dateOf(b).localeCompare(dateOf(a)));
  const away = list.filter((p) => p.coverage === "skipped" || p.coverage === "closed" || p.coverage === "deleted");
  const showGone = gone || status === "CLOSED";
  const toggle = (v: boolean) => { setGone(v); remember.set("os-gone", v); if (!v && status === "CLOSED") setStatus("all"); };
  const current = view.prs.find((p) => p.id === selected) ?? null;
  const build = (r: string) => { setRole(r); go("resume"); };
  const column = (label: string, items: Pr[], extra?: React.ReactNode) => <section className="os-col" key={label}><h2>{label}<span>{items.length}{extra}</span></h2><div className="os-list">{items.length ? items.map((p) => <Card key={p.id} p={p} open={p.id === selected} onOpen={() => setSelected(p.id)} />) : <p className="os-note">{!view.prs.length ? "Sync from GitHub to fill the board." : label === "Draft ready" ? "No drafts. Open a pull request and write its bullet." : "Nothing here with these filters."}</p>}</div></section>;

  return (
    <div className="rv-page os-page">
      {header}
      <main className="os-main">
        {top}
        {tab === "analytics" ? <Analytics view={view} drafts={drafts} setDrafts={setDrafts} onRole={build} /> : tab === "resume" ? <ByResume view={view} role={role} setRole={setRole} drafts={drafts} setDrafts={setDrafts} /> : (
          <>
            <div className="os-filters">
              <Pills label="Status" value={status} onChange={setStatus} items={[["all", "All"], ["MERGED", "Merged"], ["OPEN", "Open"], ["CLOSED", "Closed"]]} />
              <Pills label="Rating" value={level} onChange={setLevel} items={[["all", "Any rating"], ["impressive", "Impressive"], ["good", "Good"], ["average", "Average"]]} />
              <Pills label="Sort" value={sort} onChange={setSort} items={[["score", "Best first"], ["date", "Newest first"]]} />
              {pie ? <button type="button" className="os-pill" aria-pressed="true" aria-label="Clear resume filter" onClick={() => setPie(null)}>{pie.role === "ALL" ? "" : `${pie.role}, `}{seg!.label.toLowerCase()} ×</button> : null}
              <input type="search" aria-label="Search" placeholder="Repo, title or language" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className={`os-board${current ? " has-detail" : ""}`}>
              <div className={`os-cols${showGone ? " is-wide" : ""}`}>
                {COLUMNS.map((c) => column(c.label, list.filter((p) => p.coverage === c.id)))}
                {showGone ? column("Skipped or closed", away, <button type="button" className="os-hide" onClick={() => toggle(false)}>Hide</button>)
                  : <button type="button" className="os-rail" aria-expanded="false" title="Show skipped and closed" onClick={() => toggle(true)}><span>{away.length}</span><span className="os-rail-l">Skipped or closed</span></button>}
              </div>
              {current ? <Detail key={`${current.id}:${current.rating}:${current.coverage}`} p={current} view={view} onView={setView} onClose={() => setSelected(null)} pie={<ReadyPie view={view} filter={pie} onFilter={setPie} onBuild={build} />} /> : null}
            </div>
          </>
        )}
      </main>
      {adding ? <AddDialog onClose={() => setAdding(false)} onAdded={(v) => { setView(v); setSelected(v.id); setAdding(false); go("board"); }} /> : null}
    </div>
  );
}

function Numbers({ view }: { view: View }) {
  const prs = view.prs.filter((p) => p.coverage !== "deleted"), merged = prs.filter((p) => p.state === "MERGED");
  return <div className="os-nums"><span><b>{merged.length}</b> merged</span><span><b>{prs.filter((p) => p.state === "OPEN").length}</b> open</span><span><b>{merged.filter((p) => p.coverage === "covered").length}</b> of {merged.length} merged in the bank</span><span><b>{prs.filter((p) => p.rating === "impressive" && p.coverage === "todo").length}</b> impressive, not covered</span></div>;
}
