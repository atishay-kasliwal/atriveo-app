import { phrase } from "./jd-parse.mjs";

const unique = (xs) => [...new Set(xs.filter(Boolean))];
const short = (s) => String(s).length > 220 ? `${String(s).slice(0, 217)}...` : String(s);

export function resumeEvidence(parsed) {
  const out = [];
  for (const [section, entries] of [["experience", parsed.experience], ["projects", parsed.projects]]) {
    for (const entry of entries) for (const bullet of entry.bullets || []) out.push({
      tier: section === "experience" ? (/\d/.test(bullet) ? "measured_job_bullet" : "job_bullet") : "project_bullet",
      section, entry: entry.company || entry.name || "Unknown", text: bullet,
    });
  }
  // A tools line ties a skill to one job or project: stronger than the skills list, weaker than a bullet using it.
  for (const [section, tier, entries] of [["experience", "job_tools", parsed.experience], ["projects", "project_tools", parsed.projects]]) {
    for (const entry of entries) for (const item of String(entry.stack || "").split(/\s*[,;|]\s*/).filter(Boolean)) {
      out.push({ tier, section: "tools", entry: entry.company || entry.name || "Unknown", text: item });
    }
  }
  for (const item of parsed.skills.items || []) out.push({ tier: "skills_only", section: "skills", entry: "Skills", text: item });
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
      if (phrase(record.text, name, config)) [kind, term] = ["exact", name];
      else {
        const variant = (skill.variants || []).find((v) => phrase(record.text, v, config));
        if (variant) [kind, term] = ["equivalent", variant];
        else {
          const related = (skill.related || []).find((v) => phrase(record.text, v, config));
          if (related) [kind, term] = ["related", related];
        }
      }
      if (!term) continue;
      candidates.push({ ...record, skill: name, term, kind, credit: cfg.evidence_tiers[record.tier] * cfg.match_kinds[kind], evidence: short(record.text) });
    }
  }
  const kindOrder = { exact: 0, equivalent: 1, related: 2 };
  candidates.sort((a, b) => b.credit - a.credit || kindOrder[a.kind] - kindOrder[b.kind] || a.skill.localeCompare(b.skill) || a.entry.localeCompare(b.entry) || a.text.localeCompare(b.text));
  const best = candidates[0] || { skill: alternatives[0], kind: "missing", tier: "missing", credit: 0, evidence: null, entry: null, term: null };
  const distinctBullets = unique(candidates.filter((c) => c.section !== "skills" && c.section !== "tools").map((c) => `${c.entry}:${c.text}`));
  return {
    ...best,
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
  const candidates = resumeEvidence(parsed).filter((r) => r.section !== "skills" && r.section !== "tools" && item.evidence.some((term) => stemPhrase(r.text, term)))
    .map((r) => ({ ...r, credit: config.scoring.job_match.responsibility_tiers[r.tier === "project_bullet" ? "project_bullet" : "job_bullet"] }));
  candidates.sort((a, b) => b.credit - a.credit || a.text.localeCompare(b.text));
  const best = candidates[0];
  return best ? { credit: best.credit, tier: best.tier, entry: best.entry, evidence: short(best.text) } : { credit: 0, tier: "missing", entry: null, evidence: null };
}

export function domainEvidence(item, parsed, config) {
  const all = [parsed.summary || "", ...parsed.experience.flatMap((e) => e.bullets), ...parsed.projects.flatMap((e) => e.bullets)].filter(Boolean);
  for (const [kind, terms] of [["exact", item.terms], ["equivalent", item.equivalents || []]]) {
    const hit = all.find((text) => terms.some((term) => phrase(text, term)));
    if (hit) return { kind, credit: config.scoring.job_match.domain_kinds[kind], evidence: short(hit) };
  }
  return { kind: "missing", credit: 0, evidence: null };
}
