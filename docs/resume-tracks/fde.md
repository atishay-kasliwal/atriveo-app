# FDE (Forward Deployed Engineer) resume playbook

The first role in the per-role bank rebuild (2026-10-08). The order is FDE → Data Science → Data Analyst → SWE / full
stack, and each role is finished end to end before the next one starts:

1. Research (this file)
2. Facts
3. Bullets
4. Head-to-head test
5. Ship

Facts always come from you. This file only decides **how** an FDE resume tells them.

## 1. What FDE postings ask for

The evidence is 263 FDE postings from 169 companies, collected by Atriveo between Sep 29 and Oct 8, 2026. They
include Palantir, OpenAI, Ramp, Replit, ElevenLabs, C3 AI, ServiceNow and Deloitte.

**Share of postings that ask for each thing:**

| Asks for | Postings |
|---|---|
| LLMs, agents, AI applications | 83% |
| Ambiguity, end-to-end ownership | 79% |
| Evals, reliability, observability, debugging in the field | 66% |
| Travel / onsite | 52% |
| Working directly with customers | 47% |
| A domain: healthcare, government, defense, finance | 47% |
| Rapid prototyping, POCs | 43% |
| Security, compliance, enterprise constraints | 43% |
| Deploying to production in the customer's environment | 42% |
| Discovery: understanding the customer's problem or workflow | 41% |
| Feedback to product and engineering, reusable patterns | 38% |
| Integrating customer systems, data, APIs | 37% |
| Communicating with non-technical people and executives | 37% |

**Phrases FDE postings use far more than other engineering postings** (× = how many times more often):
- "customer environments" ×100
- "embed directly" ×96
- "lead (technical) discovery" ×43–82
- "deployed software" ×73
- "willingness to travel" ×66
- "customer sites" ×46
- "customer deployments" ×37
- "technical delivery" ×32
- "ambiguous environments" ×16
- "rapidly prototype" ×15
- "high stakes" ×7
- "pain points"
- "through production"
- "production grade"
- "intersection of engineering" with product and go-to-market

**Tools:**

| Tool | Postings |
|---|---|
| Python | 61% |
| TypeScript/JavaScript | 38% |
| AWS | 22% |
| Azure | 22% |
| GCP | 18% |
| SQL | 17% |
| React | 15% |
| Kubernetes | 13% |
| Docker | 12% |

Tools matter much less than the behaviours above. A larger outside count of 1,000 postings agrees: Python 66%, AI
agents 35%, TypeScript 35%, AWS 32%, LLMs 31%.

## 2. What reviewers look for (guides and hiring writeups)

A strong FDE resume "shows which customer problem you understood, what you built, where it was deployed, and what
changed after it entered the real workflow" (refresh.cv). Reviewers look for four signals (Aced):

1. **End-to-end ownership:** scoping through production.
2. **Customer or stakeholder exposure:** you worked with the people who use what you built.
3. **Production, not prototypes:** it ran, and you maintained it.
4. **Outcomes in the customer's terms:** time saved, errors removed, decisions changed.

The FDE versus SWE difference is ownership scope. "FDEs write and own production code deployed in customer
environments and stay engaged long after the deal closes." A SWE builds features; an FDE decides what to build, for
whom, and why now, and then owns the outcome (Paraform, on Palantir, Runway and Greptile). Palantir's own posting
says: "engaging directly with customer stakeholders, from technical teams to executives", "developing custom
applications tailored to customer needs", "driving projects from ideation to deployment".

**Common mistakes, from the guides:**
- "we" where it should be "I"
- unmeasured outcomes
- prototypes presented as production
- hidden customer exposure
- skills you can't defend in an interview
- one-off patches instead of reusable work

## 3. The four layers of an FDE resume (refresh.cv), and the bullet shape for each

Each layer gets its own bullets. **Two bullets on one resume never tell the same fact.**

| Layer | Shape | Example (theirs, for the pattern only) |
|---|---|---|
| **1. Understood the real workflow** | [discovered / mapped / embedded with] [whose] [workflow], found [the real constraint] → [what you changed] | "Reconstructed a manufacturing quality-review workflow from operator interviews, machine logs and escalation notes, then redesigned the alert path so plant engineers could review high-risk equipment before the daily inspection cycle." |
| **2. Built and deployed it** | [built and deployed] [system] into [their environment or workflow] under [constraint] → [measured outcome] | "Designed and shipped a production RAG system for a healthcare client in their VPC under HIPAA constraints, serving 50M documents with sub-300ms p95 retrieval latency." |
| **3. Handled the mess** | [integrated / debugged / hardened] [external systems you don't control] → [reliability outcome] | "Diagnosed and resolved an intermittent third-party API failure breaking a critical data sync; shipped exponential backoff with circuit breaking and synthetic monitoring, eliminating recurring P1 incidents." |
| **4. Turned field work into leverage** | [noticed pattern across N deployments or users] → [made it reusable] → [what it saved next time] | "Identified repeated approval and permission patterns across three onboarding automation pilots, then converted customer-specific scripts into reusable workflow templates for future deployments." |

**Language that reads FDE:**
- partnered with / embedded with [named users]
- scoped / mapped [their] workflow
- deployed into [their] pipeline
- integrated [their] [system]
- adopted by / still used by
- iterated with [users] over [time]
- kept [humans] in the loop for [decision]

**Language that reads SWE-only:**
- "implemented services powering…"
- "programmed APIs…"
- a run of tools with no user

## 4. Rules for the FDE bank

- **A real user in every bullet:** each employer or project has at least one bullet that names who used it and how
  (residents and doctors, analysts, 3,000 employees, friends using Atriveo, a Fortune 500 client).
- **Cover the layers:** one resume covers all four layers at least once. Layer 2 can appear more than once, as long as
  the facts differ.
- **Distinct facts:** two bullets on one resume never share a headline number. This fixes "one thing split into
  domains".
- **Production means it ran:** "production" only where it really ran for its users. Everything else is a prototype
  or pilot.
- **Tools are not the point:** at most 3 per bullet (bank lint), named only where they explain the constraint.
- **Truth:** every claim traces to a fact in `docs/resume-tracks/facts/` (from you, or from Atriveo's own database).
  A cloud or tool is named for a role only where that part of the work really ran on it. Wake Forest used GCP and
  AWS for different parts.
- **The template doesn't change.** No summary section: the template has none, and the header title already says
  "Forward Deployed Engineer". The first bullet of each employer does the summary's job.

## 5. Your material against the four layers (first pass)

| | 1. Workflow | 2. Built and deployed | 3. The mess | 4. Leverage |
|---|---|---|---|---|
| **Wake Forest** | Strong: learned MRI modalities, clinical process, Epic, DICOM; manual plane conversion and masking by 20 residents and 2 lead doctors | Strong: in their hospital pipeline, still used; ~1 h → under 1 min; 3 h → 2 min segmentation | Strong: ~50K scans and ~2 TB across scanner generations and vendors, DICOM → NIfTI, normalization, skull stripping, motion rejection | Partial: year-long accuracy review with clinicians (~99% agreement); human in the loop |
| **Atriveo** | Strong: your own pain (tracking), then friends' (motivation) | Strong: 8,125 company boards monitored, 6,564 jobs from 2,209 companies, 2,216 tailored resumes, 893 applications, all in 9 days | Strong: Greenhouse, Ashby, Lever, Workday, LinkedIn forms you don't control; verification, spam blocks, form changes | Strong: kept final submission and open answers human-controlled |
| **Stony Brook (FOMC)** | **Missing:** who used it, which decisions | Partial: 3 days → under 20 min (only once on a resume) | Partial: live Fed press-conference feed, Kafka | **Missing** |
| **Accolite** | **Missing:** client discovery at Fidelity, BT, T-Mobile? | Present: client systems, 3,000-employee ERP | Present: Resilience4j, 99% uptime, sync failures | Possible: reusable rubrics, knowledge transfer |
| **Insurance platform** | n/a (project) | n/a | Strong: Kafka, circuit breakers, rate limiting, tracing | n/a |

The current FDE resume leads with Stony Brook, the weakest FDE story, and tells it twice. It also lists Wake Forest's
platform as tech, not as a clinical deployment.

## 6. Next steps (FDE)

1. **Facts:** fill the missing cells, Stony Brook layers 1 and 4 and Accolite layer 1, then confirm the Wake Forest
   and Atriveo fact sheets.
2. **Bullets:** 2–3 candidates per cell from the confirmed facts, scored by lint, the rules above, keyword coverage
   of the 263 postings, and distinctness.
3. **Test:** old versus new FDE resume against 30 held-out FDE postings (keyword match, ATS readiness, blind
   pairwise review), then your read.
4. **Ship:** FDE bullets tagged `tracks: [fde]` in the bank; rebuild the FDE general resume.

## Sources

- [Aced (formerly Exponent): Forward Deployed Engineer Resume](https://www.aced.io/blog/forward-deployed-engineer-resume)
- [refresh.cv: Forward Deployed Engineer resume guide](https://refresh.cv/blog/forward-deployed-engineer-resume-guide)
- [Paraform: What a Forward-Deployed Engineer actually does at Palantir, Runway and Greptile](https://www.paraform.com/insights/forward-deployed-engineer-palantir-runway-greptile)
- [Palantir: Forward Deployed Software Engineer posting](https://jobs.lever.co/palantir/dab396d4-2f14-4796-aac0-0d82883dccf0)
- [fde.academy: FDE resume, how to write one that gets interviews](https://fde.academy/blog/forward-deployed-engineer-resume-how-to-write-one-that-gets-interviews)
- Atriveo's own job database: 263 FDE postings, analysis scripts in the 2026-10-08 session
