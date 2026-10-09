// Dynamic skills lines from selected AC evidence only — no untraceable drift.

import { parseAtsKeywords } from "./ac-bank.mjs";
import { confirmedSkillKeys, isConfirmedSkill, loadTracks } from "./ac-tracks.mjs";
import {
  SKILLS_LIBRARY,
  SKILL_BY_DISPLAY,
  SKILL_BY_NAME,
  SKILLS_MAX_CATEGORIES,
  pickCategoriesForJd,
  sortSkillsByScore,
  skillHaystack,
  expandRelatedSkills,
  jdMentionsSkill,
  fitSkillsToSingleLine,
} from "./skills-library.mjs";

function norm(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9+#./ ]/g, " ").replace(/\s+/g, " ").trim();
}

function normJd(jd) {
  // Markdown-escaped JDs write "C\+\+" and "Node\.js": unescape first, as the ATS parser does.
  return ` ${norm(String(jd || "").replace(/\\([+&#.*-])/g, "$1"))} `;
}

function acIdFromBullet(bullet) {
  return bullet.ac_id || bullet.ac?.id || null;
}

function acCorpusText(ac) {
  const parts = [ac?.fact || ""];
  for (const v of ac?.variants || []) parts.push(v.text || "");
  for (const facet of Object.values(ac?.facets || {})) {
    if (facet?.phrase) parts.push(facet.phrase);
    for (const kw of facet?.keywords || []) parts.push(kw);
  }
  return parts.join(" ");
}

function rolesInComposition(composition) {
  const roles = new Set();
  for (const role of composition.experience || []) roles.add(role.role);
  for (const project of composition.projects || []) roles.add(project.role);
  return roles;
}

function textMatchesSkill(skill, text) {
  const hay = ` ${String(text || "").toLowerCase()} `;
  return skillHaystack(skill).some((t) => hay.includes(` ${t} `) || hay.includes(t));
}

function recordEvidence(evidenceBySkill, confidenceMap, skill, source, confidence) {
  const key = norm(skill.name);
  if (!evidenceBySkill.has(key)) evidenceBySkill.set(key, new Set());
  evidenceBySkill.get(key).add(source);
  const prev = confidenceMap.get(skill.name) || 0;
  confidenceMap.set(skill.name, Math.max(prev, confidence));
}

function collectBulletEvidence(composition, bank, { useSelectedAcCorpus = true } = {}) {
  const byId = new Map((bank?.acs || []).map((ac) => [ac.id, ac]));
  const bullets = [];
  const selectedIds = new Set();
  const evidenceBySkill = new Map();
  const confidenceMap = new Map();
  const terms = new Set();
  let corpusHay = "";
  const resumeRoles = rolesInComposition(composition);

  for (const role of composition.experience || []) {
    for (const bullet of role.bullets || []) {
      bullets.push({ ...bullet, section: "experience", role: role.role });
      const id = acIdFromBullet(bullet);
      if (id) selectedIds.add(id);
    }
  }
  for (const project of composition.projects || []) {
    for (const bullet of project.bullets || []) {
      bullets.push({ ...bullet, section: "project", role: project.role });
      const id = acIdFromBullet(bullet);
      if (id) selectedIds.add(id);
    }
  }

  for (const bullet of bullets) {
    const id = acIdFromBullet(bullet);
    const ac = byId.get(id);
    const text = bullet.text || bullet.face?.text || "";
    const source = bullet.section === "project" ? "Project" : id;

    if (useSelectedAcCorpus && ac) corpusHay += ` ${acCorpusText(ac)}`;

    for (const cat of SKILLS_LIBRARY) {
      for (const skill of cat.skills) {
        if (skill.bankBacked === false) continue;
        if (!textMatchesSkill(skill, text)) continue;
        terms.add(skill.name);
        recordEvidence(evidenceBySkill, confidenceMap, skill, source, 1.0);
      }
    }

    if (!ac) continue;
    for (const meta of parseAtsKeywords(ac).values()) {
      terms.add(meta.display);
      const key = norm(meta.display);
      if (!evidenceBySkill.has(key)) evidenceBySkill.set(key, new Set());
      evidenceBySkill.get(key).add(id);
    }
  }

  if (useSelectedAcCorpus) {
    for (const ac of bank?.acs || []) {
      if (!resumeRoles.has(ac.role)) continue;
      corpusHay += ` ${acCorpusText(ac)}`;
      for (const meta of parseAtsKeywords(ac).values()) {
        terms.add(meta.display);
        const key = norm(meta.display);
        if (!evidenceBySkill.has(key)) evidenceBySkill.set(key, new Set());
        evidenceBySkill.get(key).add(ac.id);
      }
    }
  }

  if (useSelectedAcCorpus && corpusHay) {
    const hay = norm(corpusHay);
    for (const cat of SKILLS_LIBRARY) {
      for (const skill of cat.skills) {
        if (skill.bankBacked === false) continue;
        if (terms.has(skill.name)) continue;
        if (skill.evidence === "inferred") continue;
        if (!skillHaystack(skill).some((t) => hay.includes(t))) continue;
        terms.add(skill.name);
        recordEvidence(evidenceBySkill, confidenceMap, skill, "role-corpus", 0.7);
      }
    }
  }

  const expanded = expandRelatedSkills(terms, evidenceBySkill);
  for (const name of expanded) {
    if (!confidenceMap.has(name)) confidenceMap.set(name, 0.55);
  }

  return { terms: expanded, evidenceBySkill, confidenceMap, bullets, selectedIds };
}

function skillInEvidence(skill, evidenceTerms) {
  if (skill.bankBacked === false) return evidenceTerms.has(skill.name);
  const key = norm(skill.name);
  for (const term of evidenceTerms) {
    const t = norm(term);
    if (t === key || t.includes(key) || key.includes(t)) return true;
  }
  return false;
}

// Skills Atishay confirmed using (TRACKS.yaml) back a skill the JD asks for, with no bullet naming it.
const CONFIRMED_SOURCE = "confirmed by Atishay (TRACKS.yaml)";
const confirmedForJd = (skill, hay, keys) => isConfirmedSkill(skill, keys) && jdMentionsSkill(skill, hay);

export function buildSkillsEvidenceAudit(composition, bank, jd, opts = {}) {
  const { terms, evidenceBySkill, confidenceMap } = collectBulletEvidence(composition, bank, opts);
  const hay = normJd(jd);
  const confirmed = confirmedSkillKeys();
  const audit = [];

  for (const cat of SKILLS_LIBRARY) {
    for (const skill of cat.skills) {
      const fromBullets = skillInEvidence(skill, terms);
      const fromEvidence = fromBullets || confirmedForJd(skill, hay, confirmed);
      const sources = fromBullets ? [...(evidenceBySkill.get(norm(skill.name)) || [])] : fromEvidence ? [CONFIRMED_SOURCE] : [];
      const jdRelevant = jdMentionsSkill(skill, hay);
      audit.push({
        skill: skill.displayName,
        canonical: skill.name,
        category: cat.label,
        tier: skill.tier,
        evidence_mode: skill.evidence,
        priority: skill.priority,
        covered: fromEvidence,
        evidence: sources.length ? sources.join(", ") : null,
        evidence_confidence: confidenceMap.get(skill.name) ?? null,
        jd_relevant: jdRelevant,
        marketFrequency: skill.marketFrequency,
        display: fromEvidence ? "✓" : "✗",
      });
    }
  }

  audit.sort((a, b) => Number(b.covered) - Number(a.covered) || a.skill.localeCompare(b.skill));
  return audit;
}

export function buildSkillsFromComposition(composition, bank, jd, {
  evidenceOnly = true,
  maxCategories = SKILLS_MAX_CATEGORIES,
  useSelectedAcCorpus = true,
} = {}) {
  const hay = normJd(jd);
  const { terms, confidenceMap } = collectBulletEvidence(composition, bank, { useSelectedAcCorpus });
  const confirmed = confirmedSkillKeys();
  const seen = new Set();
  const lines = [];

  const hasEvidence = (skill) => {
    if (confirmedForJd(skill, hay, confirmed)) return true;
    if (skill.bankBacked === false) return skillInEvidence(skill, terms);
    if (!evidenceOnly) return true;
    return skillInEvidence(skill, terms);
  };

  const categories = pickCategoriesForJd(jd, {
    maxCategories,
    hasEvidence,
  });

  // JD skills Atishay has whose categories didn't make the cut: rather than drop them, the last line becomes
  // "Additional Skills" holding them first (then that category's own JD skills), so no asked-for skill is lost.
  const pickedLabels = new Set(categories.map((c) => c.label));
  const leftovers = SKILLS_LIBRARY.filter((c) => !pickedLabels.has(c.label)).flatMap((c) => c.skills)
    .filter((sk) => hasEvidence(sk) && jdMentionsSkill(sk, hay));
  if (leftovers.length && categories.length >= maxCategories) {
    const last = categories[categories.length - 1];
    categories[categories.length - 1] = { ...last, label: "Additional Skills", skills: [...leftovers, ...last.skills.filter((sk) => jdMentionsSkill(sk, hay))] };
  }

  for (const cat of categories) {
    const candidates = [];

    for (const skill of cat.skills) {
      const key = skill.displayName.toLowerCase().replace(/[^a-z0-9+#.]/g, "");
      if (seen.has(key)) continue;
      if (!hasEvidence(skill)) continue;
      candidates.push(skill);
    }

    if (!candidates.length) continue;

    const jdHit = (s) => jdMentionsSkill(s, hay);
    const relevant = candidates.filter((s) => jdHit(s));
    const filler = candidates.filter((s) => !jdHit(s));
    // Skills the JD names go first, so a line that runs out of room drops filler, never a JD skill.
    const ordered = [...sortSkillsByScore(relevant, jd, confidenceMap), ...sortSkillsByScore(filler, jd, confidenceMap)];
    const displayNames = ordered.map((s) => s.displayName);
    const capped = fitSkillsToSingleLine(cat.label, displayNames);

    capped.forEach((n) => seen.add(n.toLowerCase().replace(/[^a-z0-9+#.]/g, "")));
    if (capped.length) lines.push(`${cat.label}: ${capped.join(", ")}`);
  }

  return lines;
}

// A tools line names tools (languages, frameworks, databases, cloud, BI products), never practices or concepts.
const TOOL_CATEGORIES = new Set(["Languages", "Backend Frameworks", "ML Frameworks", "Data Engineering", "Databases", "Search & Vector", "Cloud & DevOps", "Frontend", "Visualization & BI", "Data Science & Statistics"]);
const NOT_TOOLS = new Set(["dashboards", "data visualization", "statistical analysis", "a/b testing", "hypothesis testing", "regression", "predictive modeling", "time series forecasting", "model evaluation", "observability", "devops", "infrastructure as code", "etl pipelines", "data ingestion", "caching", "relational databases", "nosql", "vector databases", "authentication", "event-driven architecture", "serverless", "stream processing", "feature pipelines", "data modeling", "json"]);
const CATEGORY_OF = new Map(SKILLS_LIBRARY.flatMap((c) => c.skills.map((sk) => [sk.name, c.label])));
const isTool = (sk) => TOOL_CATEGORIES.has(CATEGORY_OF.get(sk.name)) && !NOT_TOOLS.has(sk.displayName.toLowerCase());

/**
 * An employer's tools line for one JD: skills Atishay confirmed at that employer (TRACKS.yaml confirmed_skills) or that
 * its bank bullets already name (signature_technologies), kept only when the JD asks for them. Up to 6, about one
 * line on the company row. Empty when the JD names none of them.
 */
export function employerTools(roleSlug, jd, bank, { max = 6, maxChars = 58 } = {}) {
  const hay = normJd(jd);
  const confirmed = loadTracks().confirmed_skills?.[roleSlug] || [];
  const fromBank = (bank?.acs || []).filter((a) => a.role === roleSlug)
    .flatMap((a) => [a, ...(a.variants || [])].flatMap((x) => x.signature_technologies || []));
  // Skills the employer's own bullet texts already name (any wording in the bank), matched by library terms.
  const texts = normJd((bank?.acs || []).filter((a) => a.role === roleSlug)
    .flatMap((a) => [a.text, ...(a.variants || []).map((v) => v.text)]).filter(Boolean).join(" "));
  const fromTexts = SKILLS_LIBRARY.flatMap((c) => c.skills).filter((sk) => sk.bankBacked !== false && jdMentionsSkill(sk, texts)).map((sk) => sk.displayName);
  const seen = new Set(); const picked = [];
  for (const name of [...confirmed, ...fromBank, ...fromTexts]) {
    const entry = SKILL_BY_DISPLAY.get(String(name).toLowerCase()) || SKILL_BY_NAME.get(String(name).toLowerCase());
    const display = entry?.displayName || name;
    const key = display.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (entry && !isTool(entry)) continue;
    const hit = entry ? jdMentionsSkill(entry, hay) : hay.includes(` ${key} `);
    if (hit) picked.push({ display, weight: (entry?.marketFrequency || 500) * (entry?.priority || 5) });
  }
  picked.sort((a, b) => b.weight - a.weight);
  const out = [];
  for (const p of picked) {
    if (out.length >= max || [...out, p.display].join(", ").length > maxChars) continue;
    out.push(p.display);
  }
  return out;
}
