// INVARIANT enforcement: every emitted resume word must trace to evidence or profile.

import { ROLE_META, PROJECT_META } from "./tailor-dynamic.mjs";

const PROFILE_ALLOWLIST = new Set([
  "atishay", "kasliwal", "katishay@gmail.com", "934-246-1198",
  "linkedin", "github", "portfolio", "new york", "ny",
  "stony brook", "symbiosis", "indore", "madhya pradesh",
  "master of science", "data science", "bachelor of technology",
  "computer science", "information technology", "education",
  "experience", "projects", "technical skills", "software engineer",
  "senior software engineer", "languages", "backend", "frontend",
  "cloud and delivery", "data and ai", "ai & machine learning", "data engineering",
  "databases", "search & vector", "cloud & devops", "backend frameworks",
  "software engineering",
  ...Object.values(ROLE_META).flatMap((m) => [
    m.title?.toLowerCase(),
    m.loc?.toLowerCase(),
    m.dates?.toLowerCase(),
  ].filter(Boolean)),
  ...Object.values(PROJECT_META).flatMap((m) => [m.dates?.toLowerCase()].filter(Boolean)),
  "atriveo", "insurance microservices platform", "wake forest", "cair",
  "winston-salem", "nc", "hyderabad", "tg", "accolite digital",
]);

function norm(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function acId(bullet) {
  return bullet.ac_id || bullet.ac?.id;
}

function bulletText(bullet) {
  return String(bullet.face?.text || bullet.text || "").trim();
}

function collectBullets(composition) {
  const bullets = [];
  for (const role of composition.experience || []) {
    for (const b of role.bullets || []) bullets.push(b);
  }
  for (const project of composition.projects || []) {
    for (const b of project.bullets || []) bullets.push(b);
  }
  return bullets;
}

function selectedAcIds(composition) {
  return [...new Set(collectBullets(composition).map(acId).filter(Boolean))];
}

function buildEvidenceCorpus(bank, composition) {
  const byId = new Map((bank?.acs || []).map((ac) => [ac.id, ac]));
  const corpus = new Set();
  const traces = [];

  for (const id of selectedAcIds(composition)) {
    const ac = byId.get(id);
    if (!ac) continue;
    if (ac.fact) corpus.add(norm(ac.fact));
    for (const variant of ac.variants || []) {
      if (variant.text) corpus.add(norm(variant.text));
    }
    for (const meta of Object.values(ac.facets || {})) {
      if (meta.phrase) corpus.add(norm(meta.phrase));
      for (const kw of meta.keywords || []) corpus.add(norm(kw));
    }
    traces.push({ ac_id: id, sources: ["fact", "variants", "facets"] });
  }

  for (const term of PROFILE_ALLOWLIST) corpus.add(norm(term));

  const coveredSkills = (composition.skills_audit || [])
    .filter((s) => s.covered)
    .map((s) => norm(s.skill));
  for (const skill of coveredSkills) corpus.add(skill);

  for (const line of composition.skills || []) {
    const body = line.split(":").slice(1).join(":").trim();
    for (const part of body.split(",")) corpus.add(norm(part));
  }

  return { corpus, traces, coveredSkills };
}

export function verifyInvariant(composition, bank) {
  const violations = [];
  const bullets = collectBullets(composition);
  const { corpus } = buildEvidenceCorpus(bank, composition);

  for (const bullet of bullets) {
    const id = acId(bullet);
    const text = bulletText(bullet);
    const normalized = norm(text);
    if (!normalized) continue;

    const ac = (bank?.acs || []).find((a) => a.id === id);
    const variantMatch = (ac?.variants || []).some((v) => norm(v.text) === normalized);
    if (!variantMatch) {
      violations.push({
        type: "bullet_not_exact_variant",
        ac_id: id,
        text: text.slice(0, 120),
        message: "Bullet text is not an exact pre-authored AC variant.",
      });
    }
  }

  // Skills on the PDF must trace to evidence. Omitted JD-relevant skills are OK when
  // single-line layout drops them (max 5 categories, no wrap).
  for (const line of composition.skills || []) {
    const body = line.split(":").slice(1).join(":").trim();
    for (const raw of body.split(",")) {
      const skill = norm(raw);
      if (!skill) continue;
      const covered = (composition.skills_audit || []).some((r) =>
        r.covered && norm(r.skill) === skill,
      );
      if (!covered) {
        violations.push({
          type: "untraceable_skill",
          skill: raw.trim(),
          message: "Skill in PDF has no evidence trace.",
        });
      }
    }
  }

  return {
    passes: violations.length === 0,
    violations,
    selected_acs: selectedAcIds(composition),
    corpus_size: corpus.size,
  };
}
