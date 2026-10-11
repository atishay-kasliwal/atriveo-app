// Redraw resumes already built with an employer's tools on the company line ("Accolite Digital | Java, AWS") so the
// tools follow the job title ("Senior Software Developer | Java, AWS"), as new resumes print them (a4b5f73b8).
// Only the heading lines of each resume.tex change; every word stays as built. No AI, nothing re-tailored.
//
//   node scripts/rerender-tools-title.mjs                 dry run, resumes written in the last 24 h
//   node scripts/rerender-tools-title.mjs --hours=72 --apply
//   node scripts/rerender-tools-title.mjs --all --apply   every resume under the output root
//
// Skipped: a resume an application was sent with (APPLIED / SUBMITTING): what was sent stays as sent. A resume that
// doesn't compile to one page keeps its old file. Replaced files are kept under <root>/.backup-tools-title/.
// Applications not yet sent that point at a redrawn PDF re-verify it before attaching (sha256 and a pinned
// extension choice for that file are cleared, as the resume builder's Save does).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";

const PDF = "Atishay Kasliwal.pdf";
const OLD_MACRO = /^\\newcommand\{\\resumeSubheadingTools\}.*\n/m;
const OLD_HEAD = /\\resumeSubheadingTools\{\\textbf\{([^{}]*)\} \$\|\$ \\emph\{\\small ([^{}]*)\}\}\{([^{}]*)\}\{([^{}]*)\}\{([^{}]*)\}/g;
const SENT = ["APPLIED", "SUBMITTING"];

/** The new heading text, or null when a line uses the old macro in a shape this doesn't know (left alone). */
export function convertTex(tex) {
  if (!tex.includes("\\resumeSubheadingTools{")) return null;
  const out = tex.replace(OLD_HEAD, (_m, name, tools, dates, title, loc) => `\\resumeSubheading{${name}}{${dates}}{${title} $|$ ${tools}}{${loc}}`)
    .replace(OLD_MACRO, "");
  return out.includes("\\resumeSubheadingTools") ? null : out;
}

function pages(pdf) {
  const r = spawnSync("pdfinfo", [pdf], { encoding: "utf8" });
  const m = /^Pages:\s+(\d+)/m.exec(r.stdout || "");
  return m ? Number(m[1]) : null;
}

/** Every resume.tex under root (runs and builder edits), newest first. */
function findResumes(root, since) {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 5) walk(p, depth + 1);
      else if (e.isFile() && e.name === "resume.tex" && fs.existsSync(path.join(dir, PDF))) {
        const mtime = fs.statSync(path.join(dir, PDF)).mtimeMs;
        if (since == null || mtime >= since) out.push({ dir, mtime });
      }
    }
  };
  walk(root, 0);
  return out.sort((a, b) => b.mtime - a.mtime);
}

export async function rerender({ db, root, hours = 24, all = false, apply = false, now = Date.now(), log = console.log }) {
  const found = findResumes(root, all ? null : now - hours * 3600 * 1000);
  const tally = { looked: found.length, alreadyNew: 0, sent: 0, unknownShape: 0, notOnePage: 0, failed: 0, redrawn: 0, applicationsReset: 0 };
  const backupRoot = path.join(root, ".backup-tools-title");
  for (const { dir } of found) {
    const texPath = path.join(dir, "resume.tex");
    const pdfPath = path.join(dir, PDF);
    const tex = fs.readFileSync(texPath, "utf8");
    // Defined but unused (no employer had tools): the page already reads right.
    if (!tex.includes("\\resumeSubheadingTools{")) { tally.alreadyNew += 1; continue; }
    const next = convertTex(tex);
    if (!next) { tally.unknownShape += 1; log(`skip (unknown heading shape): ${dir}`); continue; }
    if (await db.collection("applications").countDocuments({ "resume.path": pdfPath, status: { $in: SENT } })) { tally.sent += 1; continue; }
    if (!apply) { tally.redrawn += 1; continue; }

    const work = fs.mkdtempSync(path.join(os.tmpdir(), "tools-title-"));
    try {
      fs.writeFileSync(path.join(work, "resume.tex"), next);
      const r = spawnSync("tectonic", ["resume.tex"], { cwd: work, encoding: "utf8", timeout: 120_000 });
      const built = path.join(work, "resume.pdf");
      if (r.status !== 0 || !fs.existsSync(built)) { tally.failed += 1; log(`compile failed: ${dir}\n${(r.stderr || "").slice(-400)}`); continue; }
      if (pages(built) !== 1) { tally.notOnePage += 1; log(`kept old (not one page): ${dir}`); continue; }
      const backup = path.join(backupRoot, path.relative(root, dir));
      fs.mkdirSync(backup, { recursive: true });
      fs.copyFileSync(pdfPath, path.join(backup, PDF));
      fs.copyFileSync(texPath, path.join(backup, "resume.tex"));
      // Same folder, then rename: a reader never sees half a file.
      fs.copyFileSync(built, `${pdfPath}.new`);
      fs.renameSync(`${pdfPath}.new`, pdfPath);
      fs.writeFileSync(`${texPath}.new`, next);
      fs.renameSync(`${texPath}.new`, texPath);
      tally.redrawn += 1;
      const res = await db.collection("applications").updateMany(
        { "resume.path": pdfPath, status: { $nin: SENT } },
        { $set: { "resume.sha256": null } });
      await db.collection("applications").updateMany(
        { "extension.resumeChoice.path": pdfPath, status: { $nin: SENT } },
        { $unset: { "extension.resumeChoice": "" } });
      tally.applicationsReset += res.modifiedCount;
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }
  log(`${all ? "All resumes" : `Resumes written in the last ${hours} h`}: ${tally.looked} · already new layout ${tally.alreadyNew} · sent with an application (left as sent) ${tally.sent} · unknown shape ${tally.unknownShape}`);
  log(apply
    ? `Redrawn ${tally.redrawn} · kept old (not one page) ${tally.notOnePage} · compile failed ${tally.failed} · applications to re-verify ${tally.applicationsReset} · backups in ${backupRoot}`
    : `Would redraw ${tally.redrawn}. Dry run: add --apply.`);
  return tally;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  dotenv.config();
  const apply = process.argv.includes("--apply");
  const all = process.argv.includes("--all");
  const hoursArg = process.argv.find((a) => a.startsWith("--hours="));
  const hours = hoursArg ? Number(hoursArg.split("=")[1]) : 24;
  if (!(hours > 0)) throw new Error(`--hours must be positive, got ${hours}`);
  const root = process.env.TAILOR_OUT_ROOT || path.join(os.homedir(), "Documents", "tailored-resumes");
  const { withMongo, closeMongo } = await import("./mongo-client.mjs");
  try {
    await withMongo((db) => rerender({ db, root, hours, all, apply }), { appName: "AtriveoRerenderToolsTitle" });
  } finally {
    await closeMongo();
  }
}
