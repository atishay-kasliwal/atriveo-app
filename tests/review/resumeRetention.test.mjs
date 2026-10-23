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
