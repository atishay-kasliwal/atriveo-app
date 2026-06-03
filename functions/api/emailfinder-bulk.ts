import {
  getEmail,
  resolveVerified,
  toDomain,
  splitName,
  domainHasMx,
  detectPattern,
  localForPattern,
  type Env,
} from "./emailfinder";

interface BulkBody {
  names?: string[]; // list of full names at the same company
  company?: string; // one company name or domain for all
}

interface BulkRow {
  name: string;
  email: string;
  basis: "verified-pattern" | "guessed-pattern" | "error";
}

// Bulk finder for the common case: many people at ONE company. Strategy —
// verify the company's email pattern ONCE (using the first usable name), then
// apply that exact pattern to every name. Falls back to the statistically
// most common pattern (first.last) if no provider confirms one. This keeps
// credit usage at ~1 lookup for an entire list.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const owner = await getEmail(request, env.JWT_SECRET);
  if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as BulkBody;
  const company = (body.company || "").trim();
  const names = (body.names || [])
    .map((n) => (n || "").trim())
    .filter(Boolean);

  if (!company || names.length === 0) {
    return Response.json(
      { error: "Provide a company and at least one name" },
      { status: 400 }
    );
  }
  if (names.length > 100) {
    return Response.json({ error: "Max 100 names per request" }, { status: 400 });
  }

  const domain = toDomain(company);
  if (!domain) {
    return Response.json({ error: "Could not derive a domain from company" }, { status: 422 });
  }

  const mxValid = await domainHasMx(domain);

  // Try to lock the company's pattern from the FIRST name that splits cleanly.
  let pattern = "first.last"; // statistical default
  let patternBasis: "verified" | "default" = "default";
  let verifiedSample: { name: string; email: string; provider: string } | null = null;

  for (const name of names) {
    const { first, last } = splitName(name);
    if (!first || !last) continue;
    const hit = await resolveVerified(first, last, domain, "", env);
    if (hit) {
      const detected = detectPattern(hit.email, first, last);
      if (detected) {
        pattern = detected;
        patternBasis = "verified";
        verifiedSample = { name, email: hit.email, provider: hit.provider };
      }
      break; // one verified hit is enough to lock the pattern
    }
  }

  // Apply the (verified or default) pattern to every name.
  const rows: BulkRow[] = names.map((name) => {
    const { first, last } = splitName(name);
    if (!first) {
      return { name, email: "", basis: "error" as const };
    }
    const local = localForPattern(pattern, first, last);
    return {
      name,
      email: `${local}@${domain}`,
      basis: patternBasis === "verified" ? ("verified-pattern" as const) : ("guessed-pattern" as const),
    };
  });

  return Response.json({
    domain,
    mxValid,
    pattern, // e.g. "first.last"
    patternBasis, // "verified" (confirmed via a provider) or "default" (guess)
    verifiedSample, // the one lookup that locked the pattern, if any
    rows,
    note:
      patternBasis === "verified"
        ? `Confirmed ${domain} uses the "${pattern}" pattern from ${verifiedSample?.email}. Applied to all ${rows.length} names.`
        : `Could not verify a pattern for ${domain} (no provider hit). Using the most common "${pattern}" format — treat these as educated guesses.`,
  });
};
