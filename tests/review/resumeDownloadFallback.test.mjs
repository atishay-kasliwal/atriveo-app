import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { saveResumeToDirectory, resumeFolderZip } from "../../src/utils/resumeDownload.ts";

const filename = "2026-10-06_general_AI-Engineer-posting-version/Atishay Kasliwal.pdf";
test("folder picker saves and repeats the exact filename for general resumes", async () => {
  const calls = [];
  const parent = { getDirectoryHandle: async (name, options) => {
    calls.push(["folder", name, options]);
    return { getFileHandle: async (name, options) => {
      calls.push(["file", name, options]);
      return { createWritable: async () => ({ write: async (blob) => calls.push(["bytes", await blob.text()]), close: async () => calls.push(["close"]), abort: async () => calls.push(["abort"]) }) };
    } };
  } };
  const blob = new Blob(["%PDF-1.4\nfixture"]);
  await saveResumeToDirectory(parent, filename, blob);
  await saveResumeToDirectory(parent, filename, blob);
  assert.equal(calls.filter(([type]) => type === "file").length, 2);
  assert.ok(calls.filter(([type]) => type === "file").every(([, name]) => name === "Atishay Kasliwal.pdf"));
  assert.equal(calls.filter(([type]) => type === "close").length, 2);
  await assert.rejects(saveResumeToDirectory(parent, "../Atishay Kasliwal.pdf", blob));
});

test("browser fallback ZIP extracts a folder with an unchanged PDF name and bytes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resume-zip-"));
  try {
    const zip = await resumeFolderZip(filename, new Blob(["%PDF-1.4\nfixture"]));
    const file = path.join(dir, "resume.zip");
    fs.writeFileSync(file, Buffer.from(await zip.arrayBuffer()));
    const result = spawnSync("python3", ["-c", "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert z.namelist()==[sys.argv[2]]; assert z.read(sys.argv[2])==b'%PDF-1.4\\nfixture'", file, filename], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
