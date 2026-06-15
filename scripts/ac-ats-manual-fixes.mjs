#!/usr/bin/env node
/** Manual ATS-quality rewrites for bullets auto-inject could not fix cleanly. */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { fileURLToPath } from "node:url";

const BANK = path.join(path.dirname(fileURLToPath(import.meta.url)), "../data/ac-bank");

const FIXES = {
  "AC-001": "Engineered an event-driven FastAPI pipeline on AWS over 7 years of FOMC data, cutting analysis from 3+ days to under 20 minutes at 67.7% accuracy.",
  "AC-002": "Engineered a Python NLP pipeline on AWS with Kafka processing 200K+ financial records in real time, delivering 27% portfolio return and $2.6K profit.",
  "AC-022": "Built React and Python LLM-driven analytics workflows across financial news and transcripts with schema validation, delivering production APIs used daily by 5 researchers.",
  "AC-023": "Built a Python and LangChain 3-agent RL debate system achieving 60% directional accuracy across 30 S&P 500 stocks on 7d/30d/90d forecasting windows in production.",
  "AC-024": "Implemented MCP-based agent orchestration across 3+ tool-use workflows, connecting LLM agents to external APIs with structured evaluation benchmarks.",
  "AC-025": "Built a production Python RAG pipeline with LangChain vector retrieval and AWS inference APIs delivering 18% accuracy lift in production evaluations.",
  "AC-033": "Developed a Python brain tumor segmentation model achieving 90%+ mask accuracy replacing manual tumor outlining for treating clinicians in production.",
  "AC-048": "Implemented Python human-in-the-loop mask review so physicians could correct AI segmentations on edge cases improving clinical trust in production workflows.",
  "AC-051": "Shipped a JavaScript Chrome extension rated 5.0 stars on the Chrome Web Store capturing LinkedIn and Indeed job postings in one click for production users.",
  "AC-073": "Built InsureRaft, a C++ and NuRaft platform replicating insurance data on a 3-node cluster for distributed carriers and regulators in production.",
  "AC-075": "Built a C++ insurance state machine applying 8 typed domain events with idempotency keys and monotonic committed log indices in production.",
  "AC-076": "Implemented C++ exactly-once delivery across 8 event types by deduplicating event_id values before committing insurance transactions to the Raft log.",
  "AC-080": "Engineered C++ file-backed per-entry log persistence on 3 nodes with automatic replay and snapshot recovery when servers restart and rejoin the cluster.",
  "AC-093": "Built a Python and scikit-learn Marketing Mix Model analyzing 5 media channels across 156 weeks at R² 0.9489 and 2.74% MAPE in production.",
  "AC-081": "Built C++ end-to-end insurance workflows across 8 event types from policy creation through claim approval and payment settlement on the replicated log.",
  "AC-082": "Shipped a CMake-built C++ server with OpenSSL TLS and an interactive CLI managing policies and claims across a 3-node production cluster.",
  "AC-083": "Built a Python automated job intelligence pipeline scraping LinkedIn via JobSpy across 6 search terms with ~20 daily runs serving a live production dashboard.",
  "AC-087": "Built Python and MongoDB Atlas storage for 15K+ job descriptions across 4 collections with run history and per-run JSON snapshots for production analytics.",
  "AC-091": "Built JavaScript admin analytics with hourly heatmaps and 7/14/30-day trend charts tracking pipeline breakdown and the last 50 production runs.",
  "AC-094": "Engineered Python geometric adstock decay and Hill saturation transforms capturing lagged ad effects and diminishing returns across 5 marketing channels.",
  "AC-099": "Implemented 5-fold time-series cross-validation in Python and scikit-learn reporting R² and MAPE per fold across 156 weeks of marketing spend data.",
  "AC-100": "Built Python ROAS-weighted budget optimization and scenario planning shifting spend from TV to high-ROI digital channels across 5 media mixes.",
  "AC-102": "Built a Python and pandas 4-notebook workflow from synthetic data generation through EDA and modeling to validation across 156 weeks in production.",
  "AC-116": "Integrated Python SHAP and LIME explainability with permutation importance across multimodal radiomics models on 255 samples in production.",
  "AC-117": "Built Python radiogenomics analysis correlating radiomics and genomics features with mutation outcomes on 73-patient cohorts in production.",
  "AC-119": "Built Python UMAP and t-SNE clustering for unsupervised phenotype discovery across 255-sample radiomics research cohorts in production.",
  "AC-121": "Built Python PDF research reports with executive summaries across 10 module visualizations for clinical research publication workflows.",
  "AC-125": "Built Express.js role-based access control separating Admin, Doctor, and Patient permissions across 3 protected API route groups in production.",
  "AC-127": "Engineered Node.js and EJS appointment scheduling workflows enabling clinic staff and patients to manage 3 role-based booking flows in production.",
  "AC-128": "Built Swagger OpenAPI docs on Express.js for auth and patient REST endpoints on the clinic API serving 3 user roles in production.",
  "AC-154": "Implemented X25519 and AES-GCM scoped-export decryption validating ECDH unwrap in 1.3 ms warm latency for production Hushh wire contracts.",
  "AC-158": "Built Python gap analysis mapping an always-on platform design to the production Hushh consent protocol across 4 invariants.",
  "AC-160": "Integrated Python scoped capability tokens with attr.domain path grammar for time-bounded access across 4 trust invariants in production.",
  "AC-161": "Built a Python 90-day roadmap sequencing 7 platform tiles for external developer onboarding to the consent API in production.",
  "AC-162": "Built Python verified mock smoke tests documenting end-to-end X25519-AES256-GCM decryption against the Hushh wire contract in production.",
};

let n = 0;
for (const [id, text] of Object.entries(FIXES)) {
  const file = path.join(BANK, `${id}.yaml`);
  const ac = yaml.load(fs.readFileSync(file, "utf8"));
  ac.variants[0].text = text;
  fs.writeFileSync(file, yaml.dump(ac, { lineWidth: 120, noRefs: true }));
  n += 1;
}
console.log(`Applied ${n} manual ATS fixes.`);
