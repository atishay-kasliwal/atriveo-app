// Open & Fill talks to the Atriveo Fill extension in this browser (playatriveo/src/extension). The
// extension marks the page when it is installed and arms one posting when asked; it fills that posting's
// application in your own Chrome and never clicks Submit. Messages stay in this tab (same origin only).

export const EXTENSION_ATTRIBUTE = "data-atriveo-fill";

/** The installed Atriveo Fill version, or null when this browser doesn't have it. */
export function extensionVersion(): string | null {
  return typeof document === "undefined" ? null : document.documentElement.getAttribute(EXTENSION_ATTRIBUTE);
}

/**
 * You're opening this LinkedIn posting from Today: Atriveo Fill 0.8.1+ remembers it for an hour, so the
 * application you start on the company's form (Apply on this page) is linked to it. Fire and forget.
 */
export function noteLinkedinOpen(url: string, company: string, title: string): void {
  if (typeof window === "undefined" || !document.documentElement.hasAttribute("data-atriveo-fill-apply")) return;
  window.postMessage({ source: "atriveo-dashboard", type: "linkedin-open", url, applicationId: url, company, title, nonce: `li-${Date.now()}` }, window.location.origin);
}

/** Atriveo Fill 0.5+: Open & Fill for any application (it opens the page and fills it by itself). */
export function canApplyAnywhere(): boolean {
  return typeof document !== "undefined" && document.documentElement.hasAttribute("data-atriveo-fill-apply");
}

/** Atriveo Fill 0.7.1+: `apply` can wait for the fill to finish (the Open & Fill queue needs that). */
export function canQueueApply(): boolean {
  return Number(typeof document === "undefined" ? 0 : document.documentElement.getAttribute("data-atriveo-fill-apply") ?? 0) >= 2;
}

/** How the extension's fill of one tab went (`wait`). */
export interface AutoResult { state: "running" | "filled" | "stopped"; message: string }

/** Open this application in a new tab and have Atriveo Fill read and fill it. Never submits. With `wait`, answers once the fill is done. */
export function applyWithExtension(url: string, applicationId: string, timeoutMs = 5_000, wait = false): Promise<{ ok: boolean; error?: string; auto?: AutoResult | null }> {
  return armExtension(url, applicationId, timeoutMs, false, "apply", wait);
}

/** Ask the extension to fill this posting when it opens (15 minutes). */
export function armExtension(url: string, applicationId: string, timeoutMs = 3_000, openTab = false, type: "arm" | "apply" = "arm", wait = false): Promise<{ ok: boolean; error?: string; auto?: AutoResult | null }> {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    const done = (r: { ok: boolean; error?: string; auto?: AutoResult | null }) => { clearTimeout(timer); window.removeEventListener("message", onReply); resolve(r); };
    const timer = setTimeout(() => done({ ok: false, error: "Atriveo Fill didn't answer; reload this page and try again" }), timeoutMs);
    const onReply = (e: MessageEvent) => {
      const d = e.data as { source?: string; type?: string; nonce?: string; reply?: { ok?: boolean; error?: string; auto?: AutoResult | null } } | null;
      if (e.source !== window || e.origin !== window.location.origin || d?.source !== "atriveo-fill" || d.type !== "armed" || d.nonce !== nonce) return;
      done(d.reply?.ok ? { ok: true, auto: d.reply.auto } : { ok: false, error: d.reply?.error ?? "Atriveo Fill refused" });
    };
    window.addEventListener("message", onReply);
    window.postMessage({ source: "atriveo-dashboard", type, url, applicationId, nonce, openTab, wait }, window.location.origin);
  });
}
