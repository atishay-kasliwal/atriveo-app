import { phrase, termRegex } from "./jd-parse.mjs";

// Fit only: one mention is thin evidence, a skill shown across several separate bullets is depth. The factor runs from
// `base` (one bullet, or a tools line alone) to 1 at `full_at_bullets` bullets. Without config.depth nothing changes.
export function depthFactor(bullets, depth) {
  if (!depth) return 1;
  return depth.base + (1 - depth.base) * Math.min(1, Math.max(0, bullets - 1) / (depth.full_at_bullets - 1));
}

// Source paths and URLs are provenance, not proof that a technology was used.
export function evidenceText(value) {
  return String(value || "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/[^\s)]+/gi, " ")
    .replace(/(?:[\w.-]+\/)*[\w.-]+\.(?:md|ya?ml|json|pdf|tex|csv|txt)\b/gi, " ")
    .replace(/\(\s*\)/g, "").replace(/\s+/g, " ").trim();
}

// Match an affirmative occurrence in its own clause, not a denial or a future plan.
export function affirmative(text, term, config, stem = false) {
  const pattern = termRegex(term, config);
  const source = stem ? pattern.source.replace(/\(\?!\[a-z0-9\]\)$/, "[a-z]*(?![a-z0-9])").replace(/ /g, "[\\s-]+") : pattern.source;
  const clean = evidenceText(text);
  for (const m of clean.matchAll(new RegExp(source, pattern.flags + "g"))) {
    const prefix = clean.slice(0, m.index).split(/\s\|\s|[;!?]|\.(?:\s|$)|,\s*(?=(?:but|used|built|implemented|developed)\b)|\bbut\b/i).at(-1).slice(-100);
    const learningOnly = /(?:^|\b(?:currently|am|is|are|was|were|started|began|now)\s+)(?:learning|studying)\s*(?:\w+\s+){0,3}$/i.test(prefix);
    if (!learningOnly && !/\b(?:did not|didn't|do not|don't|does not|doesn't|never|not|no|no(?: prior| practical| production| hands-on)? experience(?: with| in| using)?|without(?: any)?(?: experience(?: with| in))?|not familiar with|not proficient in|plan(?:ned|ning)? to (?:use|learn)|intend(?:ed)? to use|will (?:use|learn))\b(?! only)\s*(?:\w+[\s,]+){0,6}$/i.test(prefix)) return true;
  }
  return false;
}

// A version number is not a measured outcome or scope.
export const measuredEvidence = text => /\d[\d,.]*(?:\s*[kmb])?\s*(?:%|percent|ms\b|milliseconds?\b|seconds?\b|minutes?\b|hours?\b|days?\b|users?\b|employees?\b|engineers?\b|records?\b|transactions?\b|requests?\b|scans?\b|cases?\b|studies\b|releases?\b|TB\b|GB\b|F1\b)|\$\s*\d|\d[\d,.]*[- ]person\b/i.test(text);
const unique = xs => [...new Set(xs.filter(Boolean))];
const short = s => String(s).length > 220 ? `${String(s).slice(0, 217)}...` : String(s);
const wordingWith = (text, term, config) => String(text).split(" | ").find(p => affirmative(p, term, config)) || text;

export function resumeEvidence(parsed) {
  const out = [];
  for (const [section, entries] of [["experience", parsed.experience], ["projects", parsed.projects]]) {
    for (const entry of entries) for (const bullet of entry.bullets || []) out.push({
      tier: section === "experience" ? (measuredEvidence(evidenceText(bullet)) ? "measured_job_bullet" : "job_bullet") : "project_bullet",
      section, entry: entry.company || entry.name || "Unknown", text: evidenceText(bullet),
    });
  }
  // A tools line ties a skill to one job or project: stronger than the skills list, weaker than a bullet using it.
  for (const [section, tier, entries] of [["experience", "job_tools", parsed.experience], ["projects", "project_tools", parsed.projects]]) {
    for (const entry of entries) for (const item of String(entry.stack || "").split(/\s*[,;|]\s*/).filter(Boolean)) {
      out.push({ tier, section: "tools", entry: entry.company || entry.name || "Unknown", text: evidenceText(item) });
    }
  }
  for (const item of parsed.skills.items || []) out.push({ tier: "skills_only", section: "skills", entry: "Skills", text: evidenceText(item) });
  return out;
}

export function skillEvidence(alternatives, parsed, config) {
  const cfg = config.scoring.job_match;
  const records = resumeEvidence(parsed);
  const candidates = [];
  for (const name of alternatives) {
    const skill = config.skills[name] || { variants: [], related: [] };
    for (const record of records) {
      let kind = null;
      let term = null;
      if (affirmative(record.text, name, config)) [kind, term] = ["exact", name];
      else {
        const variant = (skill.variants || []).find((v) => affirmative(record.text, v, config));
        if (variant) [kind, term] = ["equivalent", variant];
        else {
          const related = (skill.related || []).find((v) => affirmative(record.text, v, config));
          if (related) [kind, term] = ["related", related];
        }
      }
      if (!term) continue;
      candidates.push({ ...record, skill: name, term, kind, credit: cfg.evidence_tiers[record.tier] * cfg.match_kinds[kind], evidence: short(wordingWith(record.text, term, config)) });
    }
  }
  const kindOrder = { exact: 0, equivalent: 1, related: 2 };
  candidates.sort((a, b) => b.credit - a.credit || kindOrder[a.kind] - kindOrder[b.kind] || a.skill.localeCompare(b.skill) || a.entry.localeCompare(b.entry) || a.text.localeCompare(b.text));
  const best = candidates[0] || { skill: alternatives[0], kind: "missing", tier: "missing", credit: 0, evidence: null, entry: null, term: null };
  const distinctBullets = unique(candidates.filter((c) => c.section !== "skills" && c.section !== "tools" && (best.kind === "related" ? c.kind === "related" : c.kind !== "related")).map((c) => `${c.entry}:${c.text}`));
  const factor = best.kind === "missing" ? 1 : depthFactor(distinctBullets.length, cfg.depth);
  return {
    ...best,
    credit: best.credit * factor, depth_factor: factor,
    distinct_bullets: distinctBullets.length,
    stuffing_warning: distinctBullets.length >= cfg.stuffing.warning_repetitions,
    supporting: candidates.slice(0, cfg.stuffing.max_distinct_bullets).map((c) => ({ entry: c.entry, text: c.evidence, tier: c.tier, kind: c.kind })),
  };
}

// Responsibility evidence terms are stems ("collaborat", "scalab", "microservice"): a term matches at a word start
// and may run on ("collaborated", "microservices"); a space also matches a hyphen ("cross-functional").
export function stemPhrase(text, term) {
  const esc = String(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[\\s-]+");
  return new RegExp(`(?<![a-z0-9])${esc}[a-z]*(?![a-z0-9])`, "i").test(String(text));
}

export function conceptEvidence(item, parsed, config) {
  const candidates = resumeEvidence(parsed).filter((r) => r.section !== "skills" && r.section !== "tools" && item.evidence.some((term) => affirmative(r.text, term, config, true)))
    .map((r) => ({ ...r, credit: config.scoring.job_match.responsibility_tiers[r.tier === "project_bullet" ? "project_bullet" : "job_bullet"] }));
  candidates.sort((a, b) => b.credit - a.credit || a.text.localeCompare(b.text));
  const best = candidates[0];
  const bullets = new Set(candidates.map((c) => `${c.entry}:${c.text}`)).size;
  return best ? { credit: best.credit * depthFactor(bullets, config.scoring.job_match.depth), tier: best.tier, entry: best.entry, evidence: short(String(best.text).split(" | ").find(p => item.evidence.some(term => affirmative(p, term, config, true))) || best.text), distinct_bullets: bullets } : { credit: 0, tier: "missing", entry: null, evidence: null };
}

export function domainEvidence(item, parsed, config) {
  const all = [parsed.summary || "", ...parsed.experience.flatMap((e) => e.bullets), ...parsed.projects.flatMap((e) => e.bullets)].filter(Boolean);
  for (const [kind, terms] of [["exact", item.terms], ["equivalent", item.equivalents || []]]) {
    const hit = all.find((text) => terms.some((term) => affirmative(text, term, config)));
    if (hit) return { kind, credit: config.scoring.job_match.domain_kinds[kind], evidence: short(hit) };
  }
  return { kind: "missing", credit: 0, evidence: null };
}

export function keywordCoverage(jd, resumeText, cfg) {
  return Object.entries(cfg.skills).flatMap(([name, skill]) => {
    const terms = [name, ...(skill.variants || [])];
    const present = terms.filter(term => phrase(jd, term, cfg));
    return present.length ? [{ name, terms: present, matched: terms.some(term => phrase(resumeText, term, cfg)) }] : [];
  });
}
