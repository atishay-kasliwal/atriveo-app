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
  PROSPEO_API_KEY?: string; //     ~75 free/mo, verified-only
  HUNTER_API_KEY?: string; //      ~50 free/mo
  SKRAPP_API_KEY?: string; //      ~100 free/mo, credits roll over
  CONTACTOUT_API_KEY?: string; //  small free tier, strong personal-email coverage
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

// Prospeo: POST https://api.prospeo.io/email-finder, header X-KEY.
// Body { first_name, last_name, company }. Response includes email,
// verification_status (valid/invalid/catch-all), catch_all. Verified-only.
// NOTE: this endpoint is marked deprecated in favor of /enrich-person, but
// still functional. Shape from prospeo.io/api-docs — confirm via ?debug=1.
async function prospeoLookup(
  first: string,
  last: string,
  domain: string,
  key: string
): Promise<VerifiedHit | null> {
  try {
    const res = await fetch("https://api.prospeo.io/email-finder", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-KEY": key },
      body: JSON.stringify({ first_name: first, last_name: last, company: domain }),
    });
    if (!res.ok) return null;
    // Prospeo wraps results; email may be at response.email or response.email
    // inside a `response` object depending on version. Handle both.
    const json = (await res.json()) as {
      error?: boolean;
      email?: string;
      verification_status?: string;
      response?: { email?: string; verification_status?: string };
    };
    const email = json.email ?? json.response?.email;
    const status = json.verification_status ?? json.response?.verification_status;
    if (email && status !== "invalid") {
      return { email, score: status === "valid" ? 95 : 80, provider: "prospeo" };
    }
    return null;
  } catch {
    return null;
  }
}

// ContactOut: POST https://api.contactout.com/v1/people/enrich, header `token`.
// Body { first_name, last_name, company_domain, include:["work_email"] }.
// Work emails at profile.work_email (array); status at profile.work_email_status.
// Shape from api.contactout.com — confirm via ?debug=1.
async function contactoutLookup(
  first: string,
  last: string,
  domain: string,
  key: string
): Promise<VerifiedHit | null> {
  try {
    const res = await fetch("https://api.contactout.com/v1/people/enrich", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        token: key,
      },
      body: JSON.stringify({
        first_name: first,
        last_name: last,
        company_domain: domain,
        include: ["work_email"],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      profile?: {
        work_email?: string[];
        work_email_status?: Record<string, string>;
      };
    };
    const emails = json.profile?.work_email;
    const email = Array.isArray(emails) ? emails[0] : undefined;
    if (email) {
      const status = json.profile?.work_email_status?.[email];
      return { email, score: status === "Verified" ? 95 : 75, provider: "contactout" };
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
  if (first && last) {
    if (env.QUICKENRICH_API_KEY) chain.push(() => quickenrichByCompany(first, last, domain, env.QUICKENRICH_API_KEY!));
    if (env.APOLLO_API_KEY) chain.push(() => apolloLookup(first, last, domain, env.APOLLO_API_KEY!));
    if (env.SKRAPP_API_KEY) chain.push(() => skrappLookup(first, last, domain, env.SKRAPP_API_KEY!));
    if (env.PROSPEO_API_KEY) chain.push(() => prospeoLookup(first, last, domain, env.PROSPEO_API_KEY!));
    if (env.HUNTER_API_KEY) chain.push(() => hunterLookup(first, last, domain, env.HUNTER_API_KEY!));
    if (env.CONTACTOUT_API_KEY) chain.push(() => contactoutLookup(first, last, domain, env.CONTACTOUT_API_KEY!));
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
  if (env.PROSPEO_API_KEY) {
    probes.push({
      provider: "prospeo",
      req: () =>
        fetch("https://api.prospeo.io/email-finder", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-KEY": env.PROSPEO_API_KEY! },
          body: JSON.stringify({ first_name: first, last_name: last, company: domain }),
        }),
    });
  }
  if (env.CONTACTOUT_API_KEY) {
    probes.push({
      provider: "contactout",
      req: () =>
        fetch("https://api.contactout.com/v1/people/enrich", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            token: env.CONTACTOUT_API_KEY!,
          },
          body: JSON.stringify({
            first_name: first,
            last_name: last,
            company_domain: domain,
            include: ["work_email"],
          }),
        }),
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

  const verified = await resolveVerified(first, last, domain, linkedinUrl, env);

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
