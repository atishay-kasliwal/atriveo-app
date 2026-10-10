// Read-only analytics over the application engine's collections (playatriveo):
// applications, form_patterns, engine_control, plus job-pipeline's jobs and
// ats_boards for the discovery → resume → apply funnel. Served by the sidecar
// at GET /applications/analytics (behind the site login via the /tailor relay).

import fs from "node:fs";
import path from "node:path";
import { classifyTrack, loadTracks } from "./ac-tracks.mjs";

const TZ = "America/New_York";
const dayKey = (iso) => (iso ? new Date(iso).toLocaleString("sv-SE", { timeZone: TZ }).slice(0, 10) : null);

const ROLEISH = /\b(engineer|developer|scientist|analyst|intern|manager|designer)\b/i;
const companyOf = (names = []) => names.find((c) => /[A-Z]/.test(c) && !ROLEISH.test(c)) ?? names.find((c) => !ROLEISH.test(c)) ?? null;

/** Employer responses for the dashboard: counts, recent mails, and the ones waiting for you to confirm. */
function inboxSummary(rows, records) {
  const mail = rows.filter((e) => e.state !== "dismissed" && e.state !== "undone");
  const appLabel = new Map(records.map((r) => [r._id, `${r.company} · ${r.title}`]));
  const base = (e) => ({ id: e._id, at: e.receivedAt, kind: e.kind, subject: e.subject, company: companyOf(e.companies), title: e.titles?.[0] ?? null });
  const recordedIn = (e) => [
    e.state === "updated" ? "engine" : null,
    // no_change = already there (e.g. a confirmation for a job you'd already tracked).
    e.tracker && ["updated", "created", "no_change"].includes(e.tracker.state) ? "tracker" : null,
    e.feed && ["updated", "no_change"].includes(e.feed.state) ? "feed" : null,
  ].filter(Boolean);
  return {
    days: 60,
    confirmed: mail.filter((e) => e.kind === "applied").length,
    rejected: mail.filter((e) => e.kind === "rejected").length,
    recent: mail.slice(0, 25).map((e) => ({ ...base(e), recordedIn: recordedIn(e), note: e.tracker?.reason ?? null })),
    confirm: [
      ...mail.filter((e) => e.tracker?.state === "needs_confirm").map((e) => ({
        ...base(e), target: "tracker",
        reason: String(e.tracker.reason ?? "").replace(/^tracker: /, "").replace(/ · candidates:.*$/, ""),
        candidates: e.tracker.candidates ?? [],
      })),
      ...mail.filter((e) => e.state === "needs_confirm" && !e.tracker).map((e) => ({
        ...base(e), target: "engine", reason: e.match?.reason ?? "",
        candidates: (e.match?.candidates ?? []).map((id) => ({ id, label: appLabel.get(id) ?? id })),
      })),
    ],
  };
}

const killSwitchOf = (control) =>
  control ? { enabled: Boolean(control.enabled), reason: control.reason ?? null, updatedAt: control.updatedAt, updatedBy: control.updatedBy } : null;

/** Newest worker heartbeat: online state and Gmail status. */
function workerOf(workerDocs) {
  const w = [...workerDocs].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  if (!w) return null;
  const age = Date.now() - Date.parse(w.updatedAt);
  return {
    online: w.status === "online" && age < 3 * 60_000,
    host: w.host ?? null, concurrency: w.concurrency ?? null, gmailConnected: Boolean(w.gmailConnected),
    accountsEmail: w.accountsEmail ?? null, updatedAt: w.updatedAt,
  };
}

/**
 * Waiting only for your Submit approval. Mirrors the guard in playatriveo's
 * approve_submit (src/application/humanAction.ts), which stays the authority:
 * keep the two in step so nothing listed here is refused there.
 */
/**
 * Filled and verified on an ATS you submit yourself (Ashby, Lever): Open & Fill instead of Approve.
 * Mirrors playatriveo's Open & Fill checks (src/application/manualFill/fillPlan.ts), which stay the authority.
 */
export function readyForYou(r) {
  return r.status === "NEEDS_REVIEW" && r.review?.reason === "MANUAL_SUBMIT"
    && !r.submission?.attemptedAt && !r.submission?.submittedAt
    && (r.review.pending ?? []).length === 0 && (r.review.failedChecks ?? []).length === 0
    && Boolean(r.submission?.validation?.passed && r.submission?.certification?.status === "CERTIFIED" && r.resume?.sha256);
}

export function readyForApproval(r) {
  return r.status === "NEEDS_REVIEW" && r.review?.reason === "SUBMIT_APPROVAL"
    && !r.submission?.attemptedAt && !r.submission?.submittedAt
    && (r.review.pending ?? []).length === 0 && (r.review.failedChecks ?? []).length === 0
    && Boolean(r.submission?.validation?.passed && r.submission?.formSignature && r.resume?.sha256);
}

/**
 * Applications you opened with Apply with Atriveo (playatriveo `owner: "extension"`) belong to your browser:
 * the worker never claims them and the backend refuses Approve, Fill and verify, Continue and Retry on them.
 * So they never appear in the Unanswered, Ready or Today action lists; they get their own list
 * ("Applying in your browser") whose only actions are Return to worker (when allowed) and Skip.
 */
export const NOT_IN_BROWSER = { owner: { $ne: "extension" } };
const OUTCOME_HOURS = 4;
const POST_FENCE_REVIEWS = new Set(["UNCERTAIN_SUBMISSION", "SPAM_BLOCKED", "SECURITY_CODE_REJECTED"]);

/**
 * Why Return to worker would be refused right now, or null when it is allowed. Mirrors playatriveo's
 * returnBlock (src/application/applyHere/ownership.ts), which stays the authority; keep the two in step
 * so the dashboard never offers an action the backend refuses.
 */
export function returnToWorkerBlock(r, now = new Date(), fileExists = fs.existsSync) {
  const s = r.submission ?? {};
  if (r.owner !== "extension") return "It already belongs to the worker.";
  if (r.status === "APPLIED") return "You already applied to this posting.";
  if (r.status === "SUBMITTING") return "It is being submitted right now.";
  if (r.status === "APPLYING" || r.lease) return "It is being filled right now.";
  if (s.attemptedAt || s.submittedAt || POST_FENCE_REVIEWS.has(r.review?.reason ?? "")) return "Submit was already attempted. Check whether it went through instead.";
  const fill = s.manualFill;
  if (fill?.planServedAt && Date.parse(fill.armedAt) + OUTCOME_HOURS * 3_600_000 > now.getTime()) return "You filled it in your browser and may still submit it there. Try again in a few hours, or skip it.";
  if (r.status !== "NEEDS_REVIEW" || r.review?.reason !== "IN_EXTENSION") return "It isn't open in your browser.";
  const before = r.extension?.before;
  const queued = !((before?.status === "NEEDS_REVIEW" && before.review) || (before?.status === "SKIPPED" && before.skip));
  if (queued && !(r.resume?.path && fileExists(r.resume.path))) return "There is no resume file for the worker to use yet.";
  return null;
}

/** Fields returnToWorkerBlock and the in-browser rows read (kept small: the link to Mongo is slow). */
const IN_BROWSER_FIELDS = {
  owner: 1, lease: 1, "resume.path": 1, "extension.startedAt": 1, "extension.takenOverFrom": 1, "extension.before.status": 1,
  "extension.before.review.reason": 1, "extension.before.skip.reason": 1,
  "submission.manualFill.armedAt": 1, "submission.manualFill.planServedAt": 1,
};

/** One application open in your browser, as the dashboard lists it. */
export function inBrowserRow(r, now = new Date(), fileExists = fs.existsSync) {
  const fill = r.submission?.manualFill ?? null;
  const block = returnToWorkerBlock(r, now, fileExists);
  return {
    id: r._id, company: r.company, companyKey: r.companyKey ?? null, title: r.title, location: r.location ?? null, ats: r.ats ?? null,
    url: r.finalUrl ?? r.applyUrl, priority: r.priority ?? 0, updatedAt: r.updatedAt,
    state: "Applying in your browser",
    startedAt: r.extension?.startedAt ?? null,
    takenOverFrom: r.extension?.takenOverFrom ?? null,
    pending: Array.isArray(r.review?.pending) ? r.review.pending.length : 0,
    filledAt: fill?.filledAt ?? null,
    filled: fill?.report?.filled ?? null,
    canReturn: block === null,
    returnBlock: block,
  };
}

// Longer choice lists (a school picker can have thousands) are left out of the
// list and fetched for one question when its card is on screen; the link to
// Mongo is slow enough that a few such lists would double the load time.
const MAX_INLINE_OPTIONS = 300;
const size = (path) => ({ $size: { $ifNull: [path, []] } });

/**
 * One application as the review pages need it, shaped in Mongo so only that crosses the wire.
 * Without questions, each pending question is just its fingerprint (enough to count).
 */
const reviewRow = (withQuestions) => ({
  $project: {
    company: 1, companyKey: 1, title: 1, location: 1, ats: 1, status: 1, priority: 1, priorityTags: 1, applyUrl: 1, finalUrl: 1, createdAt: 1, updatedAt: 1, jobUrls: 1,
    "resume.fileName": 1, "resume.sha256": 1, "failure.code": 1,
    "submission.attemptedAt": 1, "submission.submittedAt": 1, "submission.validation.passed": 1, "submission.formSignature": 1,
    "submission.approvalRequestedAt": 1, "submission.approvalInAttemptAt": 1, "submission.certification.status": 1,
    "submission.manualFill.armedAt": 1, "submission.manualFill.filledAt": 1, "submission.manualFill.report": 1,
    ...IN_BROWSER_FIELDS,
    answered: size({ $filter: { input: { $ifNull: ["$questions", []] }, cond: { $eq: ["$$this.resolution", "answered"] } } }),
    review: {
      reason: "$review.reason", detail: "$review.detail", stage: "$review.stage", since: "$review.since", questionReviewStatus: "$review.questionReviewStatus",
      failedChecks: { $map: { input: { $ifNull: ["$review.failedChecks", []] }, in: "$$this.id" } },
      pending: {
        $map: {
          input: { $ifNull: ["$review.pending", []] },
          in: !withQuestions ? "$$this.fingerprint" : {
            fieldKey: "$$this.fieldKey", fingerprint: "$$this.fingerprint", label: "$$this.label", type: "$$this.type", required: "$$this.required",
            canonicalKey: "$$this.canonicalKey", sensitive: "$$this.sensitive", reason: "$$this.reason", detail: "$$this.detail",
            openEndedAssessment: "$$this.openEndedAssessment", openEndedSuggestion: "$$this.openEndedSuggestion", openEndedUserReview: "$$this.openEndedUserReview",
            answerProposal: "$$this.answerProposal",
            optionCount: size("$$this.options"),
            options: { $cond: [{ $gt: [size("$$this.options"), MAX_INLINE_OPTIONS] }, [], { $ifNull: ["$$this.options", []] }] },
          },
        },
      },
    },
  },
});

const pendingQuestion = (p) => ({
  fieldKey: p.fieldKey ?? null,
  fingerprint: p.fingerprint, label: p.label, type: p.type, required: Boolean(p.required),
  options: p.options ?? [], optionCount: p.optionCount ?? (p.options ?? []).length,
  canonicalKey: p.canonicalKey ?? null, sensitive: p.sensitive ?? null, reason: p.reason, detail: p.detail ?? null,
  openEndedAssessment: p.openEndedAssessment ?? null,
  openEndedSuggestion: p.openEndedSuggestion ?? null,
  openEndedUserReview: p.openEndedUserReview ?? null,
  answerProposal: p.answerProposal ?? null,
  suggestedAnswer: p.answerProposal?.answer ?? p.openEndedSuggestion?.suggestedAnswer,
  questionFamily: p.answerProposal?.family ?? p.openEndedAssessment?.questionFamily ?? null,
  selectedStory: p.openEndedAssessment?.selectedStory,
  suggestionReason: p.answerProposal?.reason ?? p.openEndedAssessment?.reason,
  userDraft: p.openEndedUserReview?.draftAnswer ?? null,
  userDraftAction: p.openEndedUserReview?.action,
  reviewStatus: p.openEndedUserReview?.status ?? (p.answerProposal?.answer || p.openEndedSuggestion ? "suggested" : "none"),
});

// Blocked on questions: the Unanswered page.
const BLOCKED = { status: "NEEDS_REVIEW", ...NOT_IN_BROWSER, "submission.attemptedAt": null, $or: [
  { "review.pending.0": { $exists: true } },
  { "review.questionReviewStatus": "complete", "review.reason": { $nin: ["SUBMIT_APPROVAL", "MANUAL_SUBMIT"] } },
] };
// readyForApproval / readyForYou need one of these reasons; their other checks run on these few rows.
const MAYBE_READY = { status: "NEEDS_REVIEW", ...NOT_IN_BROWSER, "review.reason": { $in: ["SUBMIT_APPROVAL", "MANUAL_SUBMIT"] } };
// Open in your browser and still yours to finish (not applied, skipped or failed).
const IN_BROWSER = { owner: "extension", status: "NEEDS_REVIEW" };

/** Applications open in your browser, newest first. */
const inBrowserRows = async (apps, now) => (await apps.aggregate([{ $match: IN_BROWSER }, { $sort: { updatedAt: -1 } }, { $limit: 100 }, reviewRow(false)]).toArray()).map((r) => inBrowserRow(r, now));

/** The resume track a job's title puts it on (TRACKS.yaml), or null. */
let tracksDoc = null;
export const trackOf = (title) => { try { tracksDoc ??= loadTracks(); return classifyTrack(title, tracksDoc); } catch { return null; } };

/**
 * How well the tailored resume itself matches the job: the deterministic Job Match (scripts/ats) that tailor-ac saves
 * as ats-score.json beside the PDF. Each resume is rewritten per job, so this, not the profile score, is the one to read.
 */
export const resumeMatchOf = (pdfPath) => {
  if (!pdfPath) return null;
  try {
    const m = JSON.parse(fs.readFileSync(path.join(path.dirname(pdfPath), "ats-score.json"), "utf8")).job_match;
    if (typeof m?.score !== "number") return null;
    const c = m.requirement_counts ?? {};
    return { score: Math.round(m.score), required: c.required ?? null, preferred: c.preferred ?? null };
  } catch { return null; }
};

const rowBase = (r) => ({
  id: r._id, company: r.company, companyKey: r.companyKey ?? null, title: r.title, location: r.location ?? null, ats: r.ats ?? null,
  url: r.finalUrl ?? r.applyUrl, priority: r.priority ?? 0, priorityTags: r.priorityTags ?? [], updatedAt: r.updatedAt,
  createdAt: r.createdAt ?? null, score: r.score ?? null, postedAt: r.postedAt ?? null, foundAt: r.foundAt ?? null,
  track: trackOf(r.title),
  // Its resume file is here, so Fill can attach it now (Today puts these first).
  resumeReady: Boolean(r.resume?.path && fs.existsSync(r.resume.path)),
  resumeMatch: resumeMatchOf(r.resume?.path),
});

/**
 * The job-pipeline facts behind each application (Today sorts and shows them): match score (score_pct), when the
 * posting went up (date_posted) and when the pipeline first found it (run_at). Read from `jobs` by the
 * application's job_urls in one query; several documents per URL keep the best score and the earliest dates.
 * Sets score / postedAt / foundAt on each row and drops jobUrls.
 */
const isoOf = (v) => { if (!v || v === "null") return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
async function addJobFacts(db, rows) {
  const urls = [...new Set(rows.flatMap((r) => r.jobUrls ?? []))];
  const facts = new Map();
  if (urls.length) {
    const docs = await db.collection("jobs").find({ job_url: { $in: urls } }, { projection: { _id: 0, job_url: 1, score_pct: 1, date_posted: 1, run_at: 1 } }).toArray();
    for (const j of docs) {
      const f = facts.get(j.job_url) ?? { score: null, postedAt: null, foundAt: null };
      if (typeof j.score_pct === "number") f.score = Math.max(f.score ?? 0, j.score_pct);
      const posted = isoOf(j.date_posted), found = isoOf(j.run_at);
      if (posted && (!f.postedAt || posted < f.postedAt)) f.postedAt = posted;
      if (found && (!f.foundAt || found < f.foundAt)) f.foundAt = found;
      facts.set(j.job_url, f);
    }
  }
  for (const r of rows) {
    for (const u of r.jobUrls ?? []) {
      const f = facts.get(u);
      if (!f) continue;
      if (f.score !== null) r.score = Math.max(r.score ?? 0, f.score);
      if (f.postedAt && (!r.postedAt || f.postedAt < r.postedAt)) r.postedAt = f.postedAt;
      if (f.foundAt && (!r.foundAt || f.foundAt < r.foundAt)) r.foundAt = f.foundAt;
    }
    r.score ??= null; r.postedAt ??= null; r.foundAt ??= null;
    r.track = trackOf(r.title);
    if ("resumePath" in r) { r.resumeReady = Boolean(r.resumePath && fs.existsSync(r.resumePath)); r.resumeMatch = resumeMatchOf(r.resumePath); delete r.resumePath; }
    if (r.resumeReady === false) r._jobUrls = r.jobUrls ?? [];
    delete r.jobUrls;
  }
  return rows;
}

async function engineState(db) {
  const [control, workerDocs] = await Promise.all([
    db.collection("engine_control").findOne({ _id: "submissions" }),
    db.collection("engine_control").find({ _id: { $regex: "^worker:" } }).toArray(),
  ]);
  return { killSwitch: killSwitchOf(control), worker: workerOf(workerDocs) };
}

const questionCategory = { $switch: { branches: [
  { case: { $or: [{ $eq: ["$$this.type", "file"] }, { $eq: ["$$this.answerProposal.state", "action_required"] }, { $regexMatch: { input: { $ifNull: ["$$this.label", ""] }, regex: "^(?:\\(?unlabeled|yes$|no$)", options: "i" } }] }, then: "actionRequired" },
  { case: { $eq: ["$$this.openEndedUserReview.status", "rejected"] }, then: "needsInput" },
  { case: { $ne: [{ $ifNull: ["$$this.answerProposal.answer", { $ifNull: ["$$this.openEndedSuggestion.suggestedAnswer", ""] }] }, ""] }, then: "readyForReview" },
] , default: "needsInput" } };
const categoryCount = category => ({ $size: { $filter: { input: { $ifNull: ["$review.pending", []] }, cond: { $eq: [questionCategory, category] } } } });

/** Lightweight per-application counts keep filtering independent of card loading. */
const unansweredOrder = (apps) => apps.aggregate([
  { $match: BLOCKED },
  { $project: {
    updatedAt: 1, company: 1, title: 1, location: 1, createdAt: 1, priorityTags: 1, jobUrls: 1, resumePath: "$resume.path",
    n: { $size: "$review.pending" },
    suggestions: categoryCount("readyForReview"),
    readyForReview: categoryCount("readyForReview"), needsInput: categoryCount("needsInput"), actionRequired: categoryCount("actionRequired"),
    rank: { $ifNull: ["$priority", 0] },
  } },
  { $sort: { suggestions: -1, n: 1, rank: -1, updatedAt: 1, _id: 1 } },
  { $project: { _id: 0, id: "$_id", updatedAt: 1, company: 1, title: 1, location: 1, createdAt: 1, priorityTags: 1, jobUrls: 1, resumePath: 1, n: 1, suggestions: 1, readyForReview: 1, needsInput: 1, actionRequired: 1 } },
]).toArray();

/** The cards (questions included) of these applications, in this order; any no longer blocked are left out. */
async function unansweredCards(apps, ids) {
  if (!ids.length) return [];
  const rows = await apps.aggregate([{ $match: { ...BLOCKED, _id: { $in: ids } } }, reviewRow(true)]).toArray();
  const byId = new Map(rows.map((r) => [r._id, r]));
  return ids.filter((id) => byId.has(id)).map((id) => byId.get(id))
    .map((r) => ({ ...rowBase(r), reviewReason: r.review.reason ?? null, questionReviewStatus: r.review.questionReviewStatus ?? null, reviewStage: r.review.stage ?? null, questions: r.review.pending.map(pendingQuestion) }));
}

const blockedTotals = async (apps) => {
  const [t] = await apps.aggregate([{ $match: BLOCKED }, { $group: { _id: null, apps: { $sum: 1 }, questions: { $sum: { $size: "$review.pending" } },
    reviewComplete: { $sum: { $cond: [{ $eq: [{ $size: { $ifNull: ["$review.pending", []] } }, 0] }, 1, 0] } } } }]).toArray();
  return { unanswered: t?.apps ?? 0, questions: t?.questions ?? 0, reviewComplete: t?.reviewComplete ?? 0 };
};

/** Everything on the Ready page: waiting for your approval, or for you to submit it yourself (Open & Fill). */
const readyRows = async (apps) => (await apps.aggregate([{ $match: MAYBE_READY }, reviewRow(false)]).toArray()).filter((r) => readyForApproval(r) || readyForYou(r));

/** Approved in the dashboard: still waiting for the worker, or claimed in the last two days; and who was submitted to lately. */
async function approvals(apps, now) {
  const since = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  const [approved, submittedRecently] = await Promise.all([
    apps.aggregate([
      { $match: { ...NOT_IN_BROWSER, $or: [{ "submission.approvalRequestedAt": { $ne: null } }, { "submission.approvalInAttemptAt": { $gte: since } }] } },
      reviewRow(false),
    ]).toArray(),
    apps.find({ "submission.attemptedAt": { $gte: since } }, { projection: { companyKey: 1, "submission.attemptedAt": 1 } }).toArray(),
  ]);
  return { approved, submittedRecently };
}

/** The Ready page's lists: waiting for your approval (best match first), and the approvals on their way. */
function readyLists(readyDocs, { approved, submittedRecently }, now) {
  const today = dayKey(now.toISOString());
  const companiesSubmittedToday = new Set(submittedRecently.filter((r) => dayKey(r.submission.attemptedAt) === today).map((r) => r.companyKey));
  const perCompany = new Map();
  for (const r of readyDocs) perCompany.set(r.companyKey, (perCompany.get(r.companyKey) ?? 0) + 1);
  const row = (r) => ({
    ...rowBase(r),
    filledAt: r.review.since ?? r.updatedAt,
    resumeFile: r.resume?.fileName ?? null,
    answered: r.answered ?? 0,
    readyAtCompany: perCompany.get(r.companyKey) ?? 1,
    companySubmittedToday: companiesSubmittedToday.has(r.companyKey),
  });
  return {
    // You submit these in your own browser; the engine never does (submission.manualSubmitAts).
    manual: readyDocs.filter(readyForYou)
      .map((r) => {
        const fill = r.submission?.manualFill ?? null;
        return { ...row(r), openFill: fill ? { armedAt: fill.armedAt ?? null, filledAt: fill.filledAt ?? null, filled: fill.report?.filled ?? null, toCheck: fill.report ? fill.report.mismatched.length + fill.report.missing.length : null } : null };
      })
      .sort((a, b) => b.priority - a.priority || a.filledAt.localeCompare(b.filledAt)),
    ready: readyDocs.filter(readyForApproval).map(row)
      .sort((a, b) => b.priority - a.priority || a.filledAt.localeCompare(b.filledAt)),
    // Approved earlier and now back in the Ready pile: listed there instead.
    approved: approved
      .filter((r) => !readyForApproval(r))
      .map((r) => ({
        ...rowBase(r), status: r.status, reviewReason: r.review?.reason ?? null, reviewDetail: r.review?.detail ?? null,
        failureCode: r.failure?.code ?? null, submittedAt: r.submission?.submittedAt ?? null,
        approvedAt: r.submission?.approvalRequestedAt ?? r.submission?.approvalInAttemptAt ?? null,
      }))
      .sort((a, b) => String(b.approvedAt).localeCompare(String(a.approvedAt))),
  };
}

const countsOf = (order, ready) => ({ unanswered: order.length, questions: order.reduce((n, r) => n + r.n, 0), ready: ready.length,
  readyForReview: order.reduce((n, r) => n + r.readyForReview, 0), needsInput: order.reduce((n, r) => n + r.needsInput, 0), actionRequired: order.reduce((n, r) => n + r.actionRequired, 0),
  // Only a completed question review is in BLOCKED with nothing pending.
  reviewComplete: order.filter((r) => r.n === 0).length });

/**
 * The Unanswered and Ready pages and the header counts, each reading only what it shows:
 * the link to Mongo is slow, so load time follows the bytes read. Read-only, no history cap.
 *   counts      the header numbers
 *   unanswered  every application blocked on questions as { id, updatedAt, n } in page order,
 *               plus the cards of the first `cards`
 *   cards       the cards of `ids` still blocked, in that order
 *   ready       applications waiting only for your approval, and the approvals on their way
 *   full        all of it with every card, for consoles loaded before the views existed
 */
/**
 * LinkedIn postings the pipeline found in the last `days` with a resume ready: Today shows them as "On LinkedIn"
 * cards. The engine never applies on LinkedIn (you click Apply there, then Apply with Atriveo fills the company's
 * form). Jobs that already have an application, or that you discarded (job_swipes direction "left"), are left out.
 */
/** Rounded the way a person plans: 2, 5, 10, 20, 30, 40 minutes, then hours. */
const ETA_STEPS = [2, 5, 10, 20, 30, 40, 60];
const roundEta = (m) => ETA_STEPS.find((s) => m <= s) ?? Math.ceil(m / 60) * 60;

/**
 * When a card's resume should be ready (Today's "Resume in ~10 min"), for the cards whose file isn't here yet:
 *   syncing     built, on its way from the machine that built it (about a minute)
 *   building    a worker is on it now: about one resume's time
 *   queued      the jobs ahead of it in its worker's queue (priority, then score), at that worker's recent pace
 *   failed / not_queued   no estimate
 * Pace: the median gap between that worker's resumes in the last 3 hours (gaps over 30 minutes are idle time).
 */
export async function addResumeEta(db, rows, now = new Date()) {
  const want = rows.filter((r) => r.resumeReady === false);
  if (want.length) {
    const urlsOf = (r) => r._jobUrls ?? (r.url ? [r.url] : []);
    const jobs = db.collection("jobs");
    const [docs, recent] = await Promise.all([
      jobs.find({ job_url: { $in: [...new Set(want.flatMap(urlsOf))] } }, { projection: { _id: 0, job_url: 1, score_pct: 1, "resume.status": 1, "resume.owner": 1, "resume.priority": 1, "resume.updated_at": 1 } }).toArray(),
      jobs.find({ "resume.status": "success", "resume.updated_at": { $gte: new Date(now.getTime() - 3 * 3_600_000).toISOString() } }, { projection: { _id: 0, "resume.owner": 1, "resume.updated_at": 1 } }).toArray(),
    ]);
    const done = new Map();
    for (const d of recent) done.set(d.resume.owner, [...(done.get(d.resume.owner) ?? []), Date.parse(d.resume.updated_at)]);
    const pace = (owner) => {
      const t = (done.get(owner) ?? []).filter(Number.isFinite).sort((a, b) => a - b);
      const gaps = t.slice(1).map((x, i) => (x - t[i]) / 60_000).filter((g) => g > 0 && g <= 30).sort((a, b) => a - b);
      return gaps.length ? Math.min(30, Math.max(1, gaps[Math.floor(gaps.length / 2)])) : 5;
    };
    const RANK = { success: 0, running: 1, queued: 2, failed: 3 };
    const byUrl = new Map();
    for (const d of docs) { const cur = byUrl.get(d.job_url); if (!cur || (RANK[d.resume?.status] ?? 9) < (RANK[cur.resume?.status] ?? 9)) byUrl.set(d.job_url, d); }
    for (const r of want) {
      const d = urlsOf(r).map((u) => byUrl.get(u)).filter(Boolean).sort((a, b) => (RANK[a.resume?.status] ?? 9) - (RANK[b.resume?.status] ?? 9))[0];
      const st = d?.resume?.status;
      if (st === "success") r.resumeEta = { state: "syncing", minutes: 2 };
      else if (st === "running") r.resumeEta = { state: "building", minutes: roundEta(pace(d.resume.owner)) };
      else if (st === "queued") {
        const p = d.resume.priority ?? 0, sc = d.score_pct ?? 0;
        const ahead = await jobs.countDocuments({ "resume.status": "queued", "resume.owner": d.resume.owner, $or: [{ "resume.priority": { $gt: p } }, { "resume.priority": p, score_pct: { $gt: sc } }] });
        r.resumeEta = { state: "queued", ahead, minutes: roundEta((ahead + 1) * pace(d.resume.owner)) };
      } else r.resumeEta = { state: st === "failed" ? "failed" : "not_queued", minutes: null };
    }
  }
  for (const r of rows) delete r._jobUrls;
  return rows;
}

export async function linkedinJobs(db, { now = new Date(), days = 3, limit = 600 } = {}) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const [docs, applied, dismissed] = await Promise.all([
    db.collection("jobs").find({ run_at: { $gte: since }, job_url: /^https:\/\/(www\.)?linkedin\.com\//, "resume.status": "success" },
      { projection: { _id: 0, job_url: 1, company: 1, title: 1, location: 1, score_pct: 1, date_posted: 1, run_at: 1, apply_type: 1, "resume.pdf_path": 1 } }).toArray(),
    db.collection("applications").distinct("jobUrls"),
    db.collection("job_swipes").distinct("job_url", { direction: { $in: ["left", "applied"] } }),
  ]);
  const skip = new Set([...applied, ...dismissed]);
  const byUrl = new Map();
  for (const d of docs) {
    if (skip.has(d.job_url) || d.apply_type === "closed") continue;
    const found = isoOf(d.run_at), posted = isoOf(d.date_posted);
    const cur = byUrl.get(d.job_url);
    if (!cur) {
      byUrl.set(d.job_url, { id: d.job_url, url: d.job_url, company: d.company ?? "", title: d.title ?? "", location: d.location ?? null,
        score: typeof d.score_pct === "number" ? d.score_pct : null, postedAt: posted, foundAt: found, track: trackOf(d.title),
        resumeFile: d.resume?.pdf_path ? String(d.resume.pdf_path).split("/").slice(-2).join("/") : null,
        // The tailored resume itself (Today's Resume button shows it through /serve-pdf).
        resumePath: d.resume?.pdf_path ?? null,
        // The file is on this machine, so Apply with Atriveo can attach it now.
        resumeReady: Boolean(d.resume?.pdf_path && fs.existsSync(d.resume.pdf_path)),
        resumeMatch: resumeMatchOf(d.resume?.pdf_path),
        // "offsite" (the company's own form), "easy_apply" (LinkedIn's), or null until checked.
        applyType: d.apply_type ?? null });
    } else {
      if (typeof d.score_pct === "number") cur.score = Math.max(cur.score ?? 0, d.score_pct);
      if (found && (!cur.foundAt || found < cur.foundAt)) cur.foundAt = found;
      if (posted && (!cur.postedAt || posted < cur.postedAt)) cur.postedAt = posted;
    }
  }
  return [...byUrl.values()].sort((a, b) => (b.foundAt ?? "").localeCompare(a.foundAt ?? "")).slice(0, limit);
}

/** You applied to this job outside Atriveo's tracking ("Mark applied" on an On LinkedIn card): kept off Today, counted. */
export async function markJobApplied(db, jobUrl, now = new Date()) {
  if (!/^https:\/\//.test(String(jobUrl || ""))) throw new Error("A job URL is required");
  await db.collection("job_swipes").updateOne({ job_url: jobUrl },
    { $set: { job_url: jobUrl, direction: "applied", swiped_at: now.toISOString(), applied_at: now.toISOString(), date: now.toISOString().slice(0, 10), source: "apply-console" } }, { upsert: true });
  return { ok: true };
}

/**
 * The LinkedIn posting you opened from Today, linked to the application Apply with Atriveo started on the
 * company's form: the posting's URL joins the application's job URLs, so its On LinkedIn card leaves Today and
 * your Submit (tracked by the extension) counts for it. Only an application that exists and isn't submitted yet.
 */
export async function linkJobToApplication(db, applicationId, jobUrl) {
  if (!/^https:\/\/(www\.)?linkedin\.com\//.test(String(jobUrl || ""))) throw new Error("A LinkedIn job URL is required");
  const r = await db.collection("applications").updateOne({ _id: String(applicationId || "") }, { $addToSet: { jobUrls: jobUrl } });
  if (!r.matchedCount) throw new Error("Application not found");
  return { ok: true, linked: r.modifiedCount > 0 };
}

/**
 * The company's own Apply link for a LinkedIn job, seen by Atriveo Fill when LinkedIn opened it in your browser.
 * Saved as the job's job_url_direct (what the pipeline applies to) unless it already has one.
 */
export async function saveLinkedinDirect(db, jobUrl, directUrl, now = new Date()) {
  if (!/^https:\/\/(www\.)?linkedin\.com\/jobs\/view\/\d+$/.test(String(jobUrl || ""))) throw new Error("A LinkedIn job URL is required");
  let u;
  try { u = new URL(String(directUrl || "")); } catch { throw new Error("A company URL is required"); }
  if (u.protocol !== "https:" || /(^|\.)linkedin\.com$/.test(u.hostname)) throw new Error("Not a company URL");
  const r = await db.collection("jobs").updateMany({ job_url: jobUrl, $or: [{ job_url_direct: null }, { job_url_direct: { $exists: false } }] },
    { $set: { job_url_direct: u.href, job_url_direct_from: "your-browser", job_url_direct_at: now.toISOString() } });
  return { ok: true, saved: r.modifiedCount };
}

/** Not interested in this job (Discard on a Today card that has no application): a left swipe, as the job feed records it. */
export async function dismissJob(db, jobUrl, now = new Date()) {
  if (!/^https:\/\//.test(String(jobUrl || ""))) throw new Error("A job URL is required");
  await db.collection("job_swipes").updateOne({ job_url: jobUrl },
    { $set: { job_url: jobUrl, direction: "left", swiped_at: now.toISOString(), date: now.toISOString().slice(0, 10), source: "apply-console" } }, { upsert: true });
  return { ok: true };
}

export async function reviewQueue(db, { view = "full", cards = 0, ids = [], now = new Date() } = {}) {
  const apps = db.collection("applications");
  const generatedAt = now.toISOString();
  switch (view) {
    case "cards":
      return { ok: true, generatedAt, cards: await unansweredCards(apps, ids) };
    case "linkedin":
      return { ok: true, generatedAt, linkedin: await addResumeEta(db, await linkedinJobs(db, { now }), now) };
    case "counts": {
      const [engine, totals, ready] = await Promise.all([engineState(db), blockedTotals(apps), readyRows(apps)]);
      return { ok: true, generatedAt, ...engine, counts: { ...totals, ready: ready.length } };
    }
    case "unanswered": {
      const [engine, order, ready] = await Promise.all([engineState(db), unansweredOrder(apps), readyRows(apps)]);
      await addJobFacts(db, order);
      await addResumeEta(db, order, now);
      const first = await unansweredCards(apps, order.slice(0, cards).map((r) => r.id));
      return { ok: true, generatedAt, ...engine, counts: countsOf(order, ready), unanswered: order, cards: first };
    }
    case "ready": {
      const [engine, totals, ready, approved, inBrowser] = await Promise.all([engineState(db), blockedTotals(apps), readyRows(apps), approvals(apps, now), inBrowserRows(apps, now)]);
      await addJobFacts(db, ready);
      return { ok: true, generatedAt, ...engine, counts: { ...totals, ready: ready.length, inBrowser: inBrowser.length }, ...readyLists(ready, approved, now), inBrowser };
    }
    case "full": {
      const [engine, order, ready, approved, inBrowser] = await Promise.all([engineState(db), unansweredOrder(apps), readyRows(apps), approvals(apps, now), inBrowserRows(apps, now)]);
      await addJobFacts(db, [...order, ...ready]);
      await addResumeEta(db, order, now);
      const unanswered = await unansweredCards(apps, order.map((r) => r.id));
      return { ok: true, generatedAt, ...engine, counts: { ...countsOf(order, ready), inBrowser: inBrowser.length }, unanswered, ...readyLists(ready, approved, now), inBrowser };
    }
    default:
      throw new Error(`Unknown review-queue view: ${view}`);
  }
}

/** Every choice of one pending question: the lists too long to send with the review queue. Read-only. */
export async function questionOptions(db, id, fingerprint) {
  const [row] = await db.collection("applications").aggregate([
    { $match: { _id: id } },
    { $project: { _id: 0, q: { $filter: { input: { $ifNull: ["$review.pending", []] }, cond: { $eq: ["$$this.fingerprint", fingerprint] } } } } },
  ]).toArray();
  const q = row?.q?.[0];
  return q ? { ok: true, options: q.options ?? [] } : { ok: false, error: "That question is no longer waiting for an answer" };
}

export async function applicationsAnalytics(db, { days = 30, limit = 300 } = {}) {
  const apps = db.collection("applications");
  const inboxSince = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const [statusRows, atsRows, reasonRows, failureRows, pendingRows, records, patternRows, control, boardRows, siteRows, resumeReady, discovered, accountRows, workerDocs, inboxRows, queueReportDoc] = await Promise.all([
    apps.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]).toArray(),
    apps.aggregate([{ $group: { _id: { ats: "$ats", status: "$status" }, n: { $sum: 1 } } }]).toArray(),
    apps.aggregate([{ $match: { status: "NEEDS_REVIEW" } }, { $group: { _id: "$review.reason", n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray(),
    apps.aggregate([{ $match: { "failure.code": { $exists: true, $ne: null } } }, { $group: { _id: "$failure.code", n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray(),
    apps.aggregate([
      { $match: { status: "NEEDS_REVIEW" } },
      { $unwind: "$review.pending" },
      { $group: { _id: "$review.pending.label", n: { $sum: 1 }, reason: { $first: "$review.pending.reason" } } },
      { $sort: { n: -1 } },
      { $limit: 15 },
    ]).toArray(),
    apps.find({}, {
      projection: {
        company: 1, title: 1, location: 1, ats: 1, status: 1, priority: 1, applyUrl: 1, finalUrl: 1, attemptCount: 1, createdAt: 1, updatedAt: 1,
        lifecycle: 1, step: 1, attempts: 1, "review.reason": 1, "review.detail": 1, "review.questionReviewStatus": 1, "review.pending": 1, "failure.code": 1, "failure.message": 1,
        "submission.by": 1, "submission.submittedAt": 1, "submission.attemptedAt": 1, "domain.domain": 1, source: 1, outcome: 1,
        ...IN_BROWSER_FIELDS,
      },
    }).sort({ updatedAt: -1 }).limit(limit).toArray(),
    db.collection("form_patterns").aggregate([{ $group: { _id: "$trust", n: { $sum: 1 } } }]).toArray(),
    db.collection("engine_control").findOne({ _id: "submissions" }),
    db.collection("ats_boards").aggregate([
      { $group: { _id: "$ats", boards: { $sum: 1 }, polled: { $sum: { $cond: [{ $ifNull: ["$last_polled_at", false] }, 1, 0] } }, matched: { $sum: { $cond: [{ $ifNull: ["$last_matched_at", false] }, 1, 0] } } } },
    ]).toArray(),
    db.collection("jobs").aggregate([{ $group: { _id: "$site", n: { $sum: 1 } } }]).toArray(),
    db.collection("jobs").distinct("job_url", { "resume.status": "success" }),
    db.collection("jobs").distinct("job_url"),
    // Portal accounts the engine created (playatriveo `accounts.email`). Includes the generated
    // password on purpose: this endpoint sits behind the site login and the Dashboard masks it.
    db.collection("application_accounts").find({}).sort({ createdAt: -1 }).limit(100).toArray(),
    // Worker heartbeats written by playatriveo (`worker:<id>`): online state and Gmail status. No secrets in them.
    db.collection("engine_control").find({ _id: { $regex: "^worker:" } }).toArray(),
    // Inbox watcher (playatriveo): confirmation / rejection mails and where they were recorded. Metadata only.
    db.collection("inbox_events").find({ receivedAt: { $gte: inboxSince }, kind: { $in: ["applied", "rejected"] } }, {
      projection: { receivedAt: 1, kind: 1, subject: 1, companies: 1, titles: 1, state: 1, match: 1, tracker: 1, feed: 1 },
    }).sort({ receivedAt: -1 }).limit(500).toArray(),
    // "Why aren't jobs applied" — computed by the playatriveo worker with the engine's own rules.
    db.collection("engine_control").findOne({ _id: "queue_report" }),
  ]);

  const byStatus = Object.fromEntries(statusRows.map((r) => [r._id, r.n]));
  const total = records.length ? statusRows.reduce((s, r) => s + r.n, 0) : 0;

  // Daily outcomes over the window (by each record's latest outcome time).
  const today = new Date();
  const daysList = Array.from({ length: days }, (_, i) => dayKey(new Date(today.getTime() - (days - 1 - i) * 86_400_000).toISOString()));
  const daily = new Map(daysList.map((d) => [d, { day: d, queued: 0, applied: 0, needsReview: 0, failed: 0, skipped: 0 }]));
  const all = await apps.find({}, { projection: { status: 1, lifecycle: 1 } }).toArray();
  // Newest event per tile (ISO strings compare correctly); null when nothing has happened yet.
  const lastAt = { discovered: null, matched: null, queued: null, applied: null, needsReview: null, failed: null };
  const newer = (cur, v) => (v && (!cur || String(v) > String(cur)) ? v : cur);
  for (const r of all) {
    const lc = r.lifecycle ?? {};
    if (r.status === "READY_TO_APPLY") lastAt.queued = newer(lastAt.queued, lc.queuedAt);
    if (r.status === "APPLIED") lastAt.applied = newer(lastAt.applied, lc.appliedAt);
    if (r.status === "NEEDS_REVIEW") lastAt.needsReview = newer(lastAt.needsReview, lc.reviewAt);
    if (r.status === "FAILED") lastAt.failed = newer(lastAt.failed, lc.failedAt);
    const q = daily.get(dayKey(lc.queuedAt));
    if (q) q.queued += 1;
    const outcome = r.status === "APPLIED" ? ["applied", lc.appliedAt]
      : r.status === "NEEDS_REVIEW" ? ["needsReview", lc.reviewAt]
      : r.status === "FAILED" ? ["failed", lc.failedAt]
      : r.status === "SKIPPED" ? ["skipped", lc.skippedAt]
      : null;
    const bucket = outcome ? daily.get(dayKey(outcome[1])) : null;
    if (bucket) bucket[outcome[0]] += 1;
  }

  const [lastJob, lastResume] = await Promise.all([
    db.collection("jobs").find({}, { projection: { created_at: 1 } }).sort({ created_at: -1 }).limit(1).toArray(),
    db.collection("jobs").find({ "resume.status": "success" }, { projection: { "resume.updated_at": 1 } }).sort({ "resume.updated_at": -1 }).limit(1).toArray(),
  ]);
  lastAt.discovered = lastJob[0]?.created_at ?? null;
  lastAt.matched = lastResume[0]?.resume?.updated_at ?? null;

  // Average wall-clock time of the finished attempt for recent successful applications.
  const durations = records
    .filter((r) => r.status === "APPLIED")
    .map((r) => (r.attempts ?? []).filter((a) => a.endedAt && a.startedAt).pop())
    .filter(Boolean)
    .map((a) => new Date(a.endedAt).getTime() - new Date(a.startedAt).getTime())
    .filter((ms) => ms > 0 && ms < 3_600_000);
  const avgApplyMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  const atsMap = new Map();
  for (const r of atsRows) {
    const ats = r._id.ats ?? "unknown";
    const row = atsMap.get(ats) ?? { ats, total: 0, APPLIED: 0, NEEDS_REVIEW: 0, FAILED: 0, SKIPPED: 0, other: 0 };
    row.total += r.n;
    if (row[r._id.status] !== undefined) row[r._id.status] += r.n;
    else row.other += r.n;
    atsMap.set(ats, row);
  }

  const applied = byStatus.APPLIED ?? 0;
  const failed = byStatus.FAILED ?? 0;
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    kpis: {
      total,
      applied,
      needsReview: byStatus.NEEDS_REVIEW ?? 0,
      failed,
      skipped: byStatus.SKIPPED ?? 0,
      inProgress: (byStatus.READY_TO_APPLY ?? 0) + (byStatus.APPLYING ?? 0) + (byStatus.SUBMITTING ?? 0),
      successRate: applied + failed ? applied / (applied + failed) : null,
    },
    funnel: [
      { stage: "Jobs found", n: discovered.length },
      { stage: "Resume ready", n: resumeReady.length },
      { stage: "Sent to the engine", n: total },
      { stage: "Applied", n: applied },
    ],
    byStatus,
    daily: [...daily.values()],
    byAts: [...atsMap.values()].sort((a, b) => b.total - a.total),
    reviewReasons: reasonRows.map((r) => ({ reason: r._id ?? "unknown", n: r.n })),
    failureCodes: failureRows.map((r) => ({ code: r._id, n: r.n })),
    topPendingQuestions: pendingRows.map((r) => ({ label: r._id, n: r.n, reason: r.reason })),
    formTrust: Object.fromEntries(patternRows.map((r) => [r._id, r.n])),
    killSwitch: killSwitchOf(control),
    discovery: {
      boards: boardRows.map((b) => ({ ats: b._id, boards: b.boards, polled: b.polled, withMatches: b.matched })),
      jobsBySite: siteRows.map((s) => ({ site: s._id ?? "unknown", n: s.n })).sort((a, b) => b.n - a.n),
    },
    // The application being worked on right now (read-only view of the engine's own record).
    current: (() => {
      const r = records.find((x) => x.status === "APPLYING" || x.status === "SUBMITTING");
      if (!r) return null;
      const attempt = (r.attempts ?? []).filter((a) => !a.endedAt).pop() ?? (r.attempts ?? []).at(-1) ?? null;
      return {
        id: r._id, company: r.company, title: r.title, ats: r.ats ?? null, status: r.status,
        step: r.step?.name ?? null, attempt: attempt?.n ?? r.attemptCount ?? null,
        startedAt: attempt?.startedAt ?? null, updatedAt: r.updatedAt, url: r.finalUrl ?? r.applyUrl,
      };
    })(),
    lastActivityAt: records[0]?.updatedAt ?? null,
    lastAt: { ...lastAt, avgApplyMs },
    worker: workerOf(workerDocs),
    inbox: inboxSummary(inboxRows, records),
    queueReport: queueReportDoc ? (({ _id, ...r }) => r)(queueReportDoc) : null,
    accounts: accountRows.map((a) => ({
      id: a._id, ats: a.ats, tenant: a.tenant, email: a.email, password: a.password, status: a.status,
      loginUrl: a.loginUrl ?? null, createdAt: a.createdAt, updatedAt: a.updatedAt,
    })),
    history: records.map((r) => ({
      id: r._id,
      company: r.company,
      title: r.title,
      location: r.location ?? null,
      ats: r.ats ?? null,
      status: r.status,
      reviewReason: r.review?.reason ?? null,
      reviewDetail: r.review?.detail ?? null,
      questionReviewStatus: r.review?.questionReviewStatus ?? null,
      pending: (r.review?.pending ?? []).map((p) => p.label),
      // Full questions for answering in the dashboard (no answer values are stored here).
      questions: (r.review?.pending ?? []).map((p) => ({
        fingerprint: p.fingerprint, label: p.label, type: p.type, required: p.required, options: p.options ?? [],
        canonicalKey: p.canonicalKey ?? null, sensitive: p.sensitive ?? null, reason: p.reason, detail: p.detail,
        openEndedAssessment: p.openEndedAssessment ?? null,
      })),
      submitAttempted: Boolean(r.submission?.attemptedAt),
      failureCode: r.failure?.code ?? null,
      failureMessage: r.failure?.message ? String(r.failure.message).split("\n")[0].slice(0, 200) : null,
      submittedBy: r.submission?.by ?? null,
      submittedAt: r.submission?.submittedAt ?? null,
      attempts: r.attemptCount ?? 0,
      domain: r.domain?.domain ?? null,
      url: r.finalUrl ?? r.applyUrl,
      outcome: r.outcome ? { status: r.outcome.status, at: r.outcome.rejectedAt ?? r.outcome.confirmedAt ?? null, subject: r.outcome.subject ?? null } : null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      priority: r.priority ?? 0,
      owner: r.owner === "extension" ? "extension" : "engine",
      ...(r.owner === "extension" ? { inBrowser: inBrowserRow(r) } : {}),
    })),
  };
}

// --- Overview, per view -----------------------------------------------------------------------
// The full response above reads the 300 newest records whole (every pending question and its option
// lists, every attempt): ~1 MB, ~11 s over the Mac's link to Atlas. The Overview page now asks for
//   view=summary  everything but history, computed in Mongo, plus light rows for the queue panel and
//                 the first ATTENTION_PREVIEW of the attention panel (counted over every record, not
//                 only the newest 300);
//   view=history  one page of light history rows (&status=A,B&q=&skip=&limit=), newest first; the
//                 attention panel's "View all" is status=NEEDS_REVIEW,FAILED.
// A row's pending questions load only when you open its review drawer (review-queue view=cards).

const LIGHT_ROW = {
  company: 1, title: 1, location: 1, ats: 1, status: 1, priority: 1, applyUrl: 1, finalUrl: 1, attemptCount: 1, createdAt: 1, updatedAt: 1,
  "review.reason": 1, "review.detail": 1, "review.questionReviewStatus": 1, "failure.code": 1, "failure.message": 1,
  "submission.by": 1, "submission.submittedAt": 1, "submission.attemptedAt": 1, "domain.domain": 1,
  "outcome.status": 1, "outcome.rejectedAt": 1, "outcome.confirmedAt": 1, "outcome.subject": 1,
  pendingCount: { $size: { $ifNull: ["$review.pending", []] } },
  ...IN_BROWSER_FIELDS,
};

/** A history row as the Overview shows it; `questions` stay empty until the review drawer loads them. */
const lightRow = (r) => ({
  id: r._id, company: r.company, title: r.title, location: r.location ?? null, ats: r.ats ?? null, status: r.status,
  reviewReason: r.review?.reason ?? null, reviewDetail: r.review?.detail ?? null, questionReviewStatus: r.review?.questionReviewStatus ?? null,
  pendingCount: r.pendingCount ?? 0, questions: [],
  submitAttempted: Boolean(r.submission?.attemptedAt),
  failureCode: r.failure?.code ?? null,
  failureMessage: r.failure?.message ? String(r.failure.message).split("\n")[0].slice(0, 200) : null,
  submittedBy: r.submission?.by ?? null, submittedAt: r.submission?.submittedAt ?? null,
  attempts: r.attemptCount ?? 0, domain: r.domain?.domain ?? null, url: r.finalUrl ?? r.applyUrl,
  outcome: r.outcome?.status ? { status: r.outcome.status, at: r.outcome.rejectedAt ?? r.outcome.confirmedAt ?? null, subject: r.outcome.subject ?? null } : null,
  createdAt: r.createdAt, updatedAt: r.updatedAt, priority: r.priority ?? 0,
  // Open in your browser (Apply with Atriveo): the dashboard offers only Return to worker and Skip.
  owner: r.owner === "extension" ? "extension" : "engine",
  ...(r.owner === "extension" ? { inBrowser: inBrowserRow(r) } : {}),
});

const lightRows = async (apps, match, { skip = 0, limit = 0 } = {}) => (await apps.aggregate([
  { $match: match }, { $sort: { updatedAt: -1, _id: 1 } }, ...(skip ? [{ $skip: skip }] : []), ...(limit ? [{ $limit: limit }] : []), { $project: LIGHT_ROW },
]).toArray()).map(lightRow);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One page of history, newest first, filtered by status and a company/role/ATS search. */
export async function overviewHistory(db, { status = "ALL", q = "", skip = 0, limit = 25 } = {}) {
  const apps = db.collection("applications");
  const term = q.trim().slice(0, 80);
  const statuses = String(status || "ALL").split(",").map((s) => s.trim()).filter((s) => s && s !== "ALL");
  const match = {
    ...(statuses.length ? { status: { $in: statuses } } : {}),
    ...(term ? { $or: ["company", "title", "ats"].map((f) => ({ [f]: { $regex: escapeRegex(term), $options: "i" } })) } : {}),
  };
  const [rows, total] = await Promise.all([lightRows(apps, match, { skip, limit }), apps.countDocuments(match)]);
  return { ok: true, generatedAt: new Date().toISOString(), rows, total, skip, limit };
}

const ATTENTION = { status: { $in: ["NEEDS_REVIEW", "FAILED"] } };
const ATTENTION_PREVIEW = 20;

const OUTCOME_AT = { $switch: { branches: [
  { case: { $eq: ["$status", "APPLIED"] }, then: "$lifecycle.appliedAt" },
  { case: { $eq: ["$status", "NEEDS_REVIEW"] }, then: "$lifecycle.reviewAt" },
  { case: { $eq: ["$status", "FAILED"] }, then: "$lifecycle.failedAt" },
  { case: { $eq: ["$status", "SKIPPED"] }, then: "$lifecycle.skippedAt" },
], default: null } };
const dayOf = (field) => ({ $dateToString: { date: { $toDate: field }, format: "%Y-%m-%d", timezone: TZ } });

/** The Overview without its history: the same numbers as the full response, computed in Mongo. */
/** The day keys (YYYY-MM-DD, America/New_York) from `from` to `to`, inclusive; at most 400. */
function daysBetween(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); out.length < 400 && dayKey(new Date(t).toISOString()) <= to; t += 86_400_000) out.push(dayKey(new Date(t).toISOString()));
  return out;
}

/**
 * The Stats page. `from`/`to` (YYYY-MM-DD, your time zone) choose its date range: the daily series and every
 * range total (`range`) cover those days. Without them, the last `days` days ending today.
 */
export async function overviewSummary(db, { days = 30, from = null, to = null } = {}) {
  const apps = db.collection("applications");
  const inboxSince = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const rangeDays = from && to ? daysBetween(from, to) : null;
  if (rangeDays) days = rangeDays.length;
  // A day of margin either side; the day keys below decide what counts.
  const windowSince = new Date((rangeDays ? Date.parse(`${rangeDays[0]}T00:00:00Z`) : Date.now()) - (rangeDays ? 1 : days + 1) * 86_400_000).toISOString();
  const [statusRows, atsRows, reasonRows, failureRows, pendingRows, patternRows, control, boardRows, siteRows, resumeReady, discovered, accountRows, workerDocs, inboxRows, queueReportDoc,
    timeline, recent, current, attention, queue, lastJob, lastResume] = await Promise.all([
    apps.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]).toArray(),
    apps.aggregate([{ $group: { _id: { ats: "$ats", status: "$status" }, n: { $sum: 1 } } }]).toArray(),
    apps.aggregate([{ $match: { status: "NEEDS_REVIEW" } }, { $group: { _id: "$review.reason", n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray(),
    apps.aggregate([{ $match: { "failure.code": { $exists: true, $ne: null } } }, { $group: { _id: "$failure.code", n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray(),
    apps.aggregate([
      { $match: { status: "NEEDS_REVIEW" } }, { $unwind: "$review.pending" },
      { $group: { _id: "$review.pending.label", n: { $sum: 1 }, reason: { $first: "$review.pending.reason" } } }, { $sort: { n: -1, _id: 1 } }, { $limit: 15 },
    ]).toArray(),
    db.collection("form_patterns").aggregate([{ $group: { _id: "$trust", n: { $sum: 1 } } }]).toArray(),
    db.collection("engine_control").findOne({ _id: "submissions" }),
    db.collection("ats_boards").aggregate([
      { $group: { _id: "$ats", boards: { $sum: 1 }, polled: { $sum: { $cond: [{ $ifNull: ["$last_polled_at", false] }, 1, 0] } }, matched: { $sum: { $cond: [{ $ifNull: ["$last_matched_at", false] }, 1, 0] } } } },
    ]).toArray(),
    db.collection("jobs").aggregate([{ $group: { _id: "$site", n: { $sum: 1 } } }]).toArray(),
    // Distinct job URLs, counted in Mongo instead of downloading them.
    db.collection("jobs").aggregate([{ $match: { "resume.status": "success" } }, { $group: { _id: "$job_url" } }, { $count: "n" }]).toArray(),
    db.collection("jobs").aggregate([{ $group: { _id: "$job_url" } }, { $count: "n" }]).toArray(),
    db.collection("application_accounts").find({}).sort({ createdAt: -1 }).limit(100).toArray(),
    db.collection("engine_control").find({ _id: { $regex: "^worker:" } }).toArray(),
    db.collection("inbox_events").find({ receivedAt: { $gte: inboxSince }, kind: { $in: ["applied", "rejected"] } }, {
      projection: { receivedAt: 1, kind: 1, subject: 1, companies: 1, titles: 1, state: 1, match: 1, tracker: 1, feed: 1 },
    }).sort({ receivedAt: -1 }).limit(500).toArray(),
    db.collection("engine_control").findOne({ _id: "queue_report" }),
    // Daily outcomes and the newest event per tile, grouped in Mongo (dayKey's America/New_York days).
    apps.aggregate([
      { $project: { status: 1, queuedAt: "$lifecycle.queuedAt", outcomeAt: OUTCOME_AT } },
      { $facet: {
        last: [{ $group: { _id: "$status", queuedAt: { $max: "$queuedAt" }, outcomeAt: { $max: "$outcomeAt" } } }],
        queued: [{ $match: { queuedAt: { $gte: windowSince } } }, { $group: { _id: dayOf("$queuedAt"), n: { $sum: 1 } } }],
        outcomes: [{ $match: { outcomeAt: { $gte: windowSince } } }, { $group: { _id: { day: dayOf("$outcomeAt"), status: "$status" }, n: { $sum: 1 } } }],
      } },
    ]).toArray(),
    // The 300 newest, as the full response saw them: average apply time and the newest activity.
    apps.aggregate([
      { $sort: { updatedAt: -1 } }, { $limit: 300 }, { $match: { status: "APPLIED" } },
      { $project: { done: { $last: { $filter: { input: { $ifNull: ["$attempts", []] }, cond: { $and: ["$$this.endedAt", "$$this.startedAt"] } } } } } },
      { $project: { startedAt: "$done.startedAt", endedAt: "$done.endedAt" } },
    ]).toArray(),
    apps.find({ status: { $in: ["APPLYING", "SUBMITTING"] } }, { projection: { company: 1, title: 1, ats: 1, status: 1, step: 1, attempts: 1, attemptCount: 1, updatedAt: 1, finalUrl: 1, applyUrl: 1 } })
      .sort({ updatedAt: -1 }).limit(1).toArray(),
    lightRows(apps, ATTENTION, { limit: ATTENTION_PREVIEW }),
    lightRows(apps, { status: { $in: ["READY_TO_APPLY", "APPLYING", "SUBMITTING"] } }),
    db.collection("jobs").find({}, { projection: { created_at: 1 } }).sort({ created_at: -1 }).limit(1).toArray(),
    db.collection("jobs").find({ "resume.status": "success" }, { projection: { "resume.updated_at": 1 } }).sort({ "resume.updated_at": -1 }).limit(1).toArray(),
  ]);
  const newest = await apps.find({}, { projection: { updatedAt: 1 } }).sort({ updatedAt: -1 }).limit(1).toArray();

  const byStatus = Object.fromEntries(statusRows.map((r) => [r._id, r.n]));
  const total = statusRows.reduce((s, r) => s + r.n, 0);
  const today = new Date();
  const daysList = rangeDays ?? Array.from({ length: days }, (_, i) => dayKey(new Date(today.getTime() - (days - 1 - i) * 86_400_000).toISOString()));
  const daily = new Map(daysList.map((d) => [d, { day: d, queued: 0, applied: 0, needsReview: 0, failed: 0, skipped: 0 }]));
  const { last, queued, outcomes } = timeline[0];
  for (const r of queued) { const d = daily.get(r._id); if (d) d.queued += r.n; }
  const OUTCOME_KEY = { APPLIED: "applied", NEEDS_REVIEW: "needsReview", FAILED: "failed", SKIPPED: "skipped" };
  for (const r of outcomes) { const d = daily.get(r._id.day); const key = OUTCOME_KEY[r._id.status]; if (d && key) d[key] += r.n; }
  const lastOf = (status, field) => last.find((r) => r._id === status)?.[field] ?? null;
  const lastAt = {
    discovered: lastJob[0]?.created_at ?? null,
    matched: lastResume[0]?.resume?.updated_at ?? null,
    queued: lastOf("READY_TO_APPLY", "queuedAt"),
    applied: lastOf("APPLIED", "outcomeAt"),
    needsReview: lastOf("NEEDS_REVIEW", "outcomeAt"),
    failed: lastOf("FAILED", "outcomeAt"),
  };
  const durations = recent.map((a) => new Date(a.endedAt).getTime() - new Date(a.startedAt).getTime()).filter((ms) => ms > 0 && ms < 3_600_000);
  const avgApplyMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  const atsMap = new Map();
  for (const r of atsRows) {
    const ats = r._id.ats ?? "unknown";
    const row = atsMap.get(ats) ?? { ats, total: 0, APPLIED: 0, NEEDS_REVIEW: 0, FAILED: 0, SKIPPED: 0, other: 0 };
    row.total += r.n;
    if (row[r._id.status] !== undefined) row[r._id.status] += r.n;
    else row.other += r.n;
    atsMap.set(ats, row);
  }
  // Labels for the applications an unsure mail might belong to.
  const candidateIds = [...new Set(inboxRows.flatMap((e) => (e.state === "needs_confirm" && !e.tracker ? e.match?.candidates ?? [] : [])))];
  const labelled = candidateIds.length ? await apps.find({ _id: { $in: candidateIds } }, { projection: { company: 1, title: 1 } }).toArray() : [];

  const applied = byStatus.APPLIED ?? 0;
  const failed = byStatus.FAILED ?? 0;
  const cur = current[0];
  const attempt = cur ? (cur.attempts ?? []).filter((a) => !a.endedAt).pop() ?? (cur.attempts ?? []).at(-1) ?? null : null;
  // LinkedIn postings (the engine never applies there): ones you marked applied, and ones waiting on Today.
  const rangeFrom = daysList[0], rangeTo = daysList[daysList.length - 1];
  const inDays = { $gte: rangeFrom, $lte: rangeTo };
  const [linkedinApplied, linkedinWaiting, discoveredIn, matchedIn] = await Promise.all([
    db.collection("job_swipes").find({ direction: "applied" }, { projection: { _id: 0, applied_at: 1 } }).toArray(),
    linkedinJobs(db).then((l) => l.length).catch(() => null),
    // Jobs first found in the range (job-pipeline keeps a document per session: the earliest run_at counts).
    db.collection("jobs").aggregate([{ $group: { _id: "$job_url", first: { $min: "$run_at" } } }, { $match: { first: { $ne: null } } }, { $project: { day: dayOf("$first") } }, { $match: { day: inDays } }, { $count: "n" }]).toArray(),
    // Resumes finished in the range.
    db.collection("jobs").aggregate([{ $match: { "resume.status": "success", "resume.updated_at": { $ne: null } } }, { $group: { _id: "$job_url", at: { $max: "$resume.updated_at" } } }, { $project: { day: dayOf("$at") } }, { $match: { day: inDays } }, { $count: "n" }]).toArray(),
  ]);
  const todayKey = dayKey(new Date().toISOString());
  const linkedin = { applied: linkedinApplied.length, appliedToday: linkedinApplied.filter((a) => dayKey(a.applied_at) === todayKey).length, waiting: linkedinWaiting };
  // Totals for the chosen days (the Stats tiles): what happened in the range, LinkedIn included.
  const sum = (key) => daysList.reduce((n, d) => n + (daily.get(d)?.[key] ?? 0), 0);
  const range = {
    from: rangeFrom, to: rangeTo, days: daysList.length,
    discovered: discoveredIn[0]?.n ?? 0, matched: matchedIn[0]?.n ?? 0,
    queued: sum("queued"), applied: sum("applied"), needsReview: sum("needsReview"), failed: sum("failed"), skipped: sum("skipped"),
    linkedinApplied: linkedinApplied.filter((a) => { const d = dayKey(a.applied_at); return d && d >= rangeFrom && d <= rangeTo; }).length,
  };

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    kpis: {
      total, applied, needsReview: byStatus.NEEDS_REVIEW ?? 0, failed, skipped: byStatus.SKIPPED ?? 0,
      inProgress: (byStatus.READY_TO_APPLY ?? 0) + (byStatus.APPLYING ?? 0) + (byStatus.SUBMITTING ?? 0),
      successRate: applied + failed ? applied / (applied + failed) : null,
    },
    funnel: [
      { stage: "Jobs found", n: discovered[0]?.n ?? 0 },
      { stage: "Resume ready", n: resumeReady[0]?.n ?? 0 },
      { stage: "Sent to the engine", n: total },
      { stage: "Applied", n: applied },
    ],
    byStatus,
    daily: [...daily.values()],
    byAts: [...atsMap.values()].sort((a, b) => b.total - a.total),
    reviewReasons: reasonRows.map((r) => ({ reason: r._id ?? "unknown", n: r.n })),
    failureCodes: failureRows.map((r) => ({ code: r._id, n: r.n })),
    topPendingQuestions: pendingRows.map((r) => ({ label: r._id, n: r.n, reason: r.reason })),
    formTrust: Object.fromEntries(patternRows.map((r) => [r._id, r.n])),
    killSwitch: killSwitchOf(control),
    discovery: {
      boards: boardRows.map((b) => ({ ats: b._id, boards: b.boards, polled: b.polled, withMatches: b.matched })),
      jobsBySite: siteRows.map((s) => ({ site: s._id ?? "unknown", n: s.n })).sort((a, b) => b.n - a.n || a.site.localeCompare(b.site)),
    },
    current: cur ? {
      id: cur._id, company: cur.company, title: cur.title, ats: cur.ats ?? null, status: cur.status,
      step: cur.step?.name ?? null, attempt: attempt?.n ?? cur.attemptCount ?? null,
      startedAt: attempt?.startedAt ?? null, updatedAt: cur.updatedAt, url: cur.finalUrl ?? cur.applyUrl,
    } : null,
    lastActivityAt: newest[0]?.updatedAt ?? null,
    lastAt: { ...lastAt, avgApplyMs },
    worker: workerOf(workerDocs),
    inbox: inboxSummary(inboxRows, labelled),
    queueReport: queueReportDoc ? (({ _id, ...r }) => r)(queueReportDoc) : null,
    accounts: accountRows.map((a) => ({
      id: a._id, ats: a.ats, tenant: a.tenant, email: a.email, password: a.password, status: a.status,
      loginUrl: a.loginUrl ?? null, createdAt: a.createdAt, updatedAt: a.updatedAt,
    })),
    attention,
    attentionTotal: (byStatus.NEEDS_REVIEW ?? 0) + (byStatus.FAILED ?? 0),
    queue,
    linkedin,
    range,
  };
}

const SOURCE_LABEL = (p) => {
  if (!p) return "—";
  switch (p.source) {
    case "profile": return `Profile · ${p.path}`;
    case "answer_bank": return `Answer bank · ${p.scope === "global" ? "everywhere" : String(p.scope).replace("company:", "company ")} · ${p.key}`;
    case "learned": return "Learned from your earlier answer";
    case "rule": return `Rule · ${p.ruleId}`;
    case "policy": return `Policy · ${p.policyId}`;
    case "manual_review": return "You answered in review";
    default: return String(p.source);
  }
};

/** One application's full record for the History drawer: the resume used, every question with its answer, and the timeline. Read-only. */
export async function applicationDetail(db, id) {
  const r = await db.collection("applications").findOne({ _id: id });
  if (!r) return { ok: false, error: "Application not found" };
  return {
    ok: true,
    id: r._id, company: r.company, title: r.title, ats: r.ats ?? null, status: r.status, url: r.finalUrl ?? r.applyUrl,
    owner: r.owner === "extension" ? "extension" : "engine",
    inBrowser: r.owner === "extension" ? inBrowserRow(r) : null,
    resume: {
      fileName: r.resume?.fileName ?? null, path: r.resume?.path ?? null, sha256: r.resume?.sha256 ?? null,
      bytes: r.resume?.bytes ?? null, verifiedAt: r.resume?.verifiedAt ?? null, sourceJobUrl: r.resume?.sourceJobUrl ?? null,
    },
    questions: (r.questions ?? []).map((q) => {
      const withheld = q.sensitive && q.value == null && q.resolution === "answered";
      return {
        label: q.label, step: q.step ?? 0, required: Boolean(q.required), type: q.type,
        resolution: q.resolution, verified: Boolean(q.verified), sensitive: q.sensitive ?? null,
        answer: q.declined ? "Decline to self-identify" : q.value ?? null,
        answerKind: q.declined ? "declined" : q.value != null ? "value" : withheld ? "withheld" : q.resolution === "skipped" ? "blank" : "none",
        source: SOURCE_LABEL(q.provenance), detail: q.detail ?? null,
      };
    }),
    timeline: (r.history ?? []).map((h) => ({ at: h.at, from: h.from, to: h.to, actor: h.actor, reason: h.reason })),
    attempts: (r.attempts ?? []).map((a) => ({ n: a.n, startedAt: a.startedAt, endedAt: a.endedAt ?? null, outcome: a.outcome ?? null })),
    submission: { by: r.submission?.by ?? null, submittedAt: r.submission?.submittedAt ?? null, confirmation: r.submission?.confirmation?.excerpt ?? null },
    failure: r.failure ? { code: r.failure.code, message: String(r.failure.message ?? "").split("\n")[0].slice(0, 300) } : null,
  };
}
