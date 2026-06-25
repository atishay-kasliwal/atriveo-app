import { SignJWT } from "jose";

interface Env {
  atriveo_auth: D1Database;
  JWT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  error?: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  name: string;
  picture: string;
  email_verified: boolean;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return Response.redirect(new URL("/login?error=google_denied", url.origin).toString(), 302);
  }

  if (!code || !state) {
    return Response.redirect(new URL("/login?error=invalid_callback", url.origin).toString(), 302);
  }

  // Validate CSRF state
  const savedState = await env.atriveo_auth
    .prepare("SELECT state FROM oauth_state WHERE state = ?")
    .bind(state)
    .first<{ state: string }>();

  if (!savedState) {
    return Response.redirect(new URL("/login?error=invalid_state", url.origin).toString(), 302);
  }

  // Delete used state
  await env.atriveo_auth
    .prepare("DELETE FROM oauth_state WHERE state = ?")
    .bind(state)
    .run();

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/api/auth/callback`,
      grant_type: "authorization_code",
    }),
  });

  const tokens = (await tokenRes.json()) as GoogleTokenResponse;
  if (tokens.error || !tokens.access_token) {
    return Response.redirect(new URL("/login?error=token_exchange", url.origin).toString(), 302);
  }

  // Fetch user profile
  const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = (await profileRes.json()) as GoogleUserInfo;

  if (!profile.email_verified) {
    return Response.redirect(new URL("/login?error=unverified_email", url.origin).toString(), 302);
  }

  // Upsert user — link google_id to existing account if email matches
  await env.atriveo_auth
    .prepare(`
      INSERT INTO users (email, name, google_id, avatar_url, password_hash, created_at)
      VALUES (?, ?, ?, ?, '', datetime('now'))
      ON CONFLICT(email) DO UPDATE SET
        google_id   = excluded.google_id,
        avatar_url  = excluded.avatar_url,
        name        = CASE WHEN users.name = '' THEN excluded.name ELSE users.name END
    `)
    .bind(profile.email.toLowerCase(), profile.name, profile.sub, profile.picture)
    .run();

  // Check if user has any connectors — determines where to send them
  const connectorCount = await env.atriveo_auth
    .prepare("SELECT COUNT(*) as cnt FROM connectors WHERE user_email = ?")
    .bind(profile.email.toLowerCase())
    .first<{ cnt: number }>();

  const hasConnectors = (connectorCount?.cnt ?? 0) > 0;

  // Issue JWT
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  const token = await new SignJWT({
    email: profile.email.toLowerCase(),
    name: profile.name,
    avatar: profile.picture,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);

  const destination = hasConnectors ? "/" : "/onboarding";

  return new Response(null, {
    status: 302,
    headers: {
      Location: destination,
      "Set-Cookie": `atriveo_token=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`,
    },
  });
};
