// Job Match from parsed PDF evidence and parsed JD requirements. Every category and item has
// integer-tenths accounting; Readiness is never folded into this score.
import { phrase } from "./jd-parse.mjs";
import { skillEvidence, conceptEvidence, domainEvidence } from "./evidence.mjs";

const ticks = (n) => Math.round(Number(n || 0) * 10);
const points = (n) => n / 10;

function levelFor(title, cfg) {
  const t = String(title || "").toLowerCase();
  for (const [level, re] of [["principal", /\b(principal|distinguished)\b/], ["staff", /\b(staff|lead)\b/], ["senior", /\b(senior|sr\.?|iii|iv)\b/], ["intern", /\b(intern|internship)\b/], ["junior", /\b(junior|jr\.?|entry.level|associate)\b/]]) {
    if (re.test(t)) return cfg.levels[level];
  }
  return cfg.levels.mid;
}

function familyFor(title, cfg) {
  const t = String(title || "");
  for (const [family, titles] of Object.entries(cfg.families)) if (titles.some((s) => phrase(t, s))) return family;
  return null;
}

function yearsExperience(positions, asOf) {
  const endDate = new Date(`${asOf}T00:00:00Z`);
  if (Number.isNaN(endDate.valueOf())) throw new Error(`Invalid --as-of date: ${asOf}`);
  const months = new Set();
  for (const e of positions) {
    const d = e.dates;
    if (!d?.start) continue;
    const start = d.start.year * 12 + (d.start.month || 1);
    const end = d.current ? endDate.getUTCFullYear() * 12 + endDate.getUTCMonth() + 1 : d.end?.year * 12 + (d.end.month || 12);
    for (let m = start; m <= Math.min(end, start + 600); m++) months.add(m);
  }
  return Math.round(months.size / 12 * 10) / 10;
}

function category(key, maxTicks, rows, note = null) {
  const weights = rows.map((r) => r.weight ?? 1);
  const weightTotal = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => maxTicks * w / weightTotal);
  const limits = raw.map(Math.floor);
  let left = maxTicks - limits.reduce((a, b) => a + b, 0);
  for (const i of raw.map((v, i) => ({ i, fraction: v % 1 })).sort((a, b) => b.fraction - a.fraction || a.i - b.i)) if (left-- > 0) limits[i.i]++;
  const items = rows.map((row, i) => ({
    ...row, max: points(limits[i]), earned: points(Math.max(0, Math.round(limits[i] * Math.max(0, Math.min(1, row.credit))) - ticks(row.penalty_points))),
  }));
  for (const item of items) { item.lost = points(ticks(item.max) - ticks(item.earned)); delete item.credit; delete item.weight; delete item.penalty_points; }
  const earned = items.reduce((n, r) => n + ticks(r.earned), 0);
  return { key, max: points(maxTicks), earned: points(earned), lost: points(maxTicks - earned), items, ...(note && { note }) };
}

function full(key, maxTicks, note) { return category(key, maxTicks, [{ label: note, credit: 1, classification: "no requirement stated" }], note); }

function skillRows(requirements, resume, config) {
  return requirements.map((r) => {
    const evidence = skillEvidence(r.alternatives, resume, config);
    return { label: r.label, source: r.source, alternatives: r.alternatives, classification: evidence.kind,
      evidence_tier: evidence.tier, matched_skill: evidence.skill, matched_term: evidence.term,
      evidence: evidence.evidence, evidence_entry: evidence.entry, supporting: evidence.supporting,
      ...(evidence.stuffing_warning && { warning: `Repeated in ${evidence.distinct_bullets} distinct bullets; extra mentions earn no credit${config.scoring.job_match.stuffing.penalty ? ` and incur a ${config.scoring.job_match.stuffing.penalty}-point penalty` : ""}` }),
      penalty_points: evidence.stuffing_warning ? config.scoring.job_match.stuffing.penalty : 0, credit: evidence.credit };
  });
}

function recommendation(item, categoryName, bank) {
  if (item.lost <= 0 || item.classification === "no requirement stated") return null;
  const keyword = item.alternatives?.[0] || item.label;
  const match = bank?.find((b) => b.ats_keywords?.some((k) => phrase(k, keyword)));
  const guidance = {
    role_alignment: "Check whether your truthful headline clearly describes your relevant work; keep past job titles accurate.",
    seniority: "Dates and title level come from the parsed resume. Verify the parser before changing any source dates.",
    education_certs: "Add this credential only if you actually hold it; otherwise treat it as a real gap.",
    achievement_evidence: "Use a specific measured outcome where you have supporting evidence.",
    domain_terminology: "Show relevant industry work where your actual experience supports it.",
  };
  return {
    category: categoryName, requirement: item.label, recoverable_points: item.lost,
    message: guidance[categoryName] || (match
      ? `${item.label}: resume evidence is weak or absent. Your bank has ${match.id}; review whether that truthful bullet belongs in this resume.`
      : `${item.label}: add evidence only if you have genuinely used it.`),
    ...(match && { bank_id: match.id }),
  };
}

export function scoreJobMatch(resume, jd, config, { asOf = new Date().toISOString().slice(0, 10), bank = [] } = {}) {
  const cfg = config.scoring.job_match;
  const weights = cfg.weights;
  // A category the JD gives nothing to score on is left out and its weight shared: no listed skills, or
  // responsibilities the parser couldn't map to any concept (scoring those 0 would grade the parser, not the resume).
  const unmappable = !jd.responsibility_concepts.length && (jd.unparsed.length || jd.responsibilities.length);
  const present = Object.keys(weights).filter((k) => !((k === "required_skills" && !jd.required.length) || (k === "preferred_skills" && !jd.preferred.length) || (k === "experience_alignment" && unmappable)));
  const original = Object.values(weights).reduce((a, b) => a + ticks(b), 0);
  if (original !== 1000) throw new Error(`Job Match weights total ${points(original)}, expected 100`);
  const base = Object.fromEntries(present.map((k) => [k, ticks(weights[k])]));
  const unused = original - Object.values(base).reduce((a, b) => a + b, 0);
  const ordered = present.map((k) => ({ key: k, raw: unused * base[k] / (1000 - unused) }));
  const extras = Object.fromEntries(ordered.map((x) => [x.key, Math.floor(x.raw)]));
  let remainder = unused - Object.values(extras).reduce((a, b) => a + b, 0);
  for (const x of [...ordered].sort((a, b) => (b.raw % 1) - (a.raw % 1) || a.key.localeCompare(b.key))) if (remainder-- > 0) extras[x.key]++;
  const max = (k) => (base[k] || 0) + (extras[k] || 0);

  const categories = [];
  if (jd.required.length) categories.push(category("required_skills", max("required_skills"), skillRows(jd.required, resume, config)));
  const responsibilities = jd.responsibility_concepts.map((r) => {
    const ev = conceptEvidence(config.responsibilities[r.id], resume, config);
    return { label: r.label, source: r.source, classification: ev.credit ? "evidenced" : "missing", evidence_tier: ev.tier, evidence: ev.evidence, evidence_entry: ev.entry, credit: ev.credit };
  });
  const mappedSources = new Set(jd.responsibility_concepts.map((r) => r.source));
  // Lines the parser couldn't read stay listed for manual review (job_match.unparsed_requirements); they earn and
  // lose nothing, so the score reflects only requirements it understood.
  const unparsedWork = jd.unparsed.filter((r) => !mappedSources.has(r.source) && !/\b(?:legally|eligible to work|sponsorship|on.site|hybrid|relocat|fluent in|benefit|salary|compensation|equal opportunity)\b/i.test(r.source));
  const reviewNote = unparsedWork.length ? String(unparsedWork.length) + (unparsedWork.length === 1 ? " qualification line needs" : " qualification lines need") + " manual review; not scored" : null;
  if (responsibilities.length) categories.push(category("experience_alignment", max("experience_alignment"), responsibilities, reviewNote));
  else if (!unmappable) categories.push(full("experience_alignment", max("experience_alignment"), "No responsibilities stated"));

  const family = familyFor(jd.title, cfg.role);
  const titles = resume.experience.map((e) => e.title).filter(Boolean);
  const headline = resume.contact.other.find((s) => /engineer|scientist|analyst|developer|manager/i.test(s)) || "";
  const roleParts = [
    { label: "Past position titles", max: cfg.role.title_points, credit: family && titles.some((t) => familyFor(t, cfg.role) === family) ? 1 : 0, evidence: titles.join("; ") },
    { label: "Resume headline", max: cfg.role.headline_points, credit: family && familyFor(headline, cfg.role) === family ? 1 : 0, evidence: headline || null },
    { label: "Role title words", max: cfg.role.words_points, credit: jd.title && titles.some((t) => t.toLowerCase().split(/\W+/).some((w) => w.length >= cfg.role.min_shared_word_length && phrase(jd.title, w))) ? 1 : 0, evidence: titles.join("; ") },
  ];
  categories.push(category("role_alignment", max("role_alignment"), roleParts.map((p) => ({
    label: p.label, classification: p.credit ? "met" : "missing", evidence: p.evidence || null, weight: p.max, credit: p.credit,
  }))));

  if (jd.preferred.length) categories.push(category("preferred_skills", max("preferred_skills"), skillRows(jd.preferred, resume, config)));
  const years = yearsExperience(resume.experience, asOf);
  const wanted = jd.years?.minimum;
  const actualLevel = Math.max(...titles.map((t) => levelFor(t, cfg.seniority)), 0);
  const wantedLevel = levelFor(jd.title, cfg.seniority);
  categories.push(wanted == null && wantedLevel <= cfg.seniority.levels.mid ? full("seniority", max("seniority"), "No seniority requirement stated") : category("seniority", max("seniority"), [
    { label: wanted == null ? "No years minimum stated" : `${wanted}+ years experience`, classification: wanted == null ? "no requirement stated" : years >= wanted ? "met" : "gap", evidence: `${years} non-overlapping years from parsed positions`, weight: cfg.seniority.years_points, credit: wanted == null ? 1 : Math.min(1, years / wanted) },
    { label: "Title level", classification: actualLevel >= wantedLevel ? "met" : "gap", evidence: titles.join("; ") || null, weight: cfg.seniority.title_points, credit: actualLevel >= wantedLevel ? 1 : 0 },
  ]));

  const levels = cfg.education.degree_levels;
  const degreeRows = [];
  if (jd.degree) {
    const actual = Math.max(...resume.education.map((e) => Object.keys(levels).filter((l) => phrase(e.degree, l)).map((l) => levels[l])).flat(), 0);
    const credit = actual >= levels[jd.degree.level] ? 1 : jd.degree.equivalent_experience && years >= (wanted || cfg.education.equivalent_experience_years_default) ? 1 : 0;
    degreeRows.push({ label: `${jd.degree.level} degree`, source: jd.degree.source, classification: credit ? "met" : "missing", evidence: resume.education.map((e) => e.degree).join("; ") || null, weight: cfg.education.degree_points, credit });
  } else degreeRows.push({ label: "No degree requirement stated", classification: "no requirement stated", weight: cfg.education.degree_points, credit: 1 });
  if (!jd.certifications.length) degreeRows.push({ label: "No certification requirement stated", classification: "no requirement stated", weight: cfg.education.certification_points, credit: 1 });
  for (const cert of jd.certifications) {
    const matched = [resume.summary, ...resume.skills.items, ...resume.education.map((e) => e.degree)].filter(Boolean).find((s) => phrase(s, cert.text));
    degreeRows.push({ label: cert.text, source: cert.source, classification: matched ? "met" : "missing", evidence: matched || null, weight: cfg.education.certification_points / jd.certifications.length, credit: matched ? 1 : 0 });
  }
  categories.push(category("education_certs", max("education_certs"), degreeRows, !jd.degree && !jd.certifications.length ? "No degree or certification requirement stated" : null));

  const bullets = resume.experience.flatMap((e) => e.bullets);
  const a = cfg.achievement;
  const measures = [
    { label: "Quantified accomplishments", weight: a.quantified_points, credit: bullets.length ? bullets.filter((b) => /\d/.test(b)).length / bullets.length : 0 },
    { label: "Action verbs", weight: a.action_verb_points, credit: bullets.length ? bullets.filter((b) => a.action_verbs.some((v) => phrase(b.split(/\s+/).slice(0, 2).join(" "), v))).length / bullets.length : 0 },
    { label: "Clear wording", weight: a.clear_wording_points, credit: bullets.length ? bullets.filter((b) => !a.weak_phrases.some((v) => phrase(b, v))).length / bullets.length : 0 },
  ];
  categories.push(category("achievement_evidence", max("achievement_evidence"), measures.map((m) => ({ label: m.label, classification: "measured", evidence: `${Math.round(m.credit * 100)}% of ${bullets.length} job bullets`, weight: m.weight, credit: m.credit }))));

  const domains = jd.domains.map((d) => {
    const ev = domainEvidence(config.domains[d.id], resume, config);
    return { label: d.label, source: d.source, classification: ev.kind, evidence: ev.evidence, credit: ev.credit };
  });
  categories.push(domains.length ? category("domain_terminology", max("domain_terminology"), domains) : full("domain_terminology", max("domain_terminology"), "No mapped domain terminology stated"));

  const earnedTicks = categories.reduce((n, c) => n + ticks(c.earned), 0);
  const maxTicks = categories.reduce((n, c) => n + ticks(c.max), 0);
  if (maxTicks !== 1000 || categories.some((c) => ticks(c.earned) + ticks(c.lost) !== ticks(c.max) || c.items.some((i) => ticks(i.earned) + ticks(i.lost) !== ticks(i.max)))) throw new Error("Job Match accounting mismatch");
  const recommendations = categories.flatMap((c) => c.items.map((i) => recommendation(i, c.key, bank)).filter(Boolean))
    .sort((a, b) => b.recoverable_points - a.recoverable_points || a.requirement.localeCompare(b.requirement)).slice(0, cfg.recommendations_limit);
  const count = (rows) => ({ matched: rows.filter((r) => r.classification !== "missing" && r.classification !== "related" && r.evidence_tier !== "missing").length, total: rows.length });
  return {
    version: cfg.version, config_hash: config.hash, as_of: asOf, score: points(earnedTicks), max: points(maxTicks),
    accounting: { earned: points(earnedTicks), lost: points(maxTicks - earnedTicks), max: points(maxTicks) },
    requirement_counts: { required: count(categories.find((c) => c.key === "required_skills")?.items || []), preferred: count(categories.find((c) => c.key === "preferred_skills")?.items || []) },
    categories, recommendations, potential_knockouts: jd.potential_knockouts,
    unparsed_requirements: jd.unparsed,
    coverage: { status: jd.unparsed.length || !jd.title || !(jd.required.length + jd.preferred.length) ? "incomplete" : "complete", scored_requirements: jd.required.length + jd.preferred.length, unparsed_requirements: jd.unparsed.length, missing_job_title: !jd.title, no_skill_requirements: !(jd.required.length + jd.preferred.length) },
    note: "Our deterministic comparison, not the score of any employer's ATS. Readiness is separate.",
  };
}
