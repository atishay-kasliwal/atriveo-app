// General resumes: one per role track, composed by the same pipeline against that track's neutral
// posting (data/baseline-jds/<track>.txt), for Today's Resumes menu.
//
//   node --env-file=.env.tailor --env-file=.env scripts/general-resumes.mjs [track …]
//
// Output: OUT_ROOT/general/<Track>/Atishay Kasliwal.pdf and OUT_ROOT/general/manifest.json
// (OUT_ROOT = TAILOR_OUT_ROOT or ~/Documents/tailored-resumes; the resume sync copies it to Oracle).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tailorOneAc } from "./tailor-ac.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_ROOT = process.env.TAILOR_OUT_ROOT?.trim() || path.join(os.homedir(), "Documents", "tailored-resumes");
const GENERAL = path.join(OUT_ROOT, "general");

// The header title each general resume shows (the track's role, no seniority).
const TRACKS = {
  "software-engineer": { label: "SWE", title: "Software Engineer", folder: "Software Engineer" },
  "ai-engineer": { label: "AI", title: "AI Engineer", folder: "AI Engineer" },
  "data-analytics": { label: "Data Analyst", title: "Data Analyst", folder: "Data Analyst" },
  "data-science": { label: "DS", title: "Data Scientist", folder: "Data Scientist" },
  "forward-deployed": { label: "FDE", title: "Forward Deployed Engineer", folder: "Forward Deployed Engineer" },
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TRACKS);
const manifestPath = path.join(GENERAL, "manifest.json");
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { resumes: {} };
const buildDir = path.join(GENERAL, ".build");
fs.mkdirSync(buildDir, { recursive: true });

let seq = 0;
for (const track of wanted) {
  const t = TRACKS[track];
  if (!t) { console.error(`Unknown track ${track}; one of ${Object.keys(TRACKS).join(", ")}`); process.exitCode = 1; continue; }
  const jd = fs.readFileSync(path.join(ROOT, "data", "baseline-jds", `${track}.txt`), "utf8");
  const result = await tailorOneAc({ company: "General", title: t.title, job_url: `general:${track}`, jd, location: null, force_recompile: true }, ++seq, buildDir,
    { sendPhase: () => {}, log: (kind, text) => { if (kind !== "step") console.log(`  [${track}] ${text}`); } }, { planner: "v2", forceRecompile: true });
  if (result.status !== "ok" || !result.pdfPath) { console.error(`✗ ${track}: ${result.status} ${result.error ?? ""}`); process.exitCode = 1; continue; }
  const dest = path.join(GENERAL, t.folder, "Atishay Kasliwal.pdf");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(result.pdfPath, dest);
  manifest.resumes[track] = { label: t.label, title: t.title, path: dest, builtAt: new Date().toISOString(), source: result.pdfPath };
  console.log(`✓ ${track} → ${dest}`);
}
manifest.updatedAt = new Date().toISOString();
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
