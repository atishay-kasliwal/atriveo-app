// Read-only analytics over the application engine's collections (playatriveo):
// applications, form_patterns, engine_control, plus job-pipeline's jobs and
// ats_boards for the discovery → resume → apply funnel. Served by the sidecar
// at GET /applications/analytics (behind the site login via the /tailor relay).

const TZ = "America/New_York";
const dayKey = (iso) => (iso ? new Date(iso).toLocaleString("sv-SE", { timeZone: TZ }).slice(0, 10) : null);

export async function applicationsAnalytics(db, { days = 30, limit = 300 } = {}) {
  const apps = db.collection("applications");
  const [statusRows, atsRows, reasonRows, failureRows, pendingRows, records, patternRows, control, boardRows, siteRows, resumeReady, discovered] = await Promise.all([
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
        company: 1, title: 1, location: 1, ats: 1, status: 1, applyUrl: 1, finalUrl: 1, attemptCount: 1, createdAt: 1, updatedAt: 1,
        lifecycle: 1, "review.reason": 1, "review.detail": 1, "review.pending": 1, "failure.code": 1, "failure.message": 1,
        "submission.by": 1, "submission.submittedAt": 1, "submission.attemptedAt": 1, "domain.domain": 1, source: 1,
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
  ]);

  const byStatus = Object.fromEntries(statusRows.map((r) => [r._id, r.n]));
  const total = records.length ? statusRows.reduce((s, r) => s + r.n, 0) : 0;

  // Daily outcomes over the window (by each record's latest outcome time).
  const today = new Date();
  const daysList = Array.from({ length: days }, (_, i) => dayKey(new Date(today.getTime() - (days - 1 - i) * 86_400_000).toISOString()));
  const daily = new Map(daysList.map((d) => [d, { day: d, queued: 0, applied: 0, needsReview: 0, failed: 0, skipped: 0 }]));
  const all = await apps.find({}, { projection: { status: 1, lifecycle: 1 } }).toArray();
  for (const r of all) {
    const lc = r.lifecycle ?? {};
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
      { stage: "Queued to apply", n: total },
      { stage: "Applied", n: applied },
    ],
    byStatus,
    daily: [...daily.values()],
    byAts: [...atsMap.values()].sort((a, b) => b.total - a.total),
    reviewReasons: reasonRows.map((r) => ({ reason: r._id ?? "unknown", n: r.n })),
    failureCodes: failureRows.map((r) => ({ code: r._id, n: r.n })),
    topPendingQuestions: pendingRows.map((r) => ({ label: r._id, n: r.n, reason: r.reason })),
    formTrust: Object.fromEntries(patternRows.map((r) => [r._id, r.n])),
    killSwitch: control ? { enabled: Boolean(control.enabled), reason: control.reason ?? null, updatedAt: control.updatedAt, updatedBy: control.updatedBy } : null,
    discovery: {
      boards: boardRows.map((b) => ({ ats: b._id, boards: b.boards, polled: b.polled, withMatches: b.matched })),
      jobsBySite: siteRows.map((s) => ({ site: s._id ?? "unknown", n: s.n })).sort((a, b) => b.n - a.n),
    },
    history: records.map((r) => ({
      id: r._id,
      company: r.company,
      title: r.title,
      location: r.location ?? null,
      ats: r.ats ?? null,
      status: r.status,
      reviewReason: r.review?.reason ?? null,
      reviewDetail: r.review?.detail ?? null,
      pending: (r.review?.pending ?? []).map((p) => p.label),
      // Full questions for answering in the dashboard (no answer values are stored here).
      questions: (r.review?.pending ?? []).map((p) => ({
        fingerprint: p.fingerprint, label: p.label, type: p.type, required: p.required, options: p.options ?? [],
        canonicalKey: p.canonicalKey ?? null, sensitive: p.sensitive ?? null, reason: p.reason, detail: p.detail,
      })),
      submitAttempted: Boolean(r.submission?.attemptedAt),
      failureCode: r.failure?.code ?? null,
      failureMessage: r.failure?.message ? String(r.failure.message).split("\n")[0].slice(0, 200) : null,
      submittedBy: r.submission?.by ?? null,
      submittedAt: r.submission?.submittedAt ?? null,
      attempts: r.attemptCount ?? 0,
      domain: r.domain?.domain ?? null,
      url: r.finalUrl ?? r.applyUrl,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  };
}
