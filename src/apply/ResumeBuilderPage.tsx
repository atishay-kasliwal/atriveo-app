import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getTailorServerBase } from "../utils/tailorServer";
import { TRACK_LABEL } from "./tracks";
import ResumeLivePreview, { type Layout } from "./ResumeLivePreview";
import "./resume-builder.css";

// Resume builder (/resume_builder): edit a resume's content (bullets, title, skills); the template never changes.
// Opens a Today card's resume (?app=<application id> or ?job=<job url>) or a track's general resume (?track=…).
// Design and decisions: docs/resume-builder.md. Server: scripts/resume-builder.mjs (/resume-builder/* routes).

interface Bullet { ac_id: string; facet: string | null; text: string }
/** A project's tools line ("Atriveo | FastAPI, Docker…"): stack = yours; null = picked from its bullets (stackAuto). */
interface Section { role: string; kind: "experience" | "project"; label: string; bullets: Bullet[]; stack?: string[] | null; stackAuto?: string[] }
type Source = { kind: "job"; jobUrl: string; company: string; title: string; location: string | null } | { kind: "track"; track: string; company: string; title: string; location: null };
interface Loaded {
  source: Source; headerTitle: string | null; email: string; city: string; skills: string[]; sections: Section[];
  options: Record<string, Bullet[]>; roles: Array<{ role: string; kind: "experience" | "project"; label: string }>;
  current: { pdfPath: string; edited: boolean; generatedPdfPath: string | null }; jd: string | null; layout: Layout;
}
interface Draft { draftId: string; pdfPath: string; pages: number | null; problems: string[]; jdMatch: { before: number | null; after: number | null; missing: string[] } | null; stacks?: Record<string, string[]> }

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

export default function ResumeBuilderPage({ header }: { header?: React.ReactNode }) {
  const [params] = useSearchParams();
  const query = params.get("app") ? `app=${encodeURIComponent(params.get("app")!)}` : params.get("job") ? `job=${encodeURIComponent(params.get("job")!)}` : params.get("track") ? `track=${encodeURIComponent(params.get("track")!)}` : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  // What you're typing in each project's tools box (kept as typed, so commas stay while you type).
  const [stackText, setStackText] = useState<Record<string, string>>({});
  const [skills, setSkills] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  // Live: the HTML preview (instant, Paged.js); PDF: the compiled file that is sent.
  const [view, setView] = useState<"live" | "pdf">("live");
  const [livePages, setLivePages] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!query) return;
    setError(""); setLoaded(null); setDraft(null); setDirty(false);
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
      try { const d = await call<Draft>("render", edit); if (n === seq.current) setDraft(d); }
      catch (e) { if (n === seq.current) setDraft({ draftId: "", pdfPath: "", pages: null, problems: [e instanceof Error ? e.message : String(e)], jdMatch: null }); }
      finally { if (n === seq.current) setRendering(false); }
    }, 900);
    return () => clearTimeout(t);
  }, [edit, dirty]);

  const change = (fn: (s: Section[]) => Section[]) => { setSections((s) => fn(structuredClone(s))); setDirty(true); };
  const used = new Set(sections.flatMap((s) => s.bullets.map((b) => b.ac_id)));
  const verbs = new Map<string, number>();
  for (const b of sections.flatMap((s) => s.bullets)) verbs.set(verb(b.text), (verbs.get(verb(b.text)) ?? 0) + 1);

  const save = async () => {
    if (!loaded || !draft?.draftId) return;
    setSaving(true);
    try {
      const r = await call<{ pdfPath: string }>("save", { source: loaded.source, draftId: draft.draftId });
      setNotice(loaded.source.kind === "job" ? "Saved. Fill and Easy Apply attach this version now." : "Saved. Today's Resumes menu has this version now.");
      await load();
      void r;
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

  if (!query) {
    return (
      <div className="rv-page rb-page">{header}
        <div className="rb-start">
          <h1>Resume builder</h1>
          <p className="apps-muted">Change a resume's bullets, title and skills; the template stays the same. Open one from a Today card (Resume → Edit), or edit a track's general resume:</p>
          <div className="rb-tracks">{GENERAL.map((t) => <Link key={t} className={`rb-track tr-${t}`} to={`/resume_builder?track=${t}`}><i />{TRACK_LABEL[t]}<span>General resume</span></Link>)}</div>
          <p className="apps-muted rb-soon">Coming next: start from a job description you paste, and write new bullets (saved to your bank).</p>
        </div>
      </div>
    );
  }

  const preview = draft?.pdfPath || loaded?.current.pdfPath || null;
  const skillLines = skills.split("\n").map((l) => l.trim()).filter(Boolean);
  const liveSections = sections.map((s) => ({ role: s.role, kind: s.kind, bullets: s.bullets, tools: s.kind === "project" ? s.stack ?? draft?.stacks?.[s.role] ?? s.stackAuto ?? [] : undefined }));
  const canSave = Boolean(dirty && draft?.draftId && !draft.problems.length && !rendering && !saving);
  const addable = (role: string) => (loaded?.options[role] ?? []).filter((o) => !used.has(o.ac_id));
  const projects = (loaded?.roles ?? []).filter((r) => r.kind === "project" && !sections.some((s) => s.role === r.role));

  return (
    <div className="rv-page rb-page">
      {header}
      <div className="rb-bar">
        <div className="rb-title">
          <h1>{loaded ? (loaded.source.kind === "job" ? loaded.source.company : `${TRACK_LABEL[loaded.source.track] ?? loaded.source.track} general resume`) : "Resume builder"}</h1>
          <span className="apps-muted">{loaded?.source.kind === "job" ? loaded.source.title : "Not tailored to a job"}{loaded?.current.edited ? " · edited" : " · generated"}</span>
        </div>
        <div className="rb-actions">
          {draft?.jdMatch && <span className="rb-match" title={draft.jdMatch.missing.length ? `Still missing: ${draft.jdMatch.missing.join(", ")}` : "Every skill this job names is on it"}>JD match {draft.jdMatch.before ?? "–"} → <b>{draft.jdMatch.after ?? "–"}</b></span>}
          {rendering && <span className="apps-muted">Rendering…</span>}
          {loaded?.current.edited && <button className="apps-btn" disabled={saving} onClick={() => void revert()}>Revert to generated</button>}
          {loaded && <a className="apps-btn" href={pdfUrl(loaded.current.pdfPath, true)}>Download saved</a>}
          <button className="apps-btn" disabled={!dirty || saving} onClick={() => void load()}>Discard changes</button>
          <button className="rv-primary" disabled={!canSave} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
      {error && <p className="ar-error" role="alert">{error}</p>}
      {!loaded && !error && <div className="td-empty">Loading the resume…</div>}
      {loaded && (
        <main className="rb-main">
          <section className="rb-editor" aria-label="Resume content">
            <div className="rb-head">
              <label className="rb-field"><span>Title</span><input value={title} maxLength={60} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} /></label>
              <label className="rb-field"><span>Email</span><input type="email" value={email} maxLength={80} onChange={(e) => { setEmail(e.target.value); setDirty(true); }} /></label>
              <label className="rb-field"><span>Location</span><input value={city} maxLength={40} placeholder="City, ST" onChange={(e) => { setCity(e.target.value); setDirty(true); }} /></label>
            </div>
            {sections.map((s, si) => (
              <div key={s.role} className="rb-section">
                <header><b>{s.label}</b><span className="apps-muted">{s.kind === "project" ? "Project" : "Experience"} · {s.bullets.length} bullet{s.bullets.length === 1 ? "" : "s"}</span>
                  {s.kind === "project" && <button className="apps-link" onClick={() => change((x) => x.filter((_, i) => i !== si))}>Remove project</button>}</header>
                {s.kind === "project" && (() => {
                  const shown = s.stack ?? draft?.stacks?.[s.role] ?? s.stackAuto ?? [];
                  return <label className="rb-field rb-stack"><span>Tools after the name {s.stack ? <button type="button" className="apps-link" onClick={() => { setStackText((t) => { const n = { ...t }; delete n[s.role]; return n; }); change((x) => { x[si]!.stack = null; return x; }); }}>Auto</button> : <em>automatic, from the bullets</em>}</span>
                    <input value={stackText[s.role] ?? shown.join(", ")} placeholder="FastAPI, Docker, PostgreSQL" onChange={(e) => { const v = e.target.value; setStackText((t) => ({ ...t, [s.role]: v })); change((x) => { const list = v.split(",").map((t) => t.trim()).filter(Boolean); x[si]!.stack = list.length ? list : null; return x; }); }} /></label>;
                })()}
                <ol>{s.bullets.map((b, bi) => (
                  <li key={`${b.ac_id}:${bi}`} className={(verbs.get(verb(b.text)) ?? 0) > 1 ? "is-dup" : ""}>
                    <p>{b.text}</p>
                    <div className="rb-row">
                      <span className="rb-id" title="Bank entry">{b.ac_id}{b.facet && b.facet !== "default" ? ` · ${b.facet}` : ""}</span>
                      <button className="rb-icon" disabled={bi === 0} title="Move up" onClick={() => change((x) => { const l = x[si]!.bullets; [l[bi - 1], l[bi]] = [l[bi]!, l[bi - 1]!]; return x; })}>↑</button>
                      <button className="rb-icon" disabled={bi === s.bullets.length - 1} title="Move down" onClick={() => change((x) => { const l = x[si]!.bullets; [l[bi + 1], l[bi]] = [l[bi]!, l[bi + 1]!]; return x; })}>↓</button>
                      <select aria-label="Swap for another bullet" value="" onChange={(e) => { const o = (loaded.options[s.role] ?? [])[Number(e.target.value)]; if (o) change((x) => { x[si]!.bullets[bi] = o; return x; }); }}>
                        <option value="">Swap…</option>
                        {(loaded.options[s.role] ?? []).map((o, oi) => ({ o, oi })).filter(({ o }) => o.ac_id === b.ac_id ? o.text !== b.text : !used.has(o.ac_id)).map(({ o, oi }) => <option key={oi} value={oi}>{o.ac_id === b.ac_id ? "↺ " : ""}{o.text.slice(0, 110)}</option>)}
                      </select>
                      <button className="rb-icon rb-del" title="Remove" onClick={() => change((x) => { x[si]!.bullets.splice(bi, 1); return x; })}>✕</button>
                    </div>
                  </li>
                ))}</ol>
                {addable(s.role).length > 0 && <select className="rb-add" aria-label="Add a bullet" value="" onChange={(e) => { const o = addable(s.role)[Number(e.target.value)]; if (o) change((x) => { x[si]!.bullets.push(o); return x; }); }}>
                  <option value="">+ Add a bullet from the bank…</option>
                  {addable(s.role).map((o, oi) => <option key={oi} value={oi}>{o.text.slice(0, 120)}</option>)}
                </select>}
              </div>
            ))}
            {projects.length > 0 && <select className="rb-add" aria-label="Add a project" value="" onChange={(e) => { const r = projects.find((p) => p.role === e.target.value); if (r) change((x) => [...x, { role: r.role, kind: "project", label: r.label, bullets: [] }]); }}>
              <option value="">+ Add a project…</option>
              {projects.map((p) => <option key={p.role} value={p.role}>{p.label}</option>)}
            </select>}
            <label className="rb-field"><span>Technical skills (one line each, “Category: a, b, c”)</span><textarea rows={6} value={skills} onChange={(e) => { setSkills(e.target.value); setDirty(true); }} /></label>
          </section>
          <section className="rb-preview" aria-label="Preview">
            {draft && (draft.problems.length > 0
              ? <div className="rb-checks bad" role="alert"><b>Can't save yet</b><ul>{draft.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
              : <div className="rb-checks ok"><b>Ready to save</b> One page · every bullet from your bank · no repeated opening verb{draft.jdMatch ? ` · JD match ${draft.jdMatch.before ?? "–"} → ${draft.jdMatch.after ?? "–"}` : ""}</div>)}
            <div className="rb-viewbar">
              <span className="rb-tabs" role="tablist">
                <button role="tab" aria-selected={view === "live"} className={view === "live" ? "is-on" : ""} onClick={() => setView("live")}>Live</button>
                <button role="tab" aria-selected={view === "pdf"} className={view === "pdf" ? "is-on" : ""} onClick={() => setView("pdf")}>PDF</button>
              </span>
              <span className={`rb-pages ${livePages != null && livePages > 1 ? "is-over" : ""}`} title="The live preview's pages (close to the PDF; the PDF decides)">
                <i />Live {livePages == null ? "…" : `${livePages} page${livePages === 1 ? "" : "s"} ${livePages === 1 ? "✓" : "⚠"}`}</span>
              <span className="apps-muted" title="The compiled PDF, the one Fill sends">PDF {rendering ? "checking…" : draft?.pages ? `${draft.pages} page${draft.pages === 1 ? "" : "s"} ${draft.pages === 1 ? "✓" : "⚠"}` : dirty ? "…" : "saved"}</span>
            </div>
            {view === "live"
              ? <ResumeLivePreview layout={loaded.layout} title={title} email={email} city={city} sections={liveSections} skills={skillLines} onPages={setLivePages} />
              : preview && <iframe key={preview} title="Resume PDF" src={pdfUrl(preview)} />}
          </section>
        </main>
      )}
      {notice && <div className="apps-toast" role="status"><span>{notice}</span><button type="button" className="apps-toast-close" aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}
    </div>
  );
}
