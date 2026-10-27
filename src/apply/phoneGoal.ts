import { fetchJson } from "./engine";
import { getTailorServerBase } from "../utils/tailorServer";

const KEY = "atriveo-goal-pushed";

/** Copies your daily goal (kept on the website) to the server that sends the phone messages, only when it has changed. */
export async function syncGoalToPhoneMessages(): Promise<void> {
  try {
    const prefs = await fetchJson<{ goal?: number }>("/api/progress/preferences", { credentials: "include" });
    const goal = prefs.json?.goal;
    if (!prefs.res.ok || !Number.isInteger(goal)) return;
    let pushed: string | null = null;
    try { pushed = localStorage.getItem(KEY); } catch { /* private window: push every time */ }
    if (pushed === String(goal)) return;
    const sent = await fetchJson<{ ok?: boolean }>(`${getTailorServerBase()}/applications/daily-goal`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal }) });
    if (sent.res.ok && sent.json?.ok) { try { localStorage.setItem(KEY, String(goal)); } catch { /* ignore */ } }
  } catch { /* phone messages fall back to the default goal until this works */ }
}
