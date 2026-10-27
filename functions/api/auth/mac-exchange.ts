// The Mac app trades the code from /api/auth/mac plus its secret for a session token (stored in the Mac's Keychain, not a cookie).
import { SignJWT, jwtVerify } from "jose";
import { emailAllowed, type AdminEnv } from "../../_lib/admin";

interface Env extends AdminEnv { JWT_SECRET: string }
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const b64url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { code?: unknown; verifier?: unknown };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (typeof body.code !== "string" || typeof body.verifier !== "string" || body.verifier.length < 32 || body.verifier.length > 128) return json({ error: "Invalid request" }, 400);
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  try {
    const { payload } = await jwtVerify(body.code, secret);
    if (payload.purpose !== "mac-code" || typeof payload.email !== "string" || typeof payload.challenge !== "string") throw new Error("wrong purpose");
    if (b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.verifier))) !== payload.challenge) throw new Error("verifier");
    if (!emailAllowed(env, payload.email)) return json({ error: "Not allowed" }, 403);
    const token = await new SignJWT({ email: payload.email, name: payload.name ?? "" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("60d").sign(secret);
    return json({ ok: true, name: payload.name ?? "", token });
  } catch {
    return json({ error: "That sign-in link expired. Start again from the app." }, 401);
  }
};
