#!/usr/bin/env node
// Pull requests skipped on the open source page, into data/ac-bank/OSS_DECISIONS.yaml (docs/open-source-rules.md).
// The page keeps a skip and its reason in Mongo `oss_prs` (mine.skip, mine.why); the weekly update writes them to git
// so the audit and every session see the same decisions. Already-listed pull requests are left alone.
//   npm run oss:export -- [--dry-run]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { resolveBankDir } from "./ac-bank.mjs";
import { PRS, decisionsWith } from "./open-source.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The YAML lines to append for decisions made on the page. Pure. */
export function decisionLines(fileDecisions, docs) {
  return decisionsWith(fileDecisions, docs).filter((d) => d.page).flatMap((d) => [
    `  - pr: ${d.pr}`, ...(d.state ? [`    state: ${d.state}`] : []), "    decision: no-bullet", `    why: ${JSON.stringify(d.why)}`, `    decided: "${d.decided || new Date().toISOString().slice(0, 10)}"`,
  ]);
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  for (const dir of [ROOT, path.join(os.homedir(), "atriveo-app")]) {
    if (process.env.MONGO_URI) break;
    for (const f of [".env.tailor", ".env"]) { try { process.loadEnvFile(path.join(dir, f)); } catch { /* not there */ } }
  }
  if (!process.env.MONGO_URI) throw new Error("No MONGO_URI: run from ~/atriveo-app, or pass --env-file.");
  const file = path.join(resolveBankDir(), "OSS_DECISIONS.yaml");
  const text = fs.readFileSync(file, "utf8");
  const { connectMongo, getDb } = await import("./mongo-client.mjs");
  const client = await connectMongo({ appName: "oss-export-decisions" });
  try {
    const docs = await getDb(client).collection(PRS).find({ "mine.skip": true }).toArray();
    const lines = decisionLines(yaml.load(text)?.decisions || [], docs);
    if (!lines.length) { console.log("Nothing new: every page decision is already in OSS_DECISIONS.yaml."); return; }
    console.log(lines.join("\n"));
    if (!dry) { fs.writeFileSync(file, `${text.replace(/\n*$/, "\n")}${lines.join("\n")}\n`); console.log(`\nAdded to ${path.relative(ROOT, file)}. Review with git diff, then commit.`); }
  } finally { await client.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
