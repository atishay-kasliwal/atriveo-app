// Initiates Google OAuth — redirects to Google with a CSRF state token
interface Env {
  atriveo_auth: D1Database;
  GOOGLE_CLIENT_ID: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const state = crypto.randomUUID();

  await env.atriveo_auth
    .prepare("INSERT INTO oauth_state (state) VALUES (?)")
    .bind(state)
    .run();

  // Clean up states older than 10 minutes
  await env.atriveo_auth
    .prepare("DELETE FROM oauth_state WHERE created_at < datetime('now', '-10 minutes')")
    .run();

  const origin = new URL(request.url).origin;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${origin}/api/auth/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline",
    prompt: "select_account",
  });

  return Response.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    302
  );
};
