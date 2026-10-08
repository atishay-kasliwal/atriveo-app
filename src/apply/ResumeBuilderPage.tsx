import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getTailorServerBase } from "../utils/tailorServer";
import { TRACK_LABEL } from "./tracks";
import ResumeLivePreview, { sbTitle, type Layout, type LiveFit, type PageTarget } from "./ResumeLivePreview";
import "./resume-builder.css";

// Resume builder (/resume_builder): edit a resume's content (bullets, title, skills); the template never changes.
// Opens a Today card's resume (?app=<application id> or ?job=<job url>) or a track's general resume (?track=…).
// Design and decisions: docs/resume-builder.md. Server: scripts/resume-builder.mjs (/resume-builder/* routes).
// Desktop: the editor on the left, the whole page on the right, linked both ways (hover, click). Phones: the page
// only; tap a line to edit it in a sheet.

/** custom: your wording for this resume only (not in the bank). */
interface Bullet { ac_id: string; facet: string | null; text: string; custom?: boolean }
/** The tools line after the name ("Atriveo | FastAPI, Docker…"): stack = yours. null: a project's is picked from its
 *  bullets (stackAuto); an employer prints none, and stackAuto is only offered as a suggestion. */
interface Section { role: string; kind: "experience" | "project"; label: string; bullets: Bullet[]; stack?: string[] | null; stackAuto?: string[] }
type Source = { kind: "job"; jobUrl: string; company: string; title: string; location: string | null } | { kind: "track"; track: string; company: string; title: string; location: null }
  | { kind: "pasted"; pasted: string; company: string; title: string; location: string | null };
/** A resume built from a job description you pasted (standalone: not a job, not on Today). */
interface Pasted { id: string; company: string; title: string; location: string | null; edited: boolean; createdAt: string; updatedAt: string; pdfPath: string | null }
interface Loaded {
  source: Source; headerTitle: string | null; email: string; city: string; skills: string[]; sections: Section[];
  options: Record<string, Bullet[]>; roles: Array<{ role: string; kind: "experience" | "project"; label: string }>;
  current: { pdfPath: string; edited: boolean; generatedPdfPath: string | null; pages?: number | null; room?: number | null }; jd: string | null; layout: Layout;
}
interface Draft { draftId: string; pdfPath: string; pages: number | null; room?: number | null; problems: string[]; jdMatch: { before: number | null; after: number | null; missing: string[] } | null; stacks?: Record<string, string[]> }
/** Writing a bullet: rewording one (bi) or a new one (bi = -1, inserted at `at`) in section si. */
interface Writing { si: number; bi: number; at?: number; text: string; issues: string[] | null; verbs: string[]; busy: boolean; error: string }
/** The bullet picker: add to a section (at a place), or swap bullet bi for another. */
interface Picker { si: number; mode: "add" | "swap"; bi: number; tab: "bank" | "write"; q: string }
/** What undo restores. */
interface Snapshot { title: string; email: string; city: string; skills: string; sections: Section[] }

const GENERAL = ["software-engineer", "ai-engineer", "data-analytics", "data-science", "forward-deployed"];
const base = () => `${getTailorServerBase()}/resume-builder`;
async function call<T>(path: string, body?: object): Promise<T> {
  const res = await fetch(`${base()}/${path}`, body ? { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "include", cache: "no-store" });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json as T;
}
const pdfUrl = (p: string, dl = false) => `${getTailorServerBase()}/serve-pdf?path=${encodeURIComponent(p)}${dl ? "&dl=1" : ""}`;
const verb = (t: string) => (t.trim().match(/^([A-Za-z]+)/)?.[1] ?? "").toLowerCase();
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
/** The bullet's text with its opening verb set apart (the verb is what the rules and a reader look at first). */
const Text = ({ t }: { t: string }) => { const m = t.match(/^(\s*[A-Za-z]+)(.*)$/s); return m ? <><b className="rb-verb">{m[1]}</b>{m[2]}</> : <>{t}</>; };

const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };

/** The start screen: paste a job description to build a resume for it, your pasted resumes, the general ones. */
function StartScreen() {
  const navigate = useNavigate();
  const [jd, setJd] = useState("");
  const [fields, setFields] = useState({ company: "", title: "", location: "" });
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState("");
  const [list, setList] = useState<Pasted[] | null>(null);
  const refresh = useCallback(() => { call<{ resumes: Pasted[] }>("pasted").then((r) => setList(r.resumes), () => setList([])); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  // A first guess at company, title and location from the text; never over what you typed.
  useEffect(() => {
    if (jd.trim().length < 80) return;
    const t = setTimeout(() => {
      call<{ company: string; title: string; location: string }>("guess", { jd }).then((g) => setFields((f) => ({
        company: touched.has("company") ? f.company : g.company, title: touched.has("title") ? f.title : g.title, location: touched.has("location") ? f.location : g.location,
      })), () => {});
    }, 400);
    return () => clearTimeout(t);
  }, [jd]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof fields, v: string) => { setFields((f) => ({ ...f, [k]: v })); setTouched((t) => new Set(t).add(k)); };
  const tooShort = jd.trim().length < 300;
  const build = async () => {
    setBuilding(true); setError("");
    try { const r = await call<{ source: { pasted: string } }>("start", { jd, ...fields }); navigate(`/resume_builder?pasted=${r.source.pasted}`); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBuilding(false); }
  };
  const remove = async (p: Pasted) => {
    if (!window.confirm(`Delete the ${p.company} resume? This can't be undone.`)) return;
    try { await call("delete", { id: p.id }); refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="rb-start">
      <header className="rb-start-heading"><span className="rb-eyebrow">YOUR NEXT APPLICATION</span><h1>A resume for your next role.</h1><p>Build from a job description, or start with one of your general resumes.</p></header>
      <section className="rb-paste" aria-label="Start from a job description">
        <div className="rb-section-heading"><span className="rb-step" aria-hidden="true">01</span><div><h2>Start with a job description</h2><p>Paste the posting. Make it yours.</p></div></div>
        <p className="apps-muted">We’ll choose relevant experience and skills for this role. You can review and edit your resume before downloading.</p>
        <label className="rb-jd-label" htmlFor="rb-job-description">Job description</label><textarea id="rb-job-description" rows={8} value={jd} disabled={building} placeholder="Paste the whole job description: title, company, responsibilities, requirements…" onChange={(e) => setJd(e.target.value)} />
        <div className="rb-paste-fields">
          <label><span>Company</span><input value={fields.company} disabled={building} placeholder="e.g. Acme" onChange={(e) => set("company", e.target.value)} /></label>
          <label><span>Role title</span><input value={fields.title} disabled={building} placeholder="e.g. Software Engineer" onChange={(e) => set("title", e.target.value)} /></label>
          <label><span>Location <small>Optional</small></span><input value={fields.location} disabled={building} placeholder="City, ST (optional)" onChange={(e) => set("location", e.target.value)} /></label>
        </div>
        <div className="rb-paste-acts">
          <button className="rv-primary" disabled={building || tooShort || !fields.title.trim()} onClick={() => void build()}>{building ? "Building your resume…" : "Build my resume →"}</button>
          <span className="apps-muted">{building ? "Choosing bullets and compiling: usually under half a minute." : tooShort && jd.trim() ? "Add at least 300 characters from the posting." : !fields.title.trim() && !tooShort ? "Add the role title." : "Your resume stays here, separate from Today."}</span>
        </div>
        {error && <p className="td-error" role="alert">{error}</p>}
      </section>
      {list && list.length > 0 && <section aria-label="Your resumes">
        <h2>Your resumes</h2>
        <ul className="rb-list">{list.map((p) => (
          <li key={p.id}>
            <Link to={`/resume_builder?pasted=${p.id}`} className="rb-list-main"><b>{p.company}</b><span>{p.title}{p.location ? ` · ${p.location}` : ""}</span></Link>
            <span className="rb-list-meta">{when(p.updatedAt || p.createdAt)}{p.edited ? " · edited" : ""}</span>
            <span className="rb-list-acts">
              <Link className="apps-btn" to={`/resume_builder?pasted=${p.id}`}>Edit</Link>
              {p.pdfPath && <a className="apps-btn" href={pdfUrl(p.pdfPath, true)}>Download</a>}
              <button className="apps-link rb-del" onClick={() => void remove(p)}>Delete</button>
            </span>
          </li>
        ))}</ul>
      </section>}
      <section className="rb-general" aria-label="General resumes">
        <div className="rb-section-heading"><span className="rb-step" aria-hidden="true">02</span><div><h2>Start with a general resume</h2><p>Choose your track to review and edit.</p></div></div>
        <p className="apps-muted">For a resume from Today, open its card and choose Resume → Edit.</p>
        <div className="rb-tracks">{GENERAL.map((t) => <Link key={t} className={`rb-track tr-${t}`} to={`/resume_builder?track=${t}`}><i /><strong>{TRACK_LABEL[t]}</strong><span>Edit resume <b aria-hidden="true">↗</b></span></Link>)}</div>
      </section>
    </div>
  );
}

function useMedia(q: string) {
  const [on, setOn] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => { const m = window.matchMedia(q); const f = () => setOn(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, [q]);
  return on;
}

export default function ResumeBuilderPage({ header }: { header?: React.ReactNode }) {
  const [params] = useSearchParams();
  const query = ["app", "job", "track", "pasted"].map((k) => params.get(k) ? `${k}=${encodeURIComponent(params.get(k)!)}` : null).find(Boolean) ?? null;
  const phone = useMedia("(max-width: 900px)");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  // What you're typing in a tools box (kept as typed, so commas stay while you type).
  const [stackText, setStackText] = useState<Record<string, string>>({});
  const [editingTools, setEditingTools] = useState<string | null>(null);
  const [skills, setSkills] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rendering, setRendering] = useState(false);
  const [draftOf, setDraftOf] = useState<unknown>(null); // the edit the draft was compiled from
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  // Live: the HTML preview (instant, Paged.js); PDF: the compiled file that is sent.
  const [view, setView] = useState<"live" | "pdf">("live");
  const [fit, setFit] = useState<LiveFit | null>(null);
  const [writing, setWriting] = useState<Writing | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  // Phones: the sheet for what you tapped on the page (or the ⋯ menu).
  const [sheet, setSheet] = useState<PageTarget | { kind: "menu" } | null>(null);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  // The bullet under the pointer, on either side ("si:bi"), and one to flash after a click on the page.
  const [hover, setHover] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ si: number; bi: number; armed: boolean; over: number | null } | null>(null);
  const history = useRef<Snapshot[]>([]);
  const squeezeRef = useRef(false);
  const [, setHistoryLen] = useState(0);
  const titleRef = useRef<HTMLInputElement>(null);
  const skillsRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    if (!query) return;
    setError(""); setLoaded(null); setDraft(null); setDirty(false); setWriting(null); setPicker(null); setSheet(null);
    history.current = []; setHistoryLen(0);
    try {
      const r = await call<Loaded>(`load?${query}`);
      setStackText({}); setLoaded(r); setTitle(r.headerTitle ?? ""); setEmail(r.email); setCity(r.city); setSkills(r.skills.join("\n")); setSections(r.sections);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [query]);
  useEffect(() => { void load(); }, [load]);

  // Edits re-render the preview a moment after you stop (each render compiles the real template).
  const edit = useMemo(() => loaded && { source: loaded.source, headerTitle: title, email, city, skills: skills.split("\n").map((s) => s.trim()).filter(Boolean), sections }, [loaded, title, email, city, skills, sections]);
  const seq = useRef(0);
  useEffect(() => {
    if (!edit || !dirty) return;
    const n = ++seq.current;
    const t = setTimeout(async () => {
      setRendering(true);
      try { const d = await call<Draft>("render", edit); if (n === seq.current) { setDraft(d); setDraftOf(edit); } }
      catch (e) { if (n === seq.current) setDraft({ draftId: "", pdfPath: "", pages: null, problems: [e instanceof Error ? e.message : String(e)], jdMatch: null }); }
      finally { if (n === seq.current) setRendering(false); }
    }, 900);
    return () => clearTimeout(t);
  }, [edit, dirty]);

  // Undo: a snapshot before each change (bullets, tools), and when a text field gets focus.
  const snapshot = (): Snapshot => ({ title, email, city, skills, sections: structuredClone(sections) });
  const remember = () => {
    const s = snapshot();
    const top = history.current[history.current.length - 1];
    if (top && JSON.stringify(top) === JSON.stringify(s)) return;
    history.current = [...history.current.slice(-49), s];
    setHistoryLen(history.current.length);
  };
  const undo = () => {
    const s = history.current.pop();
    setHistoryLen(history.current.length);
    if (!s) return;
    setTitle(s.title); setEmail(s.email); setCity(s.city); setSkills(s.skills); setSections(s.sections); setStackText({}); setWriting(null); setDirty(true);
  };
  const change = (fn: (s: Section[]) => Section[]) => { remember(); setSections((s) => fn(structuredClone(s))); setDirty(true); };

  const writingKey = writing ? `${writing.si}:${writing.bi}:${writing.text}` : "";
  useEffect(() => {
    if (!writing || !loaded) return;
    const s = sections[writing.si];
    const b = writing.bi >= 0 ? s?.bullets[writing.bi] : null;
    const t = setTimeout(async () => {
      try {
        const r = await call<{ issues: string[]; freeVerbs: string[] }>("check", { role: s?.role, text: writing.text, acId: b ? b.ac_id : null });
        setWriting((w) => w && `${w.si}:${w.bi}:${w.text}` === writingKey ? { ...w, issues: r.issues, verbs: r.freeVerbs } : w);
      } catch { /* keep the last verdict */ }
    }, 400);
    return () => clearTimeout(t);
  }, [writingKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // The verb rule only binds the bank (bullets that may share a resume); this resume checks its own verbs on render.
  const bankOnly = (i: string) => /already opens/.test(i);
  const closeWriting = () => { setWriting(null); setSheet((s) => s?.kind === "bullet" ? null : s); };
  const useHere = () => {
    if (!writing) return;
    const { si, bi, text } = writing;
    change((x) => { const old = x[si]!.bullets[bi]!; x[si]!.bullets[bi] = { ac_id: old.ac_id, facet: old.facet, text: text.replace(/\s+/g, " ").trim(), custom: true }; return x; });
    closeWriting();
  };
  const saveToBank = async () => {
    if (!writing || !loaded) return;
    const { si, bi, at, text } = writing;
    const s = sections[si]!;
    const old = bi >= 0 ? s.bullets[bi] : null;
    setWriting({ ...writing, busy: true, error: "" });
    try {
      const r = await call<{ bullet: Bullet }>("bullet", { role: s.role, text, mode: old ? "reword" : "new", acId: old?.ac_id ?? null, facet: old?.facet ?? null });
      change((x) => { const l = x[si]!.bullets; if (bi >= 0) l[bi] = r.bullet; else l.splice(at ?? l.length, 0, r.bullet); return x; });
      // The bank now has it: offer it (or its new wording) in Swap and Add too.
      setLoaded((l) => l && { ...l, options: { ...l.options, [s.role]: [...(l.options[s.role] ?? []).filter((o) => !(o.ac_id === r.bullet.ac_id && o.facet === r.bullet.facet)), r.bullet] } });
      setNotice(old ? "Saved to your bank: future resumes use this wording." : "Added to your bank and to this resume.");
      closeWriting(); setPicker(null);
    } catch (e) { setWriting((w) => w && { ...w, busy: false, error: e instanceof Error ? e.message : String(e) }); }
  };
  const writer = (w: Writing, isNew: boolean) => {
    const textIssues = (w.issues ?? []).filter((i) => !bankOnly(i));
    const anyIssues = (w.issues ?? []).length > 0;
    const words = w.text.trim() ? w.text.trim().split(/\s+/).length : 0;
    return (
      <div className="rb-writer">
        <textarea autoFocus rows={phone ? 5 : 3} value={w.text} placeholder="Start with an action verb: what you did, with what, and the result in numbers."
          onChange={(e) => setWriting({ ...w, text: e.target.value, issues: null })}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); closeWriting(); } }} />
        <div className="rb-verdict">
          <span className={`rb-words ${words && (words < 12 || words > 35) ? "is-off" : ""}`}>{words} words</span>
          {w.issues == null ? <span className="apps-muted">Checking…</span>
            : !anyIssues ? <span className="rb-ok">✓ Passes every bullet rule</span>
            : <ul>{w.issues.map((i) => <li key={i} className={bankOnly(i) ? "is-bank" : ""}>{i}{bankOnly(i) ? " (only for the bank)" : ""}</li>)}</ul>}
          {w.issues?.some(bankOnly) && w.verbs.length > 0 && <div className="rb-verbs"><span className="apps-muted">Free verbs:</span>{w.verbs.map((v) => <button key={v} type="button" onClick={() => setWriting({ ...w, text: w.text.replace(/^\s*[A-Za-z]+/, v), issues: null })}>{v}</button>)}</div>}
          {w.error && <p className="td-error" role="alert">{w.error}</p>}
        </div>
        <div className="rb-writer-acts">
          {!isNew && <button className="apps-btn" disabled={w.busy || w.issues == null || textIssues.length > 0} title="Only this resume changes; the bank keeps its wording" onClick={useHere}>Use on this resume only</button>}
          <button className="rv-primary" disabled={w.busy || w.issues == null || anyIssues} title={isNew ? "Added to this resume and to your bank, for future resumes" : "Your wording replaces this bullet's in the bank, for future resumes too"} onClick={() => void saveToBank()}>{w.busy ? "Saving…" : isNew ? "Add (saved to your bank)" : "Save to bank (future resumes too)"}</button>
          <button className="apps-link" disabled={w.busy} onClick={closeWriting}>Cancel</button>
        </div>
      </div>
    );
  };

  const used = new Set(sections.flatMap((s) => s.bullets.map((b) => b.ac_id)));
  const verbs = new Map<string, number>();
  for (const b of sections.flatMap((s) => s.bullets)) verbs.set(verb(b.text), (verbs.get(verb(b.text)) ?? 0) + 1);

  const save = async () => {
    if (!loaded || !draft?.draftId) return;
    setSaving(true);
    try {
      await call<{ pdfPath: string }>("save", { source: loaded.source, draftId: draft.draftId });
      setSavedAt(Date.now());
      await load();
    } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  const revert = async () => {
    if (!loaded) return;
    setSaving(true);
    try { await call("revert", { source: loaded.source }); setNotice("Back to the generated resume."); await load(); }
    catch (e) { setNotice(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(""), 6000); return () => clearTimeout(t); }, [notice]);
  useEffect(() => { if (!savedAt) return; const t = setTimeout(() => setSavedAt(0), 5000); return () => clearTimeout(t); }, [savedAt]);
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 1600); return () => clearTimeout(t); }, [flash]);

  const canSave = Boolean(dirty && draft?.draftId && !draft.problems.length && !rendering && !saving);
  // Shortcuts: ⌘S saves, ⌘Z undoes (outside a text box, where the box's own undo works), Esc closes.
  const keys = useRef({ canSave, save, undo, close: () => {} });
  keys.current = { canSave, save, undo, close: () => { if (picker) setPicker(null); else if (writing) closeWriting(); else setSheet(null); } };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); if (keys.current.canSave) void keys.current.save(); }
      else if (mod && e.key.toLowerCase() === "z" && !e.shiftKey && !typing) { e.preventDefault(); keys.current.undo(); }
      else if (e.key === "Escape") keys.current.close();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  // Every bank bullet's text, measured once per render of the page: the picker shows how many lines each takes.
  const measure = useMemo(() => [...new Set(Object.values(loaded?.options ?? {}).flat().map((o) => o.text))], [loaded?.options]);
  const measureIndex = useMemo(() => new Map(measure.map((t, i) => [t, i])), [measure]);
  const linesOfText = (t: string) => { const i = measureIndex.get(t); return i == null ? null : fit?.measured[i] ?? null; };
  const linesOfBullet = (si: number, bi: number) => fit?.bullets[`${si}:${bi}`] ?? null;

  // A click on the page: phones open its sheet; the desktop brings it into view in the editor.
  const pick = (t: PageTarget) => {
    if (phone) {
      setPicker(null);
      setSheet(t);
      if (t.kind === "bullet") { const b = sections[t.si]?.bullets[t.bi]; if (b) setWriting({ si: t.si, bi: t.bi, text: b.text, issues: null, verbs: [], busy: false, error: "" }); }
      else setWriting(null);
      return;
    }
    if (t.kind === "header") { titleRef.current?.focus(); titleRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    if (t.kind === "skills") {
      const el = skillsRef.current; if (!el) return;
      const lines = skills.split("\n"); const nonEmpty = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.trim());
      const line = nonEmpty[t.line]?.i ?? 0; const start = lines.slice(0, line).join("\n").length + (line ? 1 : 0);
      el.focus(); el.setSelectionRange(start, start + (lines[line]?.length ?? 0)); el.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    const role = sections[t.si]?.role;
    if (role) setFolded((f) => { const n = new Set(f); n.delete(role); return n; });
    const key = t.kind === "bullet" ? `${t.si}:${t.bi}` : `s${t.si}`;
    setFlash(key);
    requestAnimationFrame(() => editorRef.current?.querySelector(`[data-key="${key}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };

  if (!query) {
    return <div className="rv-page rb-page rb-start-page">{header}<StartScreen /></div>;
  }

  const preview = draft?.pdfPath || loaded?.current.pdfPath || null;
  const skillLines = skills.split("\n").map((l) => l.trim()).filter(Boolean);
  const liveSections = sections.map((s, si) => ({ si, role: s.role, kind: s.kind, bullets: s.bullets, tools: s.kind === "project" ? s.stack ?? draft?.stacks?.[s.role] ?? s.stackAuto ?? [] : s.stack ?? [] }));
  // "Room for 2 more lines": a line is a bullet's line (a bullet is usually two).
  // The compiled PDF's measure once it's in for this edit (exact); the live preview's while it compiles (about).
  const pdfRoom = !dirty ? (loaded?.current.room != null && loaded.current.pages ? { pages: loaded.current.pages, lines: loaded.current.room } : null)
    : draftOf === edit && draft?.room != null && draft.pages ? { pages: draft.pages, lines: draft.room } : null;
  const roomOf = (f: { pages: number; lines: number }, about: string) => f.pages > 1 ? { tone: "over", label: `${f.pages} pages ⚠ · ${about}${-f.lines} line${f.lines === -1 ? "" : "s"} over` }
    : f.lines >= 2 ? { tone: "ok", label: `1 page ✓ · room for ${about}${f.lines} more lines` }
    : { tone: "full", label: `1 page ✓ · full${f.lines === 1 ? " (1 line left)" : ""}` };
  const room = pdfRoom ? roomOf(pdfRoom, "") : fit ? roomOf(fit, "~") : null;
  // The last PDF said "full": TeX squeezed the gaps, so the live preview squeezes too (kept while the next compiles).
  if (pdfRoom) squeezeRef.current = pdfRoom.pages === 1 && pdfRoom.lines <= 0;
  const roomChip = <span className={`rb-pages ${room ? `is-${room.tone}` : ""}`} title={pdfRoom ? "Measured on the compiled PDF. A line is one line of a bullet; most bullets are two." : "Estimated on the live preview (~) until the PDF compiles. A line is one line of a bullet; most bullets are two."}><i />{room ? room.label : "Measuring…"}</span>;
  const projects = (loaded?.roles ?? []).filter((r) => r.kind === "project" && !sections.some((s) => s.role === r.role));
  const resumeName = !loaded ? "" : loaded.source.kind === "track" ? `${TRACK_LABEL[loaded.source.track] ?? loaded.source.track} general resume` : loaded.source.company;
  const metaOf = (s: Section) => {
    const L = loaded!.layout;
    if (s.kind === "project") return (L.projects[s.role]?.dates ?? "").replace(/--/g, "–");
    const r = L.roles[s.role];
    const t = s.role === "stony-brook" ? sbTitle(title, L.sbTitleOverrides) : r?.title ?? "";
    return [t, (r?.dates ?? "").replace(/--/g, "–")].filter(Boolean).join(" · ");
  };
  const setStack = (si: number, role: string, v: string) => {
    setStackText((t) => ({ ...t, [role]: v }));
    change((x) => { const list = v.split(",").map((t) => t.trim()).filter(Boolean); x[si]!.stack = list.length ? list : null; return x; });
  };
  const openPicker = (p: Omit<Picker, "tab" | "q">) => { setWriting(null); setHover(null); setPicker({ ...p, tab: "bank", q: "" }); };
  const move = (si: number, from: number, to: number) => change((x) => { const l = x[si]!.bullets; const [b] = l.splice(from, 1); l.splice(to, 0, b!); return x; });
  const removeBullet = (si: number, bi: number) => change((x) => { x[si]!.bullets.splice(bi, 1); return x; });
  const headerFields = (
    <div className="rb-headline" data-key="header">
      <label><span>Title</span><input ref={titleRef} value={title} maxLength={60} onFocus={remember} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} /></label>
      <label><span>Email</span><input type="email" value={email} maxLength={80} onFocus={remember} onChange={(e) => { setEmail(e.target.value); setDirty(true); }} /></label>
      <label><span>Location</span><input value={city} maxLength={40} placeholder="City, ST" onFocus={remember} onChange={(e) => { setCity(e.target.value); setDirty(true); }} /></label>
    </div>
  );
  const skillsField = (
    <label className="rb-skills"><span>One line each: <code>Category: a, b, c</code></span>
      <textarea ref={skillsRef} rows={Math.max(5, skillLines.length + 1)} value={skills} onFocus={remember} onChange={(e) => { setSkills(e.target.value); setDirty(true); }} /></label>
  );
  // The tools after a section's name, as chips; click to edit them as text.
  const tools = (s: Section, si: number) => {
    const auto = s.kind === "project" && !s.stack;
    const shown = s.stack ?? (s.kind === "project" ? draft?.stacks?.[s.role] ?? s.stackAuto ?? [] : []);
    const suggested = s.stackAuto ?? [];
    if (editingTools === s.role || (phone && sheet?.kind === "section")) {
      return (
        <div className="rb-tools is-editing">
          <input autoFocus={!phone} value={stackText[s.role] ?? shown.join(", ")} placeholder={suggested.join(", ") || "Python, FastAPI, AWS"} onChange={(e) => setStack(si, s.role, e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.stopPropagation(); setEditingTools(null); } }} />
          {s.kind === "project" && s.stack && <button type="button" className="apps-link" onClick={() => { setStackText((t) => { const n = { ...t }; delete n[s.role]; return n; }); change((x) => { x[si]!.stack = null; return x; }); }}>Auto</button>}
          {s.kind === "experience" && !s.stack && suggested.length > 0 && <button type="button" className="apps-link" onClick={() => setStack(si, s.role, suggested.join(", "))}>Use {suggested.slice(0, 3).join(", ")}{suggested.length > 3 ? "…" : ""}</button>}
          {!phone && <button type="button" className="apps-link" onClick={() => setEditingTools(null)}>Done</button>}
        </div>
      );
    }
    return (
      <button type="button" className={`rb-tools ${shown.length ? "" : "is-empty"}`} title={s.kind === "experience" ? "Tools after the name, on the company line (optional)" : auto ? "Picked from the bullets; click to set your own" : "Your tools line; click to edit"} onClick={() => setEditingTools(s.role)}>
        {shown.length ? shown.map((t) => <span key={t} className="rb-chip">{t}</span>) : <span className="rb-chip-add">+ tools</span>}
        {auto && shown.length > 0 && <em>auto</em>}
      </button>
    );
  };

  // The bullet picker: your bank's bullets for this section (full text, lines each, what a swap does to the room),
  // or a new one.
  const pickerBody = (p: Picker) => {
    const s = sections[p.si]; if (!s) return null;
    const cur = p.mode === "swap" ? s.bullets[p.bi] : undefined;
    const curLines = cur ? linesOfBullet(p.si, p.bi) : null;
    const q = p.q.trim().toLowerCase();
    const list = (loaded!.options[s.role] ?? []).filter((o) => cur && o.ac_id === cur.ac_id ? o.text !== cur.text : !used.has(o.ac_id)).filter((o) => !q || o.text.toLowerCase().includes(q));
    const choose = (o: Bullet) => {
      if (p.mode === "swap") change((x) => { x[p.si]!.bullets[p.bi] = o; return x; });
      else change((x) => { x[p.si]!.bullets.splice(p.bi, 0, o); return x; });
      setPicker(null); setSheet(null);
    };
    return (
      <div className="rb-picker-body">
        <header>
          <div><b>{p.mode === "swap" ? "Swap this bullet" : `Add to ${s.label}`}</b>{cur && <p className="rb-picker-cur"><Text t={cur.text} /></p>}</div>
          <button type="button" className="rb-x" aria-label="Close" onClick={() => setPicker(null)}>×</button>
        </header>
        {p.mode === "add" && <div className="rb-seg" role="tablist">
          <button role="tab" aria-selected={p.tab === "bank"} className={p.tab === "bank" ? "is-on" : ""} onClick={() => { setWriting(null); setPicker({ ...p, tab: "bank" }); }}>From your bank</button>
          <button role="tab" aria-selected={p.tab === "write"} className={p.tab === "write" ? "is-on" : ""} onClick={() => { setPicker({ ...p, tab: "write" }); setWriting({ si: p.si, bi: -1, at: p.bi, text: "", issues: null, verbs: [], busy: false, error: "" }); }}>Write new</button>
        </div>}
        {p.tab === "write" && writing ? writer(writing, true) : <>
          <input className="rb-search" autoFocus={!phone} placeholder={`Search ${plural(list.length, "bullet")}…`} value={p.q} onChange={(e) => setPicker({ ...p, q: e.target.value })} />
          <ul className="rb-options">
            {list.length === 0 && <li className="apps-muted rb-none">{q ? "Nothing matches." : "Every bank bullet for this section is on the resume."}</li>}
            {list.map((o) => {
              const n = linesOfText(o.text);
              const d = n != null && curLines != null ? n - curLines : null;
              const verbTaken = (verbs.get(verb(o.text)) ?? 0) - (cur && verb(cur.text) === verb(o.text) ? 1 : 0) > 0;
              return (
                <li key={`${o.ac_id}:${o.facet}:${o.text.slice(0, 20)}`}>
                  <button type="button" onClick={() => choose(o)}>
                    <span className="rb-opt-text"><Text t={o.text} /></span>
                    <span className="rb-opt-meta">
                      {cur && o.ac_id === cur.ac_id && <span className="rb-tag">another version</span>}
                      {verbTaken && <span className="rb-tag is-warn">verb already used</span>}
                      {n != null && <span>{plural(n, "line")}</span>}
                      {d != null && <span className={d < 0 ? "is-good" : d > 0 ? "is-warn" : ""}>{d < 0 ? `saves ${plural(-d, "line")}` : d > 0 ? `+${plural(d, "line")}` : "same length"}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>}
      </div>
    );
  };

  const sectionCard = (s: Section, si: number) => {
    const isFolded = folded.has(s.role);
    const lines = s.bullets.reduce((n, _, bi) => n + (linesOfBullet(si, bi) ?? 0), 0);
    return (
      <section key={s.role} className={`rb-sec ${flash === `s${si}` ? "is-flash" : ""}`} data-key={`s${si}`}>
        <header onMouseEnter={() => setHover(`s${si}`)} onMouseLeave={() => setHover(null)}>
          <button type="button" className="rb-fold" aria-expanded={!isFolded} aria-label={isFolded ? "Show bullets" : "Hide bullets"} onClick={() => setFolded((f) => { const n = new Set(f); if (n.has(s.role)) n.delete(s.role); else n.add(s.role); return n; })}>{isFolded ? "▸" : "▾"}</button>
          <div className="rb-sec-title"><b>{s.label}</b><span>{metaOf(s)}</span></div>
          <span className="rb-sec-count">{plural(s.bullets.length, "bullet")}{fit && lines ? ` · ${plural(lines, "line")}` : ""}</span>
          {s.kind === "project" && <button type="button" className="rb-sec-remove apps-link" onClick={() => change((x) => x.filter((_, i) => i !== si))}>Remove</button>}
        </header>
        {!isFolded && <>
          {tools(s, si)}
          <ol className="rb-bullets" onDragOver={(e) => { if (drag?.si === si) e.preventDefault(); }}>
            {s.bullets.map((b, bi) => {
              const key = `${si}:${bi}`;
              const n = linesOfBullet(si, bi);
              const dup = (verbs.get(verb(b.text)) ?? 0) > 1;
              const isWriting = writing && writing.si === si && writing.bi === bi;
              const dropHere = drag && drag.si === si && drag.over === bi && drag.bi !== bi && drag.bi !== bi - 1;
              return (
                <Fragment key={`${b.ac_id}:${bi}`}>
                  {dropHere && <li className="rb-drop" aria-hidden />}
                  <li data-key={key} tabIndex={0}
                    className={["rb-b", dup ? "is-dup" : "", hover === key ? "is-linked" : "", flash === key ? "is-flash" : "", isWriting ? "is-writing" : "", drag?.si === si && drag.bi === bi && drag.over != null ? "is-dragging" : ""].join(" ")}
                    title={`${b.ac_id}${b.facet && b.facet !== "default" ? ` · ${b.facet}` : ""}`}
                    draggable={Boolean(drag?.armed && drag.si === si && drag.bi === bi)}
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", key); setDrag({ si, bi, armed: true, over: bi }); }}
                    onDragOver={(e) => { if (drag?.si !== si) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); const over = e.clientY < r.top + r.height / 2 ? bi : bi + 1; if (drag.over !== over) setDrag({ ...drag, over }); }}
                    onDrop={(e) => { e.preventDefault(); if (drag && drag.si === si && drag.over != null) { const to = drag.over > drag.bi ? drag.over - 1 : drag.over; if (to !== drag.bi) move(si, drag.bi, to); } setDrag(null); }}
                    onDragEnd={() => setDrag(null)}
                    onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget || writing) return;
                      if (e.altKey && e.key === "ArrowUp" && bi > 0) { e.preventDefault(); move(si, bi, bi - 1); }
                      else if (e.altKey && e.key === "ArrowDown" && bi < s.bullets.length - 1) { e.preventDefault(); move(si, bi, bi + 1); }
                      else if (e.key === "Enter") { e.preventDefault(); setWriting({ si, bi, text: b.text, issues: null, verbs: [], busy: false, error: "" }); }
                    }}>
                    {isWriting ? writer(writing, false) : <>
                      <span className="rb-grip" title="Drag to reorder (or Alt+↑ / Alt+↓)" aria-hidden onMouseDown={() => setDrag({ si, bi, armed: true, over: null })} onMouseUp={() => setDrag(null)}>⋮⋮</span>
                      <p onDoubleClick={() => !writing && setWriting({ si, bi, text: b.text, issues: null, verbs: [], busy: false, error: "" })}><Text t={b.text} />
                        {b.custom && <span className="rb-tag">this resume only</span>}
                        {dup && <span className="rb-tag is-warn" title="Another bullet on this resume opens with the same verb">same verb twice</span>}
                      </p>
                      <span className="rb-lines">{n != null ? plural(n, "line") : ""}</span>
                      <span className="rb-tools-bar">
                        <button type="button" title="Edit the wording (Enter)" disabled={Boolean(writing)} onClick={() => setWriting({ si, bi, text: b.text, issues: null, verbs: [], busy: false, error: "" })}>✎</button>
                        <button type="button" title="Swap for another bullet" disabled={Boolean(writing)} onClick={() => openPicker({ si, mode: "swap", bi })}>⇄</button>
                        <button type="button" className="rb-del" title="Remove (⌘Z brings it back)" disabled={Boolean(writing)} onClick={() => removeBullet(si, bi)}>✕</button>
                      </span>
                    </>}
                  </li>
                </Fragment>
              );
            })}
            {drag && drag.si === si && drag.over === s.bullets.length && drag.bi !== s.bullets.length - 1 && <li className="rb-drop" aria-hidden />}
          </ol>
          <button type="button" className="rb-add-b" disabled={Boolean(writing)} onClick={() => openPicker({ si, mode: "add", bi: s.bullets.length })}>+ Add bullet</button>
        </>}
      </section>
    );
  };

  const highlight = flash && !phone ? { key: flash, scroll: false } : hover ? { key: hover, scroll: false } : null;
  const livePreview = loaded && (
    <ResumeLivePreview layout={loaded.layout} title={title} email={email} city={city} sections={liveSections} skills={skillLines} measure={measure}
      mode={phone ? "width" : "fit"} squeeze={squeezeRef.current} highlight={highlight} onFit={setFit} onPick={pick} onHover={setHover} />
  );
  const pdfStatus = <span className="rb-pdf-status" title="The compiled PDF, the one Fill sends">PDF {rendering ? "checking…" : draft?.pages ? `${plural(draft.pages, "page")} ${draft.pages === 1 ? "✓" : "⚠"}` : dirty ? "…" : "saved"}</span>;
  const problems = draft && draft.problems.length > 0 && <div className="rb-checks bad" role="alert"><b>Can't save yet</b><ul>{draft.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>;
  const saveBtn = <button className="rv-primary" disabled={!canSave} onClick={() => void save()} title={draft && !draft.problems.length ? "One page · every bullet from your bank · no repeated opening verb (⌘S)" : "⌘S"}>{saving ? "Saving…" : "Save"}</button>;
  const undoBtn = <button className="apps-btn" disabled={!history.current.length} onClick={undo} title="Undo the last change (⌘Z)">Undo</button>;

  // Phones: the page, a sheet for what you tap, and a bar with the room and Save.
  if (phone) {
    const t = sheet;
    const s = t && (t.kind === "bullet" || t.kind === "section") ? sections[t.si] : undefined;
    return (
      <div className="rv-page rb-page rb-phone">
        {header}
        {error && <p className="ar-error" role="alert">{error}</p>}
        {!loaded && !error && <div className="td-empty">Loading the resume…</div>}
        {loaded && <>
          <div className="rb-ph-top"><b>{resumeName}</b>{roomChip}</div>
          {problems}
          <div className="rb-ph-page">{livePreview}</div>
          <p className="rb-ph-hint">Tap any line to edit it.</p>
          <div className="rb-ph-bar">
            {undoBtn}
            <button className="apps-btn" onClick={() => { setWriting(null); setPicker(null); setSheet({ kind: "menu" }); }} aria-label="More">⋯</button>
            {savedAt ? <span className="rb-saved">Saved ✓</span> : pdfStatus}
            {saveBtn}
          </div>
          {(t || picker) && <div className="rb-sheet-back" onClick={() => { setSheet(null); setPicker(null); setWriting(null); }} />}
          {picker ? <div className="rb-sheet" role="dialog" aria-label="Bullets">{pickerBody(picker)}</div>
            : t && <div className="rb-sheet" role="dialog" aria-label="Edit">
              <div className="rb-sheet-grab" />
              {t.kind === "bullet" && s && <>
                <div className="rb-sheet-head"><b>{s.label}</b><span>Bullet {t.bi + 1} of {s.bullets.length}{linesOfBullet(t.si, t.bi) ? ` · ${plural(linesOfBullet(t.si, t.bi)!, "line")}` : ""}</span></div>
                {writing && writing.si === t.si && writing.bi === t.bi && writer(writing, false)}
                <div className="rb-sheet-acts">
                  <button className="apps-btn" onClick={() => openPicker({ si: t.si, mode: "swap", bi: t.bi })}>⇄ Swap</button>
                  <button className="apps-btn" disabled={t.bi === 0} onClick={() => { move(t.si, t.bi, t.bi - 1); setSheet({ ...t, bi: t.bi - 1 }); setWriting((w) => w && { ...w, bi: t.bi - 1 }); }}>↑</button>
                  <button className="apps-btn" disabled={t.bi >= s.bullets.length - 1} onClick={() => { move(t.si, t.bi, t.bi + 1); setSheet({ ...t, bi: t.bi + 1 }); setWriting((w) => w && { ...w, bi: t.bi + 1 }); }}>↓</button>
                  <button className="apps-btn" onClick={() => openPicker({ si: t.si, mode: "add", bi: t.bi + 1 })}>+ Below</button>
                  <button className="apps-btn rb-del" onClick={() => { removeBullet(t.si, t.bi); setSheet(null); setWriting(null); }}>Remove</button>
                </div>
              </>}
              {t.kind === "section" && s && <>
                <div className="rb-sheet-head"><b>{s.label}</b><span>{metaOf(s)}</span></div>
                <label className="rb-sheet-label">Tools after the name{s.kind === "experience" ? " (optional)" : ""}</label>
                {tools(s, t.si)}
                <div className="rb-sheet-acts">
                  <button className="apps-btn" onClick={() => openPicker({ si: t.si, mode: "add", bi: s.bullets.length })}>+ Add bullet</button>
                  {s.kind === "project" && <button className="apps-btn rb-del" onClick={() => { change((x) => x.filter((_, i) => i !== t.si)); setSheet(null); }}>Remove project</button>}
                </div>
              </>}
              {t.kind === "header" && <><div className="rb-sheet-head"><b>Header</b></div>{headerFields}</>}
              {t.kind === "skills" && <><div className="rb-sheet-head"><b>Technical skills</b></div>{skillsField}</>}
              {t.kind === "menu" && <div className="rb-menu">
                <a className="apps-btn" href={pdfUrl(preview ?? loaded.current.pdfPath)} target="_blank" rel="noreferrer">Open the PDF</a>
                <a className="apps-btn" href={pdfUrl(loaded.current.pdfPath, true)}>Download saved</a>
                <button className="apps-btn" disabled={!dirty || saving} onClick={() => { void load(); setSheet(null); }}>Discard changes</button>
                {loaded.current.edited && <button className="apps-btn" disabled={saving} onClick={() => { void revert(); setSheet(null); }}>Revert to generated</button>}
                {projects.length > 0 && <><span className="rb-sheet-label">Add a project</span>{projects.map((p) => <button key={p.role} className="apps-btn" onClick={() => { change((x) => [...x, { role: p.role, kind: "project", label: p.label, bullets: [] }]); setSheet(null); }}>+ {p.label}</button>)}</>}
              </div>}
              {t.kind !== "bullet" && <button className="rv-primary rb-sheet-done" onClick={() => setSheet(null)}>Done</button>}
            </div>}
        </>}
        {notice && <div className="apps-toast" role="status"><span>{notice}</span><button type="button" className="apps-toast-close" aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}
      </div>
    );
  }

  return (
    <div className="rv-page rb-page">
      {header}
      {error && <p className="ar-error" role="alert">{error}</p>}
      {!loaded && !error && <div className="td-empty">Loading the resume…</div>}
      {loaded && (
        <main className="rb-main">
          <section className="rb-editor" aria-label="Resume content" ref={editorRef}>
            <div className="rb-which">
              <b>{resumeName}</b>
              <span>{loaded.source.kind === "track" ? "Not tailored to a job" : loaded.source.title}{loaded.source.kind === "pasted" ? " · from a pasted job description" : ""}{loaded.current.edited ? " · edited" : " · generated"}</span>
              <Link className="rb-back" to="/resume_builder">All resumes</Link>
            </div>
            {headerFields}
            <h3 className="rb-group">Experience</h3>
            {sections.map((s, si) => s.kind === "experience" ? sectionCard(s, si) : null)}
            <h3 className="rb-group">Projects</h3>
            {sections.map((s, si) => s.kind === "project" ? sectionCard(s, si) : null)}
            {projects.length > 0 && <select className="rb-add-proj" aria-label="Add a project" value="" onChange={(e) => { const r = projects.find((p) => p.role === e.target.value); if (r) change((x) => [...x, { role: r.role, kind: "project", label: r.label, bullets: [] }]); }}>
              <option value="">+ Add a project…</option>
              {projects.map((p) => <option key={p.role} value={p.role}>{p.label}</option>)}
            </select>}
            <h3 className="rb-group">Technical skills</h3>
            <div className="rb-sec">{skillsField}</div>
            <p className="rb-keys">⌘S save · ⌘Z undo · Enter edit a focused bullet · Alt+↑↓ move it · Esc close</p>
          </section>
          <section className="rb-preview" aria-label="Preview">
            <div className="rb-viewbar">
              <span className="rb-tabs" role="tablist">
                <button role="tab" aria-selected={view === "live"} className={view === "live" ? "is-on" : ""} onClick={() => setView("live")}>Live</button>
                <button role="tab" aria-selected={view === "pdf"} className={view === "pdf" ? "is-on" : ""} onClick={() => setView("pdf")}>PDF</button>
              </span>
              {roomChip}
              {savedAt ? <span className="rb-saved">Saved ✓</span> : pdfStatus}
              {draft?.jdMatch && <span className="rb-match" title={draft.jdMatch.missing.length ? `Still missing: ${draft.jdMatch.missing.join(", ")}` : "Every skill this job names is on it"}>JD {draft.jdMatch.before ?? "–"} → <b>{draft.jdMatch.after ?? "–"}</b></span>}
              <span className="rb-actions">
                {undoBtn}
                {loaded.current.edited && <button className="apps-btn" disabled={saving} onClick={() => void revert()} title="Back to the generated resume">Revert</button>}
                <a className="apps-btn" href={pdfUrl(loaded.current.pdfPath, true)} title="Download the saved PDF">Download</a>
                <button className="apps-btn" disabled={!dirty || saving} onClick={() => void load()}>Discard</button>
                {saveBtn}
              </span>
            </div>
            {problems}
            {view === "live" ? livePreview : preview && <iframe key={preview} title="Resume PDF" src={`${pdfUrl(preview)}#view=Fit&toolbar=0&navpanes=0`} />}
            {view === "live" && <p className="rb-page-hint">Click a line to find it in the editor.</p>}
          </section>
          {picker && <>
            <div className="rb-modal-back" onClick={() => { setPicker(null); setWriting(null); }} />
            <div className="rb-modal" role="dialog" aria-label="Bullets">{pickerBody(picker)}</div>
          </>}
        </main>
      )}
      {notice && <div className="apps-toast" role="status"><span>{notice}</span><button type="button" className="apps-toast-close" aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}
    </div>
  );
}
