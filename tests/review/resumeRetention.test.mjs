import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { planPrune, planLocal } from "../../scripts/resume-retention.mjs";

const NOW = new Date("2026-12-01T00:00:00Z");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const obj = (n) => ({ key: `resumes/${n}.pdf`, image_key: `resumes/${n}.png`, tex_key: `resumes/${n}.tex`, sha256: sha(`pdf ${n}`) });
const fakeDb = (jobs, apps = [], swipes = []) => ({ collection: (name) => ({ find: () => ({ toArray: async () => name === "jobs" ? jobs : name === "applications" ? apps : swipes }) }) });

test("prune: only unapplied resumes older than the cutoff go, and a file shared with a kept job stays", async () => {
  const jobs = [
    { job_url: "https://x/old-unapplied", resume: { object: obj("a"), updated_at: "2026-08-01T00:00:00Z" } },
    { job_url: "https://x/old-applied", resume: { object: obj("b"), updated_at: "2026-08-01T00:00:00Z" } },
    { job_url: "https://x/new", resume: { object: obj("c"), updated_at: "2026-11-25T00:00:00Z" } },
    { job_url: "https://x/old-swiped", resume: { object: obj("d"), updated_at: "2026-08-01T00:00:00Z" } },
    { job_url: "https://x/old-shared", resume: { object: obj("b"), updated_at: "2026-08-01T00:00:00Z" } },
  ];
  const plan = await planPrune(fakeDb(jobs, [{ jobUrls: ["https://x/old-applied"] }], [{ job_url: "https://x/old-swiped" }]), { days: 60, now: NOW });
  assert.deepEqual(plan.delete.sort(), ["resumes/a.pdf", "resumes/a.png", "resumes/a.tex"]);
});

test("local: a copy goes only when it is old, not part of an application, and its bytes still match R2", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ret-"));
  const mk = (name, body) => { const f = path.join(dir, `${name}.pdf`); fs.writeFileSync(f, body); fs.writeFileSync(path.join(dir, "resume-page.png"), "png"); return f; };
  const jobs = [
    { job_url: "https://x/ok", resume: { pdf_path: mk("ok", "pdf a"), object: obj("a"), updated_at: "2026-10-01T00:00:00Z" } },
    { job_url: "https://x/changed", resume: { pdf_path: mk("changed", "edited"), object: obj("b"), updated_at: "2026-10-01T00:00:00Z" } },
    { job_url: "https://x/applied", resume: { pdf_path: mk("applied", "pdf c"), object: obj("c"), updated_at: "2026-10-01T00:00:00Z" } },
    { job_url: "https://x/new", resume: { pdf_path: mk("new", "pdf d"), object: obj("d"), updated_at: "2026-11-30T00:00:00Z" } },
    { job_url: "https://x/gone", resume: { pdf_path: path.join(dir, "gone.pdf"), object: obj("e"), updated_at: "2026-10-01T00:00:00Z" } },
  ];
  const plan = await planLocal(fakeDb(jobs, [{ jobUrls: ["https://x/applied"] }]), { days: 14, now: NOW });
  assert.deepEqual(plan.files.filter((f) => f.endsWith(".pdf")), [path.join(dir, "ok.pdf")]);
  assert.deepEqual(plan.skipped, { too_new: 1, kept_application: 1, missing: 1, changed: 1 });
});

test("jobs: unapplied jobs older than the cutoff leave Mongo with their folder and R2 files; everything kept stays", async () => {
  const { createRequire } = await import("node:module");
  const { MongoClient, ObjectId } = await import("mongodb");
  const { planJobs, applyJobs } = await import("../../scripts/resume-retention.mjs");
  const engine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), "playatriveo"), "package.json"));
  const { MongoMemoryServer } = engine("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create(), client = new MongoClient(mongod.getUri());
  try {
    await client.connect();
    const db = client.db("t"), root = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-ret-"));
    const folder = (n) => { const d = path.join(root, "2026-11-01", n); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "r.pdf"), "pdf"); return path.join(d, "r.pdf"); };
    const old = new Date("2026-11-20T00:00:00Z"), fresh = new Date("2026-11-30T00:00:00Z");
    const job = (url, extra = {}, resume = {}) => ({ job_url: `https://x/${url}`, run_at: old, ...extra, resume: { status: "success", pdf_path: folder(url), object: obj(url), ...resume } });
    await db.collection("jobs").insertMany([
      job("old"), job("old", { session_id: "second scrape" }),             // two rows of one job: both go
      job("applied"), job("later"), job("swiped"), job("fresh", { run_at: fresh }),
      job("manual", {}, { source: "manual" }), job("queued", {}, { status: "queued" }), job("edited", {}, { edited_at: "2026-11-30T00:00:00Z" }),
      { job_url: "https://x/staffing", site: "staffing" },                  // no scrape date
      job("old-string", { run_at: "2026-11-20T00:00:00.000Z" }),
      job("mixed"), job("mixed", { run_at: fresh }),                        // seen again recently: kept
      job("shares", {}, { object: obj("applied") }),                         // same R2 file as an applied job
    ]);
    await db.collection("applications").insertMany([{ jobUrls: ["https://x/applied"], status: "APPLIED" }, { url: "https://x/discarded", status: "DISCARDED" }]);
    await db.collection("job_swipes").insertMany([{ job_url: "https://x/later", direction: "later" }, { job_url: "https://x/swiped", direction: "applied" }]);
    const oldId = ObjectId.createFromTime(old.getTime() / 1000), newId = ObjectId.createFromTime(fresh.getTime() / 1000);
    await db.collection("descriptions").insertMany([
      { job_url: "https://x/old", description: "d" }, { job_url: "https://x/applied", description: "d" },
      { _id: oldId, job_url: "https://x/long-gone", description: "d" }, { _id: newId, job_url: "https://x/being-written", description: "d" },
    ]);

    const plan = await planJobs(db, { days: 3, now: NOW, roots: [root] });
    assert.deepEqual(plan.urls.sort(), ["https://x/old", "https://x/old-string", "https://x/shares"]);
    assert.equal(plan.rows, 4);
    assert.deepEqual(plan.keys.sort(), [...Object.values(obj("old")), ...Object.values(obj("old-string"))].filter((v) => v.startsWith("resumes/")).sort());

    const deleted = [];
    const out = await applyJobs(db, plan, { store: { del: async (k) => deleted.push(k) }, log: () => {} });
    assert.deepEqual(out, { jobs: 4, descriptions: 2, folders: 3, objects: 6, skipped: 0 });
    const left = (await db.collection("jobs").distinct("job_url")).sort();
    assert.deepEqual(left, ["applied", "edited", "fresh", "later", "manual", "mixed", "queued", "staffing", "swiped"].map((u) => `https://x/${u}`));
    assert.deepEqual((await db.collection("descriptions").distinct("job_url")).sort(), ["https://x/applied", "https://x/being-written"]);
    assert.ok(!fs.existsSync(path.join(root, "2026-11-01", "old")) && fs.existsSync(path.join(root, "2026-11-01", "applied")));
  } finally { await client.close(); await mongod.stop(); }
});

test("jobs: a folder that cannot be deleted keeps its job in Mongo for the next run, and folders outside the roots are never touched", async () => {
  const { planJobs, applyJobs } = await import("../../scripts/resume-retention.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-ret-"));
  const jobs = [
    { job_url: "https://x/a", run_at: new Date("2026-11-01T00:00:00Z"), resume: { pdf_path: path.join(root, "2026-11-01", "a", "r.pdf") } },
    { job_url: "https://x/b", run_at: new Date("2026-11-01T00:00:00Z"), resume: { pdf_path: "/etc/elsewhere/r.pdf" } },
    { job_url: "https://x/c", run_at: new Date("2026-11-01T00:00:00Z"), resume: { pdf_path: path.join(root, "loose.pdf") } },
  ];
  const removed = [];
  const db = { collection: (name) => ({
    find: () => ({ toArray: async () => (name === "jobs" ? jobs : []) }),
    deleteMany: async (q) => { removed.push(...(q.job_url?.$in ?? [])); return { deletedCount: q.job_url?.$in?.length ?? 0 }; },
    distinct: async () => [],
  }) };
  const plan = await planJobs(db, { days: 3, now: NOW, roots: [root] });
  assert.deepEqual([...plan.folders.keys()], [path.join(root, "2026-11-01", "a")]);
  const out = await applyJobs(db, plan, { store: null, rm: () => { throw new Error("EACCES"); }, log: () => {} });
  assert.equal(out.skipped, 1);
  assert.deepEqual(removed.sort(), ["https://x/b", "https://x/c"]);
});

test("general resumes stay: neither an expired job that used one nor the local cleanup deletes them", async () => {
  const { planJobs } = await import("../../scripts/resume-retention.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-ret-"));
  const mk = (...p) => { const f = path.join(root, ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, "pdf a"); return f; };
  const general = mk("general", "Software Engineer", "r.pdf"), loose = mk("general", "r.pdf"), lookalike = mk("general-old", "x", "r.pdf");
  const job = (n, pdf_path) => ({ job_url: `https://x/${n}`, run_at: new Date("2026-11-01T00:00:00Z"), resume: { pdf_path, object: obj("a"), updated_at: "2026-10-01T00:00:00Z" } });
  const jobs = [job("general", general), job("loose", loose), job("lookalike", lookalike)];
  const plan = await planJobs(fakeDb(jobs), { days: 3, now: NOW, roots: [root] });
  assert.deepEqual([...plan.folders.keys()], [path.join(root, "general-old", "x")]);
  const local = await planLocal(fakeDb(jobs), { days: 14, now: NOW, roots: [root] });
  assert.deepEqual(local.files, [lookalike]);
  assert.equal(local.skipped.general, 2);
});
