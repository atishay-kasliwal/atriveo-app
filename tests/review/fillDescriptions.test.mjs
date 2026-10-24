import test from "node:test";
import assert from "node:assert/strict";
import { fetchDescription, htmlToText, missingDescriptions } from "../../scripts/fill-descriptions.mjs";

const respond = (map) => async (url) => { const hit = Object.entries(map).find(([k]) => url.includes(k)); return hit ? { status: hit[1].status ?? 200, json: async () => hit[1].body } : { status: 500, json: async () => ({}) }; };
const LONG = "We build things. ".repeat(30);

test("Greenhouse content is escaped HTML: it becomes plain text with its list items", () => {
  assert.equal(htmlToText("&lt;p&gt;Build &amp;amp; ship&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;/ul&gt;"), "Build & ship\n- Python");
});

test("each board gives its text: Greenhouse content, Lever plain text and lists, Ashby by posting id", async () => {
  const f = respond({
    "boards-api.greenhouse.io/v1/boards/acme/jobs/1": { body: { content: "&lt;p&gt;Hello team&lt;/p&gt;" } },
    "api.lever.co/v0/postings/co/abc": { body: { descriptionPlain: "Lever intro", lists: [{ text: "Requirements", content: "<li>Go</li>" }], additionalPlain: "Perks" } },
    "job-board/orgA": { body: { jobs: [{ id: "u1", descriptionPlain: "Ashby text" }, { id: "u2", descriptionPlain: "" }] } },
  });
  assert.equal(await fetchDescription("https://job-boards.greenhouse.io/acme/jobs/1", { fetchImpl: f }), "Hello team");
  assert.equal(await fetchDescription("https://jobs.lever.co/co/abc", { fetchImpl: f }), "Lever intro\n\nRequirements\n- Go\n\nPerks");
  assert.equal(await fetchDescription("https://jobs.ashbyhq.com/orgA/u1", { fetchImpl: f }), "Ashby text");
  assert.equal(await fetchDescription("https://jobs.ashbyhq.com/orgA/u2", { fetchImpl: f }), null, "an empty posting is no text");
  assert.equal(await fetchDescription("https://jobs.ashbyhq.com/orgA/missing", { fetchImpl: f }), null);
});

test("a failing board, an unknown site or a bad URL gives null, never a throw or a guess", async () => {
  assert.equal(await fetchDescription("https://job-boards.greenhouse.io/a/jobs/1", { fetchImpl: async () => { throw new Error("boom"); } }), null);
  assert.equal(await fetchDescription("https://job-boards.greenhouse.io/a/jobs/1", { fetchImpl: respond({}) }), null);
  assert.equal(await fetchDescription("https://acme.myworkdayjobs.com/x/job/1"), null);
  assert.equal(await fetchDescription("not a url"), null);
});

test("a job needs a description when none is held or the held one is too short", () => {
  const held = new Map([["a", LONG], ["b", "short"]]);
  const jobs = [{ job_url: "a" }, { job_url: "b" }, { job_url: "c" }, { job_url: null }];
  assert.deepEqual(missingDescriptions(jobs, held).map((j) => j.job_url), ["b", "c"]);
});
