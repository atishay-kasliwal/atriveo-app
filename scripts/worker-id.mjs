import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ID_PATH = path.join(os.homedir(), ".atriveo", "worker-id");

/** Stable worker identity — survives restarts; unique per machine unless WORKER_ID is set. */
export function getWorkerId() {
  const fromEnv = process.env.WORKER_ID?.trim();
  if (fromEnv) return fromEnv;

  if (fs.existsSync(ID_PATH)) {
    const id = fs.readFileSync(ID_PATH, "utf8").trim();
    if (id) return id;
  }

  const slug = os.hostname().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "worker";
  const id = `${slug}-${crypto.randomUUID().slice(0, 8)}`;
  fs.mkdirSync(path.dirname(ID_PATH), { recursive: true });
  fs.writeFileSync(ID_PATH, `${id}\n`);
  return id;
}

/**
 * The resume compiler that builds what this process queues, and whose builds its queue views show.
 * On one machine it is this machine (getWorkerId). On Oracle the dashboard and the compiler are separate
 * containers: the compiler (atriveo-resume-worker) runs with WORKER_ID=oracle-atriveo and claims only jobs
 * owned by it, while the dashboard has no worker id of its own, so RESUME_WORKER_ID names the compiler there.
 * Without it, every job the dashboard queued got a random owner no compiler would ever claim.
 */
export function compileOwner() {
  return process.env.RESUME_WORKER_ID?.trim() || getWorkerId();
}
