#!/usr/bin/env node
/**
 * Patch Accolite seed bullets so signature_technologies appear in resume text.
 * Run: node scripts/ac-accolite-tech-pass.mjs && node scripts/ac-accolite-seed.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED_PATH = path.join(ROOT, "data/ac-bank/ACCOLITE-SEED.json");

const PATCHES = {
  "AC-164": {
    text: "Engineered Java contract-gated transfer controls on MySQL blocking 100% of insurance exports until both parties signed consent for production exchanges.",
  },
  "AC-165": {
    text: "Architected a Java and AWS central data node at Fidelity auditing 100% of sister-company insurance transfers across direct production exchanges.",
  },
  "AC-168": {
    text: "Shipped an Angular and Java dashboard tracking 500+ daily encrypted insurance transfers across Fidelity sister-company pipelines in production operations.",
  },
  "AC-170": {
    text: "Deployed Java and AWS monitoring plus audit trails for Fidelity encrypted pipelines covering 100% of sister-company insurance transfer events daily.",
  },
  "AC-172": {
    text: "Built Java and Angular telecom checkout flows on British Telecom including service bundling across 10K+ monthly production e-commerce orders.",
  },
  "AC-173": {
    text: "Engineered Java and Angular device bundling flows on British Telecom onboarding 5K+ iPhone purchases through integrated payment experiences in production.",
  },
  "AC-177": {
    text: "Implemented Java and Spring Boot Resilience4j circuit breakers on British Telecom order APIs sustaining 99% uptime across 10K+ daily production transactions.",
  },
  "AC-178": {
    text: "Built Java and React T-Mobile onboarding workflows connecting service provisioning to payment pages for 10K+ production telecom commerce signups.",
  },
  "AC-179": {
    text: "Engineered Java and MySQL T-Mobile service provisioning APIs enabling production activation for 5K+ bundled telecom product purchases monthly.",
  },
  "AC-180": {
    text: "Built Java payment integration flows on MySQL processing 10K+ T-Mobile production checkout transactions for telecom service bundles.",
  },
  "AC-181": {
    text: "Built React and Java end-to-end T-Mobile commerce features from backend APIs through customer purchase flows serving 10K+ production telecom users.",
  },
  "AC-182": {
    text: "Shipped React and Java T-Mobile e2e commerce spanning onboarding provisioning and payment for 5K+ monthly production telecom bundle purchases.",
  },
  "AC-183": {
    text: "Built a React and MongoDB in-house operations platform replacing Oracle CRM with onboarding timesheets and reviews for 3,000 employees in production.",
  },
  "AC-184": {
    text: "Built React and MongoDB employee onboarding workflows in the in-house ERP guiding 3,000 users through tags timesheets and hierarchy setup in production.",
  },
  "AC-185": {
    text: "Engineered React and MongoDB hierarchical org views letting managers operate across 10 direct reports for reviews timesheets and approvals in production.",
  },
  "AC-186": {
    text: "Built React and MongoDB yearly performance review workflows in the in-house ERP supporting manager evaluations across 10+ hierarchical teams in production.",
  },
  "AC-188": {
    text: "Built Python and AWS Lambda Slack bots parsing weekly timesheet submissions and auto-creating ERP entries for 3,000 employees saving 500+ production hours annually.",
  },
  "AC-194": {
    text: "Built Java and React intern mentorship programs converting 10+ cohort members to full-time engineers through production client and in-house ERP deliverables.",
  },
  "AC-196": {
    text: "Built Java and React intern onboarding curricula pairing 20+ new hires with client projects and in-house ERP modules for faster production contribution.",
  },
  "AC-197": {
    text: "Built Java and Python knowledge-transfer playbooks documenting 4 pipeline architectures and ERP workflows enabling production team continuity across Fidelity and in-house products.",
  },
};

const seed = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
let patched = 0;
for (const entry of seed) {
  const patch = PATCHES[entry.id];
  if (!patch) continue;
  Object.assign(entry, patch);
  patched += 1;
}
fs.writeFileSync(SEED_PATH, `${JSON.stringify(seed, null, 2)}\n`);
console.log(`Patched ${patched} Accolite seed entries.`);
