import type { TailorProcessLogEntry } from "../types/tailorQueue";

const TAB_ID_KEY = "atriveo_tab_id";
const LOGS_KEY = (uid: string) => `atriveo_tailor_process_logs_v1_${uid}`;
const LOCK_KEY = (uid: string) => `atriveo_tailor_process_lock_v1_${uid}`;

/** No heartbeat for this long → another tab may take over (covers refresh / crash). */
export const TAILOR_LOCK_STALE_MS = 45_000;

export interface TailorProcessLock {
  tabId: string;
  jobKey: string;
  heartbeatAt: string;
}

export function getTailorTabId(): string {
  try {
    let id = sessionStorage.getItem(TAB_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(TAB_ID_KEY, id);
    }
    return id;
  } catch {
    return "unknown-tab";
  }
}

export function loadProcessLogs(uid: string): TailorProcessLogEntry[] {
  try {
    const raw = localStorage.getItem(LOGS_KEY(uid)) ?? localStorage.getItem(LOGS_KEY("anon"));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TailorProcessLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistProcessLogs(uid: string, logs: TailorProcessLogEntry[]): void {
  try {
    localStorage.setItem(LOGS_KEY(uid), JSON.stringify(logs.slice(0, 80)));
  } catch {
    /* ignore */
  }
}

export function readProcessLock(uid: string): TailorProcessLock | null {
  try {
    const raw = localStorage.getItem(LOCK_KEY(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TailorProcessLock;
    if (!parsed?.tabId || !parsed.jobKey || !parsed.heartbeatAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeProcessLock(uid: string, lock: TailorProcessLock): void {
  try {
    localStorage.setItem(LOCK_KEY(uid), JSON.stringify(lock));
  } catch {
    /* ignore */
  }
}

export function clearProcessLock(uid: string): void {
  try {
    localStorage.removeItem(LOCK_KEY(uid));
  } catch {
    /* ignore */
  }
}

export function isProcessLockFresh(lock: TailorProcessLock, now = Date.now()): boolean {
  const heartbeat = Date.parse(lock.heartbeatAt);
  if (Number.isNaN(heartbeat)) return false;
  return now - heartbeat < TAILOR_LOCK_STALE_MS;
}

export function tryAcquireProcessLock(uid: string, tabId: string, jobKey: string): boolean {
  const existing = readProcessLock(uid);
  if (existing && existing.tabId !== tabId && isProcessLockFresh(existing)) {
    return false;
  }
  writeProcessLock(uid, {
    tabId,
    jobKey,
    heartbeatAt: new Date().toISOString(),
  });
  return true;
}

export function touchProcessLock(uid: string, tabId: string, jobKey: string): void {
  writeProcessLock(uid, {
    tabId,
    jobKey,
    heartbeatAt: new Date().toISOString(),
  });
}

/** Clear lock on refresh/crash recovery, or when another tab's lock went stale. */
export function recoverProcessLock(uid: string, tabId: string): void {
  const lock = readProcessLock(uid);
  if (!lock) return;
  if (lock.tabId === tabId || !isProcessLockFresh(lock)) {
    clearProcessLock(uid);
  }
}

export function isAnotherTabProcessing(uid: string, tabId: string): boolean {
  const lock = readProcessLock(uid);
  if (!lock) return false;
  if (lock.tabId === tabId) return false;
  return isProcessLockFresh(lock);
}

export function releaseProcessLockIfOwned(uid: string, tabId: string): void {
  const lock = readProcessLock(uid);
  if (lock?.tabId === tabId) clearProcessLock(uid);
}

export function installProcessLockRelease(uid: string, tabId: string): () => void {
  const release = () => releaseProcessLockIfOwned(uid, tabId);
  window.addEventListener("pagehide", release);
  return () => window.removeEventListener("pagehide", release);
}
