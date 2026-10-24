import test from "node:test";
import assert from "node:assert/strict";
import { enforceProjects, fillOnePage, stretchToBottom, candidatesFor, LINE_PT } from "../../scripts/ac-page-fill.mjs";
import { resumeReady } from "../../scripts/ats/ready.mjs";
import { loadAtsConfig } from "../../scripts/ats/config.mjs";

const ac = (id, role, slot, text, { strength = 9, fits = [], tools = [] } = {}) => ({
  id, role, slot_kind: slot, fits, signature_technologies: tools, ats_keywords: [], variants: [{ facet: "default", strength, text }],
});
const bank = { acs: [
  ac("E1", "stony-brook", "experience", "Built a Python service.", { tools: ["Python"] }),
  ac("E2", "stony-brook", "experience", "Shipped a Kafka pipeline.", { tools: ["Kafka"] }),
  ac("E3", "stony-brook", "experience", "Designed retrieval with Pinecone.", { tools: ["Pinecone"] }),
  ac("E4", "stony-brook", "experience", "Measured latency at 80 ms."),
  ac("E5", "stony-brook", "experience", "Reduced costs by 30%."),
  ac("A1", "accolite", "experience", "Optimized ERP APIs.", { strength: 7 }),
  ac("A2", "accolite", "experience", "Resolved incidents at scale.", { strength: 7 }),
  ac("A3", "accolite", "experience", "Installed CI/CD for 20 engineers.", { strength: 6 }),
  ac("P1", "atriveo", "project", "Founded Atriveo.", { fits: ["ai-engineer"] }),
  ac("P2", "atriveo", "project", "Evaluated variants on 500 postings."),
  ac("M1", "mri-research", "project", "Interpreted radiomics models at 0.70 AUC.", { fits: ["ai-engineer"], tools: ["PyTorch"] }),
  ac("M2", "mri-research", "project", "Spearheaded a modular pipeline.", { fits: ["ai-engineer"] }),
  ac("M3", "mri-research", "project", "Predicted outcomes reaching 0.70 AUC.", { fits: ["ai-engineer"] }),
  ac("M4", "mri-research", "project", "Segmented tumors with PyTorch.", { fits: ["ai-engineer"], tools: ["PyTorch"] }),
  ac("U1", "user-data-platform", "project", "Reinforced X25519 key exchange.", { fits: ["software-engineer"] }),
  ac("U2", "user-data-platform", "project", "Documented 4 trust invariants.", { fits: ["software-engineer"] }),
] };
const b = (id) => { const a = bank.acs.find((x) => x.id === id); return { ac_id: id, facet: "default", text: a.variants[0].text }; };
const resume = (exp, proj) => ({
  experience: Object.entries(exp).map(([role, ids]) => ({ role, bullets: ids.map(b) })),
  projects: Object.entries(proj).map(([role, ids]) => ({ role, bullets: ids.map(b) })),
});

test("a missing second project is added from the pool, the one tagged for the track, with two bullets", () => {
  const { compact, changes } = enforceProjects(resume({ "stony-brook": ["E1"] }, { atriveo: ["P1", "P2"] }), bank,
    { jd: "pytorch", track: "ai-engineer", pool: ["atriveo", "mri-research", "user-data-platform"] });
  assert.deepEqual(compact.projects.map((p) => [p.role, p.bullets.length]), [["atriveo", 2], ["mri-research", 2]]);
  assert.match(changes.join(), /added project mri-research/);
});

test("a bullet is never one the renderer would cut a word from, nor one repeating a figure already in its section", () => {
  const ids = candidatesFor("mri-research", "project", bank, new Map(), "", "ai-engineer", ["Interpreted radiomics models at 0.70 AUC."]).map((c) => c.ac.id);
  assert.ok(!ids.includes("M2"), "Spearheaded is a banned word: the bullet would print without its verb");
  assert.ok(!ids.includes("M3"), "0.70 AUC is already in the section");
  assert.ok(ids.includes("M4"));
});

test("a short project gets its best remaining bullet; one that cannot reach two is swapped for one that can", () => {
  const filled = enforceProjects(resume({}, { atriveo: ["P1", "P2"], "mri-research": ["M1"] }), bank, { track: "ai-engineer" });
  assert.deepEqual(filled.compact.projects.find((p) => p.role === "mri-research").bullets.map((x) => x.ac_id), ["M1", "M4"]);
  const tiny = { acs: bank.acs.filter((a) => a.id !== "M4") };
  const swapped = enforceProjects(resume({}, { atriveo: ["P1", "P2"], "mri-research": ["M1"] }), tiny, {});
  assert.deepEqual(swapped.compact.projects.map((p) => p.role), ["atriveo", "user-data-platform"]);
  assert.match(swapped.changes.join(), /replaced project mri-research \(no second clean bullet\)/);
});

// A fake page: each bullet is one line; the page holds `room` lines.
const fakeMeasure = (room) => (tex) => {
  const lines = (tex.match(/BULLET/g) || []).length;
  return { ok: true, pages: lines > room ? 2 : 1, bottom_gap_pt: (room - lines) * LINE_PT };
};
const render = (c) => [...c.experience, ...c.projects].flatMap((s) => s.bullets.map(() => "BULLET")).join("\n");

test("too much empty space: the best remaining bullets are added until under a line is left", () => {
  const out = fillOnePage(resume({ "stony-brook": ["E1", "E2", "E3", "E4"], accolite: ["A1", "A2"] }, { atriveo: ["P1", "P2"], "mri-research": ["M1", "M4"] }),
    { bank, jd: "", render, measure: fakeMeasure(12) });
  assert.equal(out.measure.pages, 1);
  assert.ok(out.measure.bottom_gap_pt <= LINE_PT);
  assert.equal([...out.compact.experience, ...out.compact.projects].reduce((n, s) => n + s.bullets.length, 0), 12);
});

test("a second page: the oldest employer gives way first, Stony Brook keeps four, projects keep two each", () => {
  const out = fillOnePage(resume({ "stony-brook": ["E1", "E2", "E3", "E4", "E5"], accolite: ["A1", "A2", "A3"] }, { atriveo: ["P1", "P2"], "mri-research": ["M1", "M4"] }),
    { bank, jd: "", render, measure: fakeMeasure(10) });
  const count = Object.fromEntries([...out.compact.experience, ...out.compact.projects].map((s) => [s.role, s.bullets.length]));
  assert.equal(out.measure.pages, 1);
  assert.deepEqual(count, { "stony-brook": 4, accolite: 2, atriveo: 2, "mri-research": 2 });
  assert.match(out.log.join(), /removed A3 \(accolite\)/);
});

test("the last bit of space is spread between sections and entries, never added inside a list's first entry", () => {
  const tex = "\\section{Education}\n\\section{Experience}\n  \\resumeSubHeadingListStart\n    \\resumeSubheading{A}\n    \\resumeSubheading{B}\n  \\resumeSubHeadingListEnd\n\\section{Projects}\n\\section{Technical Skills}";
  const out = stretchToBottom(tex);
  assert.equal((out.match(/plus 1fill/g) || []).length, 4, "before Experience, Projects, Technical Skills and the second entry");
  assert.match(out, /\\resumeSubHeadingListStart\n    \\resumeSubheading\{A\}/);
});

test("Resume Ready: one project, a short project or an empty line at the bottom is reported", () => {
  const config = loadAtsConfig();
  const base = { readiness: { status: "PASS" }, ledger: { skills: [] }, config };
  const one = resumeReady({ ...base, tailored: { projects: [{ name: "Atriveo", bullets: ["a", "b"] }] } });
  assert.equal(one.status, "Needs Work");
  assert.match(one.reasons.join(), /1 project on the resume; the rule is 2/);
  const short = resumeReady({ ...base, tailored: { projects: [{ name: "Atriveo", bullets: ["a", "b"] }, { name: "MRI", bullets: ["a"] }] } });
  assert.equal(short.status, "Review");
  const gap = resumeReady({ ...base, tailored: { projects: [{ name: "A", bullets: ["a", "b"] }, { name: "B", bullets: ["a", "b"] }] }, pageFill: { final_gap_pt: 30 } });
  assert.match(gap.reasons.join(), /About 2 empty lines at the bottom/);
  const ok = resumeReady({ ...base, tailored: { projects: [{ name: "A", bullets: ["a", "b"] }, { name: "B", bullets: ["a", "b"] }] }, pageFill: { final_gap_pt: 0 } });
  assert.equal(ok.status, "Ready");
});

test("the rebuild picks a resume with one project, a one-bullet project, two pages or an empty line; a full one is left", async () => {
  const { ruleBreaks } = await import("../../scripts/rebuild-rule-breakers.mjs");
  const two = [{ name: "A", bullets: [1, 2] }, { name: "B", bullets: [1, 2] }];
  assert.deepEqual(ruleBreaks({ projects: two, pages: 1, gapPt: -4 }), []);
  assert.deepEqual(ruleBreaks({ projects: [{ name: "A", bullets: [1, 2] }], pages: 1, gapPt: 0 }), ["1 project"]);
  assert.deepEqual(ruleBreaks({ projects: [{ name: "A", bullets: [1, 2] }, { name: "B", bullets: [1] }], pages: 1, gapPt: 0 }), ["B: 1 bullet"]);
  assert.deepEqual(ruleBreaks({ projects: two, pages: 2, gapPt: 0 }), ["2 pages"]);
  assert.deepEqual(ruleBreaks({ projects: two, pages: 1, gapPt: 18 }), ["1 empty line(s)"]);
});
