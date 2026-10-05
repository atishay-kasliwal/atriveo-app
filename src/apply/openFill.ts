// Open & Fill talks to the Atriveo Fill extension in this browser (playatriveo/src/extension). The
// extension marks the page when it is installed and arms one posting when asked; it fills that posting's
// application in your own Chrome and never clicks Submit. Messages stay in this tab (same origin only).

export const EXTENSION_ATTRIBUTE = "data-atriveo-fill";

/** The installed Atriveo Fill version, or null when this browser doesn't have it. */
export function extensionVersion(): string | null {
  return typeof document === "undefined" ? null : document.documentElement.getAttribute(EXTENSION_ATTRIBUTE);
}

/** Atriveo Fill 0.5+: Open & Fill for any application (it opens the page and fills it by itself). */
export function canApplyAnywhere(): boolean {
  return typeof document !== "undefined" && document.documentElement.hasAttribute("data-atriveo-fill-apply");
}

/** Open this application in a new tab and have Atriveo Fill read and fill it. Never submits. */
export function applyWithExtension(url: string, applicationId: string, timeoutMs = 5_000): Promise<{ ok: boolean; error?: string }> {
  return armExtension(url, applicationId, timeoutMs, false, "apply");
}

/** Ask the extension to fill this posting when it opens (15 minutes). */
export function armExtension(url: string, applicationId: string, timeoutMs = 3_000, openTab = false, type: "arm" | "apply" = "arm"): Promise<{ ok: boolean; error?: string }> {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    const done = (r: { ok: boolean; error?: string }) => { clearTimeout(timer); window.removeEventListener("message", onReply); resolve(r); };
    const timer = setTimeout(() => done({ ok: false, error: "Atriveo Fill didn't answer; reload this page and try again" }), timeoutMs);
    const onReply = (e: MessageEvent) => {
      const d = e.data as { source?: string; type?: string; nonce?: string; reply?: { ok?: boolean; error?: string } } | null;
      if (e.source !== window || e.origin !== window.location.origin || d?.source !== "atriveo-fill" || d.type !== "armed" || d.nonce !== nonce) return;
      done(d.reply?.ok ? { ok: true } : { ok: false, error: d.reply?.error ?? "Atriveo Fill refused" });
    };
    window.addEventListener("message", onReply);
    window.postMessage({ source: "atriveo-dashboard", type, url, applicationId, nonce, openTab }, window.location.origin);
  });
}
