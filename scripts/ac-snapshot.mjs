// Resume snapshot metadata — reproducible PDF provenance.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function selectedAcs(composition) {
  const ids = [];
  for (const role of composition.experience || []) {
    for (const b of role.bullets || []) ids.push(b.ac_id || b.ac?.id);
  }
  for (const project of composition.projects || []) {
    for (const b of project.bullets || []) ids.push(b.ac_id || b.ac?.id);
  }
  return [...new Set(ids.filter(Boolean))];
}

function hashText(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex").slice(0, 12);
}

export function buildResumeSnapshot({
  company,
  planner,
  composition,
  bank,
  oracle,
  gate,
  jd,
  tex,
  outputDir,
}) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const slug = String(company || "target").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24);
  const resumeId = `${date}-${slug}-${planner}`;

  return {
    resume_id: resumeId,
    planner,
    thesis: composition.narrative?.thesis || null,
    selected_acs: selectedAcs(composition),
    bank_version: bank?.bank_version ?? bank?.acs?.length ?? null,
    bank_dir: bank?.bank_dir || null,
    oracle: oracle?.oracle_score ?? null,
    evidence_compression: gate?.evidence_compression?.ratio ?? null,
    pdf_gate_pass: gate?.passes ?? null,
    generated_at: new Date().toISOString(),
    jd_hash: hashText(jd),
    tex_hash: hashText(tex),
    output_dir: outputDir,
  };
}

export function persistSnapshot(snapshot, rootDir) {
  const indexPath = path.join(rootDir, "data", "snapshots", "index.jsonl");
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.appendFileSync(indexPath, `${JSON.stringify(snapshot)}\n`);
  return indexPath;
}
