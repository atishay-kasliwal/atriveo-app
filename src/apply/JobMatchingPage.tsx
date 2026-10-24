import { formatLocation } from "../utils/location";
import { useCallback, useEffect, useRef, useState } from "react";
import CompanyLogo from "../components/CompanyLogo";
import { getJson } from "./engine";
import { ago } from "./JobCard";
import type { ResumeMatch } from "./reviewQueue";
import { TRACK_LABEL } from "./tracks";
import { getTailorServerBase } from "../utils/tailorServer";
import "./review-pages.css";
import "./job-matching.css";

// Job Matching: one job, its tailored resume, a decision. Nothing is built here (the resume and the page image
// exist before a job reaches this queue) and nothing is submitted: Apply opens the application page in a new tab.

interface Jd { about: string; requirements: string[]; nice: string[]; duties: string[]; salary: string | null; work: string | null; kind: string | null; flags: string[]; full: string; structured: boolean }
interface Count { matched: number; total: number }
interface FitSkill { label: string; alternatives: string[]; class: "required" | "preferred"; status: "matched" | "partial" | "missing" }
// Fit: the master resume (your whole bank) against the posting. Every skill count on this page is read from its ledger.
interface Fit {
  score: number; confidence: "high" | "medium" | "low"; confidence_reasons: string[]; outside_roles: boolean;
  knockouts: { verdict: string; items: { type: string; status: string; reason: string; source: string | null }[] };
  ledger: { required: Count; preferred: Count; total: Count; matched: string[]; partial: string[]; missing: string[]; skills: FitSkill[] };
}
interface LeftOff { label: string; class: "required" | "preferred"; entry: string | null; text: string | null; as: "bullet" | "tools" | "skills" }
interface Ready { status: "Ready" | "Review" | "Needs Work"; reasons: string[]; notes?: string[]; skills_checked: boolean; checks?: { skills_on_resume?: { left_off_detail?: LeftOff[] } } }
interface AtsAnalysis { highlights: { start: number; end: number }[]; pages: number | null; roomLines: number | null }
interface MatchJob {
  id: string; company: string; title: string; location: string | null; level: string | null; score: number | null;
  postedAt: string | null; foundAt: string | null; applyType: string | null; track: string | null;
  applyUrl: string; postingUrl: string; resumePath: string; resumeObject?: { sha256: string; hasImage: boolean } | null; resumeMatch: ResumeMatch | null; saved: boolean; jd: Jd; ats: AtsAnalysis | null; fit: Fit | null; ready: Ready | null;
}
interface Queue { ok: boolean; total: number; jobs: MatchJob[] }
type Decision = "skip" | "apply" | "later";

const BATCH = 8;
const REFILL_AT = 3;
const imageUrl = (j: MatchJob) => j.resumeObject?.hasImage
  ? `${getTailorServerBase()}/applications/resume-file?sha=${j.resumeObject.sha256}&kind=image`
  : `${getTailorServerBase()}/applications/resume-image?path=${encodeURIComponent(j.resumePath)}`;

async function send(jobUrl: string, decision: Decision | "undo") {
  const res = await fetch(`${getTailorServerBase()}/applications/job-decision`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobUrl, decision }) });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
}

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

function Description({ job }: { job: MatchJob }) {
  const text = job.jd.full || "No description was saved for this job.";
  let cursor = 0;
  const content: React.ReactNode[] = [];
  for (const { start, end } of job.ats?.highlights ?? []) {
    content.push(text.slice(cursor, start), <mark className="jm-keyword" key={start}>{text.slice(start, end)}</mark>);
    cursor = end;
  }
  content.push(text.slice(cursor));
  return <div className="jm-description">{content}</div>;
}

export default function JobMatchingPage({ header }: { header?: React.ReactNode }) {
  const [queue, setQueue] = useState<MatchJob[]>([]);
  const [history, setHistory] = useState<MatchJob[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [full, setFull] = useState(false);
  const [imgOk, setImgOk] = useState(true);
  const seen = useRef(new Set<string>());
  const fetching = useRef(false);

  const fill = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const q = await getJson<Queue>(`/applications/matching-queue?limit=${BATCH}`);
      const fresh = q.jobs.filter((j) => !seen.current.has(j.id));
      fresh.forEach((j) => seen.current.add(j.id));
      setQueue((cur) => [...cur, ...fresh]);
      setTotal(q.total);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { fetching.current = false; setLoaded(true); }
  }, []);

  useEffect(() => { void fill(); }, [fill]);
  useEffect(() => { if (loaded && queue.length <= REFILL_AT && queue.length < total) void fill(); }, [loaded, queue.length, total, fill]);

  // The next two resumes and the one after are fetched now, so a decision shows the next job at once.
  useEffect(() => { for (const j of queue.slice(1, 3)) new Image().src = imageUrl(j); }, [queue]);

  const job = queue[0];
  useEffect(() => { setFull(false); setImgOk(true); }, [job?.id]);

  const decide = useCallback((decision: Decision) => {
    const j = queue[0];
    if (!j) return;
    // The tab opens inside the click so the browser allows it; the application is never submitted for you.
    if (decision === "apply") window.open(j.applyUrl, "_blank", "noopener,noreferrer");
    setQueue((q) => q.slice(1));
    setHistory((h) => [...h, j]);
    setTotal((n) => (decision === "later" ? n : Math.max(0, n - 1)));
    send(j.id, decision).catch((e) => {
      // Not recorded: the job comes back so nothing is lost silently.
      setQueue((q) => [j, ...q]);
      setHistory((h) => h.filter((x) => x.id !== j.id));
      setTotal((n) => n + (decision === "later" ? 0 : 1));
      setError(`Couldn't save that choice (${e instanceof Error ? e.message : e}). The job is back in the queue.`);
    });
  }, [queue]);

  const back = useCallback(() => {
    const j = history[history.length - 1];
    if (!j) return;
    setHistory((h) => h.slice(0, -1));
    setQueue((q) => [j, ...q]);
    setTotal((n) => n + 1);
    send(j.id, "undo").catch((e) => setError(`Couldn't undo (${e instanceof Error ? e.message : e}).`));
  }, [history]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") { setFull(false); return; }
      if (full) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); decide("skip"); }
      else if (e.key === "ArrowRight") { e.preventDefault(); decide("apply"); }
      else if (e.key === "s" || e.key === "S") decide("later");
      else if (e.key === "f" || e.key === "F") setFull(true);
      else if (e.key === "p" || e.key === "P") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, back, full]);

  const done = history.length;
  const position = `${done + 1} of ${done + total}`;
  const ats = job?.ats;
  const fit = job?.fit ?? null;
  const skills = fit?.ledger.skills ?? [];
  const missing = skills.filter((k) => k.status === "missing");
  const partial = skills.filter((k) => k.status === "partial");
  const score = fit?.score ?? null;
  const skillsHit = fit?.ledger.total.matched ?? 0;
  const skillsTotal = fit?.ledger.total.total ?? 0;
  const have = fit?.ledger.matched ?? [];
  const why = !job || !fit || !skillsTotal ? "" : have.length
    ? `Your bank shows ${have.length} of ${skillsTotal} skills this job asks for, including ${have.slice(0, 4).join(", ")}.${missing.length ? ` Not shown yet: ${missing.slice(0, 3).map((k) => k.label).join(", ")}.` : " Nothing it asks for is missing."}`
    : "Your bank doesn’t show the skills this job lists.";
  const toCheck = fit?.knockouts.items.filter((i) => i.status !== "clear") ?? [];
  // Skills your bank proves but the tailored resume leaves out, with the bullet that proves each (nothing shown when none).
  const leftOff = job?.ready?.checks?.skills_on_resume?.left_off_detail ?? [];
  const glance = job ? (job.jd.about.match(/[^.!?]+[.!?]+/g)?.slice(0, 2).join(" ").trim() || job.jd.about || job.jd.duties[0] || "") : "";

  return <div className="rv-page jm-page">{header}
    {error && <p className="jm-error" role="alert">{error} <button type="button" className="apps-link" onClick={() => { setError(""); void fill(); }}>Retry</button></p>}
    {!job ? <main className="jm-empty">
      {!loaded ? <div className="spin" aria-busy="true" /> : <>
        <strong>{done ? "That's every job for now" : "Nothing to review yet"}</strong>
        <span className="apps-muted">{done ? `You went through ${done}. New ones arrive as their resumes finish.` : "Jobs show up here once their tailored resume is built."}</span>
        {history.length > 0 && <button type="button" className="apps-btn" onClick={back}>Back to the last one</button>}
      </>}
    </main> : <>
      <main className="jm-main">
        <section className="jm-job" aria-label="Job">
          <header className="jm-head">
            <CompanyLogo company={job.company} size="lg" />
            <div className="jm-id">
              <span className="jm-co">{job.company}</span>
              <h1>{job.title}</h1>
            </div>
            <span className="jm-pos" aria-live="polite">{position}</span>
          </header>
          <ul className="jm-facts">
            {job.location && <li>{formatLocation(job.location)}</li>}
            {job.jd.work && <li>{job.jd.work}</li>}
            {job.jd.kind && <li>{job.jd.kind}</li>}
            {job.jd.salary && <li className="jm-pay">{job.jd.salary}</li>}
            {job.level && <li>{job.level}</li>}
            {job.track && TRACK_LABEL[job.track] && <li>{TRACK_LABEL[job.track]} track</li>}
            {ago(job.postedAt ?? job.foundAt) && <li>{ago(job.postedAt ?? job.foundAt)}</li>}
            {job.applyType === "easy_apply" && <li>Easy Apply</li>}
          </ul>
          {job.jd.flags.length > 0 && <p className="jm-flags">{job.jd.flags.map((f) => <span key={f}>{f}</span>)}</p>}
          <div className="jm-panel">
            <div className="jm-score" aria-label="Match summary">
              <div><strong className={score != null && score >= 80 ? "jm-good" : undefined}>{score != null ? Math.round(score) : "–"}{score != null && <small>/100</small>}</strong><span>Match</span></div>
              <div><strong className={skillsTotal && skillsHit === skillsTotal ? "jm-good" : undefined}>{skillsTotal ? skillsHit : "–"}{skillsTotal > 0 && <small>/{skillsTotal}</small>}</strong><span>Skills match</span></div>
              <div><strong className="jm-text">{job.level ?? "Not stated"}</strong><span>Seniority</span></div>
            </div>
            {fit && (fit.confidence === "low" || fit.outside_roles) && <p className="jm-conf">{fit.outside_roles ? "Outside the roles your bank supports. " : ""}{fit.confidence === "low" ? `Low confidence: ${fit.confidence_reasons[0] ?? "the posting says little"}.` : ""}</p>}
            {why && <section className="jm-block"><h2>Why it matches you</h2><p>{why}</p></section>}
            {skills.length > 0 && <section className="jm-block"><h2>Key skills they need</h2>
              <ul className="jm-chips">{skills.map((k) => <li key={`${k.class}:${k.label}`} className={k.status === "matched" ? "jm-in" : k.status === "partial" ? "jm-part" : "jm-out"} title={k.class}>{k.label}</li>)}</ul></section>}
            {glance && <section className="jm-block"><h2>Role at a glance</h2><p>{glance}</p></section>}
            {fit && <section className="jm-block jm-gaps"><h2>What we’re missing</h2>
              {missing.length || partial.length ? <>
                <ul className="jm-chips">{missing.map((k) => <li key={k.label} className="jm-out">{k.label}</li>)}{partial.map((k) => <li key={k.label} className="jm-part" title="Related experience only">{k.label}</li>)}</ul>
                <p className="apps-muted">Asked for by the job; your bank shows {missing.length ? "no evidence" : "only related work"} for these. <a className="apps-link" href={`/resume_builder?job=${encodeURIComponent(job.id)}`}>Edit the resume ↗</a></p>
              </> : <p className="apps-muted">{skillsTotal ? "Everything the job asks for is in your bank." : "No specific skills were found in this posting."}</p>}
              {toCheck.length > 0 && <ul className="jm-check">{toCheck.map((i) => <li key={i.type} className={`is-${i.status}`}><b>{i.status === "blocked" ? "Likely mismatch" : "Check"}:</b> {i.reason}</li>)}</ul>}
            </section>}
            {leftOff.length > 0 && <section className="jm-block jm-evidence"><h2>Your resume leaves these out</h2>
              <p className="apps-muted">You have them; the job asks for them. Add the bullet to the resume if you want it counted.</p>
              <ul>{leftOff.slice(0, 5).map((d) => <li key={d.label}><b>{d.label}</b>{d.class === "preferred" && <em> preferred</em>}
                {d.text ? <span>{d.as === "bullet" ? <>“{d.text}”</> : <>listed under tools</>}{d.entry ? <small> · {d.entry}</small> : null}</span> : null}</li>)}</ul>
              {leftOff.length > 5 && <p className="apps-muted">+{leftOff.length - 5} more</p>}
              <a className="apps-link" href={`/resume_builder?job=${encodeURIComponent(job.id)}`}>Edit the resume ↗</a>
            </section>}
            <section className="jm-block jm-fulljd">
              <div><h2>Full job description</h2><p className="apps-muted">Skills your bank shows are highlighted green.</p></div>
              <button type="button" className="apps-link" onClick={() => setFull(true)}>View <kbd>F</kbd></button>
            </section>
          </div>
        </section>

        <section className="jm-resume" aria-label="Tailored resume">
          <header className="jm-rhead">
            <b>Tailored resume</b>
            <a className="apps-link" href={`/resume_builder?job=${encodeURIComponent(job.id)}`}>Edit resume ↗</a>
            {job.ready && <span className={`jm-ready is-${job.ready.status.toLowerCase().replace(" ", "-")}`} title={[...job.ready.reasons, ...(job.ready.notes ?? []), job.ready.skills_checked ? "" : "Skills not checked against Fit yet"].filter(Boolean).join(". ")}>Resume Ready · {job.ready.status}</span>}
            {ats?.roomLines != null && <span className="apps-muted">{ats.roomLines >= 3 ? `Room for ~${ats.roomLines} lines` : "One-page limit"}</span>}
          </header>
          <div className="jm-page-box">
            {imgOk ? <img key={job.id} src={imageUrl(job)} alt={`Tailored resume for ${job.company}`} onError={() => setImgOk(false)} />
              : <p className="apps-muted">The resume preview didn't load. <a href={job.resumeObject ? `${getTailorServerBase()}/applications/resume-file?sha=${job.resumeObject.sha256}&kind=pdf` : `${getTailorServerBase()}/serve-pdf?path=${encodeURIComponent(job.resumePath)}`} target="_blank" rel="noreferrer">Open the PDF ↗</a></p>}
          </div>
        </section>
      </main>

      <footer className="jm-actions">
        <button type="button" className="apps-btn jm-back" onClick={back} disabled={!history.length} title="Undo the last choice (P)">← Previous</button>
        <button type="button" className="apps-btn jm-skip" onClick={() => decide("skip")}>Not apply <kbd>←</kbd></button>
        <button type="button" className="apps-btn jm-later" onClick={() => decide("later")} title="Come back to it after the rest (S)">Save for later <kbd>S</kbd></button>
        <button type="button" className="rv-primary jm-go" onClick={() => decide("apply")}>Apply <kbd>→</kbd></button>
      </footer>

      {full && <div className="jm-overlay" onClick={() => setFull(false)}>
        <div className="jm-sheet" role="dialog" aria-label="Full job description" onClick={(e) => e.stopPropagation()}>
          <header><div><b>{job.company}</b><span> · {job.title}</span></div><button type="button" className="apps-btn" onClick={() => setFull(false)}>Close <kbd>Esc</kbd></button></header>
          <div className="jm-sheet-body"><Description job={job} /></div>
        </div>
      </div>}
    </>}
  </div>;
}
