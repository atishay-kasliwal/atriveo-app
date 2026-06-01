import { jwtVerify } from "jose";

interface Env {
  JWT_SECRET: string;
}

const PUBLIC_API_PATHS = ["/api/auth/login", "/api/auth/logout"];
const ASSET_RE = /\.(js|css|ico|svg|png|jpe?g|gif|webp|avif|woff2?|map)$/i;

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const url = new URL(request.url);
  const path = url.pathname;

  // Allow assets and auth endpoints through untouched.
  if (ASSET_RE.test(path)) {
    return next();
  }
  if (PUBLIC_API_PATHS.some((p) => path.startsWith(p))) {
    return next();
  }

  const cookie = request.headers.get("Cookie") || "";
  const token = cookie.match(/atriveo_token=([^;]+)/)?.[1];
  const indexUrl = new URL("/index.html", request.url);

  if (path === "/login") {
    if (!token) {
      return env.ASSETS.fetch(indexUrl);
    }
    try {
      const secret = new TextEncoder().encode(env.JWT_SECRET);
      await jwtVerify(token, secret);
      return Response.redirect(new URL("/", request.url).toString(), 302);
    } catch {
      return env.ASSETS.fetch(indexUrl);
    }
  }

  if (!token) {
    // API routes return 401, page routes redirect to login
    if (path.startsWith("/api/")) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.redirect(new URL("/login", request.url).toString(), 302);
  }

  try {
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    await jwtVerify(token, secret);
  } catch {
    if (path.startsWith("/api/")) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.redirect(new URL("/login", request.url).toString(), 302);
  }

  if (path.startsWith("/api/")) {
    return next();
  }

  return env.ASSETS.fetch(indexUrl);
};
