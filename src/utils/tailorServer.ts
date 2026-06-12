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
