import { jwtVerify } from "jose";
import { FREE_EMAIL_DOMAINS, ROLE_PREFIXES } from "./_email_data";

interface Env {
  JWT_SECRET: string;
  // Provider keys for real per-mailbox lookups. The resolver tries each that
  // is set, in order, and returns the first verified hit. With none set, the
  // endpoint falls back to pattern generation + MX verification only.
  //
  // Confirmed working on FREE keys (verified live via ?debug=1):
  QUICKENRICH_API_KEY?: string; // works — GET /api/employees/search
  HUNTER_API_KEY?: string; //      works — /v2/email-finder
  SKRAPP_API_KEY?: string; //      coded, untested (no key); ~100/mo rolls over
  // NOT usable on free keys (kept for documentation; not wired):
  //   APOLLO_API_KEY     — /people/match is paid-only (403 API_INACCESSIBLE)
  //   PROSPEO_API_KEY    — /email-finder removed (400 DEPRECATED)
  //   CONTACTOUT_API_KEY — free key returns a fake SAMPLE profile, not real data
}

// True if an email's local part is a known role address (info@, hr@, careers@…)
// rather than a named person. Exported for reuse by the contacts endpoint.
export function isRoleAddress(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase().replace(/[._-]/g, "") ?? "";
  return ROLE_PREFIXES.has(local);
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
  linkedinUrl?: string; // optional — enables exact LinkedIn lookup (QuickEnrich)
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

// QuickEnrich: GET https://app.quickenrich.io/api/employees/search
// Auth: Authorization: Bearer <key>. Either linkedin_url OR
// company_url + first_name + last_name. Response envelope:
// { success, message, code, data: { email, ... } }. Endpoint/shape confirmed
// from the official n8n node (bcharleson/n8n-nodes-quickenrich).
interface QuickenrichData {
  email?: string;
  email_verification_date?: string;
}
interface QuickenrichResponse {
  success?: boolean;
  code?: number;
  data?: QuickenrichData | null;
}

async function quickenrichByCompany(
  first: string,
  last: string,
  domain: string,
  key: string
): Promise<VerifiedHit | null> {
  try {
    const url = `https://app.quickenrich.io/api/employees/search?company_url=${encodeURIComponent(
      domain
    )}&first_name=${encodeURIComponent(first)}&last_name=${encodeURIComponent(last)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as QuickenrichResponse;
    const email = json.data?.email;
    if (json.success !== false && email) {
      return { email, score: 88, provider: "quickenrich" };
    }
    return null;
  } catch {
    return null;
  }
}

// QuickEnrich also supports exact LinkedIn-URL lookup — the original goal of
// turning a LinkedIn profile into an email. Used when a linkedinUrl is given.
async function quickenrichByLinkedin(
  linkedinUrl: string,
  key: string
): Promise<VerifiedHit | null> {
  try {
    const url = `https://app.quickenrich.io/api/employees/search?linkedin_url=${encodeURIComponent(
      linkedinUrl
    )}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as QuickenrichResponse;
    const email = json.data?.email;
    if (json.success !== false && email) {
      return { email, score: 92, provider: "quickenrich" };
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
  linkedinUrl: string,
  env: Env
): Promise<VerifiedHit | null> {
  const chain: Array<() => Promise<VerifiedHit | null>> = [];

  // If a LinkedIn URL is supplied, QuickEnrich can resolve it directly — the
  // most accurate path, so try it first.
  if (env.QUICKENRICH_API_KEY && linkedinUrl) {
    chain.push(() => quickenrichByLinkedin(linkedinUrl, env.QUICKENRICH_API_KEY!));
  }

  // Name + domain lookups (biggest free tier first). These need both names.
  // Confirmed working on free API keys via ?debug=1: QuickEnrich and Hunter.
  // Intentionally NOT in the chain (free key does not return usable data):
  //  - Apollo:     /people/match returns 403 API_INACCESSIBLE (paid only)
  //  - Prospeo:    /email-finder returns 400 DEPRECATED (endpoint removed)
  //  - ContactOut: returns a fake SAMPLE profile ("book a call to unlock"),
  //                i.e. placeholder emails — must not be trusted/saved.
  // Their lookup functions are kept below in case of a future paid upgrade.
  if (first && last) {
    if (env.QUICKENRICH_API_KEY) chain.push(() => quickenrichByCompany(first, last, domain, env.QUICKENRICH_API_KEY!));
    if (env.SKRAPP_API_KEY) chain.push(() => skrappLookup(first, last, domain, env.SKRAPP_API_KEY!));
    if (env.HUNTER_API_KEY) chain.push(() => hunterLookup(first, last, domain, env.HUNTER_API_KEY!));
  }

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
          `https://app.quickenrich.io/api/employees/search?company_url=${encodeURIComponent(
            domain
          )}&first_name=${encodeURIComponent(first)}&last_name=${encodeURIComponent(last)}`,
          { headers: { Authorization: `Bearer ${env.QUICKENRICH_API_KEY}`, Accept: "application/json" } }
        ),
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

  // Strip any api_key / token query param from a URL before returning it, so
  // the debug output never echoes a secret.
  const redactUrl = (u: string) =>
    u.replace(/([?&](api_key|token|key)=)[^&]*/gi, "$1REDACTED");

  // Hunter returns a huge `sources` array; drop it so the debug output stays
  // readable (and doesn't get truncated in a console).
  const trimBody = (b: unknown): unknown => {
    if (b && typeof b === "object") {
      const obj = b as Record<string, unknown>;
      const data = obj.data as Record<string, unknown> | undefined;
      if (data && Array.isArray(data.sources)) {
        return { ...obj, data: { ...data, sources: `[${data.sources.length} omitted]` } };
      }
    }
    return b;
  };

  const out: ProviderProbe[] = [];
  for (const { provider, req } of probes) {
    try {
      const res = await req();
      const text = await res.text();
      let body: unknown = text;
      try {
        body = trimBody(JSON.parse(text));
      } catch {
        /* keep raw text */
      }
      out.push({ provider, url: redactUrl(res.url), status: res.status, body });
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
  const linkedinUrl = (body.linkedinUrl || "").trim();
  // Need either name+company (to generate/verify patterns) or a LinkedIn URL
  // (which QuickEnrich can resolve on its own).
  if ((!name || !company) && !linkedinUrl) {
    return Response.json(
      { error: "Provide name + company, or a LinkedIn URL" },
      { status: 400 }
    );
  }

  const { first, last } = splitName(name);
  const domain = company ? toDomain(company) : "";
  if (company && !domain) {
    return Response.json({ error: "Could not derive a domain from company" }, { status: 422 });
  }

  const candidates = domain ? buildCandidates(first, last, domain) : [];
  const mxValid = domain ? await domainHasMx(domain) : false;

  // Is the "company" actually a free email provider (gmail/yahoo/…)? If so,
  // pattern guessing against it is meaningless — flag it.
  const freeProvider = !!domain && FREE_EMAIL_DOMAINS.has(domain.toLowerCase());

  const verified = await resolveVerified(first, last, domain, linkedinUrl, env);

  // ?debug=1 → also return each configured provider's raw response so we can
  // confirm/repair the parsers after adding a key.
  const debug = new URL(request.url).searchParams.get("debug") === "1";
  const probes = debug ? await probeProviders(first, last, domain, env) : undefined;

  const note = freeProvider
    ? `${domain} is a free email provider, not a company domain — pattern guessing won't work. You'll need this person's actual address.`
    : mxValid
      ? "Domain accepts mail. Candidates are ranked by how common each pattern is — they are educated guesses, not confirmed mailboxes."
      : "No MX records found for this domain. Double-check the company domain.";

  return Response.json({
    domain,
    mxValid, // domain can receive mail
    freeProvider, // company is actually gmail/yahoo/etc — guessing is futile
    verified, // null unless a provider key is configured and a hit was found
    verifiedIsRole: verified ? isRoleAddress(verified.email) : false,
    candidates, // ranked best-guess addresses
    note,
    ...(probes ? { _debug: probes } : {}),
  });
};
