import { isAdminSite, type AdminEnv } from "../_lib/admin";

interface Env extends AdminEnv {
  ASSETS: { fetch(input: Request | URL | string): Promise<Response> };
}

// The public landing pages on apply.atriveo.com (built by scripts/build-landing.mjs into
// dist-apply/landing/). The middleware lets every /landing path through without a login;
// this keeps the console's SPA out of them: known pages and files are served as built,
// anything else under /landing gets the landing 404 instead of the console shell.
// application.atriveo.com has its own static public/landing/, so it is passed straight through.
const PAGES = new Set(["/landing/", "/landing/workflow/"]);

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  if (!isAdminSite(env)) return next();
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/landing" || path === "/landing/workflow") {
    return Response.redirect(new URL(`${path}/${url.search}`, url).toString(), 301);
  }

  const response = await next();
  const isHtml = response.headers.get("content-type")?.includes("text/html") ?? false;
  // Pages' own clean-URL redirects (e.g. /landing/index.html -> /landing/) pass through.
  if (response.status >= 300 && response.status < 400) return response;
  if (PAGES.has(path) && response.ok && isHtml) return response;
  if (response.ok && !isHtml) return response;

  const missing = await env.ASSETS.fetch(new URL("/landing/404", url));
  const body = missing.ok ? missing.body : "Not found";
  return new Response(body, {
    status: 404,
    headers: { "Content-Type": "text/html;charset=utf-8", "X-Robots-Tag": "noindex" },
  });
};
