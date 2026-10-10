#!/usr/bin/env node
// Your bullets from the resume builder, into the git bank (docs/resume-builder.md, "Export your bullets to git").
//
// The builder keeps bullets you write or reword in Mongo `bank_overlay` (scripts/ac-bank-overlay.mjs); loadBank merges
// them over data/ac-bank. This writes them into the YAML so they're in git, reviewable and backed up:
//   a new bullet (AC-U001…)   → data/ac-bank/AC-U001.yaml
//   a reworded bullet         → that entry's variant `text`, the old wording kept in the variant's `earlier_texts`
//                               (resumes that printed it stay valid in the builder)
//   a retirement (bank page)  → `tracks: [retired]` on the entry (with a "# Retired" comment) or on that variant
// Then it runs the bank lint on the result (git only, no overlay) and shows the diff. You commit.
// Safe to run again: what's already in git is skipped, and once in git the overlay's copy changes nothing.
//
//   npm run bank:export -- [--dry-run] [--prune]
//   (finds MONGO_URI in .env.tailor / .env here, or in ~/atriveo-app's when run from another worktree)
//     --prune     also delete overlay entries that are now in git (asks nothing; only exact matches)
//     --dry-run   show what would change, write nothing
//     --from F    read the overlay from a JSON file ({ entries }) instead of Mongo (tests)
//   AC_BANK_DIR picks the bank folder (default data/ac-bank).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { resolveBankDir } from "./ac-bank.mjs";
import { OVERLAY_COLLECTION } from "./ac-bank-overlay.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const norm = (t) => String(t ?? "").replace(/\s+/g, " ").trim();

/** The text block as the bank writes it: `text: >-` and the words wrapped at ~130 columns under `indent`. */
function textBlock(text, indent) {
  const words = norm(text).split(" ");
  const lines = [];
  let line = "";
  for (const w of words) { if (line && (indent.length + 2 + line.length + 1 + w.length) > 134) { lines.push(line); line = w; } else line = line ? `${line} ${w}` : w; }
  if (line) lines.push(line);
  return [`${indent}text: >-`, ...lines.map((l) => `${indent}  ${l}`)];
}

/**
 * The YAML with one variant's text replaced (by facet), the old wording added to its `earlier_texts`. A targeted
 * edit, so the rest of the file (comments, order, folding) stays as it is. Returns null when the variant isn't there.
 */
export function rewordYaml(src, facet, text) {
  const lines = src.split("\n");
  const vStart = lines.findIndex((l) => /^variants:\s*$/.test(l));
  if (vStart < 0) return null;
  // Find "- facet: <facet>" under variants, then its keys (indented under the dash).
  let i = vStart + 1, item = -1;
  for (; i < lines.length && (/^\s/.test(lines[i]) || lines[i] === ""); i++) {
    const m = lines[i].match(/^(\s*)- facet:\s*(\S+)\s*$/);
    if (m && m[2].replace(/['"]/g, "") === facet) { item = i; break; }
  }
  if (item < 0) return null;
  const keyIndent = lines[item].match(/^(\s*)-/)[1] + "  ";
  let end = item + 1;
  while (end < lines.length && lines[end].startsWith(keyIndent)) end++;
  const body = lines.slice(item, end);
  const tAt = body.findIndex((l) => l.startsWith(`${keyIndent}text:`));
  if (tAt < 0) return null;
  let tEnd = tAt + 1;
  while (tEnd < body.length && body[tEnd].startsWith(keyIndent + " ")) tEnd++;
  const parsed = yaml.load(body.map((l) => l.slice(keyIndent.length)).join("\n").replace(/^- /, "")) ?? {};
  const old = norm(parsed.text);
  if (old === norm(text)) return src;
  const earlier = [...new Set([...(parsed.earlier_texts ?? []).map(norm), old].filter((t) => t && t !== norm(text)))];
  // Drop the old text and an old earlier_texts list, then write both fresh where the text was.
  const kept = body.filter((_, k) => k < tAt || k >= tEnd);
  const eAt = kept.findIndex((l) => l.startsWith(`${keyIndent}earlier_texts:`));
  if (eAt >= 0) { let eEnd = eAt + 1; while (eEnd < kept.length && kept[eEnd].startsWith(keyIndent + " ")) eEnd++; kept.splice(eAt, eEnd - eAt); }
  const insert = [...textBlock(text, keyIndent), `${keyIndent}earlier_texts:`, ...earlier.map((t) => `${keyIndent}  - ${JSON.stringify(t)}`)];
  kept.splice(Math.min(tAt, kept.length), 0, ...insert);
  return [...lines.slice(0, item), ...kept, ...lines.slice(end)].join("\n");
}

/**
 * The YAML with the entry (facet null) or one variant retired: its `tracks` replaced by `[retired]`, the track no resume
 * uses. An entry also gets a "# Retired <date> on the bank page" comment, as the hand-retired ones have. null: no variant.
 */
export function retireYaml(src, facet, reason = "", date = "") {
  const lines = src.split("\n");
  const dropKey = (arr, from, to, indent) => {
    const at = arr.findIndex((l, k) => k >= from && k < to && l.startsWith(`${indent}tracks:`));
    if (at < 0) return arr;
    let end = at + 1;
    while (end < arr.length && (arr[end].startsWith(`${indent} `) || (indent === "" && /^\s+-/.test(arr[end])))) end++;
    return [...arr.slice(0, at), ...arr.slice(end)];
  };
  if (facet == null) {
    const top = lines.findIndex((l) => /^variants:\s*$/.test(l));
    const kept = dropKey(lines, 0, top < 0 ? lines.length : top, "");
    const roleAt = kept.findIndex((l) => /^role:/.test(l));
    const note = `# Retired${date ? ` ${date}` : ""} on the bank page${reason ? ` (${norm(reason)})` : ""}: hidden from every resume.`;
    kept.splice(roleAt + 1, 0, note, "tracks:", "  - retired");
    return kept.join("\n");
  }
  const vStart = lines.findIndex((l) => /^variants:\s*$/.test(l));
  let item = -1;
  for (let i = vStart + 1; vStart >= 0 && i < lines.length && (/^\s/.test(lines[i]) || lines[i] === ""); i++) {
    const m = lines[i].match(/^(\s*)- facet:\s*(\S+)\s*$/);
    if (m && m[2].replace(/['"]/g, "") === facet) { item = i; break; }
  }
  if (item < 0) return null;
  const keyIndent = lines[item].match(/^(\s*)-/)[1] + "  ";
  let end = item + 1;
  while (end < lines.length && lines[end].startsWith(keyIndent)) end++;
  const body = dropKey(lines.slice(item + 1, end), 0, end - item - 1, keyIndent);
  return [...lines.slice(0, item + 1), `${keyIndent}tracks:`, `${keyIndent}  - retired`, ...body, ...lines.slice(end)].join("\n");
}

/** What exporting `entries` into `bankDir` changes: [{ file, kind, id, before, after }]. Writes nothing. */
export function planExport(entries, bankDir) {
  const out = [];
  for (const e of entries.filter((x) => x.type === "new" && x.ac?.id)) {
    const file = path.join(bankDir, `${e.ac.id}.yaml`);
    const { source, ...ac } = e.ac;
    const after = `# Written in the resume builder (${e.createdAt ?? "date unknown"}); exported by scripts/export-bank-overlay.mjs.\n${yaml.dump({ ...ac, provenance: { level: "USER_WRITTEN", written_at: (e.createdAt ?? "").slice(0, 10) || null, context: "Resume builder" } }, { lineWidth: 130, noRefs: true })}`;
    const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (before !== null) continue; // already in git (maybe edited since): leave it
    out.push({ file, kind: "new", id: e.ac.id, before, after });
  }
  for (const e of entries.filter((x) => x.type === "reword")) {
    const file = path.join(bankDir, `${e.ac_id}.yaml`);
    if (!fs.existsSync(file)) { out.push({ file, kind: "missing", id: e._id }); continue; }
    const before = fs.readFileSync(file, "utf8");
    const pending = out.find((o) => o.file === file);
    const src = pending ? pending.after : before;
    const after = rewordYaml(src, e.facet ?? "default", e.text);
    if (after === null) { out.push({ file, kind: "missing", id: e._id }); continue; }
    if (after === src) continue;
    if (pending) pending.after = after; else out.push({ file, kind: "reword", id: e._id, before, after });
  }
  for (const e of entries.filter((x) => x.type === "retire")) {
    const file = path.join(bankDir, `${e.ac_id}.yaml`);
    if (!fs.existsSync(file)) { out.push({ file, kind: "missing", id: e._id }); continue; }
    const before = fs.readFileSync(file, "utf8");
    const pending = out.find((o) => o.file === file);
    const src = pending ? pending.after : before;
    if (isRetiredIn(yaml.load(src), e.facet)) continue;
    const after = retireYaml(src, e.facet ?? null, e.reason, (e.createdAt ?? "").slice(0, 10));
    if (after === null) { out.push({ file, kind: "missing", id: e._id }); continue; }
    if (pending) pending.after = after; else out.push({ file, kind: "retire", id: e._id, before, after });
  }
  return out;
}

const isRetiredIn = (ac, facet) => (facet == null ? ac?.tracks : ac?.variants?.find((v) => (v.facet ?? "default") === facet)?.tracks)?.includes("retired") ?? false;

/** Overlay entries already in the bank's YAML word for word (the ones --prune may delete). */
export function inGit(entries, bankDir) {
  return entries.filter((e) => {
    const file = path.join(bankDir, `${e.type === "new" ? e.ac?.id : e.ac_id}.yaml`);
    if (!fs.existsSync(file)) return false;
    const ac = yaml.load(fs.readFileSync(file, "utf8"));
    if (e.type === "new") return (ac.variants ?? []).some((v) => norm(v.text) === norm(e.ac.variants?.[0]?.text));
    if (e.type === "retire") return isRetiredIn(ac, e.facet ?? null);
    return (ac.variants ?? []).some((v) => (v.facet ?? "default") === (e.facet ?? "default") && norm(v.text) === norm(e.text));
  });
}

/** The bank lint on bankDir alone (no overlay): { ok, output }. */
export function lintBank(bankDir) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "ac-bullet-lint.mjs")], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, AC_BANK_DIR: bankDir, AC_BANK_OVERLAY: path.join(os.tmpdir(), "atriveo-no-overlay.json") },
  });
  return { ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  const prune = args.includes("--prune");
  const from = args.includes("--from") ? args[args.indexOf("--from") + 1] : null;
  const bankDir = resolveBankDir();
  let entries, client = null, db = null;
  if (from) entries = JSON.parse(fs.readFileSync(from, "utf8")).entries ?? [];
  else {
    // The Mongo settings: already in the environment, or the .env files here, or the main checkout's.
    for (const dir of [ROOT, path.join(os.homedir(), "atriveo-app")]) {
      if (process.env.MONGO_URI) break;
      for (const f of [".env.tailor", ".env"]) { try { process.loadEnvFile(path.join(dir, f)); } catch { /* not there */ } }
    }
    if (!process.env.MONGO_URI) throw new Error("No MONGO_URI: run from ~/atriveo-app, or pass --env-file.");
    const { connectMongo, getDb } = await import("./mongo-client.mjs");
    client = await connectMongo({ appName: "export-bank-overlay" });
    db = getDb(client);
    entries = await db.collection(OVERLAY_COLLECTION).find({}).sort({ _id: 1 }).toArray();
  }
  try {
    console.log(`${entries.length} overlay entr${entries.length === 1 ? "y" : "ies"} (${entries.filter((e) => e.type === "new").length} new, ${entries.filter((e) => e.type === "reword").length} reworded) → ${path.relative(ROOT, bankDir) || bankDir}`);
    const plan = planExport(entries, bankDir);
    for (const p of plan) console.log(`  ${p.kind === "new" ? "+" : p.kind === "reword" ? "~" : p.kind === "retire" ? "-" : "!"} ${path.basename(p.file)}  ${p.kind === "missing" ? `(${p.id}: its bank entry or variant is gone; left in the overlay)` : p.id}`);
    if (!plan.some((p) => p.after)) console.log("  Nothing to write: the bank already has every bullet.");
    if (!dry) for (const p of plan) if (p.after) fs.writeFileSync(p.file, p.after.endsWith("\n") ? p.after : `${p.after}\n`);
    if (!dry && plan.some((p) => p.after)) {
      const lint = lintBank(bankDir);
      console.log(`\nBank lint: ${lint.ok ? "passes" : "FAILS"}`);
      if (!lint.ok) { console.log(lint.output.split("\n").slice(-25).join("\n")); process.exitCode = 1; }
      const diff = spawnSync("git", ["diff", "--stat", "--", bankDir], { cwd: ROOT, encoding: "utf8" });
      const added = spawnSync("git", ["status", "--short", "--", bankDir], { cwd: ROOT, encoding: "utf8" });
      console.log(`\n${(diff.stdout || "").trim()}\n${(added.stdout || "").split("\n").filter((l) => l.startsWith("??")).join("\n")}`.trim());
      console.log("\nReview with `git diff data/ac-bank`, then commit.");
    }
    if (prune) {
      if (!db) { console.log("--prune needs the Mongo overlay (not --from)."); return; }
      if (dry) { console.log(`--prune would delete ${inGit(entries, bankDir).length} overlay entries already in git.`); return; }
      const done = inGit(entries, bankDir);
      if (done.length) await db.collection(OVERLAY_COLLECTION).deleteMany({ _id: { $in: done.map((e) => e._id) } });
      console.log(`Pruned ${done.length} overlay entr${done.length === 1 ? "y" : "ies"} now in git.`);
    }
  } finally { await client?.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
