import type { TailorOutcomeKind } from "../types/tailorQueue";
import { getTailorServerBase } from "./tailorServer";

const RECOVER_COOLDOWN_MS = 2 * 60 * 1000;
let lastRecoverAt = 0;

export function isRecoverableTailorFailure(
  error?: string | null,
  outcome?: TailorOutcomeKind | null,
): boolean {
  if (outcome === "offline" || outcome === "timeout" || outcome === "ai") return true;
  const err = (error || "").toLowerCase();
  return (
    err.includes("fetch failed")
    || err.includes("disconnected")
    || err.includes("connection dropped")
    || err.includes("stream ended")
    || err.includes("stream aborted")
    || err.includes("relay unreachable")
    || err.includes("not running")
    || err.includes("unreachable")
    || err.includes("502")
    || err.includes("503")
    || err.includes("tailor busy")
    || err.includes("could not reach")
    || err.includes("ollama")
  );
}

export async function requestTailorRecovery(reason: string): Promise<boolean> {
  if (Date.now() - lastRecoverAt < RECOVER_COOLDOWN_MS) return false;
  lastRecoverAt = Date.now();

  try {
    const res = await fetch(`${getTailorServerBase()}/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ reason: reason.slice(0, 500) }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

export function recoverCooldownRemainingMs(): number {
  return Math.max(0, RECOVER_COOLDOWN_MS - (Date.now() - lastRecoverAt));
}
