// Mongo worker fleet registry — heartbeats for cross-machine compile workers.

const STALE_MS = Number(process.env.WORKER_STALE_MS || 90_000);

export async function ensureWorkerIndex(db) {
  await db.collection("compile_workers").createIndex({ worker_id: 1 }, { unique: true });
  await db.collection("compile_workers").createIndex({ last_seen_at: 1 });
}

function nowIso() {
  return new Date().toISOString();
}

export async function upsertWorker(db, workerId, profile = {}) {
  const now = nowIso();
  const doc = {
    worker_id: workerId,
    hostname: profile.hostname || null,
    planner: profile.planner || null,
    out_root: profile.out_root || null,
    artifacts_root: profile.artifacts_root || null,
    drive_mounted: profile.drive_mounted ?? null,
    status: profile.status || "idle",
    current_job_url: profile.current_job_url || null,
    last_seen_at: now,
    updated_at: now,
  };

  await db.collection("compile_workers").updateOne(
    { worker_id: workerId },
    {
      $set: doc,
      $setOnInsert: { started_at: now },
    },
    { upsert: true },
  );
  return doc;
}

export async function heartbeatWorker(db, workerId, profile = {}) {
  return upsertWorker(db, workerId, profile);
}

export async function setWorkerBusy(db, workerId, jobUrl, profile = {}) {
  return upsertWorker(db, workerId, { ...profile, status: "busy", current_job_url: jobUrl });
}

export async function setWorkerIdle(db, workerId, profile = {}) {
  return upsertWorker(db, workerId, { ...profile, status: "idle", current_job_url: null });
}

export async function markWorkerOffline(db, workerId) {
  await db.collection("compile_workers").updateOne(
    { worker_id: workerId },
    { $set: { status: "offline", current_job_url: null, updated_at: nowIso() } },
  );
}

export async function listActiveWorkers(db, { staleMs = STALE_MS } = {}) {
  const cutoff = new Date(Date.now() - staleMs).toISOString();
  return db.collection("compile_workers").find(
    { last_seen_at: { $gte: cutoff }, status: { $ne: "offline" } },
    {
      projection: {
        _id: 0,
        worker_id: 1,
        hostname: 1,
        planner: 1,
        out_root: 1,
        drive_mounted: 1,
        status: 1,
        current_job_url: 1,
        last_seen_at: 1,
        started_at: 1,
      },
      sort: { status: -1, last_seen_at: -1 },
    },
  ).toArray();
}
