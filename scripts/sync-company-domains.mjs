#!/usr/bin/env node
/**
 * Build public/company_domains.json from job feeds for logo lookup.
 * Run after pipeline pushes new jobs: npm run sync:logos
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "public/company_domains.json");

const LEGAL = /\b(llc|llp|lp|inc|corp|corporation|ltd|limited|co|company|group|technologies|technology|tech|services|consulting|software|international|global|holdings|enterprises)\b/gi;

function normalizeCompany(name) {
  return (name || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(LEGAL, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function guessDomain(company) {
  const n = normalizeCompany(company);
  if (!n) return null;
  const slug = n.replace(/\s+/g, "");
  if (slug.length < 3) return null;
  return `${slug}.com`;
}

const feeds = ["public/today_jobs.json", "public/week_jobs.json", "public/yesterday_jobs.json"];
const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const map = { ...existing };

for (const feed of feeds) {
  const file = path.join(ROOT, feed);
  if (!fs.existsSync(file)) continue;
  const jobs = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const job of jobs) {
    const company = job.company?.trim();
    if (!company) continue;
    const key = normalizeCompany(company);
    if (!key || map[key]) continue;
    const domain = guessDomain(company);
    if (domain) map[key] = domain;
  }
}

fs.writeFileSync(OUT, JSON.stringify(map, null, 2) + "\n");
console.log(`✓ ${Object.keys(map).length} company domains → public/company_domains.json`);
