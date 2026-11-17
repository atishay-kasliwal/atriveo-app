// Dynamic skills lines from selected AC evidence only — no untraceable drift.

import { parseAtsKeywords } from "./ac-bank.mjs";
import { scaledChars } from "./resume-page.mjs";
import { confirmedSkillKeys, confirmedSkillSources, isConfirmedSkill, loadTracks } from "./ac-tracks.mjs";
import { openOnlySkillKeys, skillEvidenceKey, skillEvidenceSources } from "./skill-evidence.mjs";

// A confirmation backed only by open PRs ranks after merged and bullet evidence on a full Skills line.
const OPEN_ONLY_CONFIDENCE = 0.75;
import {
  SKILLS_LIBRARY,
  SKILL_BY_DISPLAY,
  SKILL_BY_NAME,
  SKILLS_MAX_CATEGORIES,
  pickCategoriesForJd,
  sortSkillsByScore,
  skillHaystack,
  jdMentionsSkill,
  fitSkillsToSingleLine,
  fitsOnePhysicalLine,
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

// Whole words only: a bare substring let the alias "ts" (TypeScript) match "results" (2026-10-23).
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const wordIn = (hay, t) => new RegExp(`(^|[^a-z0-9+#])${escapeRe(t)}($|[^a-z0-9+#])`).test(hay);

function textMatchesSkill(skill, text) {
  const hay = String(text || "").toLowerCase();
  return skillHaystack(skill).some((t) => wordIn(hay, t));
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
        if (!skillHaystack(skill).some((t) => wordIn(hay, t))) continue;
        terms.add(skill.name);
        recordEvidence(evidenceBySkill, confidenceMap, skill, "role-corpus", 0.7);
      }
    }
  }

  // Related skills (LLMs → LangChain, MCP) are a guess, not evidence (2026-10-23): only what the bank names counts.
  return { terms, evidenceBySkill, confidenceMap, bullets, selectedIds };
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
const confirmedForJd = (skill, hay, keys) => isConfirmedSkill(skill, keys) && jdMentionsSkill(skill, hay);

export function buildSkillsEvidenceAudit(composition, bank, jd, opts = {}) {
  const { terms, evidenceBySkill, confidenceMap } = collectBulletEvidence(composition, bank, opts);
  const hay = normJd(jd);
  const tracks = loadTracks(bank?.bank_dir);
  const confirmed = confirmedSkillKeys(tracks);
  const confirmedSources = confirmedSkillSources(tracks);
  const pendingSources = skillEvidenceSources(tracks.skill_evidence, { pending: true });
  const openOnly = openOnlySkillKeys(tracks.skill_evidence);
  const audit = [];

  for (const cat of SKILLS_LIBRARY) {
    for (const skill of cat.skills) {
      const fromBullets = skillInEvidence(skill, terms);
      const fromEvidence = fromBullets || confirmedForJd(skill, hay, confirmed);
      const confirmedMatch = confirmedForJd(skill, hay, confirmed);
      const sources = new Set(fromBullets ? evidenceBySkill.get(norm(skill.name)) || [] : []);
      if (confirmedMatch) {
        for (const source of confirmedSources.get(skillEvidenceKey(skill.name)) || []) sources.add(source);
      }
      const jdRelevant = jdMentionsSkill(skill, hay);
      audit.push({
        skill: skill.displayName,
        canonical: skill.name,
        category: cat.label,
        tier: skill.tier,
        evidence_mode: skill.evidence,
        priority: skill.priority,
        covered: fromEvidence,
        evidence: sources.size ? [...sources].join(", ") : null,
        evidence_confidence: confidenceMap.get(skill.name) ?? (confirmedMatch ? (openOnly.has(skillEvidenceKey(skill.name)) ? OPEN_ONLY_CONFIDENCE : 1.0) : null),
        pending_evidence: [...(pendingSources.get(skillEvidenceKey(skill.name)) || [])],
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
  // Skills that must print, treated like skills the JD names (first in their line, never dropped as filler). By default
  // the tools the employer title lines no longer show and no bullet names (unprintedEmployerTools).
  mustInclude = null,
} = {}) {
  const must = new Set((mustInclude ?? unprintedEmployerTools(composition, jd, bank)).map((s) => String(s).toLowerCase()));
  const hay = normJd(jd);
  const asked = (sk) => jdMentionsSkill(sk, hay) || must.has(sk.name.toLowerCase()) || must.has(sk.displayName.toLowerCase());
  const { terms, confidenceMap } = collectBulletEvidence(composition, bank, { useSelectedAcCorpus });
  const tracks = loadTracks(bank?.bank_dir);
  const confirmed = confirmedSkillKeys(tracks);
  // Open only confirmations sort after merged ones, so a full line drops them first.
  const openOnly = openOnlySkillKeys(tracks.skill_evidence);
  for (const cat of SKILLS_LIBRARY) {
    for (const skill of cat.skills) {
      if (!confidenceMap.has(skill.name) && openOnly.has(skillEvidenceKey(skill.name))) confidenceMap.set(skill.name, OPEN_ONLY_CONFIDENCE);
    }
  }
  const seen = new Set();
  const lines = [];

  const hasEvidence = (skill) => {
    if (confirmedForJd(skill, hay, confirmed)) return true;
    if (skill.bankBacked === false) return skillInEvidence(skill, terms);
    if (!evidenceOnly) return true;
    return skillInEvidence(skill, terms);
  };

  let categories = pickCategoriesForJd(jd, {
    maxCategories,
    hasEvidence,
  });
  // Languages always print, first (2026-11-17, toward 9.5): a recruiter's scan starts there, and when the JD's ranking
  // left the line out, Python ended up in "Additional Skills". It takes the lowest-ranked line's place.
  const languages = SKILLS_LIBRARY.find((c) => c.label === "Languages");
  if (languages?.skills.some((s) => hasEvidence(s))) {
    categories = [languages, ...categories.filter((c) => c.label !== "Languages")].slice(0, Math.max(1, maxCategories));
  }

  // JD skills Atishay has whose categories didn't make the cut: rather than drop them, the last line becomes
  // "Additional Skills" holding them first (then that category's own skills), so no asked-for skill is lost.
  const pickedLabels = new Set(categories.map((c) => c.label));
  const leftovers = SKILLS_LIBRARY.filter((c) => !pickedLabels.has(c.label)).flatMap((c) => c.skills)
    .filter((sk) => hasEvidence(sk) && asked(sk));
  if (leftovers.length && categories.length >= maxCategories && categories.length > 1) {
    const last = categories[categories.length - 1];
    categories[categories.length - 1] = { ...last, label: "Additional Skills", skills: [...leftovers, ...last.skills] };
  }

  const pageText = [...(composition?.experience || []), ...(composition?.projects || [])]
    .flatMap((s) => (s.bullets || []).map((b) => b.text || b.face?.text || "")).join(" ");
  const namedOnPage = (sk) => [sk.displayName, sk.name, ...(sk.aliases || [])].some((n) => n && new RegExp(`(^|[^A-Za-z0-9])${String(n).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}($|[^A-Za-z0-9])`, "i").test(pageText));
  const keyOf = (name) => name.toLowerCase().replace(/[^a-z0-9+#.]/g, "");
  // "HTML/CSS" says what "HTML" and "CSS" already say (and the reverse).
  const shown = (key) => seen.has(key) || (key === "htmlcss" && (seen.has("html") || seen.has("css")))
    || ((key === "html" || key === "css") && seen.has("htmlcss"));
  const isMust = (s) => must.has(s.name.toLowerCase()) || must.has(s.displayName.toLowerCase());

  for (const cat of categories) {
    // One entry per printed name (two library entries may print the same name, e.g. GraphQL and GraphQL APIs).
    const candidates = [...new Map(cat.skills.filter((skill) => !shown(keyOf(skill.displayName)) && hasEvidence(skill))
      .map((skill) => [keyOf(skill.displayName), skill])).values()];
    if (!candidates.length) continue;

    // Skills the JD names (and the must-print ones) by score, then filler, so a line that runs out of room drops filler.
    const top = sortSkillsByScore(candidates.filter((s) => asked(s)), jd, confidenceMap);
    // Languages filler (not asked for) prints when a bullet on this page uses it, or to bring the line to 3 (2026-11-17:
    // "Languages: Python, SQL, Java, TypeScript, CSS" on a data resume listed languages nothing on the page used).
    // Other lines keep their confirmed filler.
    const fillerAll = sortSkillsByScore(candidates.filter((s) => !asked(s) && !NEVER_LISTED.has(s.displayName)), jd, confidenceMap);
    const onPage = fillerAll.filter((s) => namedOnPage(s));
    const filler = cat.label !== "Languages" ? fillerAll
      : [...onPage, ...fillerAll.filter((s) => !namedOnPage(s)).slice(0, Math.max(0, 3 - top.length - onPage.length))];
    let capped = fitSkillsToSingleLine(cat.label, [...top, ...filler].map((s) => s.displayName));
    // A must-print skill that didn't fit takes the place of the last skill on the line that isn't one.
    const mustNames = new Set(top.filter(isMust).map((s) => s.displayName));
    for (const name of mustNames) {
      if (capped.includes(name)) continue;
      const trial = [...capped];
      while (!fitsOnePhysicalLine(cat.label, [...trial, name])) {
        const at = trial.findLastIndex((n) => !mustNames.has(n));
        if (at < 0) break;
        trial.splice(at, 1);
      }
      if (fitsOnePhysicalLine(cat.label, [...trial, name])) capped = [...trial, name];
    }

    capped.forEach((n) => seen.add(keyOf(n)));
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
 * its bank bullets already name (signature_technologies or bullet text). The JD's skills come first, best first, up to 6 and
 * about one line on the company row. A line never has fewer than `min` (5): when the JD asks for fewer of the employer's tools,
 * the employer's other tools follow, so the line stays honest (only tools used there) and full. It is shorter only when the
 * employer has fewer than 5 such tools.
 */
/** Formats, not skills: they print only when a JD asks for them by name. */
const NEVER_LISTED = new Set(["JSON"]);

/**
 * The tools an employer's title line used to name (employerTools: the JD's skills Atishay used there) that no bullet on
 * the resume names. Since 2026-11-17 title lines print the title alone, so these go into Technical Skills instead.
 */
export function unprintedEmployerTools(composition, jd, bank) {
  const printed = [...(composition?.experience || []), ...(composition?.projects || [])]
    .flatMap((s) => (s.bullets || []).map((b) => b.text || b.face?.text || "")).join(" ");
  const named = (tool) => new RegExp(`(^|[^A-Za-z0-9])${tool.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}($|[^A-Za-z0-9])`, "i").test(printed);
  return [...new Set((composition?.experience || []).flatMap((role) => employerTools(role.role, jd, bank)))].filter((t) => !named(t));
}

// 58 and 72 characters on the old 7.5in line, scaled to the template's width (resume-page.mjs).
export function employerTools(roleSlug, jd, bank, { max = 6, min = 5, maxChars = scaledChars(58), hardChars = scaledChars(72) } = {}) {
  const hay = normJd(jd);
  const confirmed = loadTracks().confirmed_skills?.[roleSlug] || [];
  const fromBank = (bank?.acs || []).filter((a) => a.role === roleSlug)
    .flatMap((a) => [a, ...(a.variants || [])].flatMap((x) => x.signature_technologies || []));
  // Skills the employer's own bullet texts already name (any wording in the bank), matched by library terms.
  const texts = normJd((bank?.acs || []).filter((a) => a.role === roleSlug)
    .flatMap((a) => [a.text, ...(a.variants || []).map((v) => v.text)]).filter(Boolean).join(" "));
  const fromTexts = SKILLS_LIBRARY.flatMap((c) => c.skills).filter((sk) => sk.bankBacked !== false && jdMentionsSkill(sk, texts)).map((sk) => sk.displayName);
  const seen = new Set(); const hits = []; const others = [];
  for (const name of [...confirmed, ...fromBank, ...fromTexts]) {
    const entry = SKILL_BY_DISPLAY.get(String(name).toLowerCase()) || SKILL_BY_NAME.get(String(name).toLowerCase());
    const display = entry?.displayName || name;
    const key = display.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (entry && !isTool(entry)) continue;
    const hit = entry ? jdMentionsSkill(entry, hay) : hay.includes(` ${key} `);
    (hit ? hits : others).push({ display, weight: (entry?.marketFrequency || 500) * (entry?.priority || 5) });
  }
  const byWeight = (a, b) => b.weight - a.weight;
  hits.sort(byWeight); others.sort(byWeight);
  const ordered = [...hits, ...others];
  const out = [];
  const fits = (p, limit) => [...out, p.display].join(", ").length <= limit;
  // The JD's skills first, within the usual line length.
  for (const p of hits) if (out.length < max && fits(p, maxChars)) out.push(p.display);
  // Short of the minimum: the JD's skills that did not fit, then the employer's other tools, up to the hard line length.
  for (const p of ordered) if (out.length < min && !out.includes(p.display) && fits(p, hardChars)) out.push(p.display);
  return out;
}
