/** Local sidecar in dev; same-origin /tailor relay on production (Pages Function → tunnel). */
export function getTailorServerBase(): string {
  if (typeof window === "undefined") return "http://localhost:8787";
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return "http://localhost:8787";
  }
  return `${window.location.origin}/tailor`;
}

export function isLocalTailorHost(): boolean {
  if (typeof window === "undefined") return true;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

/** User-facing message when the sidecar / Cloudflare relay is unreachable. */
export function tailorUnavailableMessage(): string {
  if (!isLocalTailorHost()) {
    return "Tailor relay unreachable. On your Mac run: npm run tailor:prod (or launchctl kickstart -k gui/$(id -u)/com.atriveo.tailor).";
  }
  return "Tailor server not running. In a second terminal: npm run tailor";
}

export function tailorSidecarErrorMessage(status: number, serverError?: string): string {
  if (typeof serverError === "string" && serverError.trim()) return serverError;
  if (status === 401) return "Not signed in — refresh and log in again.";
  if (status === 503) {
    return "Tailor relay not configured on Cloudflare. Set TAILOR_ORIGIN, or run locally with npm run dev + npm run tailor.";
  }
  if (status === 502 || status === 530 || status === 521 || status === 523) {
    return tailorUnavailableMessage();
  }
  return `HTTP ${status}`;
}
