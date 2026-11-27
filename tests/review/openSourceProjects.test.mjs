import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import yaml from "js-yaml";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickResumeProjectRoles } from "../../scripts/ac-role-meta.mjs";
import { scoreStoryTriple } from "../../scripts/ac-story-select.mjs";
import { sharedOpeningVerbs, sharedOpeningVerbsByTrack, resumeRoles, lintBullet } from "../../scripts/ac-bullet-rules.mjs";
import { loadTracks } from "../../scripts/ac-tracks.mjs";
import { ossHeading, companyProjects, companyOf, assembleAcResume } from "../../scripts/ac-tex.mjs";
import { loadBank } from "../../scripts/ac-bank.mjs";
import { addThirdOpenSource, jdNames } from "../../scripts/ac-page-fill.mjs";
import { bankForTrack } from "../../scripts/ac-tracks.mjs";
import { loadSkillEvidence } from "../../scripts/skill-evidence.mjs";

// Open source project slot (QUESTION_ANSWERS "Open Source Work on Resumes", approved 2026-11-16).
const planner = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/planner/v2.json"), "utf8"));
const pool = planner.canonical_pools["open-source"];
const bank = loadBank();
const all = bank.acs.filter((a) => a.role === "open-source");
const retired = (a) => (a.tracks || []).includes("retired");
const oss = all.filter((a) => !retired(a));
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
  assert.equal(oss.length, 48);
  assert.equal(all.filter(retired).length, 23);
  // Every live open source bullet scores 9+ (bank rubric), and the ranking follows the score (2026-11-25).
  assert.deepEqual(oss.filter((a) => !(a.strength.recruiter >= 9 && a.variants[0].strength >= 9)).map((a) => a.id), []);
  const ranked = [...oss].sort((a, b) => a.display_order - b.display_order);
  for (let i = 1; i < ranked.length; i += 1) assert.ok(ranked[i - 1].strength.recruiter >= ranked[i].strength.recruiter, ranked[i].id);
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

// 2026-11-25: 10 bullets had drifted from their PRs. Statuses come from SKILL_EVIDENCE.yaml, so this stays offline.
test("a bullet's status matches its PRs, and a closed PR is never on an active bullet", () => {
  const status = new Map(loadSkillEvidence().records.flatMap((r) => r.sources.map((s) => [s.url, s.status])));
  for (const ac of oss) {
    const known = ac.oss.prs.map((u) => status.get(u)).filter(Boolean);
    assert.ok(!known.includes("CLOSED"), ac.id);
    if (ac.oss.status === "merged") assert.ok(known.every((s) => s === "MERGED"), `${ac.id} says merged: ${known}`);
    else if (known.length === ac.oss.prs.length) assert.ok(known.includes("OPEN"), `${ac.id} says open, but every PR is merged`);
  }
  assert.deepEqual([...pool.ac_ids].sort(), oss.map((a) => a.id).sort());
  assert.ok(!pool.ac_ids.includes("AC-280") && pool.story_packages.every((p) => !p.ids.includes("AC-280")));
});

// 2026-11-26 (Atishay): open PRs count fully, since the work is done. The 9+ bar decides what is live.
test("open work counts the same as merged work at the same JD fit", () => {
  const [merged, open] = [oss.find((a) => a.oss.status === "merged"), oss.find((a) => a.oss.status === "open")];
  const pkg = { name: "t", ids: [], jd_signals: [], roleName: "open-source", openPenalty: pool.open_penalty };
  const same = (ac) => ({ ...merged, id: ac.id, oss: ac.oss });
  const a = scoreStoryTriple([same(merged), same(merged)], { jd: "", scoreAc: () => 0, pkg, weights: pool.story_weights });
  const b = scoreStoryTriple([same(merged), same(open)], { jd: "", scoreAc: () => 0, pkg, weights: pool.story_weights });
  assert.equal(pool.open_penalty, 0);
  assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  // Tier A holds every live open source bullet, open or merged.
  const tiers = yaml.load(fs.readFileSync(path.join(bank.bank_dir, "TIERS.yaml"), "utf8"));
  assert.deepEqual(oss.map((a) => a.id).filter((id) => !tiers.A.includes(id)), []);
});

test("the heading names the org when one org owns the bullets, else each project with its own org", () => {
  assert.equal(ossHeading([{ ac_id: "AC-261" }, { ac_id: "AC-287" }]).text, "Kiali (Open Source)");
  assert.equal(ossHeading([{ ac_id: "AC-261" }, { ac_id: "AC-263" }]).text, "Kiali, Numaflow (Open Source)");
  assert.equal(ossHeading([{ ac_id: "AC-256" }, { ac_id: "AC-271" }]).text, "Mezmo AURA, PR-Agent (Open Source)");
  assert.equal(ossHeading([{ ac_id: "AC-258" }, { ac_id: "AC-269" }]).text, "NVIDIA NVKR, Keycloak (Open Source)");
  assert.deepEqual(ossHeading([{ ac_id: "AC-253" }, { ac_id: "AC-254" }]).tools, ["Rust", "Tokio", "MCP"]); // both Mezmo: the company project
});

test("a posting names a term only as a whole word", () => {
  const jd = "we are good at building trust with clients, associates and enrollment; guidance provided. go to market.";
  for (const t of ["Rust", "Go", "CLI", "OCI", "LLM", "GUI", "Java"]) assert.equal(jdNames(jd, t), false, t);
  for (const [text, t] of [["golang services", "Go"], ["python, go, and rust", "Go"], ["python, go, and rust", "Rust"], ["c++/linux", "C++"], ["several llms", "LLM"], ["java/spring", "Java"], ["microservices", "microservice"], ["ci/cd pipelines", "CI/CD"], ["node.js", "Node.js"]]) assert.equal(jdNames(text, t), true, `${t} in ${text}`);
  assert.equal(jdNames("javascript", "Java"), false);
  // The project choice too: words inside other words never bring open source in.
  assert.equal(pick("Good communication builds trust with clients and associates; guidance on enrollment."), "insurance-platform");
});

test("the third open source bullet is related to the first two", () => {
  const track = "software-engineer", b = bankForTrack(bank, track);
  for (const pkg of pool.story_packages) {
    const two = pkg.ids.map((id) => b.acs.find((a) => a.id === id));
    if (two.some((a) => !a)) continue;
    const { compact } = addThirdOpenSource({ experience: [], projects: [{ role: "open-source", bullets: two.map((a) => ({ ac_id: a.id, text: a.variants[0].text })) }] }, b, { jd: "Software engineer", track });
    const ids = compact.projects[0].bullets.map((x) => x.ac_id), third = b.acs.find((a) => a.id === ids[2]);
    // A company project prints its description line and exactly 2 bullets.
    if (ossHeading(two.map((a) => ({ ac_id: a.id }))).company) { assert.equal(ids.length, 2, pkg.name); continue; }
    assert.ok(third, pkg.name);
    const related = (a) => two.some((x) => (x.oss.org && x.oss.org === a.oss.org) || x.oss.project === a.oss.project || (x.signature_technologies || []).some((t) => (a.signature_technologies || []).includes(t)));
    const anyLeft = b.acs.some((a) => a.role === "open-source" && !ids.slice(0, 2).includes(a.id) && related(a) && !two.some((x) => x.variants[0].text.split(" ")[0] === a.variants[0].text.split(" ")[0]));
    if (anyLeft) assert.ok(related(third), `${pkg.name}: ${ids}`);
  }
});

test("only approved bullets are live, and every pull request is either a bullet or a recorded decision", async () => {
  const fs = await import("node:fs");
  const yaml = (await import("js-yaml")).default;
  const { audit } = await import("../../scripts/oss-audit.mjs");
  // Each live open source bullet carries the date Atishay approved it (docs/open-source-rules.md, rule 1).
  assert.deepEqual(oss.filter((a) => !/^\d{4}-\d{2}-\d{2}$/.test(String(a.oss.approved || ""))).map((a) => a.id), []);
  const decisions = yaml.load(fs.readFileSync(path.join(bank.bank_dir, "OSS_DECISIONS.yaml"), "utf8")).decisions;
  assert.ok(decisions.every((d) => /^[\w.-]+\/[\w.-]+#\d+$/.test(d.pr) && d.decision === "no-bullet" && d.why && d.decided), "every decision has a reason");
  const cited = new Set(all.flatMap((a) => a.oss.prs));
  assert.deepEqual(decisions.filter((d) => cited.has(`https://github.com/${d.pr.replace("#", "/pull/")}`)).map((d) => d.pr), [], "a PR is a bullet or a decision, not both");
  // The audit on a made-up GitHub answer: status drift, a closed PR, a merged PR with no decision, a decided PR that merged.
  const pr = (id, state, over = {}) => { const [repo, n] = id.split("#"); return { url: `https://github.com/${repo}/pull/${n}`, repo, owner: repo.split("/")[0], n: Number(n), title: id, state, stars: 20000, code: 80, test: 40, files: 3, tested: true, measured: true, ...over }; };
  const ghNow = [
    ...all.filter((a) => !retired(a)).flatMap((a) => a.oss.prs.map((u) => pr(u.replace("https://github.com/", "").replace("/pull/", "#"), a.oss.status === "merged" ? "MERGED" : "OPEN"))),
    pr("scipy/scipy#26813", "MERGED"), pr("brand/new#1", "MERGED"), pr("cockpit-project/cockpit#23924", "MERGED"),
  ].map((p) => (p.repo === "kiali/kiali" && p.n === 10514 ? { ...p, state: "CLOSED" } : p));
  const r = audit(bank, decisions, ghNow);
  assert.ok(r.fix.some((x) => x.id === "AC-300" && /merged/.test(x.issue)), "open bullet whose PR merged");
  assert.ok(r.fix.some((x) => x.id === "AC-261" && /closed/.test(x.issue)), "closed PR still cited");
  assert.deepEqual(r.draft.map((x) => x.pr), ["brand/new#1"]);
  assert.deepEqual(r.decidedChanged.map((x) => x.pr), ["cockpit-project/cockpit#23924"]);
});

// Company projects (2026-11-26, Atishay): "NVIDIA (Open Source) | Go, Kubernetes, Cobra", a line saying what the project is,
// then 2 bullets. The line names the project's purpose, stack and one scale number, never "Contributed to" or praise.
test("company projects print a heading, a description line and 2 bullets from one company", () => {
  const list = companyProjects(bank.bank_dir);
  assert.deepEqual(list.map((c) => c.id), ["nvidia", "mezmo", "red-hat", "numaflow"]);
  for (const c of list) {
    assert.match(c.heading, /^[\w .]+ \(Open Source\)$/, c.id);
    assert.ok(c.skills.length >= 2 && c.skills.length <= 4, c.id);
    assert.match(c.description, /\d/, `${c.id}: a scale number`);
    assert.doesNotMatch(c.description, /\b(contribut\w*|merged|pull requests?|PRs?|leading|world class|renowned|prestigious|cutting edge|I|my)\b/i, c.id);
    assert.ok(c.description.split(/\s+/).length <= 20, c.id);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(c.approved), c.id);
    // Every company has live bullets and at least one package of two of them.
    const members = oss.filter((a) => companyOf(a, bank.bank_dir)?.id === c.id).map((a) => a.id);
    assert.ok(pool.story_packages.some((p) => p.ids.every((id) => members.includes(id))), c.id);
  }
  const h = ossHeading([{ ac_id: "AC-258" }, { ac_id: "AC-321" }]);
  assert.equal(h.text, "NVIDIA (Open Source)");
  assert.deepEqual(h.tools, ["Go", "Kubernetes", "Cobra"]);
  assert.match(h.description, /^NVIDIA's GPU Kubernetes stack/);
  // One company bullet with another project's keeps the heading built from the bullets.
  assert.equal(ossHeading([{ ac_id: "AC-258" }, { ac_id: "AC-284" }]).company, null);
  // Bullets never count PRs ("18 PRs merged" is logistics, not what he built).
  for (const a of oss) assert.doesNotMatch(a.variants[0].text, /\b\d+ (pull requests?|PRs?)\b/i, a.id);
});

test("the masters print the company projects Atishay chose", () => {
  const pins = (t) => loadTracks().tracks[t].general_pinned.projects["open-source"];
  assert.deepEqual(pins("software-engineer"), ["AC-258", "AC-321"]);
  assert.deepEqual(pins("forward-deployed"), ["AC-258", "AC-321"]);
  assert.deepEqual(pins("ai-engineer"), ["AC-253", "AC-322"]);
  assert.deepEqual(pins("data-science"), ["AC-282", "AC-284", "AC-286"]);
  const tex = assembleAcResume({ experience: [], projects: [{ role: "open-source", bullets: ["AC-258", "AC-321"].map((id) => ({ ac_id: id, text: bank.acs.find((a) => a.id === id).variants[0].text })) }] }, { skillsLines: [] });
  assert.match(tex, /\\textbf\{NVIDIA \(Open Source\)\} \$\|\$ \\emph\{Go, Kubernetes, Cobra\}/);
  assert.match(tex, /\\resumeProjectHeadingAbout\{\\textbf\{NVIDIA \(Open Source\)\}.*\}\{NVIDIA's GPU Kubernetes stack/);
});
