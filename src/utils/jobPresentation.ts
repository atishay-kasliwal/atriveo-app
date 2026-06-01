import type { Job } from "../types";

type MatchTier = {
  key: "green" | "blue" | "yellow" | "gray";
  icon: string;
  label: string;
};

const COMPANY_DOMAINS: Record<string, string> = {
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
  stripe: "stripe.com",
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

  return null;
}

export function companyLogoUrl(company?: string | null): string | null {
  const domain = companyDomain(company);
  return domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64` : null;
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
  for (const [label, pattern] of KEYWORD_PATTERNS) {
    if (pattern.test(haystack) && !matches.includes(label)) matches.push(label);
    if (matches.length >= limit) return matches;
  }

  const compactTerm = job.search_term?.replace(/ engineer$/i, "").trim();
  if (compactTerm && !matches.includes(compactTerm)) matches.push(compactTerm);
  if (job.level && !matches.includes(job.level)) matches.push(job.level);
  return matches.slice(0, limit);
}

export function rankBadge(index?: number): string | null {
  if (index === 1) return "🥇";
  if (index === 2) return "🥈";
  if (index === 3) return "🥉";
  return index && index <= 5 ? `#${index}` : null;
}
