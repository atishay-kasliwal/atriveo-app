interface Env { TAILOR_ORIGIN?: string; TAILOR_TOKEN?: string }

// Your lucky hours as a calendar Google Calendar can subscribe to (docs/lucky.md). No sign-in: Google fetches it from its own servers,
// so the long random token in the link is the key. A new link from the Lucky page makes the old one stop working.
export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const token = String(params.token ?? "").replace(/\.ics$/, "");
  if (!/^[a-f0-9]{48}$/.test(token)) return new Response("Not found", { status: 404 });
  if (!env.TAILOR_ORIGIN || !env.TAILOR_TOKEN) return new Response("Calendar is not configured", { status: 503 });
  try {
    const res = await fetch(new URL(`/lucky/ics/${token}`, env.TAILOR_ORIGIN.trim()), { headers: { "X-Tailor-Token": env.TAILOR_TOKEN }, redirect: "manual", signal: AbortSignal.timeout(20000) });
    if (res.status !== 200) return new Response("Not found", { status: 404 });
    return new Response(await res.text(), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response("Calendar is briefly unavailable", { status: 502 }); }
};
