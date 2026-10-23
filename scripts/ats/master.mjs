// The master resume for Fit: everything the AC bank lets you truthfully claim, in the parsed-resume shape the
// scorer already reads. Nothing here comes from a tailored resume, a headline, or any generated text.
//
// Evidence rule: a skill counts only through a bullet (the confirmed fact or one of its approved wordings), through a
// role's verified tools (ROLE-ATS-TECH.yaml, which must also appear in that role's bullets), or through a project's
// declared stack. The bank's keyword lists (ats_keywords, facets, signature_technologies) are never evidence.
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { fileURLToPath } from "node:url";
import { parseDateRange } from "./patterns.mjs";
import { EDUCATION_ROWS } from "../resume-education.mjs";

const bankDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/ac-bank");
// Provenance levels that are not a claim you made or confirmed.
const NOT_EVIDENCE = new Set(["UNSUPPORTED", "HISTORICAL_CLAIM"]);
// The bank's display tags (fits:) name the roles it can credibly support; Fit reads them as role families.
const FIT_FAMILY = { "software-engineer": "software", "forward-deployed": "software", "ai-engineer": "ai", "data-science": "data", "data-analytics": "data" };
const readYaml = (file) => yaml.load(fs.readFileSync(file, "utf8")) || {};
const dates = (text) => parseDateRange(String(text || "").replace(/\s*--\s*/g, " – "));
const flat = (v) => (Array.isArray(v) ? v.flatMap(flat) : v && typeof v === "object" ? Object.values(v).flatMap(flat) : v ? [String(v)] : []);

export function buildMaster(dir = bankDir) {
  const files = fs.readdirSync(dir);
  const roles = new Map();
  for (const f of files.filter((n) => /\.yaml$/.test(n) && !/^AC-/.test(n))) {
    try { const doc = readYaml(path.join(dir, f)); if (doc?.role?.id) roles.set(doc.role.id, doc); } catch { /* not a role file */ }
  }
  const bulletsByRole = new Map();
  const excluded = { no_role_file: new Set(), not_evidence: 0 };
  const families = new Set();
  for (const f of files.filter((n) => /^AC-U?\d+\.yaml$/.test(n)).sort()) {
    let ac; try { ac = readYaml(path.join(dir, f)); } catch { continue; }
    if (!ac?.role) continue;
    if (NOT_EVIDENCE.has(ac.provenance?.level)) { excluded.not_evidence++; continue; }
    if (!roles.has(ac.role)) { excluded.no_role_file.add(ac.role); continue; }
    for (const tag of ac.fits || []) if (FIT_FAMILY[tag]) families.add(FIT_FAMILY[tag]);
    const texts = [ac.fact, ...(ac.variants || []).map((v) => v.text)].map((t) => String(t || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    // The variants are wordings of one confirmed fact: together they are one bullet, so depth counts facts, not rewordings.
    const list = bulletsByRole.get(ac.role) || [];
    if (texts.length) list.push([...new Set(texts)].join(" | "));
    bulletsByRole.set(ac.role, list);
  }
  const anchors = readYaml(path.join(dir, "ROLE-ATS-TECH.yaml"));
  const entry = (id, doc) => {
    const bullets = bulletsByRole.get(id) || [];
    const declared = doc.product?.stack ? flat(doc.product.stack) : [];
    // Verified anchors only where a bullet of the role actually uses them.
    const used = (anchors[id] || []).filter((t) => bullets.some((b) => b.toLowerCase().includes(String(t).toLowerCase())));
    return { company: doc.role.employer, name: doc.role.employer, title: doc.role.title, dates: dates(doc.role.dates), bullets, stack: [...new Set([...used, ...declared])].join(", "), role_id: id };
  };
  const experience = [], projects = [];
  for (const [id, doc] of roles) (doc.role.slot_kind === "project" ? projects : experience).push(entry(id, doc));
  const rank = (e) => (e.dates?.current ? 9999 * 12 : (e.dates?.end?.year ?? 0) * 12 + (e.dates?.end?.month ?? 0));
  experience.sort((a, b) => rank(b) - rank(a));
  return {
    families: [...families].sort(), contact: { other: [] }, summary: null, experience: experience.filter((e) => e.bullets.length), projects: projects.filter((e) => e.bullets.length),
    education: EDUCATION_ROWS.map((e) => ({ school: e.school, degree: e.degree, dates: dates(e.dates) })),
    skills: { groups: [], items: [] },
    provenance: { source: "data/ac-bank", roles: [...roles.keys()], excluded: { ...excluded, no_role_file: [...excluded.no_role_file] } },
  };
}
