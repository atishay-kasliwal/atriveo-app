#!/usr/bin/env node
/**
 * Capability-centric rewrite pass for Accolite bank (AC-163–AC-198).
 * Business/architectural outcomes first; stack supports the story.
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BANK = path.join(ROOT, "data/ac-bank");
const SEED_PATH = path.join(BANK, "ACCOLITE-SEED.json");

const REWRITES = {
  "AC-163":
    "Architected encrypted sister-company insurance exchange at Fidelity on Java and AWS moving 10K+ policy records only after signed contracts in production.",
  "AC-164":
    "Engineered contract-gated export controls on Java and MySQL blocking 100% of unauthorized insurance transfers until both parties signed consent in production.",
  "AC-165":
    "Architected Fidelity's central audit hub on Java and AWS with visibility into 100% of sister-company insurance transfers even on direct production exchanges.",
  "AC-166":
    "Built Fidelity's primary insurance integration path on Java and MySQL enabling 10K+ encrypted policy exchanges across sister-company production networks.",
  "AC-167":
    "Accelerated Fidelity partner onboarding with Python and MySQL transfer paths mirroring 10K+ encrypted sister-company flows without disrupting live production pipelines.",
  "AC-168":
    "Shipped an Angular and Java operations console giving Fidelity compliance teams visibility into 500+ daily encrypted sister-company transfer events in production.",
  "AC-169":
    "Standardized auditable data integrity for Fidelity insurance exchanges on MySQL and AWS spanning 10K+ encrypted sister-company records in production.",
  "AC-170":
    "Deployed compliance-grade audit trails on Java and AWS covering 100% of Fidelity encrypted sister-company transfer events for regulatory review in production.",
  "AC-171":
    "Sustained British Telecom commerce at 10K+ daily transactions on Java and Spring Boot with 200ms P99 latency across production REST and GraphQL APIs.",
  "AC-172":
    "Reduced checkout friction for British Telecom e-commerce on Java and Angular converting 10K+ monthly service and device bundle orders in production.",
  "AC-173":
    "Engineered device-and-service bundling on British Telecom with Java and Angular onboarding 5K+ iPhone purchases through integrated payment flows in production.",
  "AC-174":
    "Deployed British Telecom commerce on AWS and Azure across 3 enterprise regions sustaining telecom sales without regional production downtime.",
  "AC-175":
    "Automated British Telecom order fulfillment on Java and MySQL powering 10K+ monthly service purchases and bundled device checkout in production.",
  "AC-176":
    "Owned 20+ British Telecom telecom service launches end-to-end from Java APIs through Angular payment experiences reaching production commerce customers.",
  "AC-177":
    "Sustained 99% uptime on British Telecom order APIs across 10K+ daily transactions with Java and Spring Boot fault-tolerance patterns in production.",
  "AC-178":
    "Accelerated T-Mobile customer acquisition with Java and React onboarding flows connecting provisioning to payment for 10K+ production commerce signups.",
  "AC-179":
    "Reduced T-Mobile activation delays with Java and MySQL provisioning APIs enabling same-day service for 5K+ bundled product purchases monthly in production.",
  "AC-180":
    "Processed 10K+ T-Mobile bundled checkout transactions monthly on Java and MySQL payment flows supporting telecom service revenue in production.",
  "AC-181":
    "Owned end-to-end T-Mobile commerce features on React and Java from backend APIs through customer purchase flows serving 10K+ production users.",
  "AC-182":
    "Shipped unified T-Mobile bundle commerce on React and Java spanning onboarding provisioning and payment for 5K+ monthly production purchases.",
  "AC-183":
    "Replaced Oracle CRM with an in-house operations platform on React and MongoDB serving onboarding timesheets and reviews for 3,000 employees in production.",
  "AC-184":
    "Cut new-hire ramp time with React and MongoDB onboarding workflows guiding 3,000 employees through hierarchy setup and timesheet compliance in production.",
  "AC-185":
    "Engineered hierarchical org views on React and MongoDB letting managers approve reviews and timesheets across 10 direct reports in production.",
  "AC-186":
    "Standardized yearly performance reviews on React and MongoDB across 10+ manager teams replacing manual evaluation workflows for 3,000 employees in production.",
  "AC-187":
    "Automated timesheet submission on AWS Lambda and SQS for 3,000 employees eliminating manual weekly filing across production operations.",
  "AC-188":
    "Eliminated 500+ annual hours of manual timesheet entry with Python and AWS Lambda Slack bots auto-creating ERP records for 3,000 employees in production.",
  "AC-189":
    "Reduced ERP API latency from 350ms to 80ms on a Python and AWS Lambda serverless platform serving 3K+ daily production users.",
  "AC-190":
    "Eliminated recurring production incidents for 100K+ users by rearchitecting on Redis and Elasticsearch cutting P99 latency 40% after deployment.",
  "AC-191":
    "Deployed Jenkins Docker and Kubernetes CI/CD across 20 engineers cutting release cycles from 6 hours to 90 seconds with 20+ monthly production releases.",
  "AC-192":
    "Accelerated enterprise telecom partner integrations with FastAPI and Redis microservices delivering sub-200ms REST responses across 10K+ production API calls.",
  "AC-193":
    "Standardized technical interview programs covering 500+ candidate screens over 3 years improving hire quality for Java Python and cloud production teams.",
  "AC-194":
    "Converted 10+ intern cohort members to full-time engineers through mentorship on Fortune 500 client deliverables using Java and React production modules.",
  "AC-195":
    "Standardized technical evaluation rubrics used across 500+ candidate screens aligning Java Python and cloud hiring loops with production team needs.",
  "AC-196":
    "Enabled 20+ new hires to reach production client contribution faster through Java and React onboarding curricula across ERP and telecom modules.",
  "AC-197":
    "Built Java and Python playbooks documenting 4 enterprise pipeline architectures plus ERP workflows preserving team continuity across Fidelity production systems.",
};

const SCOPE_198 =
  "Delivered 3 years of Fortune 500 platforms for Fidelity, British Telecom and T-Mobile with Java backend services and React/Angular on AWS Azure GCP spanning secure insurance exchange for 3,000 employees.";

const seed = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
let n = 0;
for (const entry of seed) {
  if (REWRITES[entry.id]) {
    entry.text = REWRITES[entry.id];
    n += 1;
  }
}
fs.writeFileSync(SEED_PATH, `${JSON.stringify(seed, null, 2)}\n`);

const ac198Path = path.join(BANK, "AC-198.yaml");
const ac198 = yaml.load(fs.readFileSync(ac198Path, "utf8"));
ac198.variants[0].text = SCOPE_198;
ac198.fact =
  "Accolite scope thesis — 3 years owning Fortune 500 delivery across secure insurance exchange, telecom commerce, and Oracle CRM replacement for 3,000 employees.";
fs.writeFileSync(ac198Path, yaml.dump(ac198, { lineWidth: 120, noRefs: true }));

console.log(`Updated ${n} seed bullets and AC-198 scope thesis.`);
