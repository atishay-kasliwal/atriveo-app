import test from "node:test";
import assert from "node:assert/strict";
import { config, CLEAN_LAYOUT, extraction } from "./helpers.mjs";
import { withHash } from "../../scripts/ats/config.mjs";
import { parseResume } from "../../scripts/ats/resume-parse.mjs";
import { parseJobDescription } from "../../scripts/ats/jd-parse.mjs";
import { skillEvidence } from "../../scripts/ats/evidence.mjs";
import { scoreJobMatch } from "../../scripts/ats/match.mjs";
import { scoreAts } from "../../scripts/ats/score.mjs";
import { assessReadiness } from "../../scripts/ats/readiness.mjs";
import { formatMatch } from "../../scripts/ats/match-cli.mjs";
import { diffScores } from "../../scripts/ats/diff-cli.mjs";

const resume = parseResume(CLEAN_LAYOUT, config.sections);
const jdText = `Backend Engineer
About us
We are a payments startup using Scala.
Responsibilities:
- Build Python APIs and deploy scalable services to production.
- Improve observability and on-call reliability.
Requirements:
- Strong Go/Rust/TypeScript experience.
- PostgreSQL and Kafka experience required.
- 4+ years of relevant experience.
- Bachelor's degree in computer science or equivalent experience.
Preferred Qualifications:
- Swift is a plus.
- Kubernetes or Docker experience.
Benefits:
Our office uses React but it is not part of this job.
`;
const jd = parseJobDescription(jdText, config);
const score = (r = resume, j = jd, c = config) => scoreJobMatch(r, j, c, { asOf: "2026-10-01" });

test("JD sections keep required and preferred separate; about/benefits never enter scoring", () => {
  assert.deepEqual(jd.required.map((r) => r.label), ["Go / Rust / TypeScript", "PostgreSQL", "Kafka"]);
  assert.deepEqual(jd.preferred.map((r) => r.label), ["Swift", "Kubernetes / Docker"]);
  assert.equal(jd.years.minimum, 4);
  assert.equal(jd.degree.level, "bachelor");
  assert.ok(!JSON.stringify(jd).includes("Scala"));
  assert.ok(!JSON.stringify(jd).includes("React"));
});

test("an unfamiliar named technology remains a scored requirement", () => {
  const unknown = parseJobDescription("Data Engineer\nRequirements:\n- Experience with Databricks and Cassandra.", config);
  assert.deepEqual(unknown.required.map((r) => r.label), ["Databricks", "Cassandra"]);
  const m = score(resume, unknown);
  assert.equal(m.requirement_counts.required.total, 2);
  assert.equal(m.requirement_counts.required.matched, 0);
});

test("comma lists ending in or count as one any-of requirement", () => {
  const posting = parseJobDescription("Backend Engineer\nRequired Skills and Experience:\n- Proficiency in Go, Python, Java, or similar languages.\n- PostgreSQL and Kafka.", config);
  assert.deepEqual(posting.required.map((r) => r.label), ["Go / Python / Java", "PostgreSQL", "Kafka"]);
});

test("Markdown headings stop salary and EEO prose from becoming qualifications", () => {
  const posting = parseJobDescription(`**Description**
The company is growing.
**Basic Qualifications**
* 5\+ years of data scientist experience
* Experience with Python and Databricks.
**Preferred Qualifications**
* Knowledge of machine learning.
Amazon is an equal opportunity employer.
Our inclusive culture empowers Amazonians.
The base salary range includes RSUs and benefits.
`, config);
  assert.equal(posting.years.minimum, 5);
  assert.deepEqual(posting.required.map((x) => x.label), ["Python", "Databricks"]);
  assert.deepEqual(posting.preferred.map((x) => x.label), ["Machine learning"]);
  assert.ok(!JSON.stringify(posting).includes("Amazonians"));
});

test("unusual role and qualification headings are recognized; inline bonus does not switch sections", () => {
  const posting = parseJobDescription("About the Team\nIn This Role, You Will:\n- Build APIs.\nYou Might Thrive In This Role If You\n- Have experience with Go or Rust.\n- Have built products (bonus for startup experience).\n- Proficient in Python.", config);
  assert.deepEqual(posting.required.map((x) => x.label), ["Go / Rust", "Python"]);
  assert.equal(posting.responsibilities.length, 1);
});

test("a requirement on the same line as its heading is retained", () => {
  const posting = parseJobDescription("Backend Engineer\nRequirements: Experience with Python and Kafka.", config);
  assert.deepEqual(posting.required.map((x) => x.label), ["Python", "Kafka"]);
  const headingFirst = parseJobDescription("Requirements:\n- Experience with Go.", config);
  assert.deepEqual(headingFirst.required.map((x) => x.label), ["Go"]);
});

test("ordinary lowercase go is not Go language evidence", () => {
  const posting = parseJobDescription("Software Engineer\nRequirements:\n- Ability to go beyond standard approaches.\n- Experience with Go.", config);
  assert.deepEqual(posting.required.map((x) => x.label), ["Go"]);
  const lower = parseResume(CLEAN_LAYOUT.replaceAll("Go", "Elixir").replace("Built Python services", "Built services that go beyond Python"), config.sections);
  assert.equal(skillEvidence(["Go"], lower, config).kind, "missing");
});

test("any-of requirement earns credit from one alternative and retains its source", () => {
  const item = score().categories.find((c) => c.key === "required_skills").items[0];
  assert.equal(item.label, "Go / Rust / TypeScript");
  assert.equal(item.matched_skill, "Go");
  assert.equal(item.classification, "exact");
  assert.match(item.evidence, /ledger in Go/);
  assert.equal(item.evidence_tier, "project_bullet");
});

test("evidence credit order and equivalent vs related are explicit", () => {
  const measured = skillEvidence(["Python"], resume, config);
  const project = skillEvidence(["Go"], resume, config);
  const skillsOnly = skillEvidence(["TypeScript"], resume, config);
  const equivalent = skillEvidence(["PostgreSQL"], parseResume(CLEAN_LAYOUT.replaceAll("PostgreSQL", "Postgres"), config.sections), config);
  const related = skillEvidence(["Generative AI"], parseResume(CLEAN_LAYOUT.replace("Built Python", "Built LLM Python"), config.sections), config);
  assert.equal(measured.credit, 1);
  assert.equal(project.credit, .75);
  assert.equal(skillsOnly.credit, .5);
  assert.equal(equivalent.kind, "equivalent");
  assert.equal(equivalent.credit, .95);
  assert.equal(related.kind, "related");
  assert.equal(related.credit, .5);
});

test("repeated skill mentions do not increase its points and a warning records saturation", () => {
  const many = structuredClone(resume);
  many.experience[0].bullets.push(...Array.from({ length: 8 }, (_, i) => `Built Python service ${i} for 10K users.`));
  const one = skillEvidence(["Python"], resume, config);
  const repeated = skillEvidence(["Python"], many, config);
  assert.equal(repeated.credit, one.credit);
  assert.equal(repeated.supporting.length, config.scoring.job_match.stuffing.max_distinct_bullets);
  assert.equal(repeated.stuffing_warning, true);
});

test("optional stuffing penalty comes from config and is off by default", () => {
  const many = structuredClone(resume);
  many.experience[0].bullets.push(...Array.from({ length: 8 }, (_, i) => `Built Python service ${i} for 10K users.`));
  const posting = parseJobDescription("Python Engineer\nRequirements:\n- Python required.", config);
  const defaultScore = score(many, posting);
  const edited = structuredClone(config);
  edited.scoring.job_match.stuffing.penalty = 2;
  const penalized = score(many, posting, withHash(edited));
  assert.equal(Math.round((defaultScore.score - penalized.score) * 10) / 10, 2);
});

test("points and losses add up exactly at item, category and total level", () => {
  const m = score();
  assert.equal(m.categories.reduce((n, c) => n + Math.round(c.max * 10), 0), 1000);
  assert.equal(m.categories.reduce((n, c) => n + Math.round(c.earned * 10), 0), Math.round(m.score * 10));
  for (const c of m.categories) {
    assert.equal(Math.round((c.earned + c.lost) * 10), Math.round(c.max * 10));
    for (const i of c.items) assert.equal(Math.round((i.earned + i.lost) * 10), Math.round(i.max * 10));
  }
  assert.deepEqual(m.requirement_counts.required, { matched: 3, total: 3 });
});

test("no JD yields readiness only through the CLI formatter; scores remain separate", () => {
  const readiness = assessReadiness(extraction(CLEAN_LAYOUT), config);
  assert.equal(readiness.status, "PASS");
  const result = scoreAts(readiness, "", config);
  assert.equal(result.job_match, null);
  assert.match(formatMatch(result), /No JD supplied/);
  assert.ok(score().score < readiness.parseability);
});

test("a JD with no recognizable requirements is unscorable, not near-perfect", () => {
  const readiness = assessReadiness(extraction(CLEAN_LAYOUT), config);
  const result = scoreAts(readiness, "We are a great company and you will love our team.", config);
  assert.equal(result.job_match, null);
  assert.match(formatMatch(result), /needs manual review/);
});

test("missing job title makes role alignment coverage incomplete", () => {
  const readiness = assessReadiness(extraction(CLEAN_LAYOUT), config);
  const result = scoreAts(readiness, "We are hiring.\nRequirements:\n- Python experience required.", config, { asOf: "2026-10-01" });
  assert.equal(result.job_match.coverage.missing_job_title, true);
  assert.match(formatMatch(result), /no job title was supplied/);
});

test("a supplied job title overrides a short marketing opener", () => {
  const readiness = assessReadiness(extraction(CLEAN_LAYOUT), config);
  const result = scoreAts(readiness, "Join our team\nRequirements:\n- Python experience required.", config, { asOf: "2026-10-01", title: "Backend Engineer" });
  assert.equal(result.jd.title, "Backend Engineer");
  assert.equal(result.job_match.coverage.missing_job_title, false);
});

test("nothing stated for degree/seniority earns their points; absent skill groups redistribute", () => {
  const sparse = parseJobDescription("Software Engineer\nResponsibilities:\n- Build Python APIs.", config);
  const m = score(resume, sparse);
  assert.equal(m.categories.find((c) => c.key === "seniority").earned, m.categories.find((c) => c.key === "seniority").max);
  assert.equal(m.categories.find((c) => c.key === "education_certs").earned, m.categories.find((c) => c.key === "education_certs").max);
  assert.equal(m.categories.some((c) => c.key === "required_skills"), false);
  assert.equal(m.coverage.no_skill_requirements, true);
  assert.equal(m.categories.reduce((n, c) => n + Math.round(c.max * 10), 0), 1000);
});

test("unparsed responsibility prose cannot earn full experience points", () => {
  const vague = parseJobDescription("Software Engineer\nRequirements:\n- Demonstrated ability to handle ambiguous stakeholder needs.", config);
  const m = score(resume, vague);
  const experience = m.categories.find((c) => c.key === "experience_alignment");
  assert.equal(experience.earned, 0);
  assert.match(experience.note, /manual review/);
  assert.equal(m.coverage.status, "incomplete");
});

test("as-of date fixes present-tenure duration and different configs change hash", () => {
  const later = scoreJobMatch(resume, jd, config, { asOf: "2028-10-01" });
  const now = score();
  assert.notEqual(later.categories.find((c) => c.key === "seniority").items[0].evidence, now.categories.find((c) => c.key === "seniority").items[0].evidence);
  const copy = structuredClone(config);
  copy.scoring.job_match.match_kinds.related = .4;
  const edited = score(resume, jd, withHash(copy));
  assert.notEqual(edited.config_hash, now.config_hash);
});

test("deterministic under shuffled configuration keys and ats:diff explains score movement", () => {
  const reverse = (x) => Array.isArray(x) ? x.map(reverse) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).reverse().map(([k, v]) => [k, reverse(v)])) : x;
  const shuffled = withHash(reverse(config));
  assert.equal(shuffled.hash, config.hash);
  assert.deepEqual(score(resume, jd, shuffled), score());
  const weaker = structuredClone(resume);
  weaker.projects[0].bullets = weaker.projects[0].bullets.map((b) => b.replaceAll("Go", "Elixir"));
  weaker.skills.items = weaker.skills.items.filter((s) => s !== "Go" && s !== "TypeScript");
  const diff = diffScores(score(weaker), score());
  assert.ok(diff.delta >= 0);
  assert.equal(diff.changed_config, false);
  assert.ok(diff.changes.length);
});
