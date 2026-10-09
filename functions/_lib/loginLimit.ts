// Login rate limit: 5 failed attempts for one email, or 20 from one IP, within 15 minutes block further tries
// until the window passes. Failures live in D1 (login_attempts, migrations/0007_login_attempts.sql); a success
// clears that email's failures.

export const WINDOW_MINUTES = 15;
export const MAX_PER_EMAIL = 5;
export const MAX_PER_IP = 20;

export async function loginBlocked(db: D1Database, email: string, ip: string): Promise<boolean> {
  const since = `-${WINDOW_MINUTES} minutes`;
  const row = await db
    .prepare("SELECT SUM(email = ?) AS by_email, SUM(ip = ?) AS by_ip FROM login_attempts WHERE created_at > datetime('now', ?)")
    .bind(email, ip, since)
    .first<{ by_email: number | null; by_ip: number | null }>();
  return (row?.by_email ?? 0) >= MAX_PER_EMAIL || (row?.by_ip ?? 0) >= MAX_PER_IP;
}

export async function recordFailure(db: D1Database, email: string, ip: string): Promise<void> {
  await db.prepare("INSERT INTO login_attempts (email, ip, created_at) VALUES (?, ?, datetime('now'))").bind(email, ip).run();
  // Keep the table small: anything older than a day no longer matters.
  await db.prepare("DELETE FROM login_attempts WHERE created_at < datetime('now', '-1 day')").run();
}

export async function clearFailures(db: D1Database, email: string): Promise<void> {
  await db.prepare("DELETE FROM login_attempts WHERE email = ?").bind(email).run();
}
