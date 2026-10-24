import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { checkR2 } from "../../scripts/r2-check.mjs";

function fake(status = 200) {
  const objects = new Map();
  const server = http.createServer((req, res) => {
    const chunks = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const key = req.url.split("?")[0];
      if (status !== 200) { res.writeHead(status); return res.end(); }
      if (req.method === "PUT") { objects.set(key, Buffer.concat(chunks)); res.writeHead(200); return res.end(); }
      if (req.method === "DELETE") { objects.delete(key); res.writeHead(204); return res.end(); }
      if (!objects.has(key)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-length": objects.get(key).length }); res.end(req.method === "HEAD" ? undefined : objects.get(key));
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, endpoint: `http://127.0.0.1:${server.address().port}`, objects })));
}

test("a working key writes, reads back and deletes, and leaves nothing behind", async () => {
  const f = await fake();
  try {
    const r = await checkR2({ endpoint: f.endpoint, bucket: "b", accessKeyId: "id", secretAccessKey: "secret" });
    assert.equal(r.ok, true);
    assert.equal(f.objects.size, 0);
  } finally { f.server.close(); }
});

test("a refused key is reported with a plain hint and the step that failed", async () => {
  const f = await fake(403);
  try {
    const r = await checkR2({ endpoint: f.endpoint, bucket: "b", accessKeyId: "id", secretAccessKey: "secret" });
    assert.equal(r.ok, false);
    assert.equal(r.step, "write");
    assert.match(r.hint, /Object Read & Write/);
    assert.ok(!JSON.stringify(r).includes("secret"), "the secret never appears in the result");
  } finally { f.server.close(); }
});

test("a missing bucket points at the account and bucket names", async () => {
  const f = await fake(404);
  try {
    const r = await checkR2({ endpoint: f.endpoint, bucket: "nope", accessKeyId: "id", secretAccessKey: "secret" });
    assert.equal(r.ok, false);
    assert.match(r.hint, /bucket/i);
  } finally { f.server.close(); }
});

// The whole set-r2 script, against a fake bucket and an `ssh` stand-in that runs the remote command locally on a temp env file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

test("set-r2: tests the key first, then replaces only the R2 lines in the env file, keeps a backup, and never prints the secret", async () => {
  const f = await fake();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "setr2-"));
  const envFile = path.join(dir, "dashboard.env");
  fs.writeFileSync(envFile, "MONGO_URI=mongodb://x\nR2_BUCKET=old-bucket\nR2_ACCESS_KEY_ID=OLDKEYOLDKEYOLDKEY\nNTFY_TOPIC=topic\nR2_SECRET_ACCESS_KEY=oldsecret\n", { mode: 0o600 });
  fs.mkdirSync(path.join(dir, "bin"));
  // A fake ssh: the last argument is the remote command; run it here, with stdin passed through.
  fs.writeFileSync(path.join(dir, "bin/ssh"), '#!/bin/sh\nfor a; do last="$a"; done\nexec bash -c "$last"\n', { mode: 0o755 });
  const SECRET = "s".repeat(40);
  // Async, so this process can answer the fake bucket while the script runs.
  const run = (extra = {}) => new Promise((resolve) => execFile("bash", ["scripts/set-r2.sh"], {
    timeout: 30_000,
    env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, R2_ENDPOINT: f.endpoint, R2_ENVFILE: envFile, SET_R2_SKIP_RESTART: "1",
      R2_ACCESS_KEY_ID: "A".repeat(32), R2_SECRET_ACCESS_KEY: SECRET, ...extra },
  }, (error, stdout, stderr) => resolve({ status: error ? (error.code ?? 1) : 0, stdout, stderr })));
  try {
    const bad = await run({ R2_ENDPOINT: "http://127.0.0.1:1" });
    assert.notEqual(bad.status, 0, "an unreachable bucket stops the script");
    assert.match(bad.stderr, /Nothing was changed on Oracle/);
    assert.ok(fs.readFileSync(envFile, "utf8").includes("OLDKEYOLDKEYOLDKEY"), "the env file is untouched after a failed test");

    const ok = await run();
    assert.equal(ok.status, 0, ok.stderr);
    assert.ok(!(ok.stdout + ok.stderr).includes(SECRET), "the secret is never printed");
    const after = fs.readFileSync(envFile, "utf8");
    assert.match(after, /^MONGO_URI=mongodb:\/\/x$/m);
    assert.match(after, /^NTFY_TOPIC=topic$/m);
    assert.equal((after.match(/^R2_/gm) || []).length, 4);
    assert.match(after, /^R2_BUCKET=atriveo-resume$/m);
    assert.ok(after.includes(`R2_SECRET_ACCESS_KEY=${SECRET}`));
    assert.ok(!after.includes("old-bucket") && !after.includes("oldsecret"));
    assert.ok(fs.readFileSync(`${envFile}.bak-r2`, "utf8").includes("oldsecret"), "the old file is kept as a backup");
    assert.equal(fs.statSync(envFile).mode & 0o077, 0, "the env file stays private");
    assert.equal(fs.statSync(`${envFile}.bak-r2`).mode & 0o077, 0, "so does the backup");

    const short = await run({ R2_SECRET_ACCESS_KEY: "short" });
    assert.notEqual(short.status, 0);
  } finally { f.server.close(); }
});
