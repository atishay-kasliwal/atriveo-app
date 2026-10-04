#!/usr/bin/env node
// Compare two saved Phase 2 JSON reports and explain category/requirement changes.
import fs from "node:fs";

export function diffScores(before, after) {
  const a = before.job_match || before;
  const b = after.job_match || after;
  if (!a?.categories || !b?.categories) throw new Error("Both inputs must contain Job Match reports");
  const old = new Map(a.categories.map((c) => [c.key, c]));
  const changes = b.categories.map((c) => {
    const prev = old.get(c.key);
    const items = new Map((prev?.items || []).map((i) => [i.label, i]));
    return { category: c.key, before: prev?.earned ?? 0, after: c.earned, delta: Math.round((c.earned - (prev?.earned ?? 0)) * 10) / 10,
      requirements: c.items.filter((i) => i.earned !== (items.get(i.label)?.earned ?? 0)).map((i) => ({ label: i.label, before: items.get(i.label)?.earned ?? 0, after: i.earned, evidence: i.evidence })) };
  }).filter((x) => x.delta || x.requirements.length);
  return { before: a.score, after: b.score, delta: Math.round((b.score - a.score) * 10) / 10,
    changed_config: a.config_hash !== b.config_hash, changed_date: a.as_of !== b.as_of, changes };
}

if (process.argv[1]?.endsWith("/diff-cli.mjs")) {
  try {
    const [oldPath, newPath] = process.argv.slice(2);
    if (!oldPath || !newPath) throw new Error("Usage: npm run ats:diff -- before.json after.json");
    console.log(JSON.stringify(diffScores(JSON.parse(fs.readFileSync(oldPath, "utf8")), JSON.parse(fs.readFileSync(newPath, "utf8"))), null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
