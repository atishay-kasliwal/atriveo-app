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

test("a skill counts only with evidence: Kubernetes is in a bullet, Agile is not", () => {
  const r = fit();
  assert.ok(r.ledger.matched.includes("Java"));
  assert.ok(r.ledger.matched.includes("Kubernetes"));
  assert.ok(r.ledger.missing.includes("Agile"));
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
