import test from "node:test";
import assert from "node:assert/strict";
import { loadSkillEvidence, eligibleSkillEvidence, usableSkillEvidence, openOnlySkillKeys, skillEvidenceSources, skillEvidenceKey } from "../../scripts/skill-evidence.mjs";
import { loadTracks, confirmedSkillKeys } from "../../scripts/ac-tracks.mjs";
import { buildSkillsEvidenceAudit, buildSkillsFromComposition } from "../../scripts/ac-skills.mjs";
import { loadSafeClaims } from "../../scripts/tailor-bank.mjs";
import { SKILLS_LIBRARY } from "../../scripts/skills-library.mjs";

const empty = { experience: [], projects: [] };
const jd = "Go Rust Tokio Serde gRPC Prometheus Kubernetes GraphSAGE Kustomize Apache Pulsar Ansible";

test("approved merged evidence is eligible, incomplete or mixed-status evidence fails closed", () => {
  const record = { approved: true, resume_eligible: true, status: "MERGED", skills: ["Rust"], sources: [{ url: "https://github.com/mezmo/aura/pull/904", status: "MERGED" }] };
  assert.equal(eligibleSkillEvidence(record), true);
  for (const change of [
    { approved: false }, { resume_eligible: false }, { status: "OPEN" },
    { sources: [] }, { sources: [null] },
    { sources: [...record.sources, { url: "https://github.com/mezmo/aura/pull/911", status: "OPEN" }] },
    { sources: [{ url: "https://github.com/mezmo/aura", status: "MERGED" }] },
  ]) assert.equal(eligibleSkillEvidence({ ...record, ...change }), false);
});

// Policy 2026-11-16 (QUESTION_ANSWERS "Open Source Work on Resumes"): open PRs are usable at lower priority.
test("open evidence is usable but not merged; closed or unapproved evidence never is", () => {
  const open = { approved: true, resume_eligible: true, status: "OPEN", skills: ["Kustomize"], sources: [{ url: "https://github.com/NVIDIA/nodewright/pull/1047", status: "OPEN" }] };
  assert.equal(usableSkillEvidence(open), true);
  assert.equal(eligibleSkillEvidence(open), false);
  for (const change of [
    { status: "CLOSED" }, { approved: false }, { resume_eligible: false },
    { sources: [{ url: "https://github.com/NVIDIA/nodewright/pull/1047", status: "CLOSED" }] },
    { sources: [{ url: "https://github.com/NVIDIA/nodewright", status: "OPEN" }] },
  ]) assert.equal(usableSkillEvidence({ ...open, ...change }), false);
  const keys = openOnlySkillKeys([open]);
  assert.ok(keys.has("kustomize"));
  assert.equal(skillEvidenceSources([open]).size, 0, "merged-only by default");
  assert.ok(skillEvidenceSources([open], { includeOpen: true }).has("kustomize"));
});

test("inventory names resolve and source-level skills belong to their record", () => {
  const names = new Set(SKILLS_LIBRARY.flatMap((cat) => cat.skills.map((skill) => skill.name)));
  for (const record of loadSkillEvidence().records) {
    assert.ok(record.activity.length && record.verification && record.limits && record.tracks.length);
    for (const name of record.skills) assert.ok(names.has(name), name);
    for (const source of record.sources) {
      for (const name of source.skills || []) assert.ok(record.skills.includes(name), `${record.id}: ${name}`);
    }
  }
});

test("merged and open skills are available without pretending the source is an employer", () => {
  const doc = loadTracks();
  const confirmed = confirmedSkillKeys(doc);
  for (const name of ["Go", "Rust", "Tokio", "Serde", "gRPC", "Prometheus", "Kubernetes"]) assert.ok(confirmed.has(skillEvidenceKey(name)));
  // Open PR work counts too (the user did the work); it only ranks after merged evidence.
  for (const name of ["Kustomize", "Apache Pulsar", "Ansible"]) assert.ok(confirmed.has(skillEvidenceKey(name)), name);
  // Its only PR (neo4j#379) was closed without merging on 2026-11-18.
  assert.equal(confirmed.has(skillEvidenceKey("GraphSAGE")), false);
  assert.equal(confirmedSkillKeys({ confirmed_skills: { unplaced: ["Python"], not_confirmed: ["FAISS"] } }).has("faiss"), false);
});

test("audits list merged PR provenance first and mark open only evidence at lower confidence", () => {
  const audit = buildSkillsEvidenceAudit(empty, { acs: [] }, jd);
  const rust = audit.find((row) => row.canonical === "Rust");
  assert.equal(rust.covered, true);
  assert.equal(rust.evidence_confidence, 1);
  // Merged sources come before the open ones in the evidence list.
  assert.ok(rust.evidence.indexOf("mezmo/aura/pull/904") < rust.evidence.indexOf("mezmo/rig/pull/19"));
  for (const name of ["Apache Pulsar", "Ansible"]) {
    const row = audit.find((entry) => entry.canonical === name);
    assert.equal(row.covered, true, name);
    assert.ok(row.evidence_confidence < 1, `${name} ranks after merged evidence`);
    assert.ok(row.pending_evidence.length);
  }
  assert.equal(audit.find((entry) => entry.canonical === "GraphSAGE").covered, false);
});

test("generated skills put merged evidence first and still require JD relevance", () => {
  const text = buildSkillsFromComposition(empty, { acs: [] }, jd).join("\n");
  assert.match(text, /Go, Rust/);
  assert.match(text, /Tokio/);
  // Open only skills may appear, after merged ones in the same line.
  for (const line of text.split("\n")) {
    const pulsar = line.indexOf("Pulsar");
    if (pulsar >= 0 && line.includes("Kubernetes")) assert.ok(line.indexOf("Kubernetes") < pulsar, line);
  }
  const unrelated = buildSkillsEvidenceAudit(empty, { acs: [] }, "Accountant");
  assert.equal(unrelated.find((row) => row.canonical === "Rust").covered, false);
});

test("source subsets do not credit a source migration with gRPC server tests", () => {
  const sources = skillEvidenceSources(loadSkillEvidence().records);
  assert.ok(sources.get("grpc").has("https://github.com/numaproj/numaflow-rs/pull/191"));
  assert.equal(sources.get("grpc").has("https://github.com/numaproj/numaflow-rs/pull/187"), false);
});

test("legacy allowlist receives merged and open skills, never a closed PR's", () => {
  const claims = loadSafeClaims({ roles: [], projects: [] });
  assert.ok(claims.has("rust"));
  assert.ok(claims.has("tokio"));
  assert.equal(claims.has("graphsage"), false);
  assert.ok(claims.has("kustomize"));
});

test("Prometheus evidence does not become a Grafana skill match", () => {
  const audit = buildSkillsEvidenceAudit(empty, { acs: [] }, "Grafana dashboards");
  assert.equal(audit.find((row) => row.canonical === "Prometheus").covered, false);
});
