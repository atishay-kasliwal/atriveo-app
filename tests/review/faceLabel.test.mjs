// A bullet's facet label names the wording it prints (Nov 28). AC-025's ai-track wording is limited to the ai-engineer
// track; on any other track the default prints and must be labelled "default", not "ai-track".
import test from "node:test";
import assert from "node:assert/strict";
import { loadBank, buildBullet } from "../../scripts/ac-bank.mjs";
import { bankForTrack } from "../../scripts/ac-tracks.mjs";

const bank = loadBank();
const jd = "Full stack engineer building LLM and AI features: React, Node, LangChain, Pinecone, RAG, AWS.";

for (const id of ["AC-023", "AC-025"]) {
  test(`${id}: the label matches the printed wording on and off the AI track`, () => {
    for (const track of ["software-engineer", "ai-engineer", null]) {
      const ac = bankForTrack(bank, track).acs.find((a) => a.id === id);
      if (!ac) continue;
      const { face } = buildBullet(ac, { jd });
      const v = ac.variants.find((x) => (x.facet ?? "default") === (face.facet ?? "default"));
      assert.ok(v, `${id} on ${track}: label ${face.facet} names a wording this track has`);
      assert.equal(v.text, face.text, `${id} on ${track}: label ${face.facet} is the wording printed`);
    }
  });
}
