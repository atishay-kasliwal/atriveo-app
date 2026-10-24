import test from "node:test";
import assert from "node:assert/strict";
import { computeFit, fitIsCurrent, ensureFit } from "../../scripts/fit-store.mjs";
import { rankForMatching } from "../../scripts/job-matching.mjs";
import { resumeReadyOf } from "../../scripts/applications-analytics.mjs";

const JD = "Backend Engineer\nRequirements:\n- Python and Java experience.\n- Kubernetes experience.\n";

test("a saved Fit is small, current, and goes stale when its inputs change", () => {
  const fit = computeFit(JD, "Backend Engineer");
  assert.equal(typeof fit.score, "number");
  assert.ok(JSON.stringify(fit).length < 4000);
  assert.ok(fit.ledger.skills.every((s) => s.label && Array.isArray(s.alternatives) && s.status));
  assert.equal(fitIsCurrent(fit), true);
  assert.equal(fitIsCurrent({ ...fit, master_hash: "old" }), false);
  assert.equal(fitIsCurrent({ ...fit, config_hash: "old" }), false);
  assert.equal(fitIsCurrent({ ...fit, shape: 1 }), false, "a Fit saved before it kept the proof bullets is recomputed");
  const { shape: _omitted, ...legacy } = fit;
  assert.equal(fitIsCurrent(legacy), false);
  assert.equal(fitIsCurrent(null), false);
});

test("ensureFit computes and saves only what is missing or stale, up to the limit, and keeps a Fit when the posting is gone", async () => {
  const have = computeFit(JD, "Backend Engineer");
  const written = [];
  const db = { collection: (name) => name === "descriptions"
    ? { find: () => ({ toArray: async () => [{ job_url: "https://x/1", description: JD }, { job_url: "https://x/2", description: JD }] }) }
    : { bulkWrite: async (ops) => written.push(...ops) } };
  const docs = [{ job_url: "https://x/0", title: "Backend Engineer", fit: have }, { job_url: "https://x/1", title: "Backend Engineer" }, { job_url: "https://x/2", title: "Backend Engineer" }, { job_url: "https://x/3", title: "Backend Engineer" }];
  const got = await ensureFit(db, docs, { max: 2 });
  assert.deepEqual([...got.keys()].sort(), ["https://x/0", "https://x/1", "https://x/2"]);
  assert.equal(written.length, 2);
  assert.equal(written[0].updateOne.update.$set.fit.score, got.get("https://x/1").score);
  const stale = { ...have, master_hash: "old" };
  const gone = await ensureFit({ collection: (n) => n === "descriptions" ? { find: () => ({ toArray: async () => [] }) } : { bulkWrite: async () => {} } }, [{ job_url: "https://x/9", title: "Backend Engineer", fit: stale }], { max: 5 });
  assert.equal(gone.get("https://x/9"), stale, "no posting text now: keep the Fit we had");
});

test("the queue is ordered by Fit; blocked jobs and saved-for-later go last; confidence and pipeline score break ties", () => {
  const f = (score, confidence = "high", verdict = "clear") => ({ score, confidence, knockouts: { verdict } });
  const docs = [
    { job_url: "a", fit: f(80), score_pct: 10, run_at: "2026-10-01" },
    { job_url: "b", fit: f(95, "high", "blocked"), score_pct: 99, run_at: "2026-10-01" },
    { job_url: "c", fit: f(90, "low"), score_pct: 10, run_at: "2026-10-01" },
    { job_url: "d", fit: f(90, "high"), score_pct: 10, run_at: "2026-10-01" },
    { job_url: "e", fit: null, score_pct: 99, run_at: "2026-10-01" },
    { job_url: "f", fit: f(99), score_pct: 99, run_at: "2026-10-01" },
    { job_url: "g", fit: f(90, "high"), score_pct: 50, run_at: "2026-10-01" },
  ];
  assert.deepEqual(rankForMatching(docs, new Map([["f", "x"]])).map((d) => d.job_url), ["g", "d", "c", "a", "e", "b", "f"]);
});

test("Resume Ready is read from the readiness saved beside the PDF, and is null before there is one", async () => {
  assert.equal(resumeReadyOf(null), null);
  assert.equal(resumeReadyOf("/nowhere/at/all.pdf"), null);
});

import { resumeReady } from "../../scripts/ats/ready.mjs";
import { parseResume } from "../../scripts/ats/resume-parse.mjs";
import { config, CLEAN_LAYOUT } from "../ats/helpers.mjs";

test("Resume Ready names the bank bullet that proves each skill the resume leaves out, one wording, not the joined text", () => {
  const fit = computeFit("Backend Engineer\nRequirements:\n- Spring Boot, MongoDB and Java experience.\n", "Backend Engineer");
  const stored = fit.ledger.skills.filter((s) => s.status === "matched");
  assert.ok(stored.length && stored.every((s) => s.evidence?.text && s.evidence.entry), "the stored Fit keeps the proof for every matched skill");
  const r = resumeReady({ readiness: { status: "PASS" }, tailored: parseResume(CLEAN_LAYOUT, config.sections), ledger: fit.ledger, config });
  const detail = r.checks.skills_on_resume.left_off_detail;
  assert.ok(detail.length >= 1);
  for (const d of detail) {
    assert.ok(d.entry && d.text, `${d.label} has a source`);
    assert.ok(!d.text.includes(" | "), "one wording, not the wordings joined together");
    assert.ok(d.text.toLowerCase().includes(d.label.toLowerCase().split(" ")[0]), `the wording actually mentions ${d.label}`);
    assert.ok(["bullet", "tools", "skills"].includes(d.as));
  }
  assert.deepEqual(r.checks.skills_on_resume.left_off, detail.filter((d) => d.class === "required").map((d) => d.label));
});

test("preferred skills the resume leaves out are listed with their proof but never change the status", () => {
  const fit = computeFit("Backend Engineer\nRequirements:\n- Java experience.\nPreferred Qualifications:\n- Elasticsearch and MongoDB.\n", "Backend Engineer");
  const tailored = parseResume(CLEAN_LAYOUT, config.sections);
  const withPreferred = resumeReady({ readiness: { status: "PASS" }, tailored, ledger: fit.ledger, config });
  const requiredOnly = resumeReady({ readiness: { status: "PASS" }, tailored, ledger: { skills: fit.ledger.skills.filter((s) => s.class === "required") }, config });
  assert.equal(withPreferred.status, requiredOnly.status);
  assert.ok(withPreferred.checks.skills_on_resume.left_off_detail.some((d) => d.class === "preferred"));
});
