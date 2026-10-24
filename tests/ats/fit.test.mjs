import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config, configWith, CLEAN_LAYOUT } from "./helpers.mjs";
import { loadCandidate } from "../../scripts/ats/config.mjs";
import { parseResume } from "../../scripts/ats/resume-parse.mjs";
import { skillEvidence } from "../../scripts/ats/evidence.mjs";
import { scoreFit } from "../../scripts/ats/fit.mjs";
import { buildMaster } from "../../scripts/ats/master.mjs";
import { resumeReady } from "../../scripts/ats/ready.mjs";

const jdText = `Backend Engineer
Requirements:
- Strong Java, Spring Boot and React experience.
- 3+ years of relevant experience.
- Bachelor's degree in computer science.
- Experience with Agile delivery and Kubernetes.
Preferred Qualifications:
- Go is a plus.
`;
const fit = (text = jdText, opts = {}) => scoreFit(text, { title: "Backend Engineer", asOf: "2026-10-23", ...opts });
const master = buildMaster();

test("Fit is deterministic: same bank and posting, byte-identical result", () => {
  assert.equal(JSON.stringify(fit()), JSON.stringify(fit()));
});

test("Fit is normalized: applicable categories sum to 100 and every point is accounted for", () => {
  const r = fit();
  assert.equal(r.accounting.max, 100);
  assert.equal(Math.round((r.accounting.earned + r.accounting.lost) * 10), 1000);
  assert.equal(Math.round(r.categories.reduce((n, c) => n + c.max, 0) * 10), 1000);
  for (const c of r.categories) {
    assert.equal(Math.round((c.earned + c.lost) * 10), Math.round(c.max * 10), c.key);
    for (const i of c.items) assert.equal(Math.round((i.earned + i.lost) * 10), Math.round(i.max * 10), i.label);
  }
});

test("an unstated requirement is not applicable, never free points", () => {
  const r = fit();
  assert.deepEqual(r.not_applicable.map((n) => n.key).sort(), ["achievement_evidence", "domain_terminology"]);
  assert.ok(!r.categories.some((c) => ["achievement_evidence", "domain_terminology"].includes(c.key)));
  assert.ok(!r.categories.flatMap((c) => c.items).some((i) => i.classification === "no requirement stated"));
  // A posting with no degree, years, domain or level states less to score: those categories vanish and the rest is renormalized.
  const thin = fit("Backend Engineer\nRequirements:\n- Python and Kubernetes experience.\n");
  assert.ok(["education_certs", "seniority", "domain_terminology"].every((k) => thin.not_applicable.some((n) => n.key === k)));
  assert.equal(thin.categories.reduce((n, c) => n + c.max, 0), 100);
});

test("every lost point traces to the posting: skill, responsibility and degree rows name their source line", () => {
  const r = fit();
  for (const c of r.categories.filter((c) => ["required_skills", "preferred_skills", "education_certs"].includes(c.key))) {
    for (const i of c.items.filter((i) => i.lost > 0)) assert.ok(i.source, `${c.key}: ${i.label} has no source line`);
  }
});

test("one ledger: required plus preferred is the total and the missing list is what the scored rows say", () => {
  const r = fit();
  const { ledger } = r;
  assert.equal(ledger.total.total, ledger.required.total + ledger.preferred.total);
  assert.equal(ledger.total.matched, ledger.matched.length);
  assert.equal(ledger.total.total, ledger.matched.length + ledger.partial.length + ledger.missing.length);
  const rows = r.categories.find((c) => c.key === "required_skills").items;
  assert.equal(ledger.required.total, rows.length);
  assert.deepEqual(ledger.missing.filter((l) => rows.some((i) => i.label === l && i.lost > 0)), ledger.missing.filter((l) => ledger.skills.find((s) => s.label === l).class === "required"));
});

test("a skill counts only with evidence: Kubernetes is in a bullet, Rust is not", () => {
  const r = fit(jdText.replace("Go is a plus.", "Go is a plus.\n- Rust experience."));
  assert.ok(r.ledger.matched.includes("Java"));
  assert.ok(r.ledger.matched.includes("Kubernetes"));
  assert.ok(r.ledger.missing.includes("Rust"));
});

test("every job gets a Fit: a blank or unreadable posting still scores, flagged Low Confidence", () => {
  const blank = scoreFit("", { title: "Data Analyst", asOf: "2026-10-23" });
  assert.equal(typeof blank.score, "number");
  assert.equal(blank.confidence.level, "low");
  const unreadable = scoreFit("Great place to work. Apply today!", { title: "Backend Engineer", asOf: "2026-10-23" });
  assert.equal(typeof unreadable.score, "number");
  assert.equal(unreadable.confidence.level, "low");
});

test("words the parser cannot place are listed, never scored as missing skills", () => {
  const r = fit("Backend Engineer\nRequirements:\n- Experience with Retail, Government and Money Laundering.\n- Python experience.\n");
  assert.ok(!r.ledger.missing.includes("Retail"));
  assert.ok(r.ledger.matched.includes("Python"));
});

test("role alignment follows the families your bank supports, so a data analyst role is not marked as a mismatch", () => {
  assert.ok(master.families.includes("data"));
  const r = fit("Data Analyst\nRequirements:\n- SQL and Python experience.\n");
  const row = r.categories.find((c) => c.key === "role_alignment").items.find((i) => i.label === "Past position titles");
  assert.equal(row.lost, 0);
  const rn = fit("Registered Nurse\nRequirements:\n- Python experience.\n", { title: "Registered Nurse" });
  assert.ok(rn.categories.find((c) => c.key === "role_alignment").items.find((i) => i.label === "Past position titles").lost > 0);
});

test("the bank's keyword lists are not evidence", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bank-"));
  fs.writeFileSync(path.join(dir, "ROLE-ATS-TECH.yaml"), "acme:\n  - Rust\n");
  fs.writeFileSync(path.join(dir, "ACME.yaml"), "role:\n  id: acme\n  employer: Acme\n  title: Software Engineer\n  dates: January 2022 -- January 2023\n  slot_kind: experience\n");
  fs.writeFileSync(path.join(dir, "AC-900.yaml"), "id: AC-900\nrole: acme\nats_keywords: [Rust, Haskell]\nsignature_technologies: [Rust]\nfacets:\n  default:\n    keywords: [rust]\nfact: Built payment services in Go.\nvariants:\n  - text: Built payment services in Go that cut latency by 30%.\n");
  const m = buildMaster(dir);
  assert.equal(skillEvidence(["Rust"], m, config).kind, "missing");
  assert.equal(skillEvidence(["Haskell"], m, config).kind, "missing");
  assert.notEqual(skillEvidence(["Go"], m, config).kind, "missing");
  assert.equal(m.experience[0].stack, "", "a verified anchor absent from every bullet does not enter the stack");
});

test("Fit cannot reach a tailored resume: no imports of resume, readiness, persistence or Resume Ready", () => {
  for (const f of ["fit", "master", "knockouts", "match", "evidence", "jd-parse"]) {
    const src = fs.readFileSync(new URL(`../../scripts/ats/${f}.mjs`, import.meta.url), "utf8");
    assert.ok(!/from "\.\/(?:resume-parse|readiness|ready|persist|extract|cli)\.mjs"|job-matching-analysis|ats-score\.json/.test(src), `${f}.mjs reads tailoring output`);
  }
  assert.ok(!/headline/i.test(JSON.stringify(master.contact)), "the master has no headline");
  assert.deepEqual(master.contact.other, []);
});

test("Resume Ready never moves Fit", () => {
  const before = fit();
  const tailored = parseResume(CLEAN_LAYOUT, config.sections);
  resumeReady({ readiness: { status: "PASS", parseability: 100 }, tailored, ledger: before.ledger, config });
  assert.equal(JSON.stringify(fit()), JSON.stringify(before));
});

test("Resume Ready is a status: Ready, Review or Needs Work", () => {
  const ledger = { skills: [{ class: "required", status: "matched", label: "Python", alternatives: ["Python"] }, { class: "required", status: "matched", label: "Rust", alternatives: ["Rust"] }] };
  const tailored = parseResume(CLEAN_LAYOUT, config.sections);
  const base = { tailored, config, ledger };
  assert.equal(resumeReady({ ...base, readiness: { status: "PASS" }, ledger: { skills: [ledger.skills[0]] } }).status, "Ready");
  assert.equal(resumeReady({ ...base, readiness: { status: "WARN", parseability: 80 }, ledger: { skills: [ledger.skills[0]] } }).status, "Review");
  assert.equal(resumeReady({ ...base, readiness: { status: "PASS" } }).status, "Needs Work", "half of the skills you have are left off");
  assert.equal(resumeReady({ ...base, readiness: { status: "FAIL", critical: ["No text"] }, ledger: { skills: [] } }).status, "Needs Work");
  assert.equal(resumeReady({ ...base, readiness: { status: "PASS" }, pages: 2, ledger: { skills: [] } }).status, "Needs Work");
});

test("certifications we were not told about stay unknown and are not scored", () => {
  const r = fit("Cloud Engineer\nRequirements:\n- AWS Certified Solutions Architect required.\n- Python experience.\n");
  assert.ok(r.unknown_requirements.some((u) => u.type === "certification"));
  assert.ok(!r.categories.some((c) => c.key === "education_certs"));
  const known = fit("Cloud Engineer\nRequirements:\n- AWS Certified Solutions Architect required.\n- Python experience.\n", { candidate: { ...loadCandidate(), certifications: [] } });
  assert.ok(known.categories.some((c) => c.key === "education_certs"), "once you confirm you hold none, it is a real gap");
});

test("knockouts: unknown stays unknown, authorization is read from candidate.yaml, nothing is rejected", () => {
  const text = "Backend Engineer\nRequirements:\n- Python and Java experience.\n- Active security clearance required.\n- U.S. citizenship required.\n- We will not provide visa sponsorship.\n- Hybrid in Austin, TX.\n";
  const r = fit(text);
  const by = Object.fromEntries(r.knockouts.items.map((i) => [i.type, i.status]));
  assert.equal(by.clearance, "unknown");
  assert.equal(by.citizenship, "unknown");
  assert.equal(by.sponsorship, "clear");
  assert.equal(by.location, "clear");
  assert.equal(r.knockouts.auto_reject, false);
  assert.equal(r.knockouts.verdict, "unknown");
  const citizen = fit(text, { candidate: { ...loadCandidate(), us_citizen: true } });
  assert.equal(citizen.knockouts.items.find((i) => i.type === "citizenship").status, "clear");
  assert.equal(citizen.score, r.score, "an unknown never moves Fit");
});

test("knockouts: substantially higher seniority, a mandatory degree we lack, and extremely weak overlap", () => {
  const seniority = fit("Principal Engineer\nRequirements:\n- 12+ years of experience.\n- Python.\n");
  assert.equal(seniority.knockouts.items.find((i) => i.type === "seniority").status, "blocked");
  const degree = fit("Research Scientist\nRequirements:\n- PhD in computer science required.\n- Python.\n");
  assert.equal(degree.knockouts.items.find((i) => i.type === "degree").status, "blocked");
  const weak = fit("Systems Engineer\nRequirements:\n- Rust experience.\n- Scala experience.\n- Ruby experience.\n- Swift experience.\n");
  assert.equal(weak.knockouts.items.find((i) => i.type === "weak_overlap")?.status, "blocked");
  const ok = fit();
  assert.ok(!ok.knockouts.items.some((i) => i.status === "blocked"));
});

test("Low Confidence is separate: a thin posting is flagged and its Fit still equals what the points say", () => {
  const thin = fit("Backend Engineer\nRequirements:\n- Python.\n");
  assert.equal(thin.confidence.level, "low");
  assert.equal(thin.score, thin.accounting.earned);
  const stricter = fit("Backend Engineer\nRequirements:\n- Python.\n", { config: configWith((c) => { c.scoring.fit.confidence.low_below_scored_requirements = 99; c.scoring.job_match.stuffing.warning_repetitions = 1e9; }) });
  assert.equal(stricter.score, thin.score, "confidence thresholds never change the Fit number");
  assert.equal(fit().confidence.level, "high");
});

test("the candidate settings are read from data/ats/candidate.yaml", () => {
  const c = loadCandidate();
  assert.equal(c.work_authorization.status, "f1_opt");
  assert.equal(c.relocation, true);
  assert.equal(c.us_citizen, "unknown");
  assert.equal(c.security_clearance, "unknown");
  assert.equal(c.certifications, "unknown");
});

test("depth: a skill in one bullet earns less than the same skill across four, and only in Fit", () => {
  const entry = (bullets) => ({ experience: [{ company: "Acme", title: "Engineer", bullets, stack: "" }], projects: [], skills: { items: [] }, education: [], contact: { other: [] } });
  const one = entry(["Built Kafka pipelines that cut latency by 30%."]);
  const four = entry(["Built Kafka pipelines that cut latency by 30%.", "Ran Kafka consumers for 12 services.", "Tuned Kafka retention for cost.", "Moved batch jobs to Kafka streams."]);
  const fitConfig = configWith((c) => { c.scoring.job_match.depth = { base: 0.7, full_at_bullets: 4 }; });
  const a = skillEvidence(["Kafka"], one, fitConfig), b = skillEvidence(["Kafka"], four, fitConfig);
  assert.equal(a.distinct_bullets, 1);
  assert.equal(b.distinct_bullets, 4);
  assert.ok(Math.abs(a.credit / b.credit - 0.7) < 1e-9);
  assert.equal(skillEvidence(["Kafka"], one, config).credit, skillEvidence(["Kafka"], four, config).credit, "the old tailored score has no depth");
});

test("depth counts facts, not rewordings: the master merges a fact's wordings into one bullet", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bank-"));
  fs.writeFileSync(path.join(dir, "ROLE-ATS-TECH.yaml"), "{}\n");
  fs.writeFileSync(path.join(dir, "ACME.yaml"), "role:\n  id: acme\n  employer: Acme\n  title: Software Engineer\n  dates: January 2022 -- January 2023\n  slot_kind: experience\n");
  fs.writeFileSync(path.join(dir, "AC-901.yaml"), "id: AC-901\nrole: acme\nfact: Ran Kafka consumers.\nvariants:\n  - text: Ran Kafka consumers for 12 services.\n  - text: Operated Kafka consumers at scale.\n");
  const m = buildMaster(dir);
  assert.equal(m.experience[0].bullets.length, 1);
  assert.equal(skillEvidence(["Kafka"], m, configWith((c) => { c.scoring.job_match.depth = { base: 0.7, full_at_bullets: 4 }; })).distinct_bullets, 1);
});

// Fit audit, Oct 23: real postings showed good jobs marked "blocked" by the parser. Each case below is a posting wording.
const verdictOf = (body, title = "Software Engineer") => fit(`${title}\nRequirements:\n${body}\n- Python experience.\n`, { title }).knockouts.items.filter((i) => i.status === "blocked").map((i) => i.type);

test("degree: a choice of levels asks for the lowest; an alternative to years is not a requirement; preferred lines do not raise it", () => {
  assert.deepEqual(verdictOf("- A Bachelor's, Master's, or PhD degree in computer science."), []);
  assert.deepEqual(verdictOf("- Advanced degree (Master's or PhD) in Statistics.", "Data Scientist"), []);
  assert.deepEqual(verdictOf("- PhD or equivalent research experience.", "Applied Scientist"), []);
  assert.deepEqual(verdictOf("- 8+ years of programming experience OR 4+ years experience with a PhD."), []);
  assert.deepEqual(verdictOf("- Bachelor's degree required.\nPreferred:\n- Advanced degree (Masters or PhD).", "Data Scientist"), []);
  assert.deepEqual(verdictOf("- Master's degree required.", "Data Scientist"), [], "you hold a Master's");
  assert.deepEqual(verdictOf("- PhD in computer science required.", "Research Scientist"), ["degree"]);
  assert.deepEqual(verdictOf("- PhD and 3+ years of experience.", "Scientist"), ["degree"]);
});

test("years: a range asks for its low end; an either/or asks for the smaller; a preferred ask is not a requirement", () => {
  const years = (body) => fit(`Software Engineer\nRequirements:\n${body}\n- Python experience.\n`).categories.find((c) => c.key === "seniority")?.items[0]?.label;
  assert.equal(years("- 2-8 years of experience."), "2+ years experience");
  assert.equal(years("- 3 to 8 years in software testing."), "3+ years experience");
  assert.equal(years("- 5+ years of experience or 3+ years with a Master's."), "3+ years experience");
  assert.deepEqual(verdictOf("- 2-8 years of experience."), [], "2-8 years is not an 8-year requirement");
  assert.deepEqual(verdictOf("- 8+ years of experience."), ["seniority"]);
  const preferred = fit("Software Engineer\nRequirements:\n- Python experience.\nPreferred Qualifications:\n- 10+ years of experience.\n");
  assert.ok(!preferred.knockouts.items.some((i) => i.type === "seniority"));
});

test("sponsorship: the usual wordings are read; offers are clear; a heading alone is nothing", () => {
  const sponsor = (line) => fit(`Software Engineer\nRequirements:\n- Python experience.\n- ${line}\n`).knockouts.items.find((i) => i.type === "sponsorship")?.status ?? "none";
  assert.equal(sponsor("Authorized to work in the US without current or future visa sponsorship"), "unknown", "rules out future sponsorship; after OPT is unknown");
  assert.equal(sponsor("Applicants requiring employer sponsorship of a visa will not be considered for this position."), "clear");
  assert.equal(sponsor("We are unable to sponsor visas."), "clear");
  assert.equal(sponsor("Visa sponsorship available"), "clear");
  assert.equal(sponsor("Sponsorship:"), "none");
  assert.equal(sponsor("Immigration sponsorship (e.g., H-1B) is not available for this position."), "clear");
  const itar = fit("Software Engineer\nRequirements:\n- Python experience.\n- Must be a U.S. person under ITAR.\n").knockouts.items.find((i) => i.type === "citizenship");
  assert.equal(itar?.status, "unknown");
});

test("approved skills are yours to add: with none listed a skill needs a bullet; listed ones count as the weakest evidence", () => {
  const skill = (m) => skillEvidence(["Swift"], m, config);
  assert.equal(skill(master).kind, "missing");
  const withApproved = { ...master, skills: { groups: [], items: ["Swift"] } };
  const e = skill(withApproved);
  assert.equal(e.tier, "skills_only");
  assert.ok(e.credit > 0 && e.credit <= 0.5 + 1e-9);
});

test("skills the dictionary learned from the audit are scored now (Git, Agile, MLOps, Databricks, .NET, MCP)", () => {
  const r = fit("Platform Engineer\nRequirements:\n- Git, Agile, MLOps, Databricks, .NET and MCP experience.\n", { title: "Platform Engineer" });
  assert.deepEqual(r.ledger.skills.map((s) => s.label).sort(), [".NET", "Agile", "Databricks", "Git", "MCP", "MLOps"]);
  assert.deepEqual(r.ledger.unrecognized, []);
});

import { dateStyle } from "../../scripts/ats/ready.mjs";

test("Resume Ready: dates in mixed styles ask for a review; one style, even with abbreviated and full month names, is fine", () => {
  assert.equal(dateStyle("Aug. 2024"), dateStyle("November 2024"), "abbreviated and full month names are the same style");
  assert.equal(dateStyle("Present"), null);
  assert.notEqual(dateStyle("Aug 2024"), dateStyle("08/2024"));
  const tailored = (a, b) => ({ contact: { other: [] }, experience: [{ dates: { text: a, start: {} } }, { dates: { text: b, start: {} } }], projects: [], education: [] });
  const ok = resumeReady({ readiness: { status: "PASS" }, tailored: tailored("Aug. 2024 – May 2026", "November 2021 – Present"), ledger: { skills: [] }, config });
  assert.equal(ok.status, "Ready");
  const mixed = resumeReady({ readiness: { status: "PASS" }, tailored: tailored("Aug 2024 – May 2026", "08/2021 – 06/2023"), ledger: { skills: [] }, config });
  assert.equal(mixed.status, "Review");
  assert.match(mixed.reasons.join(" "), /different styles/);
});

test("Resume Ready: a posting title that shares no words with your headline is a note, never a status change", () => {
  const tailored = { contact: { other: ["Full Stack Engineer"] }, experience: [], projects: [], education: [] };
  const none = resumeReady({ readiness: { status: "PASS" }, tailored, ledger: { skills: [] }, config, jobTitle: "Registered Nurse" });
  assert.equal(none.status, "Ready");
  assert.equal(none.notes.length, 1);
  const some = resumeReady({ readiness: { status: "PASS" }, tailored, ledger: { skills: [] }, config, jobTitle: "Senior Full Stack Developer" });
  assert.deepEqual(some.notes, []);
});
