import test from "node:test";
import assert from "node:assert/strict";
import { postingAlive } from "../../scripts/posting-alive.mjs";

const respond = (map) => async (url) => { const hit = Object.entries(map).find(([k]) => url.includes(k)); return hit ? { status: hit[1].status ?? 200, json: async () => hit[1].body } : { status: 500, json: async () => ({}) }; };

test("Greenhouse and Lever: 200 is open, 404 is closed, anything else is unknown", async () => {
  const f = respond({ "boards-api.greenhouse.io/v1/boards/acme/jobs/1": { status: 200 }, "boards-api.greenhouse.io/v1/boards/acme/jobs/2": { status: 404 }, "api.lever.co/v0/postings/co/abc": { status: 200 }, "api.lever.co/v0/postings/co/gone": { status: 404 } });
  assert.equal((await postingAlive("https://job-boards.greenhouse.io/acme/jobs/1", { fetchImpl: f })).state, "open");
  assert.equal((await postingAlive("https://boards.greenhouse.io/acme/jobs/2", { fetchImpl: f })).state, "closed");
  assert.equal((await postingAlive("https://jobs.lever.co/co/abc", { fetchImpl: f })).state, "open");
  assert.equal((await postingAlive("https://jobs.lever.co/co/gone/apply", { fetchImpl: f })).state, "closed");
  assert.equal((await postingAlive("https://job-boards.greenhouse.io/acme/jobs/3", { fetchImpl: f })).state, "unknown", "a server error is not evidence of a closed posting");
});

test("Ashby: open only when the posting id is on the company's board; a missing board is closed", async () => {
  const f = respond({ "job-board/orgA": { body: { jobs: [{ id: "uuid-1" }, { id: "uuid-2" }] } }, "job-board/orgB": { status: 404 } });
  assert.equal((await postingAlive("https://jobs.ashbyhq.com/orgA/uuid-2", { fetchImpl: f })).state, "open");
  assert.equal((await postingAlive("https://jobs.ashbyhq.com/orgA/uuid-9", { fetchImpl: f })).state, "closed");
  assert.equal((await postingAlive("https://jobs.ashbyhq.com/orgB/uuid-1", { fetchImpl: f })).state, "closed");
});

test("anything else, and network errors, are unknown (never a guess)", async () => {
  assert.equal((await postingAlive("https://acme.myworkdayjobs.com/x/job/1")).state, "unknown");
  assert.equal((await postingAlive("not a url")).state, "unknown");
  assert.equal((await postingAlive("https://job-boards.greenhouse.io/a/jobs/1", { fetchImpl: async () => { throw new Error("boom"); } })).state, "unknown");
});
