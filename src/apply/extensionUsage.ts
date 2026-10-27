import { checkCompanion, companionIsConnected, sendToExtension } from "./companionLink";
import { EXTENSION_FEATURES, sendUsage } from "./usage";

const allowed = new Set(EXTENSION_FEATURES.map(([k]) => k));

/** Only known names with sensible whole numbers become usage items; anything else the extension sends is dropped. */
export function itemsFromExtension(counts: unknown): { kind: "action"; key: string; seconds: number; count: number }[] {
  if (!counts || typeof counts !== "object") return [];
  const out: { kind: "action"; key: string; seconds: number; count: number }[] = [];
  let total = 0;
  for (const [k, n] of Object.entries(counts as Record<string, unknown>)) {
    if (!allowed.has(k) || typeof n !== "number" || !Number.isInteger(n) || n < 1) continue;
    const count = Math.min(n, 500);
    out.push({ kind: "action", key: `extension.${k}`, seconds: 0, count }); total += count;
  }
  return total ? [...out, { kind: "action", key: "extension.interactions", seconds: 0, count: Math.min(total, 500) }] : [];
}

/** While the console is open: take what the extension has counted (it clears its own tally) and report it to Usage. Older extensions simply do not answer. */
export function startExtensionUsage(): () => void {
  let busy = false;
  const collect = async () => {
    if (busy || document.visibilityState !== "visible") return;
    busy = true;
    try {
      if (!companionIsConnected() && !(await checkCompanion({ attempts: 1, timeoutMs: 1500 }))) return;
      const reply = await sendToExtension("USAGE", 4000);
      const items = itemsFromExtension(reply?.counts);
      if (items.length) sendUsage(items);
    } catch { /* an older or sleeping extension: try again next time */ } finally { busy = false; }
  };
  const first = window.setTimeout(() => void collect(), 8000), timer = window.setInterval(() => void collect(), 60_000);
  return () => { window.clearTimeout(first); window.clearInterval(timer); };
}
