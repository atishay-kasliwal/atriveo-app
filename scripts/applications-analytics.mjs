// Read-only analytics over the application engine's collections (playatriveo):
// applications, form_patterns, engine_control, plus job-pipeline's jobs and
// ats_boards for the discovery → resume → apply funnel. Served by the sidecar
// at GET /applications/analytics (behind the site login via the /tailor relay).

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
export function readyForApproval(r) {
  return r.status === "NEEDS_REVIEW" && r.review?.reason === "SUBMIT_APPROVAL"
    && !r.submission?.attemptedAt && !r.submission?.submittedAt
    && (r.review.pending ?? []).length === 0 && (r.review.failedChecks ?? []).length === 0
    && Boolean(r.submission?.validation?.passed && r.submission?.formSignature && r.resume?.sha256);
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
    company: 1, companyKey: 1, title: 1, location: 1, ats: 1, status: 1, priority: 1, applyUrl: 1, finalUrl: 1, createdAt: 1, updatedAt: 1,
    "resume.fileName": 1, "resume.sha256": 1, "failure.code": 1,
    "submission.attemptedAt": 1, "submission.submittedAt": 1, "submission.validation.passed": 1, "submission.formSignature": 1,
    "submission.approvalRequestedAt": 1, "submission.approvalInAttemptAt": 1,
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
const BLOCKED = { status: "NEEDS_REVIEW", "submission.attemptedAt": null, $or: [
  { "review.pending.0": { $exists: true } },
  { "review.questionReviewStatus": "complete", "review.reason": { $ne: "SUBMIT_APPROVAL" } },
] };
// readyForApproval needs this reason; its other checks run on these few rows.
const MAYBE_READY = { status: "NEEDS_REVIEW", "review.reason": "SUBMIT_APPROVAL" };

const rowBase = (r) => ({
  id: r._id, company: r.company, companyKey: r.companyKey ?? null, title: r.title, location: r.location ?? null, ats: r.ats ?? null,
  url: r.finalUrl ?? r.applyUrl, priority: r.priority ?? 0, updatedAt: r.updatedAt,
});

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
    updatedAt: 1, company: 1, title: 1,
    n: { $size: "$review.pending" },
    suggestions: categoryCount("readyForReview"),
    readyForReview: categoryCount("readyForReview"), needsInput: categoryCount("needsInput"), actionRequired: categoryCount("actionRequired"),
    rank: { $ifNull: ["$priority", 0] },
  } },
  { $sort: { suggestions: -1, n: 1, rank: -1, updatedAt: 1, _id: 1 } },
  { $project: { _id: 0, id: "$_id", updatedAt: 1, company: 1, title: 1, n: 1, suggestions: 1, readyForReview: 1, needsInput: 1, actionRequired: 1 } },
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
  const [t] = await apps.aggregate([{ $match: BLOCKED }, { $group: { _id: null, apps: { $sum: 1 }, questions: { $sum: { $size: "$review.pending" } } } }]).toArray();
  return { unanswered: t?.apps ?? 0, questions: t?.questions ?? 0 };
};

const readyRows = async (apps) => (await apps.aggregate([{ $match: MAYBE_READY }, reviewRow(false)]).toArray()).filter(readyForApproval);

/** Approved in the dashboard: still waiting for the worker, or claimed in the last two days; and who was submitted to lately. */
async function approvals(apps, now) {
  const since = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  const [approved, submittedRecently] = await Promise.all([
    apps.aggregate([
      { $match: { $or: [{ "submission.approvalRequestedAt": { $ne: null } }, { "submission.approvalInAttemptAt": { $gte: since } }] } },
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
  return {
    ready: readyDocs
      .map((r) => ({
        ...rowBase(r),
        filledAt: r.review.since ?? r.updatedAt,
        resumeFile: r.resume?.fileName ?? null,
        answered: r.answered ?? 0,
        readyAtCompany: perCompany.get(r.companyKey) ?? 1,
        companySubmittedToday: companiesSubmittedToday.has(r.companyKey),
      }))
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
  readyForReview: order.reduce((n, r) => n + r.readyForReview, 0), needsInput: order.reduce((n, r) => n + r.needsInput, 0), actionRequired: order.reduce((n, r) => n + r.actionRequired, 0) });

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
export async function reviewQueue(db, { view = "full", cards = 0, ids = [], now = new Date() } = {}) {
  const apps = db.collection("applications");
  const generatedAt = now.toISOString();
  switch (view) {
    case "cards":
      return { ok: true, generatedAt, cards: await unansweredCards(apps, ids) };
    case "counts": {
      const [engine, totals, ready] = await Promise.all([engineState(db), blockedTotals(apps), readyRows(apps)]);
      return { ok: true, generatedAt, ...engine, counts: { ...totals, ready: ready.length } };
    }
    case "unanswered": {
      const [engine, order, ready] = await Promise.all([engineState(db), unansweredOrder(apps), readyRows(apps)]);
      const first = await unansweredCards(apps, order.slice(0, cards).map((r) => r.id));
      return { ok: true, generatedAt, ...engine, counts: countsOf(order, ready), unanswered: order, cards: first };
    }
    case "ready": {
      const [engine, totals, ready, approved] = await Promise.all([engineState(db), blockedTotals(apps), readyRows(apps), approvals(apps, now)]);
      return { ok: true, generatedAt, ...engine, counts: { ...totals, ready: ready.length }, ...readyLists(ready, approved, now) };
    }
    case "full": {
      const [engine, order, ready, approved] = await Promise.all([engineState(db), unansweredOrder(apps), readyRows(apps), approvals(apps, now)]);
      const unanswered = await unansweredCards(apps, order.map((r) => r.id));
      return { ok: true, generatedAt, ...engine, counts: countsOf(order, ready), unanswered, ...readyLists(ready, approved, now) };
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
    })),
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
