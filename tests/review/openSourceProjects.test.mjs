import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickResumeProjectRoles } from "../../scripts/ac-role-meta.mjs";
import { scoreStoryTriple } from "../../scripts/ac-story-select.mjs";
import { sharedOpeningVerbs, sharedOpeningVerbsByTrack, resumeRoles, lintBullet } from "../../scripts/ac-bullet-rules.mjs";
import { loadTracks } from "../../scripts/ac-tracks.mjs";
import { ossHeading } from "../../scripts/ac-tex.mjs";
import { loadBank } from "../../scripts/ac-bank.mjs";

// Open source project slot (QUESTION_ANSWERS "Open Source Work on Resumes", approved 2026-11-16).
const planner = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/planner/v2.json"), "utf8"));
const pool = planner.canonical_pools["open-source"];
const bank = loadBank();
const oss = bank.acs.filter((a) => a.role === "open-source");
const pick = (jd) => pickResumeProjectRoles(["atriveo", "insurance-platform", "open-source"], jd, planner)[1];

test("open source takes the second slot only when the JD clearly matches it", () => {
  assert.equal(pick("We hire Kubernetes engineers to build Go controllers and an informer cache layer for reliability."), "open-source");
  assert.equal(pick("Rust and Tokio services, concurrency and async systems."), "open-source");
  // A JD it doesn't match, or only ties, keeps the existing project (open source never wins on recency alone).
  assert.equal(pick("Accountant. Excel and month end close."), "insurance-platform");
  assert.equal(pick("Java Spring Boot microservices on a distributed platform."), "insurance-platform");
});

test("every open source package pairs two bank entries with unique verbs inside the package", () => {
  const byId = new Map(oss.map((a) => [a.id, a]));
  assert.equal(oss.length, 29);
  for (const pkg of pool.story_packages) {
    assert.equal(pkg.ids.length, 2, pkg.name);
    const verbs = pkg.ids.map((id) => byId.get(id).variants[0].text.split(/\s+/)[0].toLowerCase());
    assert.equal(new Set(verbs).size, 2, `${pkg.name}: ${verbs}`);
  }
  // Across packages a verb may repeat; never inside one, and never against another resume role on any track (the bank lint).
  const active = bank.acs.filter((a) => a.variants?.[0]?.text && a.visibility?.default !== false); // as the bank lint does
  const clashes = sharedOpeningVerbsByTrack(active, resumeRoles(bank.bank_dir), loadTracks(bank.bank_dir));
  assert.deepEqual(clashes.filter((c) => c.ids.some((id) => byId.has(id))), []);
  // Two bullets of one package never share a verb, even with the package check alone.
  assert.deepEqual(sharedOpeningVerbs(oss, new Set(["open-source"]), planner.canonical_pools), []);
});

test("every open source bullet passes the bank lint and carries its upstream provenance", () => {
  for (const ac of oss) {
    const { issues, score } = lintBullet(ac, ac.variants[0].text);
    assert.deepEqual(issues, [], ac.id);
    assert.ok(score >= 9.5, `${ac.id} ${score}`);
    assert.ok(["merged", "open"].includes(ac.oss.status), ac.id);
    assert.ok(ac.oss.prs.length && ac.oss.prs.every((u) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(u)), ac.id);
    // Status never prints, and open work never claims it landed upstream.
    assert.doesNotMatch(ac.variants[0].text, /\b(merged|open PR|pull request)\b/i, ac.id);
    if (ac.oss.status === "open") assert.doesNotMatch(ac.variants[0].text, /\b(shipped|released|adopted|used by)\b/i, ac.id);
  }
});

test("merged work outranks open work at the same JD fit", () => {
  const [merged, open] = [oss.find((a) => a.oss.status === "merged"), oss.find((a) => a.oss.status === "open")];
  const pkg = { name: "t", ids: [], jd_signals: [], roleName: "open-source", openPenalty: pool.open_penalty };
  const same = (ac) => ({ ...merged, id: ac.id, oss: ac.oss });
  const a = scoreStoryTriple([same(merged), same(merged)], { jd: "", scoreAc: () => 0, pkg, weights: pool.story_weights });
  const b = scoreStoryTriple([same(merged), same(open)], { jd: "", scoreAc: () => 0, pkg, weights: pool.story_weights });
  assert.ok(a - b >= pool.open_penalty - 1e-9, `${a} vs ${b}`);
});

test("the heading names the org when one org owns the bullets, else each project with its own org", () => {
  assert.equal(ossHeading([{ ac_id: "AC-258" }, { ac_id: "AC-259" }]).text, "NVIDIA | NVKR, Workload Map (Open Source)");
  assert.equal(ossHeading([{ ac_id: "AC-261" }, { ac_id: "AC-263" }]).text, "Kiali, Numaflow (Open Source)");
  assert.equal(ossHeading([{ ac_id: "AC-255" }, { ac_id: "AC-271" }]).text, "Mezmo AURA, PR-Agent (Open Source)");
  assert.deepEqual(ossHeading([{ ac_id: "AC-253" }, { ac_id: "AC-254" }]).tools, ["Rust", "Tokio"]);
});
