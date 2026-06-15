// Mongo-backed compile queue — resume subdocument on jobs collection.

import { COMPILE_STAGES, resolveCachedCompile } from "./ac-artifact-store.mjs";
import { loadBank } from "./ac-bank.mjs";

export { COMPILE_STAGES };

export const RESUME_STATUSES = ["queued", "running", "success", "failed", "skipped"];

const DEFAULT_PLANNER = process.env.TAILOR_PLANNER?.trim() || "v2";

export async function ensureResumeIndex(db) {
  await db.collection("jobs").createIndex({ "resume.status": 1, "resume.lease_until": 1 });
  await db.collection("jobs").createIndex({ "resume.fingerprint": 1 }, { sparse: true });

  const indexes = await db.collection("jobs").indexes();
  const hasJobUrlIndex = indexes.some((idx) => idx.key?.job_url === 1);
  if (hasJobUrlIndex) return;

  try {
    await db.collection("jobs").createIndex({ job_url: 1 }, { unique: true });
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes("E11000") || msg.includes("duplicate key")) {
      await db.collection("jobs").createIndex({ job_url: 1 });
    } else if (
      msg.includes("already exists")
      || msg.includes("same name")
      || msg.includes("IndexOptionsConflict")
    ) {
      // Index present under a different definition — safe to continue.
    } else {
      throw e;
    }
  }
}

export async function fetchDescription(db, jobUrl) {
  const doc = await db.collection("descriptions").findOne(
    { job_url: jobUrl },
    { projection: { _id: 0, description: 1 } },
  );
  return doc?.description ? String(doc.description) : "";
}

async function applyManifestCacheHit(db, jobUrl, { force = false, planner = DEFAULT_PLANNER } = {}) {
  if (force) return null;
  const jd = await fetchDescription(db, jobUrl);
  if (!jd || jd.length < 200) return null;
  const bank = loadBank();
  const cached = resolveCachedCompile({
    jd,
    planner,
    bankVersion: bank.bank_version,
    force,
  });
  if (!cached.hit) return null;
  await updateResumeState(db, jobUrl, {
    status: "success",
    stage: "SUCCESS",
    fingerprint: cached.fingerprint,
    pdf_path: cached.pdfPath,
    run_dir: cached.runDir,
    error: null,
    cached: true,
  });
  return cached;
}

export async function enqueueJob(db, job, { force = false, planner = DEFAULT_PLANNER } = {}) {
  const jobUrl = job.job_url;
  if (!jobUrl) throw new Error("job_url required");

  const existing = await db.collection("jobs").findOne(
    { job_url: jobUrl },
    { projection: { resume: 1 } },
  );
  if (!force && existing?.resume?.status === "success") {
    return { jobUrl, skipped: true, reason: "already_success" };
  }
  if (!force && existing?.resume?.status === "running") {
    return { jobUrl, skipped: true, reason: "already_running" };
  }

  const cacheHit = await applyManifestCacheHit(db, jobUrl, { force, planner });
  if (cacheHit) {
    return {
      jobUrl,
      skipped: true,
      reason: "cache_hit",
      fingerprint: cacheHit.fingerprint,
      pdf_path: cacheHit.pdfPath,
    };
  }

  const now = new Date().toISOString();
  await db.collection("jobs").updateOne(
    { job_url: jobUrl },
    {
      $set: {
        resume: {
          status: "queued",
          stage: "QUEUED",
          fingerprint: existing?.resume?.fingerprint ?? null,
          lease_until: null,
          worker_id: null,
          updated_at: now,
          error: null,
          company: job.company || existing?.company || null,
          title: job.title || existing?.title || null,
        },
      },
    },
    { upsert: false },
  );
  return { jobUrl, skipped: false };
}

export async function enqueueTopJobs(db, { limit = null, minScore = 0 } = {}) {
  const findOptions = {
    projection: { _id: 0, job_url: 1, company: 1, title: 1, score_pct: 1 },
    sort: { score_pct: -1 },
  };
  if (limit != null && limit > 0) findOptions.limit = limit;

  const cursor = db.collection("jobs").find(
    {
      score_pct: { $gte: minScore },
      $or: [
        { resume: { $exists: false } },
        { "resume.status": { $in: [null, "failed", "skipped"] } },
      ],
    },
    findOptions,
  );

  const results = [];
  for await (const job of cursor) {
    results.push(await enqueueJob(db, job));
  }
  return results;
}

export async function claimNextJob(db, workerId, leaseSec = 900) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseSec * 1000);

  const result = await db.collection("jobs").findOneAndUpdate(
    {
      "resume.status": "queued",
      $or: [
        { "resume.lease_until": null },
        { "resume.lease_until": { $lt: now } },
      ],
    },
    {
      $set: {
        "resume.status": "running",
        "resume.lease_until": leaseUntil,
        "resume.worker_id": workerId,
        "resume.updated_at": now.toISOString(),
        "resume.stage": "QUEUED",
        "resume.error": null,
      },
    },
    { sort: { score_pct: -1 }, returnDocument: "after" },
  );

  return result?.value ?? result ?? null;
}

/** Extend lease while a worker is still compiling (cross-machine safe). */
export async function renewJobLease(db, jobUrl, workerId, leaseSec = 900) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseSec * 1000);
  const result = await db.collection("jobs").updateOne(
    {
      job_url: jobUrl,
      "resume.status": "running",
      "resume.worker_id": workerId,
    },
    {
      $set: {
        "resume.lease_until": leaseUntil,
        "resume.updated_at": now.toISOString(),
      },
    },
  );
  return result.modifiedCount > 0;
}

export async function updateResumeState(db, jobUrl, patch) {
  const set = {};
  for (const [key, value] of Object.entries(patch)) {
    set[`resume.${key}`] = value;
  }
  set["resume.updated_at"] = new Date().toISOString();
  await db.collection("jobs").updateOne({ job_url: jobUrl }, { $set: set });
}

export async function listCompileJobs(db, { status, limit = 50 } = {}) {
  const filter = status ? { "resume.status": status } : { resume: { $exists: true } };
  return db.collection("jobs").find(filter, {
    projection: {
      _id: 0,
      job_url: 1,
      company: 1,
      title: 1,
      score_pct: 1,
      batch_time: 1,
      resume: 1,
    },
    sort: { "resume.updated_at": -1, score_pct: -1 },
    limit,
  }).toArray();
}

export async function cancelCompileJob(db, jobUrl) {
  const result = await db.collection("jobs").updateOne(
    { job_url: jobUrl, "resume.status": "queued" },
    { $unset: { resume: "" } },
  );
  return result.modifiedCount > 0;
}

export async function enqueueJobs(db, jobs, { force = false } = {}) {
  const results = [];
  for (const job of jobs) {
    results.push(await enqueueJob(db, job, { force }));
  }
  return results;
}

export function stageToProgress(stage) {
  switch (stage) {
    case "QUEUED": return 8;
    case "GATED": return 18;
    case "COMPOSED": return 38;
    case "OPTIMIZED": return 52;
    case "TEX": return 72;
    case "PDF": return 88;
    case "SUCCESS": return 100;
    default: return 12;
  }
}

export async function findJobByFingerprint(db, fingerprint) {
  return db.collection("jobs").findOne(
    { "resume.fingerprint": fingerprint },
    {
      projection: {
        _id: 0,
        job_url: 1,
        company: 1,
        title: 1,
        score_pct: 1,
        resume: 1,
      },
    },
  );
}

const COMPILE_JOB_PROJECTION = {
  _id: 0,
  job_url: 1,
  company: 1,
  title: 1,
  score_pct: 1,
  batch_time: 1,
  resume: 1,
};

/** Normalize a jobs doc for compile-queue API / SSE payloads. */
export function serializeCompileJob(doc) {
  if (!doc?.job_url) return null;
  return {
    job_url: doc.job_url,
    company: doc.company,
    title: doc.title,
    score_pct: doc.score_pct ?? null,
    batch_time: doc.batch_time ?? null,
    resume: doc.resume ?? null,
  };
}

/** True when a change stream event touched the resume subdocument. */
export function resumeFieldTouched(change) {
  const op = change?.operationType;
  if (op === "insert" || op === "replace") {
    return Boolean(change.fullDocument?.resume);
  }
  if (op === "update") {
    const updated = change.updateDescription?.updatedFields || {};
    const removed = change.updateDescription?.removedFields || [];
    if (removed.includes("resume")) return true;
    return Object.keys(updated).some((k) => k === "resume" || k.startsWith("resume."));
  }
  return false;
}

export async function loadCompileJobById(db, id) {
  const doc = await db.collection("jobs").findOne({ _id: id }, { projection: COMPILE_JOB_PROJECTION });
  return serializeCompileJob(doc);
}
