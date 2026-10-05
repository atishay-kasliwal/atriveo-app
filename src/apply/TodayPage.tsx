import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import OpenFillQueue from "./OpenFillQueue";
import ApplicationReview from "./ApplicationReview";
import PdfPreviewModal from "../components/PdfPreviewModal";
import CompanyLogo from "../components/CompanyLogo";
import { postAction, when } from "./engine";
import { applyWithExtension, armExtension, canApplyAnywhere, canQueueApply, extensionVersion, noteLinkedinOpen } from "./openFill";
import { blocking } from "./questionGroups";
import { discardNow, dismissJobs, markJobsApplied } from "./discard";
import { adjustCounts, loadCards, refreshLinkedin, refreshReady, refreshUnanswered, useLinkedinQueue, useReadyQueue, useUnansweredCards, useUnansweredQueue, type ManualApp, type QueuedApp, type ReadyApp } from "./reviewQueue";
import "../styles/applications.css";
import "./review-pages.css";
import "./today.css";

// Today: every application waiting for you, five at a time, the ones you can apply to now first. Their main
// button is Open & Fill: a form the engine verified opens armed with those answers; any other (answers approved,
// or every question answered or drafted) opens its job page, where Apply with Atriveo (the toolbar button) fills
// it live and shows each answer, drafts included, in its side panel. You always click Submit. Applications with
// a question nobody has answered come last and send you to To answer, which shows only those questions.

type Kind = "you_submit" | "approve" | "fill" | "drafted" | "linkedin" | "answer";
interface Item { resumePath?: string | null; track?: string | null; toAnswer?: number; location?: string | null; score?: number | null; age?: string | null; id: string; kind: Kind; company: string; title: string; ats: string | null; url?: string; updatedAt: string; priorityTags?: string[]; ready?: ReadyApp | ManualApp; queued?: QueuedApp }

/** The resume track's short name (TRACKS.yaml ids). */
const TRACK_LABEL: Record<string, string> = { "software-engineer": "SWE", "ai-engineer": "AI", "data-science": "Data science", "data-analytics": "Analytics", "forward-deployed": "FDE" };

/** A North Carolina job (they come first). */
const NC = /\b(NC|North Carolina|Raleigh|Durham|Charlotte|Cary|Chapel Hill|Morrisville|Research Triangle|RTP|Greensboro|Winston[- ]Salem|Wilmington|Apex)\b/i;
export const inNC = (location?: string | null) => Boolean(location && NC.test(location));

/** "3h", "2d", "5w": how long ago the posting went up (or was found). */
function ago(iso?: string | null): string | null {
  if (!iso) return null;
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (!Number.isFinite(h)) return null;
  return h < 1 ? "just now" : h < 24 ? `${Math.floor(h)}h ago` : h < 24 * 14 ? `${Math.floor(h / 24)}d ago` : `${Math.floor(h / 24 / 7)}w ago`;
}

/** Sites Atriveo Fill fills by itself (Apply with Atriveo, full support). */
const AUTO_ATS = ["greenhouse", "lever", "ashby"];

const STAGE: Record<Kind, { label: string; tone: string }> = {
  you_submit: { label: "You submit", tone: "go" },
  approve: { label: "Approve to submit", tone: "go" },
  fill: { label: "Answers approved", tone: "info" },
  drafted: { label: "Answers drafted", tone: "info" },
  linkedin: { label: "On LinkedIn", tone: "info" },
  answer: { label: "Needs your answers", tone: "warn" },
};

/** Cards across, and rows that fit the window (a second row of five on a tall screen). */
function useLayout() {
  const pick = () => ({
    columns: window.innerWidth >= 1400 ? 5 : window.innerWidth >= 1100 ? 4 : window.innerWidth >= 760 ? 2 : 1,
    rows: window.innerWidth >= 760 && window.innerHeight >= 860 ? 2 : 1,
  });
  const [n, setN] = useState(pick);
  useEffect(() => { const f = () => setN(pick()); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return n;
}

export default function TodayPage({ header }: { header?: React.ReactNode }) {
  const unanswered = useUnansweredQueue(60_000);
  const ready = useReadyQueue(60_000);
  const linkedin = useLinkedinQueue(300_000);
  const { cards } = useUnansweredCards();
  const navigate = useNavigate();
  const { columns, rows } = useLayout();
  const perPage = columns * rows;
  const [queueRunning, setQueueRunning] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [review, setReview] = useState<{ id: string; updatedAt: string; company: string; mode: "answers" | "resume" } | null>(null);
  const [page, setPage] = useState(0);
  const [done, setDone] = useState<Record<string, string>>({});
  const [later, setLater] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [confirmAll, setConfirmAll] = useState<"approve" | "fill" | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // The tailored resume of a card with no application (On LinkedIn), shown from its file.
  const [pdf, setPdf] = useState<string | null>(null);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(""), 7000); return () => clearTimeout(t); }, [notice]);

  const items = useMemo<Item[]>(() => {
    const manual = ready.data?.manual ?? [];
    const manualIds = new Set(manual.map((r) => r.id));
    const fromReady = (r: ReadyApp, kind: Kind): Item => ({ id: r.id, kind, company: r.company, title: r.title, ats: r.ats, url: r.url, updatedAt: r.updatedAt, priorityTags: r.priorityTags, ready: r,
      location: r.location, score: r.score ?? null, track: r.track ?? null, age: r.postedAt ?? r.foundAt ?? r.createdAt ?? null });
    const fromQueue = (q: QueuedApp): Item => {
      const c = cards[q.id];
      // Only required questions nobody answered hold it back (optional ones and resume fields are left to the page).
      const current = c && c.updatedAt >= q.updatedAt ? c : null;
      const toAnswer = current ? current.questions.filter(blocking).length : q.needsInput ?? 0;
      return { toAnswer, id: q.id, kind: !q.n ? "fill" : toAnswer > 0 ? "answer" : "drafted", company: q.company ?? c?.company ?? "Loading…", title: q.title ?? c?.title ?? "", ats: c?.ats ?? null, url: c?.url, updatedAt: q.updatedAt, priorityTags: q.priorityTags ?? c?.priorityTags, queued: q,
        location: q.location ?? c?.location ?? null, score: q.score ?? null, track: q.track ?? null, age: q.postedAt ?? q.foundAt ?? q.createdAt ?? null };
    };
    // What you can act on now comes first (Open & Fill: approved or drafted alike), then what needs answers;
    // within each, North Carolina first, then the newest posting, then the best match.
    const order: Record<Kind, number> = { you_submit: 0, approve: 1, fill: 2, drafted: 2, linkedin: 2, answer: 3 };
    const all = [
      ...manual.map((r) => fromReady(r, "you_submit")),
      ...(ready.data?.ready ?? []).filter((r) => !manualIds.has(r.id)).map((r) => fromReady(r, "approve")),
      ...(unanswered.data?.unanswered ?? []).map(fromQueue),
      // LinkedIn postings: no application (the engine never applies on LinkedIn); same score, place and age.
      ...(linkedin.data?.linkedin ?? []).map((l): Item => ({ id: l.id, kind: "linkedin", company: l.company, title: l.title, ats: null, url: l.url,
        updatedAt: l.foundAt ?? "", location: l.location, score: l.score, track: l.track, age: l.postedAt ?? l.foundAt, resumePath: l.resumePath ?? null })),
    ];
    return all
      .filter((i) => done[i.id] !== i.updatedAt)
      .sort((a, b) => Number(later.includes(a.id)) - Number(later.includes(b.id)) || order[a.kind] - order[b.kind]
        || Number(inNC(b.location)) - Number(inNC(a.location)) || (b.age ?? "").localeCompare(a.age ?? "") || (b.score ?? -1) - (a.score ?? -1));
  }, [ready.data, unanswered.data, linkedin.data, cards, done, later]);

  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const current = Math.min(page, pages - 1);
  const shown = items.slice(current * perPage, (current + 1) * perPage);
  // The job links of the cards on screen (questions load with them; a page of ten at a time).
  const shownQueued = shown.flatMap((i) => i.queued ? [i.queued] : []);
  const shownKey = shownQueued.map((q) => `${q.id}@${q.updatedAt}`).join(",");
  useEffect(() => { if (shownQueued.length) void loadCards(shownQueued); }, [shownKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Every queued card's questions and link (Select all covers every page; a card whose only open questions are
  // optional or resume fields moves up to Open & Fill once they load).
  const openFillQueued = items.flatMap((i) => i.queued ? [i.queued] : []);
  const openFillKey = openFillQueued.map((q) => `${q.id}@${q.updatedAt}`).join(",");
  useEffect(() => { if (openFillQueued.length) void loadCards(openFillQueued); }, [openFillKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = (k: Kind) => items.filter((i) => i.kind === k).length;
  const approvable = items.filter((i) => i.kind === "approve");
  const fillable = items.filter((i) => i.kind === "fill");
  // The queue takes You submit (armed Open & Fill), and with Atriveo Fill 0.7.1 every other Open & Fill card it can fill by itself.
  const selectable = (i: Item) => i.kind === "you_submit" || ((i.kind === "fill" || i.kind === "drafted") && Boolean(i.url) && AUTO_ATS.includes(i.ats ?? "") && canQueueApply());
  const queueable = items.filter(selectable);
  const queued = items.filter((i) => selectable(i) && selectedIds.includes(i.id)).map((i) => ({ id: i.id, company: i.company, ...(i.kind === "you_submit" ? {} : { url: i.url }) }));
  const worker = unanswered.data?.worker ?? ready.data?.worker ?? null;

  const finish = (item: Item, message: string, delta: Parameters<typeof adjustCounts>[0]) => {
    setDone((d) => ({ ...d, [item.id]: item.updatedAt }));
    adjustCounts(delta);
    setNotice(message);
    setTimeout(() => { void refreshReady(); void refreshUnanswered(); }, 1500);
  };
  const run = async (item: Item, body: object, onOk: () => void) => {
    setBusy(item.id);
    setErrors((e) => ({ ...e, [item.id]: "" }));
    const res = await postAction({ ...body, applicationId: item.id, expectedUpdatedAt: item.updatedAt });
    setBusy(null);
    if (!res.ok) { setErrors((e) => ({ ...e, [item.id]: res.error ?? "Couldn't do that" })); if (/changed/i.test(res.error ?? "")) { void refreshReady(); void refreshUnanswered(); } return; }
    onOk();
  };

  /** Open & Fill, as on the Ready page: the tab opens during your click, then points at the form once armed. */
  const openFill = async (item: Item) => {
    const version = (extensionVersion() ?? "0.0.0").split(".").map(Number);
    const minimum = item.ats === "workday" ? [0, 3, 0] : [0, 2, 3];
    const installed = (version[0] ?? 0) * 1_000_000 + (version[1] ?? 0) * 1000 + (version[2] ?? 0);
    const required = minimum[0]! * 1_000_000 + minimum[1]! * 1000 + minimum[2]!;
    if (["greenhouse", "workday"].includes(item.ats ?? "") && (!Number.isFinite(installed) || installed < required)) {
      setErrors(e => ({ ...e, [item.id]: `Reload Atriveo Fill ${minimum.join(".")} or newer in chrome://extensions, then refresh this page.` }));
      return;
    }
    const tab = window.open("about:blank", "_blank");
    setBusy(item.id);
    setErrors((e) => ({ ...e, [item.id]: "" }));
    const res = await postAction({ action: "open_and_fill", applicationId: item.id, expectedUpdatedAt: item.updatedAt });
    const armed = res.ok && res.url ? await armExtension(res.url, item.id) : null;
    setBusy(null);
    if (!res.ok || !res.url || !armed?.ok) {
      tab?.close();
      setErrors((e) => ({ ...e, [item.id]: !res.ok ? res.error ?? "Couldn't open it" : armed?.error ?? "Couldn't open it" }));
      return;
    }
    if (tab) { tab.opener = null; tab.location.href = res.url; } else window.open(res.url, "_blank", "noopener");
    setNotice(`Opened ${item.company}. Atriveo Fill fills it and stops; review it and click Submit yourself.`);
    setTimeout(() => void refreshReady(), 1500);
  };

  /**
   * Open & Fill for a form the engine hasn't verified. Atriveo Fill 0.5+ opens it and fills it by itself
   * (Greenhouse, Lever, Ashby); older versions and other sites open the page for the toolbar button.
   */
  const openInBrowser = async (item: Item) => {
    if (canApplyAnywhere() && item.url && AUTO_ATS.includes(item.ats ?? "")) {
      setBusy(item.id);
      setErrors((e) => ({ ...e, [item.id]: "" }));
      const res = await applyWithExtension(item.url, item.id);
      setBusy(null);
      if (!res.ok) { setErrors((e) => ({ ...e, [item.id]: res.error ?? "Atriveo Fill didn't answer" })); return; }
      setDone((d) => ({ ...d, [item.id]: item.updatedAt }));
      setNotice(`Opened ${item.company}. Atriveo is filling it now; check the page and click Submit. The Atriveo icon shows what it did.`);
      return;
    }
    const [major = 0, minor = 0] = (extensionVersion() ?? "0.0.0").split(".").map(Number);
    if (major * 1000 + minor < 4) {
      setErrors((e) => ({ ...e, [item.id]: "Needs Atriveo Fill 0.4 or newer: reload it in chrome://extensions, then refresh this page." }));
      return;
    }
    if (!item.url) { setErrors((e) => ({ ...e, [item.id]: "Still loading this job's link; try again in a moment." })); return; }
    window.open(item.url, "_blank", "noopener");
    setDone((d) => ({ ...d, [item.id]: item.updatedAt }));
    setNotice(`Opened ${item.company}. Click Apply with Atriveo in Chrome's toolbar there: it fills the form and lists every answer in its side panel. You click Submit.`);
  };

  /** Start filling every application whose answers you approved. Filling checks the form; it never submits. */
  const fillAll = async () => {
    setConfirmAll(null);
    let ok = 0;
    for (const item of fillable) {
      setBusy(item.id);
      const res = await postAction({ action: "continue_application", applicationId: item.id, expectedUpdatedAt: item.updatedAt });
      if (res.ok) { ok += 1; setDone((d) => ({ ...d, [item.id]: item.updatedAt })); }
      else setErrors((e) => ({ ...e, [item.id]: res.error ?? "Couldn't start filling" }));
    }
    setBusy(null);
    setNotice(`Started filling ${ok} of ${fillable.length}. Each moves on once its answers check out. Nothing is submitted.`);
    void refreshUnanswered();
  };

  const approveAll = async () => {
    setConfirmAll(null);
    let ok = 0;
    for (const item of approvable) {
      setBusy(item.id);
      const res = await postAction({ action: "approve_submit", applicationId: item.id, expectedUpdatedAt: item.updatedAt });
      if (res.ok) { ok += 1; setDone((d) => ({ ...d, [item.id]: item.updatedAt })); adjustCounts({ ready: -1 }); }
      else setErrors((e) => ({ ...e, [item.id]: res.error ?? "Couldn't approve" }));
    }
    setBusy(null);
    setNotice(`Approved ${ok} of ${approvable.length}. The worker refills, checks and submits them one by one.`);
    void refreshReady();
  };

  /** Discard: the engine marks it skipped (history kept); active approvals and attempted submissions are refused. */
  const discard = async (ids: string[]) => {
    if (!ids.length) return;
    setBusy(ids.length === 1 ? ids[0]! : "discard");
    try {
      // LinkedIn postings have no application: they're dismissed as jobs; the rest are discarded applications.
      const jobIds = ids.filter((id) => items.find((i) => i.id === id)?.kind === "linkedin");
      const appIds = ids.filter((id) => !jobIds.includes(id));
      const [r, j] = await Promise.all([appIds.length ? discardNow(appIds) : { discarded: [] as string[], errors: [] as string[] }, jobIds.length ? dismissJobs(jobIds) : { dismissed: [] as string[], errors: [] as string[] }]);
      r.discarded.push(...j.dismissed); r.errors.push(...j.errors);
      if (j.dismissed.length) setTimeout(() => void refreshLinkedin(), 1500);
      const gone = new Set(r.discarded);
      setDone((d) => ({ ...d, ...Object.fromEntries(items.filter((i) => gone.has(i.id)).map((i) => [i.id, i.updatedAt])) }));
      setSelectedIds((s) => s.filter((id) => !gone.has(id)));
      setNotice(`Discarded ${gone.size}${r.errors.length ? ` · ${r.errors.length} kept: ${r.errors[0]}` : ""}`);
      setTimeout(() => { void refreshReady(); void refreshUnanswered(); }, 1500);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); setConfirmDiscard(false); }
  };

  /** "Mark applied" on an On LinkedIn card (you applied without Atriveo's tracking): it leaves Today. */
  const markApplied = async (item: Item) => {
    setBusy(item.id);
    const r = await markJobsApplied([item.id]).catch((e) => ({ marked: [] as string[], errors: [String(e)] }));
    setBusy(null);
    if (!r.marked.length) { setErrors((e) => ({ ...e, [item.id]: r.errors[0] ?? "Couldn't save" })); return; }
    setDone((d) => ({ ...d, [item.id]: item.updatedAt }));
    setNotice(`Marked ${item.company} as applied.`);
    setTimeout(() => void refreshLinkedin(), 1500);
  };

  const card = (item: Item) => {
    const stage = STAGE[item.kind];
    const q = item.queued;
    const r = item.ready as ManualApp | undefined;
    const drafted = q ? (q.readyForReview ?? q.suggestions ?? 0) : 0;
    const isBusy = queueRunning || busy === item.id;
    const nc = inNC(item.location);
    const age = ago(item.age);
    const tags = (item.priorityTags ?? []).filter((t) => !item.location?.includes(t));
    return (
      <article key={item.id} className={`td-card is-${stage.tone} ${selectedIds.includes(item.id) ? "is-selected" : ""}`} aria-label={`${item.company}: ${stage.label}`} aria-busy={isBusy}>
        <header className="td-head">
          <input type="checkbox" className="td-check" disabled={queueRunning} aria-label={`Select ${item.company} ${item.title}`} checked={selectedIds.includes(item.id)} onChange={e => setSelectedIds(ids => e.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} />
          <CompanyLogo company={item.company} size="sm" />
          <div className="td-id"><strong title={item.company}>{item.company}</strong><span title={item.title}>{item.title}</span></div>
          {item.score != null && <span className={`td-score ${item.score >= 60 ? "is-high" : item.score >= 35 ? "is-mid" : ""}`} style={{ ["--pct" as string]: `${Math.min(100, item.score)}%` }} title={`Match score ${item.score}%`}><b>{item.score}</b></span>}
        </header>
        <div className="td-meta">
          {item.location && <span className={`td-loc ${nc ? "is-nc" : ""}`} title={item.location}>{nc ? "★ " : ""}{item.location}</span>}
          {age && <span className="td-age" title={item.age ?? undefined}>{age}</span>}
        </div>
        <div className="td-tags"><span className={`td-stage is-${stage.tone}`}>{stage.label}</span>{item.track && TRACK_LABEL[item.track] && <span className={`td-track is-${item.track}`} title="Resume track">{TRACK_LABEL[item.track]}</span>}{tags.map((t) => <span key={t} className={`td-tag ${t === "Strong match" ? "is-strong" : ""}`}>{t}</span>)}</div>
        <div className="td-body">
          {item.kind === "drafted" && q && <>
            <p className="td-big">{drafted || q.n} answer{(drafted || q.n) === 1 ? "" : "s"} drafted</p>
            <p className="td-note">Atriveo fills them on the job page; you check, then Submit.</p>
          </>}
          {item.kind === "answer" && q && <>
            <p className="td-big">{item.toAnswer} question{item.toAnswer === 1 ? "" : "s"} to answer</p>
            <p className="td-note">Answer {item.toAnswer === 1 ? "it" : "them"} once; then it moves up for Open & Fill.</p>
          </>}
          {item.kind === "fill" && <p className="td-note">Every answer is approved. Atriveo fills it on the job page; you check, then Submit.</p>}
          {item.kind === "linkedin" && <>
            <p className="td-big">Resume ready</p>
            <p className="td-note">Apply on LinkedIn, then Atriveo → Apply on this page on the company's form.</p>
          </>}
          {item.kind === "approve" && r && <>
            <p className="td-big">{r.answered} answers verified</p>
            <p className="td-note">Filled {when(r.filledAt)}{r.resumeFile ? ` · ${r.resumeFile}` : ""}.</p>
            {r.companySubmittedToday && <p className="td-note warn">Already submitted to {item.company} today: this one goes out tomorrow.</p>}
          </>}
          {item.kind === "you_submit" && r && <>
            <p className="td-big">{r.answered} answers verified</p>
            <p className="td-note">{r.openFill?.filledAt ? `Atriveo Fill filled ${r.openFill.filled ?? 0} fields ${when(r.openFill.filledAt)}.` : "Opens in your Chrome; Atriveo Fill fills it and you click Submit."}</p>
          </>}
          {errors[item.id] && <p className="td-error" role="alert">{errors[item.id]}</p>}
        </div>
        <footer className="td-foot">
          {item.kind === "linkedin" && <a className="td-cta td-cta-linkedin" href={item.url} target="_blank" rel="noreferrer" onClick={() => noteLinkedinOpen(item.url!, item.company, item.title)}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45z"/></svg>
            Open on LinkedIn<span aria-hidden="true">↗</span></a>}
          {(item.kind === "drafted" || item.kind === "fill") && <button className="rv-primary" disabled={isBusy} onClick={() => void openInBrowser(item)}>{busy === item.id ? "Opening…" : "Open & Fill"}</button>}
          {item.kind === "answer" && <button className="rv-primary" disabled={isBusy} onClick={() => navigate(`/unanswered?app=${encodeURIComponent(item.id)}`)}>Answer {item.toAnswer ?? ""}</button>}
          {item.kind === "approve" && <button className="rv-primary" disabled={isBusy} onClick={() => void run(item, { action: "approve_submit" }, () => finish(item, `Approved ${item.company}. The worker refills it, checks it again and submits.`, { ready: -1 }))}>{isBusy ? "Approving…" : "Approve submit"}</button>}
          {item.kind === "you_submit" && <button className="rv-primary" disabled={isBusy} onClick={() => void openFill(item)}>{isBusy ? "Opening…" : "Open & Fill"}</button>}
          {item.kind === "approve" && ["greenhouse", "ashby", "lever", "workday"].includes(item.ats ?? "") && <button className="apps-btn" disabled={isBusy} onClick={() => void openFill(item)}>Open & Fill</button>}
          <div className="td-review-links">
            {(item.kind === "approve" || item.kind === "you_submit") && <button className="apps-btn" onClick={() => setReview({ ...item, mode: "answers" })}>Answers</button>}
            {item.kind !== "linkedin" && <button className="apps-btn" onClick={() => setReview({ ...item, mode: "resume" })}>Resume</button>}
            {item.kind === "linkedin" && item.resumePath && <button className="td-ghost" onClick={() => setPdf(item.resumePath!)}><span aria-hidden="true">📄</span> Resume</button>}
            {item.kind === "linkedin" && <button className="td-ghost td-applied" disabled={isBusy} onClick={() => void markApplied(item)}><span aria-hidden="true">✓</span> Mark applied</button>}
            {item.url && item.kind !== "linkedin" && <a className="apps-btn" href={item.url} target="_blank" rel="noreferrer">Job ↗</a>}
          </div>
          <div className="td-links">
            <button className="apps-link" disabled={isBusy} onClick={() => setLater((l) => [...l.filter((id) => id !== item.id), item.id])}>Later</button>
            {(item.kind === "approve" || item.kind === "you_submit") && <Link to={`/ready?app=${encodeURIComponent(item.id)}`}>Details</Link>}
            <button className="apps-link td-discard" disabled={isBusy} onClick={() => void discard([item.id])}>Discard</button>
          </div>
        </footer>
      </article>
    );
  };

  const loading = !unanswered.data && !ready.data;
  return (
    <div className="rv-page td-page">
      {header}
      <div className="td-bar">
        <div className="td-title"><h1>Today</h1><span className="apps-muted">{loading ? "Loading…" : `${items.length} application${items.length === 1 ? "" : "s"} waiting for you`}</span></div>
        <ol className="td-strip" aria-label="Where your applications are">
          <li className="go"><b>{count("you_submit")}</b><span>You submit</span></li>
          <li className="go"><b>{count("approve")}</b><span>Approve to submit</span></li>
          <li className="go"><b>{count("fill") + count("drafted")}</b><span>Open & Fill</span></li>
          <li><b>{count("linkedin")}</b><span>On LinkedIn</span></li>
          <li className="td-strip-link"><Link to="/unanswered"><b>{count("answer")}</b><span>Need your answers →</span></Link></li>
        </ol>
        <div className="td-actions">
          {selectedIds.length > 0 && (confirmDiscard
            ? <span className="td-confirm">Discard {selectedIds.length}? <button className="apps-btn danger" disabled={busy !== null} onClick={() => void discard(selectedIds)}>Discard</button><button className="apps-link" onClick={() => setConfirmDiscard(false)}>Cancel</button></span>
            : <button className="apps-btn" disabled={queueRunning || busy !== null} onClick={() => setConfirmDiscard(true)}>Discard selected ({selectedIds.length})</button>)}
          {queueable.length > 0 && <><button className="apps-btn" disabled={queueRunning} onClick={() => setSelectedIds(queueable.map(i => i.id))}>Select all Open & Fill ({queueable.length})</button><button className="apps-btn" disabled={queueRunning || !selectedIds.length} onClick={() => setSelectedIds([])}>Clear</button><OpenFillQueue onRunning={setQueueRunning} selected={queued} onFilled={(id) => { const it = items.find((i) => i.id === id); if (it) setDone((d) => ({ ...d, [id]: it.updatedAt })); setSelectedIds((ids) => ids.filter((x) => x !== id)); }} onFinish={() => { void refreshReady(); void refreshUnanswered(); }} /></>}
          {worker && <span className={`apps-state ${worker.online ? "" : "bad"}`}><i aria-hidden />{worker.online ? "Worker running" : "Worker offline"}</span>}
          {fillable.length > 0 && <button className="apps-btn" disabled={busy !== null || queueRunning} onClick={() => setConfirmAll("fill")}>Fill and verify all {fillable.length}</button>}
          {approvable.length > 0 && <button className="apps-btn" disabled={busy !== null || queueRunning} onClick={() => setConfirmAll("approve")}>Approve all {approvable.length} ready</button>}
        </div>
      </div>
      {(unanswered.error || ready.error) && <p className="ar-error" role="alert">{unanswered.error || ready.error}</p>}
      <main className="td-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
        {loading && <div className="td-empty">Loading your applications…</div>}
        {!loading && !items.length && <div className="td-empty"><strong>Nothing is waiting for you.</strong><span>New applications show up here once their questions are collected.</span></div>}
        {shown.map(card)}
      </main>
      {items.length > perPage && (
        <nav className="td-pager" aria-label="More applications">
          <button className="apps-btn" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Previous applications">←</button>
          <span>{current * perPage + 1}–{Math.min((current + 1) * perPage, items.length)} of {items.length}</span>
          <button className="apps-btn" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)} aria-label="Next applications">→</button>
        </nav>
      )}
      {confirmAll && (() => {
        const list = confirmAll === "approve" ? approvable : fillable;
        return (
          <div className="td-modal" role="dialog" aria-modal="true" aria-label={confirmAll === "approve" ? "Approve all ready applications" : "Fill and verify all approved applications"}>
            <div className="td-modal-card">
              <h2>{confirmAll === "approve" ? `Approve ${list.length} for submission?` : `Fill and verify ${list.length}?`}</h2>
              <p className="apps-muted">{confirmAll === "approve" ? "The worker refills each one, checks every answer again, and submits it. One per company per day." : "The worker fills each form with your approved answers and checks every one. Nothing is submitted: each comes back to you to approve."}</p>
              <ul>{list.map((i) => <li key={i.id}><b>{i.company}</b> · {i.title}</li>)}</ul>
              <div className="td-modal-actions"><button className="apps-btn" onClick={() => setConfirmAll(null)}>Cancel</button><button className="rv-primary" onClick={() => void (confirmAll === "approve" ? approveAll() : fillAll())}>{confirmAll === "approve" ? `Approve ${list.length}` : `Fill and verify ${list.length}`}</button></div>
            </div>
          </div>
        );
      })()}
      {pdf && <PdfPreviewModal pdfPath={pdf} onClose={() => setPdf(null)} />}
      {review && <ApplicationReview key={`${review.id}:${review.mode}`} application={review} onClose={() => setReview(null)} />}
      {notice && <div className="apps-toast" role="status"><span>{notice}</span><button type="button" className="apps-toast-close" aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}
    </div>
  );
}
