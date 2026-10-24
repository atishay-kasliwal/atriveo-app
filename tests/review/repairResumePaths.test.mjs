import test from "node:test";
import assert from "node:assert/strict";
import { planRepairs, applyRepairs, undoBatch } from "../../scripts/repair-resume-paths.mjs";

const files = new Set(["/r/new/job1.pdf", "/r/keep/job0.pdf", "/r/old3/Renamed Resume.pdf", "/r/old3/Cover Letter.pdf"]);
const exists = (p) => files.has(p);
const pdfsIn = (dir) => [...files].filter((f) => f.startsWith(`${dir}/`)).map((f) => f.slice(dir.length + 1));
const app = (id, p, extra = {}) => ({ _id: id, company: `Co${id}`, title: "SWE", status: "NEEDS_REVIEW", url: `https://x/${id}`, jobUrls: [`https://x/${id}`], resume: { path: p, fileName: "a.pdf", sha256: "abc", bytes: 10, verifiedAt: "t", sourceJobUrl: `https://x/${id}` }, ...extra });
const jobs = new Map([
  ["https://x/1", [{ job_url: "https://x/1", resume: { status: "success", pdf_path: "/r/new/job1.pdf", updated_at: "2026-10-20" } }]],
  ["https://x/4", [{ job_url: "https://x/4", resume: { status: "failed", pdf_path: "/r/gone/x.pdf" } }]],
  ["https://x/5", [{ job_url: "https://x/5", resume: { status: "success", pdf_path: "/r/never/was.pdf", updated_at: "2026-10-21" } }]],
]);

test("planRepairs: keeps what is fine, repoints to a finished resume or a renamed PDF, and leaves the rest for a rebuild", () => {
  const apps = [app(0, "/r/keep/job0.pdf"), app(1, "/r/old1/gone.pdf"), app(3, "/r/old3/Atishay Kasliwal.pdf"), app(4, "/r/old4/gone.pdf"), app(5, "/r/old5/gone.pdf"), app(6, "")];
  const plan = planRepairs(apps, jobs, { exists, pdfsIn });
  assert.deepEqual(plan.ok.map((a) => a._id), [0]);
  assert.deepEqual(plan.repair.map((r) => [r.app._id, r.to]), [[1, "/r/new/job1.pdf"], [3, "/r/old3/Renamed Resume.pdf"]], "never the cover letter");
  assert.deepEqual(plan.rebuild.map((r) => r.app._id), [4, 5, 6], "a job whose 'finished' file is also missing is not a target");
});

function fakeDb() {
  const apps = new Map(), log = [];
  return {
    apps, log,
    collection: (n) => n === "applications"
      ? { updateOne: async (f, u) => { const a = apps.get(f._id); if (a && (f["resume.path"] === undefined || a.resume.path === f["resume.path"])) { for (const [k, v] of Object.entries(u.$set)) { if (k.startsWith("resume.")) a.resume[k.slice(7)] = v; else a[k] = v; } } } }
      : { insertOne: async (d) => log.push(d), find: () => ({ toArray: async () => log }) },
  };
}

test("applyRepairs changes only the resume fields, logs the old values, and undoBatch restores them exactly", async () => {
  const db = fakeDb();
  const a = app(1, "/r/old1/gone.pdf"); db.apps.set(1, structuredClone(a));
  const batch = await applyRepairs(db, [{ app: a, to: "/r/new/job1.pdf", via: "x" }], { now: new Date("2026-10-24T00:00:00Z") });
  const after = db.apps.get(1);
  assert.equal(after.resume.path, "/r/new/job1.pdf");
  assert.equal(after.resume.fileName, "job1.pdf");
  assert.equal(after.resume.sha256, null, "the engine verifies the new file before use");
  assert.equal(after.resume.sourceJobUrl, "https://x/1", "other fields are untouched");
  assert.equal(after.status, "NEEDS_REVIEW");
  assert.equal(db.log.length, 1);
  assert.equal(db.log[0].before.path, "/r/old1/gone.pdf");
  assert.equal(await undoBatch(db, batch), 1);
  assert.equal(db.apps.get(1).resume.path, "/r/old1/gone.pdf");
  assert.equal(db.apps.get(1).resume.sha256, "abc");
  assert.equal(db.apps.get(1).resume.verifiedAt, "t");
});

test("applyRepairs refuses to overwrite a record that changed since it was read", async () => {
  const db = fakeDb();
  const a = app(1, "/r/old1/gone.pdf");
  db.apps.set(1, { ...structuredClone(a), resume: { ...a.resume, path: "/r/someone/else.pdf" } });
  await applyRepairs(db, [{ app: a, to: "/r/new/job1.pdf", via: "x" }]);
  assert.equal(db.apps.get(1).resume.path, "/r/someone/else.pdf");
});
