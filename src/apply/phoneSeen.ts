// How many replies you had when you last looked (Home's "new since you last looked"); kept in this browser only.
const SEEN_REPLIES = "phone.seenReplies";

export function readSeenReplies(): number | null {
  try { const v = localStorage.getItem(SEEN_REPLIES); return v != null && Number.isFinite(Number(v)) ? Number(v) : null; } catch { return null; }
}

export function markRepliesSeen(n: number): void {
  try { localStorage.setItem(SEEN_REPLIES, String(n)); } catch { /* private window */ }
}
