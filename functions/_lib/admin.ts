// Admin-only mode for apply.atriveo.com (the application-engine console).
// The same Pages Functions run on application.atriveo.com and apply.atriveo.com; this
// switches on only where the project sets SITE = "apply" (see scripts/deploy-apply.sh).
// There, only emails in ADMIN_EMAILS can sign up, sign in or call any API. It fails
// closed: an apply site with an empty ADMIN_EMAILS lets nobody in.

export interface AdminEnv {
  SITE?: string;
  ADMIN_EMAILS?: string;
}

export function isAdminSite(env: AdminEnv): boolean {
  return env.SITE === "apply";
}

export function adminEmails(env: AdminEnv): string[] {
  return (env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** True when this email may use the site. Always true outside the admin site. */
export function emailAllowed(env: AdminEnv, email: unknown): boolean {
  if (!isAdminSite(env)) return true;
  return typeof email === "string" && adminEmails(env).includes(email.trim().toLowerCase());
}

export const NOT_ALLOWED_MESSAGE = "This site is for admins only. Your email is not on the allowlist.";
