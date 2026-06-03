import { jwtVerify } from "jose";

interface Env {
  JWT_SECRET: string;
  // Optional provider keys for real per-mailbox lookups. Set whichever you
  // have in wrangler env — the resolver tries them in order (biggest free
  // tier first) and returns the first verified hit. Combined free quota of
  // all four is ~550+ lookups/month. With none set, the endpoint falls back
  // to pattern generation + MX/domain verification only.
  QUICKENRICH_API_KEY?: string; // ~300 free/mo
  APOLLO_API_KEY?: string; //      ~100 free/mo, largest DB
  HUNTER_API_KEY?: string; //      ~50 free/mo
  SKRAPP_API_KEY?: string; //      ~100 free/mo, credits roll over
}

interface VerifiedHit {
  email: string;
  score: number; // 0–100 confidence
  provider: string;
}

async function getEmail(request: Request, secret: string): Promise<string | null> {
  const cookie = request.headers.get("Cookie") || "";
  const token = cookie.match(/atriveo_token=([^;]+)/)?.[1];
  if (!token) return null;
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key);
    return (payload.email as string) || null;
  } catch {
    return null;
  }
}

interface FindBody {
  name?: string;
  company?: string; // company name OR a domain
}

interface Candidate {
  email: string;
  pattern: string;
  // Rough real-world frequency of this pattern across corporate inboxes.
  confidence: number;
}

// Strip accents and non-letters so "José O'Brien" → "joseobrien" parts.
function clean(part: string): string {
  return part
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).map(clean).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts[parts.length - 1] };
}

// Turn a company name or URL into a bare domain guess.
function toDomain(company: string): string {
  let c = company.trim().toLowerCase();
  c = c.replace(/^https?:\/\//, "").replace(/^www\./, "");
  c = c.split("/")[0].split("?")[0];
  if (c.includes(".")) return c; // already looks like a domain
  // Bare company name → strip suffixes/punctuation and guess .com
  const slug = c
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|technologies|labs|group)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
  return slug ? `${slug}.com` : "";
}

// Generate candidate emails ranked by how common each pattern is in practice.
function buildCandidates(first: string, last: string, domain: string): Candidate[] {
  if (!domain) return [];
  const f = first;
  const l = last;
  const fi = first.charAt(0);
  const li = last.charAt(0);

  const out: Candidate[] = [];
  const push = (local: string, pattern: string, confidence: number) => {
    if (local) out.push({ email: `${local}@${domain}`, pattern, confidence });
  };

  if (f && l) {
    push(`${f}.${l}`, "first.last", 0.34);
    push(`${fi}${l}`, "flast", 0.13);
    push(`${f}${l}`, "firstlast", 0.09);
    push(`${f}`, "first", 0.07);
    push(`${f}_${l}`, "first_last", 0.05);
    push(`${f}.${li}`, "first.l", 0.04);
    push(`${fi}.${l}`, "f.last", 0.04);
    push(`${l}.${f}`, "last.first", 0.03);
    push(`${l}${fi}`, "lastf", 0.02);
    push(`${l}`, "last", 0.02);
  } else if (f) {
    push(`${f}`, "first", 0.5);
  }
  return out;
}

// Free domain reality check: does the domain have MX records (can it receive
// mail)? Uses Cloudflare/Google DNS-over-HTTPS. This confirms the *domain*,
// not a specific mailbox.
async function domainHasMx(domain: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      { headers: { accept: "application/dns-json" } }
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { Answer?: Array<{ type: number }> };
    // MX record type = 15
    return Array.isArray(data.Answer) && data.Answer.some((a) => a.type === 15);
  } catch {
    return false;
  }
}

// ── Provider lookups ────────────────────────────────────────────────────
// Each returns a VerifiedHit or null. All are wrapped so a single provider
// failing (rate limit, network, schema change) never breaks the chain.

async function hunterLookup(
  first: string,
  last: string,
  domain: string,
  key: string
): Promise<VerifiedHit | null> {
  try {
    const url = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(
      domain
    )}&first_name=${encodeURIComponent(first)}&last_name=${encodeURIComponent(
      last
    )}&api_key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { email?: string; score?: number } };
    if (data.data?.email) {
      return { email: data.data.email, score: data.data.score ?? 0, provider: "hunter" };
    }
    return null;
  } catch {
    return null;
  }
}

async function apolloLookup(
  first: string,
  last: string,
  domain: string,
  key: string
): Promise<VerifiedHit | null> {
  try {
    const res = await fetch("https://api.apollo.io/v1/people/match", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": key },
      body: JSON.stringify({
        first_name: first,
        last_name: last,
        domain,
        reveal_personal_emails: false,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { person?: { email?: string } };
    if (data.person?.email) {
      return { email: data.person.email, score: 90, provider: "apollo" };
    }
    return null;
  } catch {
    return null;
  }
}

async function quickenrichLookup(
  first: string,
  last: string,
  domain: string,
  key: string
): Promise<VerifiedHit | null> {
  try {
    const url = `https://api.quickenrich.io/v1/email-finder?domain=${encodeURIComponent(
      domain
    )}&first_name=${encodeURIComponent(first)}&last_name=${encodeURIComponent(last)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string; score?: number };
    if (data.email) {
      return { email: data.email, score: data.score ?? 85, provider: "quickenrich" };
    }
    return null;
  } catch {
    return null;
  }
}

async function skrappLookup(
  first: string,
  last: string,
  domain: string,
  key: string
): Promise<VerifiedHit | null> {
  try {
    const url = `https://api.skrapp.io/v2/find?firstName=${encodeURIComponent(
      first
    )}&lastName=${encodeURIComponent(last)}&domain=${encodeURIComponent(domain)}`;
    const res = await fetch(url, { headers: { "X-Access-Key": key } });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string; quality?: { score?: number } };
    if (data.email) {
      return { email: data.email, score: data.quality?.score ?? 80, provider: "skrapp" };
    }
    return null;
  } catch {
    return null;
  }
}

// Try every configured provider in order (biggest free tier first) and return
// the first verified hit. Skips any provider whose key isn't set.
async function resolveVerified(
  first: string,
  last: string,
  domain: string,
  env: Env
): Promise<VerifiedHit | null> {
  if (!first || !last) return null;
  const chain: Array<() => Promise<VerifiedHit | null>> = [];
  if (env.QUICKENRICH_API_KEY) chain.push(() => quickenrichLookup(first, last, domain, env.QUICKENRICH_API_KEY!));
  if (env.APOLLO_API_KEY) chain.push(() => apolloLookup(first, last, domain, env.APOLLO_API_KEY!));
  if (env.HUNTER_API_KEY) chain.push(() => hunterLookup(first, last, domain, env.HUNTER_API_KEY!));
  if (env.SKRAPP_API_KEY) chain.push(() => skrappLookup(first, last, domain, env.SKRAPP_API_KEY!));

  for (const lookup of chain) {
    const hit = await lookup();
    if (hit) return hit;
  }
  return null;
}

// Debug helper: hit every configured provider directly and capture the raw
// HTTP status + body, so we can confirm each one's response shape after adding
// a key. Returned only when the request carries ?debug=1.
interface ProviderProbe {
  provider: string;
  url: string;
  status: number | "error";
  body: unknown;
}

async function probeProviders(
  first: string,
  last: string,
  domain: string,
  env: Env
): Promise<ProviderProbe[]> {
  const probes: Array<{ provider: string; req: () => Promise<Response> }> = [];
  if (env.QUICKENRICH_API_KEY) {
    probes.push({
      provider: "quickenrich",
      req: () =>
        fetch(
          `https://api.quickenrich.io/v1/email-finder?domain=${encodeURIComponent(
            domain
          )}&first_name=${encodeURIComponent(first)}&last_name=${encodeURIComponent(last)}`,
          { headers: { Authorization: `Bearer ${env.QUICKENRICH_API_KEY}` } }
        ),
    });
  }
  if (env.APOLLO_API_KEY) {
    probes.push({
      provider: "apollo",
      req: () =>
        fetch("https://api.apollo.io/v1/people/match", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Api-Key": env.APOLLO_API_KEY! },
          body: JSON.stringify({ first_name: first, last_name: last, domain }),
        }),
    });
  }
  if (env.HUNTER_API_KEY) {
    probes.push({
      provider: "hunter",
      req: () =>
        fetch(
          `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(
            domain
          )}&first_name=${encodeURIComponent(first)}&last_name=${encodeURIComponent(
            last
          )}&api_key=${encodeURIComponent(env.HUNTER_API_KEY!)}`
        ),
    });
  }
  if (env.SKRAPP_API_KEY) {
    probes.push({
      provider: "skrapp",
      req: () =>
        fetch(
          `https://api.skrapp.io/v2/find?firstName=${encodeURIComponent(
            first
          )}&lastName=${encodeURIComponent(last)}&domain=${encodeURIComponent(domain)}`,
          { headers: { "X-Access-Key": env.SKRAPP_API_KEY! } }
        ),
    });
  }

  const out: ProviderProbe[] = [];
  for (const { provider, req } of probes) {
    try {
      const res = await req();
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* keep raw text */
      }
      out.push({ provider, url: res.url, status: res.status, body });
    } catch (err) {
      out.push({ provider, url: "", status: "error", body: String(err) });
    }
  }
  return out;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const email = await getEmail(request, env.JWT_SECRET);
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as FindBody;
  const name = (body.name || "").trim();
  const company = (body.company || "").trim();
  if (!name || !company) {
    return Response.json({ error: "name and company are required" }, { status: 400 });
  }

  const { first, last } = splitName(name);
  const domain = toDomain(company);
  if (!domain) {
    return Response.json({ error: "Could not derive a domain from company" }, { status: 422 });
  }

  const candidates = buildCandidates(first, last, domain);
  const mxValid = await domainHasMx(domain);

  const verified = await resolveVerified(first, last, domain, env);

  // ?debug=1 → also return each configured provider's raw response so we can
  // confirm/repair the parsers after adding a key.
  const debug = new URL(request.url).searchParams.get("debug") === "1";
  const probes = debug ? await probeProviders(first, last, domain, env) : undefined;

  return Response.json({
    domain,
    mxValid, // domain can receive mail
    verified, // null unless a provider key is configured and a hit was found
    candidates, // ranked best-guess addresses
    note: mxValid
      ? "Domain accepts mail. Candidates are ranked by how common each pattern is — they are educated guesses, not confirmed mailboxes."
      : "No MX records found for this domain. Double-check the company domain.",
    ...(probes ? { _debug: probes } : {}),
  });
};
