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
