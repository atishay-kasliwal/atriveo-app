#!/usr/bin/env node
/**
 * Sync resume_bullet fields in role review YAMLs from canonical AC-*.yaml variant text.
 * Preserves comments and structure; only replaces resume_bullet block content.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBank } from "./ac-bank.mjs";

const BANK = path.join(path.dirname(fileURLToPath(import.meta.url)), "../data/ac-bank");

const REVIEW_FILES = {
  accolite: "ACCOLITE.yaml",
  "stony-brook": "STONY-BROOK.yaml",
  "wake-forest": "WAKE-FOREST.yaml",
  atriveo: "ATRIVEO.yaml",
  "insurance-platform": "INSURANCE-PLATFORM.yaml",
  insureraft: "INSURERAFT.yaml",
  "job-pipeline": "JOB-PIPELINE.yaml",
  "bayesian-mmm": "BAYESIAN-MMM.yaml",
  "mri-research": "MRI-RESEARCH.yaml",
  medledger: "MEDLEDGER.yaml",
  "user-data-platform": "USER-DATA-PLATFORM.yaml",
};

function wrapBullet(text, indent, maxLine = 88) {
  const words = text.replace(/\s+/g, " ").trim().split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxLine - indent.length && line) {
      lines.push(`${indent}${line}`);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(`${indent}${line}`);
  return lines;
}

function replaceResumeBullet(content, acId, newText) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const idMatch = lines[i].match(/^(\s*)(?:-\s+)?id:\s+(AC-\d+)\s*$/);
    if (!idMatch || idMatch[2] !== acId) continue;

    const baseBlockIndent = idMatch[1].length;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^\s*- id:\s+AC-\d+\s*$/.test(lines[j]) && lines[j].search(/\S/) <= baseBlockIndent + 2) break;

      const rb = lines[j].match(/^(\s*)resume_bullet:\s*(>-|\|)?\s*$/);
      if (!rb) continue;

      const rbIndent = rb[1].length;
      const wrapIndent = " ".repeat(rbIndent + 2);
      const wrapped = wrapBullet(newText, wrapIndent);

      let k = j + 1;
      while (k < lines.length) {
        const t = lines[k].trim();
        if (t === "") {
          k += 1;
          continue;
        }
        const indent = lines[k].search(/\S/);
        if (indent <= rbIndent) break;
        k += 1;
      }

      lines.splice(j + 1, k - (j + 1), ...wrapped);
      return lines.join("\n");
    }
  }
  return content;
}

function updateBankVersionHeader(content, version) {
  return content.replace(/^#\s*Bank v\d+[^\n]*/m, `# Bank v${version}`);
}

function main() {
  const bank = loadBank();
  let total = 0;

  for (const [role, fileName] of Object.entries(REVIEW_FILES)) {
    const filePath = path.join(BANK, fileName);
    if (!fs.existsSync(filePath)) {
      console.warn(`Skip missing ${fileName}`);
      continue;
    }

    let content = fs.readFileSync(filePath, "utf8");
    const roleAcs = bank.acs.filter(
      (a) => a.role === role && a.visibility?.default !== false && a.variants?.[0]?.text,
    );

    let updated = 0;
    for (const ac of roleAcs) {
      const text = ac.variants[0].text.replace(/\s+/g, " ").trim();
      const next = replaceResumeBullet(content, ac.id, text);
      if (next !== content) {
        content = next;
        updated += 1;
      }
    }

    content = updateBankVersionHeader(content, bank.bank_version);
    fs.writeFileSync(filePath, content);
    console.log(`${fileName}: synced ${updated}/${roleAcs.length} resume_bullet fields`);
    total += updated;
  }

  console.log(`\nDone — ${total} resume_bullet fields updated across review YAMLs.`);
}

main();
