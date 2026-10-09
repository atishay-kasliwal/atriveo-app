import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";

const { hashPassword, verifyPassword, isLegacyHash } = await import("../../functions/_lib/password.ts");
const { loginBlocked, recordFailure, clearFailures, MAX_PER_EMAIL } = await import("../../functions/_lib/loginLimit.ts");

test("passwords: salted PBKDF2, each hash unique; old SHA-256 hashes still verify and are flagged for upgrade", async () => {
  const a = await hashPassword("correct horse");
  const b = await hashPassword("correct horse");
  assert.match(a, /^pbkdf2\$100000\$/);
  assert.notEqual(a, b, "a random salt per hash");
  assert.ok(await verifyPassword("correct horse", a));
  assert.ok(!(await verifyPassword("wrong horse", a)));
  const legacy = createHash("sha256").update("old pass").digest("hex");
  assert.ok(isLegacyHash(legacy) && !isLegacyHash(a));
  assert.ok(await verifyPassword("old pass", legacy));
  assert.ok(!(await verifyPassword("nope", legacy)));
  assert.ok(!(await verifyPassword("x", null)), "a Google-only account has no password");
});

// D1's prepare/bind/first/run over node:sqlite, with the real migration.
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(new URL("../../migrations/0007_login_attempts.sql", import.meta.url), "utf8"));
  const stmt = (sql, args = []) => ({ first: async () => db.prepare(sql).get(...args) ?? null, run: async () => db.prepare(sql).run(...args) });
  return { prepare: (sql) => ({ ...stmt(sql), bind: (...args) => stmt(sql, args) }) };
}

test("login limit: the 5th failure for an email blocks it; another email is unaffected; success clears it", async () => {
  const db = d1();
  for (let i = 0; i < MAX_PER_EMAIL - 1; i++) await recordFailure(db, "a@x.com", "1.1.1.1");
  assert.equal(await loginBlocked(db, "a@x.com", "1.1.1.1"), false);
  await recordFailure(db, "a@x.com", "1.1.1.1");
  assert.equal(await loginBlocked(db, "a@x.com", "2.2.2.2"), true);
  assert.equal(await loginBlocked(db, "b@x.com", "2.2.2.2"), false);
  await clearFailures(db, "a@x.com");
  assert.equal(await loginBlocked(db, "a@x.com", "1.1.1.1"), false);
});
