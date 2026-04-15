import { jwtVerify } from "jose";

interface Env {
  JWT_SECRET: string;
}

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout"];

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const url = new URL(request.url);
  const path = url.pathname;

  // Allow public paths and static assets
  if (
    PUBLIC_PATHS.some((p) => path.startsWith(p)) ||
    path.match(/\.(js|css|ico|svg|png|woff2?)$/)
  ) {
    return next();
  }

  const cookie = request.headers.get("Cookie") || "";
  const token = cookie.match(/atriveo_token=([^;]+)/)?.[1];

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
    return next();
  } catch {
    if (path.startsWith("/api/")) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.redirect(new URL("/login", request.url).toString(), 302);
  }
};
