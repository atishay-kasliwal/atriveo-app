import { jwtVerify } from "jose";
import { emailAllowed, isAdminSite, NOT_ALLOWED_MESSAGE, type AdminEnv } from "./_lib/admin";

interface Env extends AdminEnv {
  JWT_SECRET: string;
}

const PUBLIC_API_PATHS = ["/api/auth/login", "/api/auth/logout", "/api/auth/google", "/api/auth/callback", "/api/auth/signup",
  // Token-checked by the route itself (inbox watcher on the Mac), not a login cookie.
  "/api/tracker/inbox"];
const ASSET_RE = /\.(js|css|ico|svg|png|jpe?g|gif|webp|avif|woff2?|map)$/i;

function isJsonRoute(path: string): boolean {
  return path.startsWith("/api/") || path.startsWith("/tailor");
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const url = new URL(request.url);
  const path = url.pathname;

  if (isLocalHostname(url.hostname)) {
    return next();
  }

  // Allow assets, auth endpoints, landing page, and login through untouched.
  if (ASSET_RE.test(path)) {
    return next();
  }
  if (PUBLIC_API_PATHS.some((p) => path.startsWith(p))) {
    return next();
  }
  if (path === "/login" || path === "/onboarding" || path.startsWith("/landing")) {
    return next();
  }

  const cookie = request.headers.get("Cookie") || "";
  const token = cookie.match(/atriveo_token=([^;]+)/)?.[1];
  const indexUrl = new URL("/index.html", request.url);

  // The admin site has no landing page: signed-out visitors go straight to its login.
  const signedOutPage = isAdminSite(env) ? "/login" : "/landing/index.html";
  if (!token) {
    if (isJsonRoute(path)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.redirect(new URL(signedOutPage, request.url).toString(), 302);
  }

  try {
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    if (!emailAllowed(env, payload.email)) {
      const clear = "atriveo_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0";
      if (isJsonRoute(path)) {
        return new Response(JSON.stringify({ error: NOT_ALLOWED_MESSAGE }), { status: 403, headers: { "Content-Type": "application/json", "Set-Cookie": clear } });
      }
      return new Response(null, { status: 302, headers: { Location: new URL("/login?error=not_allowed", request.url).toString(), "Set-Cookie": clear } });
    }
  } catch {
    if (isJsonRoute(path)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.redirect(new URL("/login", request.url).toString(), 302);
  }

  if (isJsonRoute(path)) {
    return next();
  }

  return env.ASSETS.fetch(indexUrl);
};
