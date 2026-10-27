// Sign in the Atriveo Mac app with Google. The app opens this URL in your browser with a challenge (the SHA-256 of a secret it keeps).
// Signed in already: this page hands a two-minute code back to the app (atriveo://signin?code=...). Not signed in: it goes through the usual
// Google sign-in first and comes back here (the challenge rides in a short-lived cookie). The app then trades code + secret for a session
// at /api/auth/mac-exchange, so a code taken from the address alone is useless.
import { SignJWT, jwtVerify } from "jose";
import { emailAllowed, type AdminEnv } from "../../_lib/admin";

interface Env extends AdminEnv { JWT_SECRET: string }
export const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

const page = (target: string) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect your Mac</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1013;color:#eceef2;font:16px/1.5 system-ui,sans-serif}main{max-width:380px;padding:32px;text-align:center}h1{font-size:22px;margin:0 0 8px}p{color:#9aa1ad;margin:0 0 22px}a{display:inline-block;background:#2455e8;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600}</style>
<main><h1>Connecting your Mac…</h1><p>If Atriveo does not open on its own, press the button. You can close this tab afterwards.</p><a href="${target}">Open Atriveo</a></main>
<script>setTimeout(function(){location.href=${JSON.stringify(target)}},300)</script>`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const challenge = new URL(request.url).searchParams.get("challenge") || "";
  if (!CHALLENGE.test(challenge)) return new Response("Bad request", { status: 400 });
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  const cookie = request.headers.get("cookie") || "";
  const session = cookie.match(/(?:^|;\s*)atriveo_token=([^;]+)/)?.[1];
  let user: { email: string; name: string } | null = null;
  if (session) {
    try {
      const { payload } = await jwtVerify(session, secret);
      if (typeof payload.email === "string" && emailAllowed(env, payload.email)) user = { email: payload.email, name: String(payload.name ?? "") };
    } catch { /* not signed in */ }
  }
  if (!user) {
    return new Response(null, { status: 302, headers: { Location: "/api/auth/google", "Set-Cookie": `mac_challenge=${challenge}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=600` } });
  }
  const code = await new SignJWT({ email: user.email, name: user.name, purpose: "mac-code", challenge })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2m").sign(secret);
  return new Response(page(`atriveo://signin?code=${code}`), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
};
