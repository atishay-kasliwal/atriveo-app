import type { Job } from "../types";
import syncedCompanyDomains from "../../public/company_domains.json";

type MatchTier = {
  key: "green" | "blue" | "yellow" | "gray";
  icon: string;
  label: string;
};

export type CareerOpsRating = MatchTier & {
  score: number;
  grade: "A" | "B" | "C" | "D";
  rawPct: number;
  atsPct: number | null;
  fitPct: number | null;
  tooltip: string;
};

const MAX_RAW_SCORE = 250;

const COMPANY_DOMAINS: Record<string, string> = {
  ...(syncedCompanyDomains as Record<string, string>),
  adobe: "adobe.com",
  airbnb: "airbnb.com",
  amazon: "amazon.com",
  "amazon web services": "aws.amazon.com",
  americanexpress: "americanexpress.com",
  amex: "americanexpress.com",
  anthropic: "anthropic.com",
  apple: "apple.com",
  axiompath: "axiompath.com",
  bytedance: "bytedance.com",
  capitalone: "capitalone.com",
  cloudflare: "cloudflare.com",
  conga: "conga.com",
  databricks: "databricks.com",
  datadog: "datadoghq.com",
  doordash: "doordash.com",
  focuscamera: "focuscamera.com",
  google: "google.com",
  ibm: "ibm.com",
  largeton: "largeton.com",
  linkedin: "linkedin.com",
  lockheedmartin: "lockheedmartin.com",
  lyft: "lyft.com",
  meta: "meta.com",
  microsoft: "microsoft.com",
  netflix: "netflix.com",
  nscale: "nscale.com",
  nvidia: "nvidia.com",
  openai: "openai.com",
  oracle: "oracle.com",
  palantir: "palantir.com",
  ramona: "ramonaoptics.com",
  recruitingfromscratch: "recruitingfromscratch.com",
  salesforce: "salesforce.com",
  snowflake: "snowflake.com",
  blackrock: "blackrock.com",
  brex: "brex.com",
  jpmorganchase: "jpmorganchase.com",
  jpmorgan: "jpmorgan.com",
  nuveen: "nuveen.com",
  paramount: "paramount.com",
  ramp: "ramp.com",
  renaissance: "renaissance.com",
  uber: "uber.com",
  varonis: "varonis.com",
  tata: "tcs.com",
  "tata consultancy": "tcs.com",
  tempus: "tempus.com",
  tesla: "tesla.com",
};

const KEYWORD_PATTERNS: Array<[string, RegExp]> = [
  ["Python", /\bpython\b/i],
  ["React", /\breact(?:\.js)?\b/i],
  ["TypeScript", /\btypescript\b|\bts\b/i],
  ["JavaScript", /\bjavascript\b|\bjs\b/i],
  ["Node", /\bnode(?:\.js)?\b/i],
  ["FastAPI", /\bfastapi\b/i],
  ["AWS", /\baws\b|\bamazon web services\b/i],
  ["Azure", /\bazure\b/i],
  ["GCP", /\bgcp\b|\bgoogle cloud\b/i],
  ["SQL", /\bsql\b|\bpostgres\b|\bmysql\b/i],
  ["Spark", /\bspark\b|\bpyspark\b/i],
  ["Kafka", /\bkafka\b/i],
  ["Airflow", /\bairflow\b/i],
  ["Docker", /\bdocker\b/i],
  ["Kubernetes", /\bkubernetes\b|\bk8s\b/i],
  ["AI", /\bai\b|\bartificial intelligence\b/i],
  ["ML", /\bml\b|\bmachine learning\b/i],
  ["LLM", /\bllm\b|\blarge language model/i],
  ["Data Science", /\bdata sci|\bdata scientist\b/i],
  ["Backend", /\bbackend\b|\bback end\b/i],
  ["Full Stack", /\bfull stack\b|\bfull-stack\b/i],
  ["Distributed Systems", /\bdistributed systems?\b/i],
  ["API", /\bapi\b|\brest\b|\bgraphql\b/i],
  ["Java", /\bjava\b/i],
  ["Go", /\bgolang\b|\bgo\b/i],
  ["C++", /\bc\+\+\b/i],
];

function normalizeCompany(company?: string | null): string {
  return (company || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|group|services|germany|usa|us)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function companyDomain(company?: string | null): string | null {
  const normalized = normalizeCompany(company);
  if (!normalized) return null;
  if (COMPANY_DOMAINS[normalized]) return COMPANY_DOMAINS[normalized];

  for (const [key, domain] of Object.entries(COMPANY_DOMAINS)) {
    const compactKey = key.replace(/[^a-z0-9]+/g, "");
    if (normalized.includes(compactKey) || compactKey.includes(normalized)) return domain;
  }

  const slug = normalized.replace(/\s+/g, "");
  if (slug.length >= 3) return `${slug}.com`;
  return null;
}

/** Try Clearbit first, then Google favicons — CompanyLogo cycles on error. */
export function companyLogoUrls(company?: string | null): string[] {
  const domain = companyDomain(company);
  if (!domain) return [];
  return [
    `https://logo.clearbit.com/${domain}`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`,
  ];
}

export function companyLogoUrl(company?: string | null): string | null {
  return companyLogoUrls(company)[0] ?? null;
}

export function companyColor(company?: string | null): string {
  const palette = ["#4f4f47", "#69725a", "#77766a", "#9a7653", "#8d534c", "#5f5e54"];
  const source = company || "Atriveo";
  const code = [...source].reduce((total, char) => total + char.charCodeAt(0), 0);
  return palette[code % palette.length];
}

export function scoreTier(score = 0): MatchTier {
  if (score >= 150) return { key: "green", icon: "🔥", label: "Elite" };
  if (score >= 120) return { key: "blue", icon: "⚡", label: "Strong" };
  if (score >= 90) return { key: "yellow", icon: "⭐", label: "Good" };
  return { key: "gray", icon: "•", label: "Watch" };
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeFitScore(value: number | null | undefined): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return clampPct(numeric <= 10 ? numeric * 10 : numeric);
}

export function careerOpsRating(job: Job): CareerOpsRating {
  const rawPct = clampPct(((Number(job.score) || 0) / MAX_RAW_SCORE) * 100);
  const atsPct = Number.isFinite(Number(job.ats_score ?? job.score_pct))
    ? clampPct(Number(job.ats_score ?? job.score_pct))
    : null;
  const fitPct = normalizeFitScore(job.fit_score);
  const weightedParts = [
    { value: rawPct, weight: 0.7 },
    ...(atsPct == null ? [] : [{ value: atsPct, weight: 0.2 }]),
    ...(fitPct == null ? [] : [{ value: fitPct, weight: 0.1 }]),
  ];
  const totalWeight = weightedParts.reduce((sum, part) => sum + part.weight, 0) || 1;
  const score = clampPct(weightedParts.reduce((sum, part) => sum + part.value * part.weight, 0) / totalWeight);
  const tier: Pick<CareerOpsRating, "key" | "icon" | "label" | "grade"> =
    score >= 75 ? { key: "green", icon: "🔥", label: "Strong match", grade: "A" }
      : score >= 50 ? { key: "blue", icon: "⚡", label: "Good match", grade: "B" }
        : score >= 25 ? { key: "yellow", icon: "⭐", label: "Review first", grade: "C" }
          : { key: "gray", icon: "•", label: "Low priority", grade: "D" };
  const details = [
    `CareerOps ${score}/100`,
    `Raw ${job.score ?? 0}/${MAX_RAW_SCORE}`,
    atsPct == null ? null : `ATS ${atsPct}%`,
    fitPct == null ? null : `Fit ${fitPct}%`,
  ].filter(Boolean).join(" · ");

  return { ...tier, score, rawPct, atsPct, fitPct, tooltip: details };
}

export function careerOpsStars(score = 0): string {
  const stars = score >= 75 ? 4 : score >= 50 ? 3 : score >= 25 ? 2 : 1;
  return "★★★★★".slice(0, stars) + "☆☆☆☆☆".slice(0, 5 - stars);
}

export function confidenceStars(score = 0): string {
  const stars = score >= 150 ? 5 : score >= 120 ? 4 : score >= 90 ? 3 : score >= 70 ? 2 : 1;
  return "★★★★★".slice(0, stars) + "☆☆☆☆☆".slice(0, 5 - stars);
}

export function responseRateLabel(score = 0): string {
  if (score >= 150) return "Very high";
  if (score >= 120) return "High";
  if (score >= 90) return "Medium";
  return "Needs review";
}

export function matchReasons(job: Job, limit = 4): string[] {
  const haystack = [job.title, job.summary, job.search_term, job.level].filter(Boolean).join(" ");
  const matches: string[] = [];
  const seen = new Set<string>();
  const addReason = (reason?: string | null) => {
    const cleaned = reason?.trim();
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    matches.push(cleaned);
  };

  for (const [label, pattern] of KEYWORD_PATTERNS) {
    if (pattern.test(haystack)) addReason(label);
    if (matches.length >= limit) return matches;
  }

  const compactTerm = job.search_term?.replace(/ engineer$/i, "").trim();
  addReason(compactTerm);
  addReason(job.level);
  return matches.slice(0, limit);
}

export function rankBadge(index?: number): string | null {
  if (index === 1) return "🥇";
  if (index === 2) return "🥈";
  if (index === 3) return "🥉";
  return index && index <= 5 ? `#${index}` : null;
}

export function jobBoardLabel(site?: string | null, jobUrl?: string | null): string {
  const source = `${site || ""} ${jobUrl || ""}`.toLowerCase();
  if (source.includes("linkedin")) return "LinkedIn";
  if (source.includes("indeed")) return "Indeed";
  if (source.includes("greenhouse")) return "Greenhouse";
  if (source.includes("lever.co")) return "Lever";
  if (source.includes("workday")) return "Workday";
  if (source.includes("ashby")) return "Ashby";
  if (site?.trim()) return site.trim().replace(/^\w/, (char) => char.toUpperCase());
  return "Job Board";
}
