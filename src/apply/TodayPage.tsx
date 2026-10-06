import { useEffect, useMemo, useRef, useState } from "react";
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
import { GOALS, readPref, useAppliedToday, writePref } from "./todayGoal";
import { useExclusions } from "../hooks/useExclusions";
import { getTailorServerBase } from "../utils/tailorServer";
import "../styles/applications.css";
import "./review-pages.css";
import "./today.css";

// Today: every application waiting for you, five at a time, the ones you can apply to now first. Their main
// button is Open & Fill: a form the engine verified opens armed with those answers; any other (answers approved,
// or every question answered or drafted) opens its job page, where Apply with Atriveo (the toolbar button) fills
// it live and shows each answer, drafts included, in its side panel. You always click Submit. Applications with
// a question nobody has answered come last and send you to To answer, which shows only those questions.

type Kind = "you_submit" | "approve" | "fill" | "drafted" | "linkedin" | "answer";
interface Item { easyApply?: boolean; resumePath?: string | null; track?: string | null; toAnswer?: number; location?: string | null; score?: number | null; age?: string | null; id: string; kind: Kind; company: string; title: string; ats: string | null; url?: string; updatedAt: string; priorityTags?: string[]; ready?: ReadyApp | ManualApp; queued?: QueuedApp }

/** The resume track's short name (TRACKS.yaml ids). */
const TRACK_LABEL: Record<string, string> = { "software-engineer": "SWE", "ai-engineer": "AI", "data-analytics": "Data Analyst", "data-science": "DS", "forward-deployed": "FDE" };

/** The mood bar: one track at a time (keys 1–7), or Mixed, which takes the tracks in turn. */
type TrackFilter = "all" | "mixed" | keyof typeof TRACK_LABEL;
const TRACK_FILTERS: TrackFilter[] = ["all", ...Object.keys(TRACK_LABEL), "mixed"];
/** What you do with it: Open & Fill (you submit, approve, approved or drafted answers), On LinkedIn, or answer first. */
type KindFilter = "all" | "fill" | "linkedin" | "answer";
const KIND_OF: Record<Kind, KindFilter> = { you_submit: "fill", approve: "fill", fill: "fill", drafted: "fill", linkedin: "linkedin", answer: "answer" };
const KIND_LABEL: Record<Exclude<KindFilter, "all">, string> = { fill: "Open & Fill", linkedin: "On LinkedIn", answer: "Need answers" };

/** The tracks in turn (a SWE, an AI, a Data Analyst…), each in its own order; untracked jobs keep their place in the turn. */
function interleave<T extends { track?: string | null }>(list: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const i of list) { const k = i.track && TRACK_LABEL[i.track] ? i.track : "other"; groups.set(k, [...(groups.get(k) ?? []), i]); }
  const out: T[] = [];
  for (let round = 0; out.length < list.length; round++) for (const g of groups.values()) if (g[round]) out.push(g[round]!);
  return out;
}

/** General resumes, one per track (scripts/general-resumes.mjs builds them into the resume folder's general/). */
const GENERAL_RESUMES: Array<{ track: keyof typeof TRACK_LABEL; folder: string }> = [
  { track: "software-engineer", folder: "Software Engineer" }, { track: "ai-engineer", folder: "AI Engineer" }, { track: "data-analytics", folder: "Data Analyst" },
  { track: "data-science", folder: "Data Scientist" }, { track: "forward-deployed", folder: "Forward Deployed Engineer" },
];

/** Postings older than this have no freshness left on the bar. */
const FRESH_HOURS = 72;

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
  // Later is remembered in this browser for a week, so a refresh keeps those cards at the end.
  const [laterAt, setLaterAt] = useState<Record<string, number>>(() => Object.fromEntries(Object.entries(readPref<Record<string, number>>("later", {})).filter(([, at]) => at > Date.now() - 7 * 86_400_000)));
  const later = useMemo(() => Object.keys(laterAt), [laterAt]);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [confirmAll, setConfirmAll] = useState<"approve" | "fill" | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // The tailored resume of a card with no application (On LinkedIn), shown from its file.
  const [pdf, setPdf] = useState<string | null>(null);
  const [track, setTrack] = useState<TrackFilter>(() => { const t = readPref<string>("track", "all"); return (TRACK_FILTERS as string[]).includes(t) ? t as TrackFilter : "all"; });
  const [kind, setKind] = useState<KindFilter>(() => { const k = readPref<string>("kind", "all"); return ["all", "fill", "linkedin", "answer"].includes(k) ? k as KindFilter : "all"; });
  const [goal, setGoal] = useState<number>(() => { const g = readPref<number>("goal", 15); return GOALS.includes(g) ? g : 15; });
  const [focus, setFocus] = useState(0);
  const goalDay = useAppliedToday();
  // Companies you don't want now (your account's list, shared with the job feed's Settings): their cards stay off Today until you remove them.
  const { exclusions, excludeCompany, removeExclusion } = useExclusions();
  const [skipOpen, setSkipOpen] = useState(false);
  const [resumesOpen, setResumesOpen] = useState(false);
  const [skipDraft, setSkipDraft] = useState("");
  const skipped = (company: string) => { const co = company.toLowerCase(); return exclusions.companies.some((c) => co.includes(c)); };
  // A new mood starts at the top: first page, first card, nothing selected.
  const pick = (next: { track?: TrackFilter; kind?: KindFilter }) => {
    if (next.track !== undefined) { setTrack(next.track); writePref("track", next.track); }
    if (next.kind !== undefined) { setKind(next.kind); writePref("kind", next.kind); }
    setPage(0); setFocus(0); setSelectedIds([]);
  };
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(""), 7000); return () => clearTimeout(t); }, [notice]);

  const everything = useMemo<Item[]>(() => {
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
        updatedAt: l.foundAt ?? "", location: l.location, score: l.score, track: l.track, age: l.postedAt ?? l.foundAt, resumePath: l.resumePath ?? null, easyApply: l.applyType === "easy_apply" })),
    ];
    return all
      .filter((i) => done[i.id] !== i.updatedAt && !skipped(i.company))
      // Easy Apply postings (LinkedIn's own form) come after everything you can fill on a company's site.
      .sort((a, b) => Number(later.includes(a.id)) - Number(later.includes(b.id)) || (order[a.kind] + (a.easyApply ? 0.5 : 0)) - (order[b.kind] + (b.easyApply ? 0.5 : 0))
        || Number(inNC(b.location)) - Number(inNC(a.location)) || (b.age ?? "").localeCompare(a.age ?? "") || (b.score ?? -1) - (a.score ?? -1));
  }, [ready.data, unanswered.data, linkedin.data, cards, done, later, exclusions]); // eslint-disable-line react-hooks/exhaustive-deps
  // Counts on each pill: a track's count follows the chosen kind, and a kind's count follows the chosen track.
  const inTrack = (i: Item, t: TrackFilter) => t === "all" || t === "mixed" || i.track === t;
  const inKind = (i: Item, k: KindFilter) => k === "all" || KIND_OF[i.kind] === k;
  const items = useMemo(() => {
    const list = everything.filter((i) => inTrack(i, track) && inKind(i, kind));
    if (track !== "mixed") return list;
    // Mixed keeps Later cards last.
    const later_ = list.filter((i) => later.includes(i.id));
    return [...interleave(list.filter((i) => !later.includes(i.id))), ...later_];
  }, [everything, track, kind, later]);

  // The resume folder, from any tailored resume's path (general resumes sit in its general/ folder).
  const resumeRoot = useMemo(() => { const p = (linkedin.data?.linkedin ?? []).find((l) => l.resumePath?.includes("/tailored-resumes/"))?.resumePath; return p ? p.slice(0, p.indexOf("/tailored-resumes/") + "/tailored-resumes".length) : null; }, [linkedin.data]);
  const generalPath = (folder: string) => resumeRoot ? `${resumeRoot}/general/${folder}/Atishay Kasliwal.pdf` : null;
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
  const kindCount = (k: KindFilter) => everything.filter((i) => inTrack(i, track) && inKind(i, k)).length;
  const trackCount = (t: TrackFilter) => everything.filter((i) => inTrack(i, t) && inKind(i, kind)).length;
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
      const jobIds = ids.filter((id) => everything.find((i) => i.id === id)?.kind === "linkedin");
      const appIds = ids.filter((id) => !jobIds.includes(id));
      const [r, j] = await Promise.all([appIds.length ? discardNow(appIds) : { discarded: [] as string[], errors: [] as string[] }, jobIds.length ? dismissJobs(jobIds) : { dismissed: [] as string[], errors: [] as string[] }]);
      r.discarded.push(...j.dismissed); r.errors.push(...j.errors);
      if (j.dismissed.length) setTimeout(() => void refreshLinkedin(), 1500);
      const gone = new Set(r.discarded);
      setDone((d) => ({ ...d, ...Object.fromEntries(everything.filter((i) => gone.has(i.id)).map((i) => [i.id, i.updatedAt])) }));
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
    goalDay.mark();
    const n = (goalDay.applied ?? 0) + 1;
    setNotice(`Marked ${item.company} as applied. ${n} / ${goal} today${n >= goal ? " · goal reached 🎉" : ` · ${goal - n} to go`}`);
    setTimeout(() => void refreshLinkedin(), 1500);
  };

  const focused = Math.min(focus, Math.max(0, shown.length - 1));
  const later_ = (item: Item) => setLaterAt((l) => { const next = { ...l, [item.id]: Date.now() }; writePref("later", next); return next; });
  const skipCompany = (company: string) => { excludeCompany(company); setNotice(`Skipping ${company}: its jobs stay off Today until you remove it from Skipped companies.`); };
  /** O: the card's main way in (LinkedIn posting, Open & Fill); nothing for cards that need answers or approval. */
  const openCard = (item: Item) => {
    if (item.kind === "linkedin" && item.url) { noteLinkedinOpen(item.url, item.company, item.title); window.open(item.url, "_blank", "noreferrer"); }
    else if (item.kind === "fill" || item.kind === "drafted") void openInBrowser(item);
    else if (item.kind === "you_submit") void openFill(item);
  };
  // Keys: 1–7 pick a track, ←/→ (↑/↓ by row) move between cards and pages, A/L/D/O act on the outlined card.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || review || pdf || confirmAll || queueRunning) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= TRACK_FILTERS.length) { pick({ track: TRACK_FILTERS[n - 1]! }); e.preventDefault(); return; }
    const move = (delta: number) => {
      const at = current * perPage + focused + delta;
      if (at < 0 || at >= items.length) return;
      setPage(Math.floor(at / perPage)); setFocus(at % perPage);
    };
    const item = shown[focused];
    switch (e.key) {
      case "ArrowRight": move(1); break;
      case "ArrowLeft": move(-1); break;
      case "ArrowDown": move(columns); break;
      case "ArrowUp": move(-columns); break;
      case "a": case "A": if (item?.kind === "linkedin" && busy !== item.id) void markApplied(item); else return; break;
      case "l": case "L": if (item) later_(item); else return; break;
      case "d": case "D": if (item && busy !== item.id) void discard([item.id]); else return; break;
      case "o": case "O": if (item) openCard(item); else return; break;
      case "s": case "S": if (item) skipCompany(item.company); else return; break;
      default: return;
    }
    e.preventDefault();
  };
  useEffect(() => { const f = (e: KeyboardEvent) => keys.current(e); window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, []);

  const card = (item: Item, index: number) => {
    const stage = STAGE[item.kind];
    const q = item.queued;
    const r = item.ready as ManualApp | undefined;
    const drafted = q ? (q.readyForReview ?? q.suggestions ?? 0) : 0;
    const isBusy = queueRunning || busy === item.id;
    const nc = inNC(item.location);
    const age = ago(item.age);
    const tags = (item.priorityTags ?? []).filter((t) => !item.location?.includes(t));
    const hours = item.age ? (Date.now() - Date.parse(item.age)) / 3_600_000 : NaN;
    const fresh = Number.isFinite(hours) ? Math.max(0, Math.min(1, 1 - hours / FRESH_HOURS)) : null;
    return (
      <article key={item.id} onMouseDown={() => setFocus(index)} className={`td-card is-${stage.tone} ${item.track && TRACK_LABEL[item.track] ? `tr-${item.track}` : ""} ${selectedIds.includes(item.id) ? "is-selected" : ""} ${index === focused ? "is-focused" : ""}`} aria-label={`${item.company}: ${stage.label}`} aria-busy={isBusy}>
        <header className="td-head">
          <input type="checkbox" className="td-check" disabled={queueRunning} aria-label={`Select ${item.company} ${item.title}`} checked={selectedIds.includes(item.id)} onChange={e => setSelectedIds(ids => e.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} />
          <CompanyLogo company={item.company} size="sm" />
          <div className="td-id"><strong title={item.company}>{item.company}</strong><span title={item.title}>{item.title}</span></div>
          <button type="button" className="td-skip-co" disabled={isBusy} title={`Skip ${item.company}: hide its jobs until you remove it from Skipped companies (S)`} aria-label={`Skip ${item.company}`} onClick={() => skipCompany(item.company)}><svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M4.1 11.9l7.8-7.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button>
          {item.score != null && <span className={`td-score ${item.score >= 60 ? "is-high" : item.score >= 35 ? "is-mid" : ""}`} style={{ ["--pct" as string]: `${Math.min(100, item.score)}%` }} title={`Match score ${item.score}%`}><b>{item.score}</b></span>}
        </header>
        <div className="td-meta">
          {item.location && <span className={`td-loc ${nc ? "is-nc" : ""}`} title={item.location}>{nc ? "★ " : ""}{item.location}</span>}
          {age && <span className={`td-age ${hours < 1 ? "is-new" : ""}`} title={item.age ?? undefined}>{age}</span>}
          {fresh != null && <span className={`td-fresh ${fresh > 0.66 ? "is-fresh" : fresh > 0.33 ? "is-mid" : "is-stale"}`} title={fresh > 0 ? "Freshness: drains over 3 days; early applicants are seen first" : "Over 3 days old"}><i style={{ width: `${Math.round(fresh * 100)}%` }} /></span>}
        </div>
        <div className="td-tags"><span className={`td-stage is-${stage.tone}`}>{stage.label}</span>{item.track && TRACK_LABEL[item.track] && <span className={`td-track is-${item.track}`} title="Resume track">{TRACK_LABEL[item.track]}</span>}{item.kind === "linkedin" && item.easyApply && <span className="td-tag" title="Applied on LinkedIn itself (Easy Apply), not a company form">Easy Apply</span>}{tags.map((t) => <span key={t} className={`td-tag ${t === "Strong match" ? "is-strong" : ""}`}>{t}</span>)}</div>
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
          {item.kind === "linkedin" && <a className="td-cta td-cta-linkedin" title="Apply on LinkedIn, then Atriveo → Apply on this page on the company's form" href={item.url} target="_blank" rel="noreferrer" onClick={() => noteLinkedinOpen(item.url!, item.company, item.title)}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45z"/></svg>
            <span>Open on LinkedIn</span><svg className="td-cta-ext" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 3.5H3.5v9h9V10M9 3h4v4M13 3L7.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/></svg></a>}
          {(item.kind === "drafted" || item.kind === "fill") && <button className="rv-primary" disabled={isBusy} onClick={() => void openInBrowser(item)}>{busy === item.id ? "Opening…" : "Open & Fill"}</button>}
          {item.kind === "answer" && <button className="rv-primary" disabled={isBusy} onClick={() => navigate(`/unanswered?app=${encodeURIComponent(item.id)}`)}>Answer {item.toAnswer ?? ""}</button>}
          {item.kind === "approve" && <button className="rv-primary" disabled={isBusy} onClick={() => void run(item, { action: "approve_submit" }, () => finish(item, `Approved ${item.company}. The worker refills it, checks it again and submits.`, { ready: -1 }))}>{isBusy ? "Approving…" : "Approve submit"}</button>}
          {item.kind === "you_submit" && <button className="rv-primary" disabled={isBusy} onClick={() => void openFill(item)}>{isBusy ? "Opening…" : "Open & Fill"}</button>}
          {item.kind === "approve" && ["greenhouse", "ashby", "lever", "workday"].includes(item.ats ?? "") && <button className="apps-btn" disabled={isBusy} onClick={() => void openFill(item)}>Open & Fill</button>}
          <div className="td-review-links">
            {(item.kind === "approve" || item.kind === "you_submit") && <button className="apps-btn" onClick={() => setReview({ ...item, mode: "answers" })}>Answers</button>}
            {item.kind !== "linkedin" && <button className="apps-btn" onClick={() => setReview({ ...item, mode: "resume" })}>Resume</button>}
            {item.kind === "linkedin" && item.resumePath && <button className="td-ghost" onClick={() => setPdf(item.resumePath!)}><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M4 1.8h5.2L12.5 5v9.2H4zM9 1.8V5h3.5M6 8.2h4.5M6 10.8h4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"/></svg>Resume</button>}
            {item.kind === "linkedin" && <button className="td-ghost td-applied" disabled={isBusy} onClick={() => void markApplied(item)}><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round"/></svg>Mark applied</button>}
            {item.url && item.kind !== "linkedin" && <a className="apps-btn" href={item.url} target="_blank" rel="noreferrer">Job ↗</a>}
          </div>
          <div className="td-links">
            <button className="apps-link" disabled={isBusy} onClick={() => later_(item)}>Later</button>
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
        <div className="td-title"><h1>Today</h1><span className="apps-muted">{loading ? "Loading…" : `${everything.length} application${everything.length === 1 ? "" : "s"} waiting for you`}</span></div>
        <div className="td-moods" role="group" aria-label="Track">
          {TRACK_FILTERS.map((t, n) => (
            <button key={t} type="button" className={`td-mood is-${t} ${track === t ? "is-on" : ""}`} aria-pressed={track === t} title={`Key ${n + 1}${t === "mixed" ? ": the tracks in turn" : ""}`} onClick={() => pick({ track: t })}>
              {t === "mixed" ? <><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M2 4.5h3c2.5 0 3.5 7 6 7h3M12 9.5l2 2-2 2M2 11.5h3c1 0 1.7-1 2.3-2.3M8.7 6.3c.6-1.1 1.3-1.8 2.3-1.8h3M12 2.5l2 2-2 2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>Mixed</> : <>{t !== "all" && <i className="td-dot" aria-hidden="true" />}{t === "all" ? "All" : TRACK_LABEL[t]}<b>{trackCount(t)}</b></>}
            </button>
          ))}
        </div>
        <div className="td-kinds" role="group" aria-label="How you apply">
          {(Object.keys(KIND_LABEL) as Array<Exclude<KindFilter, "all">>).map((k) => (
            <button key={k} type="button" className={`td-kind ${kind === k ? "is-on" : ""}`} aria-pressed={kind === k} onClick={() => pick({ kind: kind === k ? "all" : k })}>{KIND_LABEL[k]} <b>{kindCount(k)}</b></button>
          ))}
          <span className="td-skiplist">
            <button type="button" className={`td-kind ${resumesOpen ? "is-on" : ""}`} aria-expanded={resumesOpen} onClick={() => { setResumesOpen((o) => !o); setSkipOpen(false); }}>
              <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14"><path d="M4 1.8h5.2L12.5 5v9.2H4zM9 1.8V5h3.5M6 8.2h4.5M6 10.8h4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"/></svg>Resumes</button>
            {resumesOpen && <div className="td-skip-pop td-resumes" role="dialog" aria-label="General resumes">
              <p className="apps-muted">General resume for each track (not tailored to a job).</p>
              <ul>{GENERAL_RESUMES.map((g) => { const p = generalPath(g.folder); const url = p ? `${getTailorServerBase()}/serve-pdf?path=${encodeURIComponent(p)}` : null; return (
                <li key={g.track} className={`tr-${g.track}`}><span><i className="td-dot" aria-hidden="true" style={{ ["--td-c" as string]: `var(--tr)` }} />{TRACK_LABEL[g.track]}</span>
                  {url ? <span className="td-resume-acts"><button type="button" className="apps-link" onClick={() => { setPdf(p); setResumesOpen(false); }}>View</button><a className="apps-btn" href={`${url}&dl=1`} download={`Atishay Kasliwal - ${g.folder}.pdf`}>Download</a></span> : <span className="apps-muted">Loading…</span>}
                </li>); })}</ul>
            </div>}
          </span>
          <span className="td-skiplist">
            <button type="button" className={`td-kind ${skipOpen ? "is-on" : ""}`} aria-expanded={skipOpen} onClick={() => { setSkipOpen((o) => !o); setResumesOpen(false); }}>Skipped companies <b>{exclusions.companies.length}</b></button>
            {skipOpen && <div className="td-skip-pop" role="dialog" aria-label="Skipped companies">
              <form onSubmit={(e) => { e.preventDefault(); if (skipDraft.trim()) { excludeCompany(skipDraft); setSkipDraft(""); } }}>
                <input value={skipDraft} onChange={(e) => setSkipDraft(e.target.value)} placeholder="Add a company…" aria-label="Company to skip" autoFocus />
                <button type="submit" className="apps-btn" disabled={!skipDraft.trim()}>Skip</button>
              </form>
              {exclusions.companies.length ? <ul>{exclusions.companies.map((c) => <li key={c}><span>{c}</span><button type="button" className="apps-link" aria-label={`Stop skipping ${c}`} onClick={() => removeExclusion("company", c)}>Remove</button></li>)}</ul>
                : <p className="apps-muted">No companies skipped. Use Skip company on a card (or S), or add one here.</p>}
            </div>}
          </span>
          {(track !== "all" || kind !== "all") && <button type="button" className="apps-link" onClick={() => pick({ track: "all", kind: "all" })}>Clear filters</button>}
        </div>
        <div className="td-actions">
          {selectedIds.length > 0 && (confirmDiscard
            ? <span className="td-confirm">Discard {selectedIds.length}? <button className="apps-btn danger" disabled={busy !== null} onClick={() => void discard(selectedIds)}>Discard</button><button className="apps-link" onClick={() => setConfirmDiscard(false)}>Cancel</button></span>
            : <button className="apps-btn" disabled={queueRunning || busy !== null} onClick={() => setConfirmDiscard(true)}>Discard selected ({selectedIds.length})</button>)}
          {queueable.length > 0 && <><button className="apps-btn" disabled={queueRunning} onClick={() => setSelectedIds(queueable.map(i => i.id))}>Select all Open & Fill ({queueable.length})</button><button className="apps-btn" disabled={queueRunning || !selectedIds.length} onClick={() => setSelectedIds([])}>Clear</button><OpenFillQueue onRunning={setQueueRunning} selected={queued} onFilled={(id) => { const it = everything.find((i) => i.id === id); if (it) setDone((d) => ({ ...d, [id]: it.updatedAt })); setSelectedIds((ids) => ids.filter((x) => x !== id)); }} onFinish={() => { void refreshReady(); void refreshUnanswered(); }} /></>}
          {worker && <span className={`apps-state ${worker.online ? "" : "bad"}`}><i aria-hidden />{worker.online ? "Worker running" : "Worker offline"}</span>}
          {fillable.length > 0 && <button className="apps-btn" disabled={busy !== null || queueRunning} onClick={() => setConfirmAll("fill")}>Fill and verify all {fillable.length}</button>}
          {approvable.length > 0 && <button className="apps-btn" disabled={busy !== null || queueRunning} onClick={() => setConfirmAll("approve")}>Approve all {approvable.length} ready</button>}
        </div>
      </div>
      <div className="td-goal" aria-label={`Applied today: ${goalDay.applied ?? "loading"} of ${goal}`}>
        <span className="td-goal-n"><b>{goalDay.applied ?? "–"}</b> / <button type="button" title="Daily goal: click to change" onClick={() => { const g = GOALS[(GOALS.indexOf(goal) + 1) % GOALS.length]!; setGoal(g); writePref("goal", g); }}>{goal}</button> applied today</span>
        <div className={`td-goal-bar ${(goalDay.applied ?? 0) >= goal ? "is-done" : ""}`}>
          <i style={{ width: `${Math.min(100, ((goalDay.applied ?? 0) / goal) * 100)}%` }} />
          {Array.from({ length: Math.floor((goal - 1) / 5) }, (_, n) => <s key={n} className={(goalDay.applied ?? 0) >= (n + 1) * 5 ? "is-hit" : ""} style={{ left: `${((n + 1) * 5 / goal) * 100}%` }} />)}
        </div>
        <span className="td-goal-left">{goalDay.applied == null ? "Loading…" : goalDay.applied >= goal ? "Goal reached 🎉" : `${goal - goalDay.applied} to go`}</span>
        {goalDay.combo >= 2 && <span key={goalDay.combo} className="td-combo" title="Applied within 3 minutes of each other">🔥 ×{goalDay.combo}</span>}
      </div>
      {(unanswered.error || ready.error) && <p className="ar-error" role="alert">{unanswered.error || ready.error}</p>}
      <main className="td-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
        {loading && <div className="td-empty">Loading your applications…</div>}
        {!loading && !items.length && everything.length > 0 && <div className="td-empty"><strong>Nothing here for this filter.</strong><button type="button" className="apps-link" onClick={() => pick({ track: "all", kind: "all" })}>Show everything</button></div>}
        {!loading && !everything.length && <div className="td-empty"><strong>Nothing is waiting for you.</strong><span>New applications show up here once their questions are collected.</span></div>}
        {shown.map((item, index) => card(item, index))}
      </main>
      <div className="td-bottom">
      <aside className="td-keys" aria-label="Keyboard shortcuts"><span><kbd>1</kbd>–<kbd>7</kbd> track</span><span><kbd>←</kbd><kbd>→</kbd> move</span><span><kbd>O</kbd> open</span><span><kbd>A</kbd> mark applied</span><span><kbd>L</kbd> later</span><span><kbd>S</kbd> skip company</span><span><kbd>D</kbd> discard</span></aside>
      {items.length > perPage && (
        <nav className="td-pager" aria-label="More applications">
          <button className="apps-btn" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Previous applications">←</button>
          <span>{current * perPage + 1}–{Math.min((current + 1) * perPage, items.length)} of {items.length}</span>
          <button className="apps-btn" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)} aria-label="Next applications">→</button>
        </nav>
      )}
      </div>
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
