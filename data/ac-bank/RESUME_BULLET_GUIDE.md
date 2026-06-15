# FANG-Level Resume Bullet Guide

Audience: ex-Google Staff Engineer / ex-Meta Hiring Manager bar.

**Goal:** Make a recruiter think *"This candidate built something important"* — not describe work.

## Golden Formula

**Action + What was built + Biggest measurable impact + Why it mattered**

✅ Architected an AI powered radiology platform that processed over 10,000 brain MRI studies and reduced tumor segmentation from three hours to two minutes.

✅ Built a patient similarity engine over more than 10,000 historical MRI studies that helped physicians identify comparable disease patterns and treatment outcomes.

❌ Built Python, GCP, SimpleITK, PyRadiomics, ETL pipelines and dashboards for MRI preprocessing, segmentation, survival analysis, and clinician workflows.

## Writing Rules

1. **One breath only** — 28 to 35 words max; prefer one comma; avoid chaining multiple "and" clauses.
2. **One achievement only** — do not combine platform, dashboard, cloud, AI, and ETL in one bullet.
3. **Lead with impact** — transformation or result in the first half; tech supports the story.
4. **One strongest metric per bullet** — do not repeat the same metric across selected bullets.
5. **Answer "So what?"** — end with user or business value.
6. **Business verbs** — Architected, Automated, Standardized, Reduced, Accelerated, Deployed, Built, Designed, Integrated, Implemented.
7. **No keyword stuffing** — technologies only when they strengthen the story.
8. **Show ownership** — owned a meaningful subsystem or product.
9. **Memorable** — one takeaway after a single read.
10. **Significance test** — *If this were the only bullet, would I believe they built something significant?*

## Quality Checklist (target ≥ 9.5/10)

- [ ] One breath
- [ ] Single achievement
- [ ] Strong action verb
- [ ] Measurable evidence
- [ ] Why it matters
- [ ] Memorable after one read
- [ ] Product ownership

## Lint thresholds (enforced by `npm run ac:bullet-lint`)

| Check | Limit |
|-------|-------|
| Word count | 12–35 words |
| `and` clauses | ≤ 2 |
| Commas | ≤ 2 |
| Weak verbs | none at start |
| Primary metrics per bullet | 1 (AC-031 headline may use 2) |
| Signature technologies | ≤ 2 per bullet; must match `signature_technologies` field |
| Puffery | no modern / advanced / innovative / cloud-native |
| Wake Forest ATS coverage | Python, GCP, SimpleITK, PyRadiomics, Apache Airflow, React across bank |

## Verified metrics (Wake Forest — do not invent beyond)

- 10K+ MRI studies
- 3 hours → 2 minutes (segmentation / marking)
- 90%+ mask accuracy
- 200+ radiomic biomarkers
- 5–10 years historical data
- 5 standardized modalities (T1, T2, DWI, heatmap, FLAIR)
- 2 minutes upload → clinician-ready insight
- 20-person physician-research team
- Clinical production deployment

## Verified metrics (Atriveo — do not invent beyond)

- 1K+ daily users
- 2K+ daily queries
- 99.9% uptime
- 5.0 Chrome Web Store stars (open source on GitHub)
- 5K+ LinkedIn job descriptions processed each week (5534 active URLs in export)
- Application tracker with external integrations
- 1-page PDF output (resume pipeline gate)
- 15-bullet fixed resume layout

### Atriveo dynamic anchors (2 bullets per resume)

| JD type | Anchor | Typical pair |
|---------|--------|----------------|
| Full Stack | AC-050 | AC-050 + AC-052 |
| AI / LLM | AC-042 | AC-042 + AC-054 |
| Backend | AC-053 | AC-053 + AC-057 |
| Product | AC-050 | AC-050 + AC-051 |
| Infrastructure | AC-057 | AC-057 + AC-062 |
| Data | AC-059 | AC-059 + AC-056 |

### Accolite verified metrics (Aug 2021–Aug 2024 — do not invent)

- 3 years tenure; clients: Fidelity, British Telecom, T-Mobile
- Fidelity: 10K+ policy records; contract-gated encrypted exchange; Java and Python pipelines; MySQL; AWS; Angular dashboard
- British Telecom: 10K+ daily transactions; 200ms P99; 99% uptime; REST and GraphQL; Resilience4j; AWS Azure GCP
- T-Mobile: 10K+ signups; bundled commerce flows
- In-house ERP: 3,000 employees; Oracle CRM replacement; hierarchy (10 direct reports); Slack bots; Lambda SQS SNS
- Serverless: 3K+ users; 350ms → 80ms API latency
- Redis/Elasticsearch: 100K+ users; P99 −40%
- CI/CD: 20 engineers; 6h → 90s deploy; 20+ releases/month
- Leadership: 500+ interviews; intern mentorship
- FastAPI: sub-200ms latency for telecom integrations
- **Canonical bank:** 36 ACs (AC-198 scope + AC-163–AC-197 evidence); resume always picks **4** = **1 thesis + 3 proof**

### Accolite resume structure (fixed)

| Slot | Role | ID |
|------|------|-----|
| Bullet 1 | **Scope thesis** — tenure, Fortune 500 clients, domains, stack identity | **AC-198** (always) |
| Bullets 2–4 | **Evidence** — JD-matched from story packages | AC-163–AC-197 |

**Scope bullet (AC-198):** Do not replace with a feature bullet. It answers *"What was your scope and why should I care?"* Embed stack **in context** — never as a bare list (`Java React Angular AWS Azure GCP`). Example: *Java backend services and React/Angular apps on AWS, Azure, and GCP*.

**Evidence bullets:** Max **two** signature technologies per bullet, each tied to an outcome. Spread Spring Boot, Kafka, Docker, etc. across the bank — repetition across the **composed resume** is capped by `ATS_COVERAGE_MATRIX.yaml`.

### Insurance platform verified metrics (GitHub — do not invent)

- 8 Spring Boot microservices
- 3-broker Kafka cluster + Confluent Schema Registry (Avro)
- 3-node Elasticsearch cluster
- CQRS + event sourcing architecture
- JWT gateway + Redis rate limit (5 req/s, burst 10)
- Docker Compose deployment
- Prometheus, Grafana, Zipkin, ELK observability
- **Do not claim:** FastAPI, AWS, PostgreSQL (in progress only), millions of records

### Atriveo ATS tech anchors

| Bullet anchor | Signature tech |
|---------------|----------------|
| Platform (AC-050) | React + FastAPI |
| Dashboard (AC-052) | React + TypeScript |
| Backend (AC-053) | FastAPI + PostgreSQL |
| RAG (AC-054) | LangChain |
| Resume compiler (AC-042) | Python |
| Cloud (AC-057) | Cloudflare |
| JD index (AC-059) | Python |

---

## ATS and Technical Depth Optimization

**Target: 9.8/10 ATS** — not by adding keywords, but by **balanced, in-context coverage** across the composed 15 bullets + skills.

Modern ATS (Workday, Greenhouse, Lever, Ashby) **parse and index**; ranking uses exact match, semantic similarity, and recruiter filters. One bullet with FastAPI + PostgreSQL already indexes backend, APIs, and Python — stacking REST, Docker, Kubernetes, microservices in the same line rarely helps.

### Rules (enforced)

1. **Spread, don't stack** — same six keywords in a readable sentence beats a tech list.
2. **Keywords in context** — *Engineered FastAPI and PostgreSQL services in Python* beats *Python FastAPI PostgreSQL Docker*.
3. **Synonyms count** — event-driven / messaging / streaming satisfy Kafka searches; retrieval / vector search satisfy RAG.
4. **Min/max repetition** — `data/ac-bank/ATS_COVERAGE_MATRIX.yaml` + composer scoring penalize missing **and** over-use (e.g. React max 2 on a resume).
5. **Skills evidence-backed** — skills lines only from selected bullets (`skills_evidence_only: true`).
6. **Bank vs resume** — `ROLE-ATS-TECH.yaml` ensures the **pool** can cover a role; the **matrix** balances what appears on each composed resume.

Audit a composition: `npm run ac:ats-matrix -- path/to/composition.json`

### Every technology must earn its place

A technology should answer: what language, framework, cloud, library, or recognizable tool made the achievement possible?

**Good:** Python, GCP, SimpleITK, PyRadiomics, Apache Airflow, React
**Bad (unless backed by specifics):** AI, ML, LLM, Cloud, Modern, Advanced, Innovative

### Max two signature technologies per bullet

Spread coverage across bullets — do not repeat Python or GCP in every line.

| Bullet anchor | Signature tech |
|---------------|----------------|
| Platform (AC-031) | Python + GCP |
| Preprocessing (AC-032) | Python + SimpleITK |
| ETL (AC-043) | Apache Airflow |
| Radiomics (AC-044) | PyRadiomics |
| Dashboard (AC-047) | React + TypeScript |
| Cloud (AC-049) | GCP |

Achievement first; technology explains how.

### Never invent technologies

Do not mention Kafka, Docker, Kubernetes, or LLMs unless genuinely used. Interviewers will ask follow-ups.

### Final ATS formula

**Strong action + signature technology + core achievement + primary metric + business outcome**

Example:

> Architected a Python and GCP-based AI radiology platform that processed 10K+ brain MRI studies and reduced tumor segmentation from 3 hours to 2 minutes.

### Validation (every bullet)

- [ ] One breath (25–35 words)
- [ ] One achievement, one primary metric
- [ ] One or two signature technologies (if any)
- [ ] No invented claims or filler adjectives
- [ ] If a technology can be removed without weakening the story, remove it
