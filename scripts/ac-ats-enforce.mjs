#!/usr/bin/env node
/**
 * Bank-wide ATS pass: ensure signature_technologies appear in variant text.
 * Prefer contextual embedding — do NOT run to stack more keywords on bullets that already pass lint.
 * Composed-resume balance: npm run ac:ats-matrix
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { fileURLToPath } from "node:url";
import { loadBank } from "./ac-bank.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BANK = path.join(ROOT, "data/ac-bank");

const TECH_TOKENS = new Set([
  "Python", "Java", "JavaScript", "TypeScript", "React", "Angular", "Node.js", "Express.js",
  "FastAPI", "Spring Boot", "Kafka", "Elasticsearch", "Docker", "Kubernetes", "AWS", "Azure",
  "GCP", "PostgreSQL", "MongoDB", "MySQL", "Redis", "C++", "Raft", "NuRaft", "CMake",
  "LangChain", "Cloudflare", "JobSpy", "scikit-learn", "pandas", "SciPy", "XGBoost",
  "SimpleITK", "PyRadiomics", "Apache Airflow", "JWT", "EJS", "Swagger", "Helmet",
  "X25519", "AES-GCM", "MCP", "Tableau", "lifelines", "SHAP", "LIME", "UMAP", "Resilience4j",
  "GraphQL", "Firebase", "SQS", "SNS", "AWS Lambda", "Docker", "Kubernetes", "Jenkins",
  "Elasticsearch", "Gradle", "Avro", "Prometheus", "Grafana", "Zipkin", "NuRaft",
]);

const STRONG_VERBS = /^(architected|built|designed|developed|engineered|implemented|integrated|deployed|automated|standardized|reduced|accelerated|eliminated|unified|enabled|scaled|extracted|synthesized|created|launched|shipped|optimized|conducted)/i;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWord(text, tech) {
  return techPattern(tech).test(text);
}

function techPattern(tech) {
  if (tech === "C++") return /C\+\+/;
  if (tech === "C#") return /C#/;
  return new RegExp(`\\b${escapeRe(tech)}\\b`, "i");
}

function inferSignatureFromAts(ac) {
  const fromAts = (ac.ats_keywords || [])
    .map((k) => (typeof k === "string" ? k : Object.keys(k)[0]))
    .filter((k) => TECH_TOKENS.has(k));
  if (fromAts.length >= 2) return fromAts.slice(0, 2);
  if (fromAts.length === 1) return fromAts;
  return [];
}

function injectMissingTech(text, techs) {
  let out = text.replace(/\s+/g, " ").trim();
  const missing = techs.filter((t) => !hasWord(out, t));
  if (!missing.length) return out;

  if (missing.length === 2) {
    const m = out.match(/^(\w+)\s+/);
    if (m && STRONG_VERBS.test(m[1]) && !missing.includes("C++")) {
      return `${m[1]} ${missing[0]} and ${missing[1]} ${out.slice(m[0].length)}`;
    }
  }

  for (const tech of missing) {
    if (tech === "C++") {
      if (/C\+\+/.test(out)) continue;
      const m = out.match(/^(\w+)\s+/);
      if (m && STRONG_VERBS.test(m[1])) {
        out = `${m[1]} C++ ${out.slice(m[0].length)}`;
        continue;
      }
    }
    if (/\bin production\b/i.test(out) && !hasWord(out, tech)) {
      out = out.replace(/\bin production\b/i, `with ${tech} in production`);
      continue;
    }
    const hook = out.match(
      /\b(capturing|serving|processing|across|powering|enabling|supporting|handling|moving|mirroring|blocking|auditing|tracking|cutting|reducing|improving|sustaining|connecting|guiding|parsing|documenting|converting|pairing|scraping|indexing|decomposing|validating|correlating|clustering|preprocessing|automating|orchestrating|securing|replacing|letting|spanning|including|onboarding|processing)\b/i,
    );
    if (hook) {
      out = out.replace(hook, `in ${tech} ${hook[0]}`);
      continue;
    }
    const m = out.match(/^(\w+)\s+/);
    if (m && STRONG_VERBS.test(m[1])) {
      out = `${m[1]} ${tech} ${out.slice(m[0].length)}`;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

function mergeAtsKeywords(ac, techs) {
  const existing = new Set(
    (ac.ats_keywords || []).map((k) => (typeof k === "string" ? k : Object.keys(k)[0])),
  );
  for (const t of techs) existing.add(t);
  return [...existing];
}

function lintQuick(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const andCount = (text.match(/\band\b/gi) || []).length;
  const commaCount = (text.match(/,/g) || []).length;
  const first = text.trim().split(/\s+/)[0] || "";
  const issues = [];
  if (words > 35) issues.push("too long");
  if (words < 12) issues.push("too short");
  if (andCount > 2) issues.push("too many and");
  if (commaCount > 2) issues.push("too many commas");
  if (!STRONG_VERBS.test(first)) issues.push("weak verb");
  return issues;
}

function processAc(ac, dryRun) {
  const file = path.join(BANK, `${ac.id}.yaml`);
  let changed = false;
  const copy = structuredClone(ac);

  if (!copy.signature_technologies?.length) {
    const inferred = inferSignatureFromAts(copy);
    if (inferred.length) {
      copy.signature_technologies = inferred;
      changed = true;
    }
  }

  const techs = copy.signature_technologies || [];
  if (!copy.variants?.[0]?.text) return { changed: false, issues: ["no variant text"] };

  const before = copy.variants[0].text.replace(/\s+/g, " ").trim();
  let after = injectMissingTech(before, techs);

  // If injection broke lint, try verb-prefix for single missing tech only
  if (lintQuick(after).length && techs.length === 1 && !hasWord(before, techs[0])) {
    const m = before.match(/^(\w+)\s+/);
    if (m) after = `${m[1]} ${techs[0]} ${before.slice(m[0].length)}`.replace(/\s+/g, " ").trim();
  }

  const issues = lintQuick(after);
  if (after !== before) {
    copy.variants[0].text = after;
    changed = true;
  }

  const mergedAts = mergeAtsKeywords(copy, techs);
  if (JSON.stringify(mergedAts) !== JSON.stringify(copy.ats_keywords || [])) {
    copy.ats_keywords = mergedAts;
    changed = true;
  }

  if (changed && !dryRun) {
    fs.writeFileSync(file, yaml.dump(copy, { lineWidth: 120, noRefs: true }));
  }

  const sigMissing = techs.filter((t) => !hasWord(after, t));
  return { changed, issues, sigMissing, before, after };
}

const dryRun = process.argv.includes("--dry-run");
const bank = loadBank();
const visible = bank.acs.filter((a) => a.visibility?.default !== false && a.variants?.[0]?.text);

let updated = 0;
const problems = [];

for (const ac of visible) {
  const result = processAc(ac, dryRun);
  if (result.changed) updated += 1;
  if (result.issues?.length || result.sigMissing?.length) {
    problems.push({ id: ac.id, role: ac.role, ...result });
  }
}

console.log(`${dryRun ? "[dry-run] " : ""}Updated ${updated} / ${visible.length} visible AC files.`);

if (problems.length) {
  console.log(`\n${problems.length} bullets need manual fix:`);
  for (const p of problems.slice(0, 40)) {
    console.log(`  ${p.id} (${p.role}): lint=[${p.issues.join(", ")}] sig=[${(p.sigMissing || []).join(", ")}]`);
    if (p.after && p.before !== p.after) console.log(`    → ${p.after.slice(0, 100)}…`);
  }
  if (problems.length > 40) console.log(`  … and ${problems.length - 40} more`);
}

process.exit(problems.length ? 1 : 0);
