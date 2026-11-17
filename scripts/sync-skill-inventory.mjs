// Export the approved inventory for the browser and standalone job-search pipeline.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SKILLS_LIBRARY } from "./skills-library.mjs";
import { loadSkillEvidence, skillEvidenceSources, skillEvidenceKey } from "./skill-evidence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = loadSkillEvidence(path.join(root, "data/ac-bank"));
// Merged and open evidence (merged urls first); a closed PR never counts. `merged` marks the first priority.
const evidence = skillEvidenceSources(source.records, { includeOpen: true });
const mergedEvidence = skillEvidenceSources(source.records);
const seen = new Set();
const vocabulary = SKILLS_LIBRARY.flatMap((category) => category.skills.flatMap((skill) => {
  const key = skillEvidenceKey(skill.name);
  if (seen.has(key)) return [];
  seen.add(key);
  // A related tool is not an equivalent spelling. Keep the export conservative.
  const aliases = { Go: ["golang"], "Shell Scripting": ["bash", "shell scripting"],
    "Server-Sent Events": ["sse"], "Function Calling": ["tool calling"],
    "Agent Systems": ["ai agents", "agent orchestration", "multi-agent systems"],
    "Web Accessibility": ["a11y"], Internationalization: ["i18n", "localization"],
    "Content Security Policy": ["csp"], Kubernetes: ["k8s"], GraphSAGE: ["graph sage"],
    "NATS JetStream": ["jetstream"], "Apache Pulsar": ["pulsar"],
    "REST APIs": ["rest api"], "Stream Processing": ["stream processing"],
    "Kubernetes Informers": ["informer caches"],
    "Kubernetes Admission Webhooks": ["admission webhooks"],
  };
  return [{ name: skill.name, category: category.label,
    terms: [...new Set([skill.name, ...(aliases[skill.name] || [])])],
    merged: mergedEvidence.has(key),
    sources: [...(evidence.get(key) || [])] }];
}));
const payload = JSON.stringify({ version: 1, evidence_snapshot: source.evidence_snapshot,
  skills: vocabulary.filter((skill) => skill.sources.length), vocabulary }, null, 2) + "\n";
const args = process.argv.slice(2);
const outputs = [path.join(root, "data/skill-inventory.json")];
const pipelineFlag = args.indexOf("--pipeline-dir");
if (pipelineFlag >= 0) {
  if (!args[pipelineFlag + 1]) throw new Error("--pipeline-dir requires a directory");
  outputs.push(path.resolve(args[pipelineFlag + 1], "data/skill_inventory.json"));
} else {
  // The local job-pipeline checkout (same default as scrape-control.mjs), once it reads the inventory.
  const pipelineDir = process.env.JOB_PIPELINE_DIR?.trim() || path.join(os.homedir(), "job-pipeline");
  if (fs.existsSync(path.join(pipelineDir, "job_pipeline/skill_inventory.py"))) outputs.push(path.join(pipelineDir, "data/skill_inventory.json"));
}
for (const file of outputs) {
  if (args.includes("--check")) {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== payload) throw new Error(`Stale skills inventory: ${file}`);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, payload);
  }
}
console.log(`${args.includes("--check") ? "Checked" : "Updated"} ${outputs.length} inventory export(s), ${vocabulary.filter((s) => s.sources.length).length} eligible skills`);
