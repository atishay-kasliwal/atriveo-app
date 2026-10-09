// Password storage: PBKDF2-SHA256 with a random 16-byte salt per user, 100,000 iterations (the most Cloudflare
// Workers' Web Crypto allows). Stored as "pbkdf2$<iterations>$<salt b64>$<hash b64>". Accounts created before
// 2026-10-09 hold an unsalted SHA-256 hex digest; they still verify, and login rewrites them in this format.

const ITERATIONS = 100_000;
const enc = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

/** Constant-time comparison, so a wrong guess takes as long as a nearly right one. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, ITERATIONS))}`;
}

/** True for a pre-2026-10-09 unsalted SHA-256 hash, which login replaces. */
export function isLegacyHash(stored: string | null | undefined): boolean {
  return /^[0-9a-f]{64}$/.test(String(stored || ""));
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const value = String(stored || "");
  if (isLegacyHash(value)) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(password)));
    const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
    return sameBytes(enc.encode(hex), enc.encode(value));
  }
  const [scheme, iterations, salt, hash] = value.split("$");
  if (scheme !== "pbkdf2" || !iterations || !salt || !hash) return false;
  return sameBytes(await pbkdf2(password, unb64(salt), Number(iterations)), unb64(hash));
}
