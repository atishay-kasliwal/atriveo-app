import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { signRequest, createStore, publishResume, fetchResumeToFile, resumeKey, imageKey, storeFromEnv, resumeFileRedirect } from "../../scripts/resume-store.mjs";

test("SigV4 matches AWS's published GET-object example", () => {
  const r = signRequest({
    method: "GET", host: "examplebucket.s3.amazonaws.com", canonicalPath: "/test.txt", headers: { range: "bytes=0-9" },
    accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1", amzDate: "20130524T000000Z",
  });
  assert.equal(r.signature, "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
});

// A tiny in-memory S3: stores objects, and records that every request was signed.
function fakeR2() {
  const objects = new Map(), seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, hash: req.headers["x-amz-content-sha256"] });
      const key = decodeURIComponent(req.url.split("?")[0]);
      if (req.method === "PUT") { objects.set(key, Buffer.concat(chunks)); res.writeHead(200); res.end(); }
      else if (!objects.has(key)) { res.writeHead(404); res.end(); }
      else { res.writeHead(200, { "content-length": objects.get(key).length }); res.end(req.method === "HEAD" ? undefined : objects.get(key)); }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, objects, seen, endpoint: `http://127.0.0.1:${server.address().port}` })));
}

test("publishResume stores the PDF and its page image once, by content hash, and returns the Mongo reference", async () => {
  const fake = await fakeR2();
  try {
    const store = createStore({ endpoint: fake.endpoint, bucket: "atriveo-resumes", accessKeyId: "id", secretAccessKey: "secret" });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resume-"));
    const pdf = path.join(dir, "Atishay Kasliwal.pdf");
    fs.writeFileSync(pdf, "%PDF-1.5 test resume");
    fs.writeFileSync(path.join(dir, "resume-page.png"), "png bytes");
    fs.writeFileSync(path.join(dir, "resume.tex"), "\\documentclass{article}");
    fs.writeFileSync(path.join(dir, "jd.txt"), "The posting");
    const a = await publishResume(pdf, { store });
    assert.equal(a.configured, true);
    assert.equal(a.object.key, resumeKey(a.object.sha256));
    assert.equal(a.object.image_key, imageKey(a.object.sha256));
    assert.equal(a.object.bucket, "atriveo-resumes");
    assert.equal(fake.objects.size, 4);
    assert.equal(a.object.tex_key, `resumes/${a.object.sha256.slice(0, 2)}/${a.object.sha256}.tex`);
    assert.equal(a.object.jd_key, `resumes/${a.object.sha256.slice(0, 2)}/${a.object.sha256}.jd.txt`);
    const puts = fake.seen.filter((s) => s.method === "PUT").length;
    const b = await publishResume(pdf, { store });
    assert.deepEqual(b.object, a.object, "same file, same key");
    assert.equal(fake.seen.filter((s) => s.method === "PUT").length, puts, "an existing object is not uploaded again");
    assert.ok(fake.seen.every((s) => /^AWS4-HMAC-SHA256 Credential=id\//.test(s.auth) && s.hash));
    const file = await fetchResumeToFile(a.object, path.join(dir, "out"), { store });
    assert.equal(fs.readFileSync(file, "utf8"), "%PDF-1.5 test resume");
    fake.objects.set(`/atriveo-resumes/${a.object.key}`, Buffer.from("tampered"));
    await assert.rejects(fetchResumeToFile(a.object, path.join(dir, "out2"), { store }), /does not match/);
  } finally { fake.server.close(); }
});

test("a storage failure never throws into the compile; not configured is a quiet no-op", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resume-"));
  const pdf = path.join(dir, "r.pdf");
  fs.writeFileSync(pdf, "x");
  assert.deepEqual(await publishResume(pdf, { store: null }), { configured: false });
  const broken = createStore({ endpoint: "http://127.0.0.1:1", bucket: "b", accessKeyId: "i", secretAccessKey: "s" });
  const r = await publishResume(pdf, { store: broken });
  assert.equal(r.configured, true);
  assert.ok(r.error);
  assert.equal(storeFromEnv({}), null);
});

test("presigned links carry an expiry and a signature, and no secret", () => {
  const store = createStore({ endpoint: "https://acct.r2.cloudflarestorage.com", bucket: "b", accessKeyId: "id", secretAccessKey: "topsecret", now: () => new Date("2026-10-23T12:00:00Z") });
  const url = store.presignGet("resumes/ab/abc.pdf", 120);
  assert.match(url, /X-Amz-Expires=120/);
  assert.match(url, /X-Amz-Signature=[0-9a-f]{64}$/);
  assert.ok(!url.includes("topsecret"));
});

test("updateResumeState keeps an R2 reference beside pdf_path on success, and only then", async () => {
  const { updateResumeState } = await import("../../scripts/resume-queue.mjs");
  const fake = await fakeR2();
  const saved = {};
  const db = { collection: () => ({ updateOne: async (_f, u) => Object.assign(saved, u.$set) }) };
  const keep = { ...process.env };
  Object.assign(process.env, { R2_ACCOUNT_ID: "x", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" });
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resume-"));
    const pdf = path.join(dir, "r.pdf");
    fs.writeFileSync(pdf, "%PDF fake");
    // Real R2 is unreachable from here (no network keys): the row still succeeds and records why nothing was stored.
    await updateResumeState(db, "https://example.com/j", { status: "success", pdf_path: pdf });
    assert.equal(saved["resume.status"], "success");
    assert.equal(saved["resume.pdf_path"], pdf);
    assert.ok(saved["resume.object_error"] || saved["resume.object"]);
    const failed = {};
    const db2 = { collection: () => ({ updateOne: async (_f, u) => Object.assign(failed, u.$set) }) };
    await updateResumeState(db2, "https://example.com/j", { status: "failed", pdf_path: null });
    assert.ok(!("resume.object" in failed) && !("resume.object_error" in failed));
  } finally { for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) delete process.env[k]; Object.assign(process.env, keep); fake.server.close(); }
});

test("resume-file answers with a short-lived redirect, and refuses a bad hash or no R2", async () => {
  const { resumeFileRedirect } = await import("../../scripts/resume-store.mjs");
  const store = createStore({ endpoint: "https://acct.r2.cloudflarestorage.com", bucket: "b", accessKeyId: "id", secretAccessKey: "s" });
  const sha = "a".repeat(64);
  const pdf = resumeFileRedirect({ sha, kind: "pdf" }, { store });
  assert.equal(pdf.status, 302);
  assert.ok(pdf.location.includes(`/b/resumes/aa/${sha}.pdf?`));
  assert.ok(resumeFileRedirect({ sha, kind: "image" }, { store }).location.includes(`${sha}.png?`));
  assert.equal(resumeFileRedirect({ sha: "../../etc/passwd" }, { store }).status, 400);
  assert.equal(resumeFileRedirect({ sha }, { store: null }).status, 404);
});


test("PDF downloads sign attachment headers while previews stay inline",()=>{
 const store=createStore({endpoint:"https://acct.r2.cloudflarestorage.com",bucket:"b",accessKeyId:"id",secretAccessKey:"secret",now:()=>new Date("2026-10-25T12:00:00Z")});
 const sha="a".repeat(64);
 const preview=new URL(resumeFileRedirect({sha,kind:"pdf"},{store}).location);
 const download=new URL(resumeFileRedirect({sha,kind:"pdf",dl:"1"},{store}).location);
 assert.equal(preview.searchParams.has("response-content-disposition"),false);
 assert.equal(download.searchParams.get("response-content-disposition"),'attachment; filename="Atishay Kasliwal.pdf"');
 assert.notEqual(download.searchParams.get("X-Amz-Signature"),preview.searchParams.get("X-Amz-Signature"));
 assert.equal(new URL(resumeFileRedirect({sha,kind:"image",dl:"1"},{store}).location).searchParams.has("response-content-disposition"),false);
});
