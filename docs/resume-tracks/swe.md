# SWE / full-stack resume playbook

Second role in the bank rebuild (2026-10-08), after FDE (docs/resume-tracks/fde.md): the same cycle, the same 90%+
blind-test bar. Facts come from `docs/resume-tracks/facts/`.

## 1. What SWE postings ask for

Evidence: 3,254 software-engineer-track postings from 1,172 companies, collected by Atriveo (Sep 29 – Oct 8, 2026).
They split into full stack (425), backend/platform (511), frontend (51) and general (2,267).

| Asks for | All | Full stack | Backend | Other roles |
|---|---|---|---|---|
| Testing / code quality / reviews | 80% | 81% | 78% | 69% |
| Scale / performance (latency, throughput, millions) | 77% | 76% | **83%** | 67% |
| System design / architecture | 67% | 68% | **77%** | 49% |
| APIs / services | 65% | **87%** | 72% | 49% |
| Reliability / on-call / monitoring | 67% | 59% | **75%** | 55% |
| Frontend (React / TypeScript / UI) | 42% | **86%** | 31% | 15% |
| Databases / data models | 47% | **68%** | 58% | 47% |
| CI/CD / deployment | 56% | **69%** | 51% | 60% |
| Cloud (AWS / GCP / Azure) | 44% | 55% | 50% | 31% |
| End-to-end ownership | 50% | 53% | 57% | 43% |

**Tools:**
- **Full stack:** React 62%, Python 51%, AWS 46%, Java 45%, TypeScript 44%, JavaScript 40%, SQL 37%, Node.js 28%.
- **Backend:** Python 52%, AWS 43%, Go 38%, Java 34%, Kubernetes 31%, PostgreSQL 21%, Kafka 16%, Redis 16%.

**Reviewers** scan for stack, scope and impact in seconds. The bullet shape is action + scope + quantified outcome:
latency, uptime, users, requests, release speed
([techinterview.org](https://www.techinterview.org/post/3233474602/software-engineer-resume-guide/),
[Interview Kickstart](https://interviewkickstart.com/blogs/articles/build-faang-software-engineering-resume)).

## 2. The layers of a SWE resume

Each layer gets its own bullets, with one fact per bullet, as on FDE.

| Layer | Shape |
|---|---|
| **Scale and performance** | [optimized / rearchitected] [system] for [N users, requests, records] → [latency, throughput or cost number] |
| **Design and ownership** | [designed / built] [service or feature] end to end ([API + data model + UI]) → [who used it, what it enabled] |
| **Reliability and quality** | [tests, CI/CD, monitoring, incident fixes] → [release speed, uptime, incidents removed] |
| **Full stack** (full-stack set) | [React / TypeScript UI] on [API] over [database] for [users] → [outcome] |

**Two sets, as on FDE:**
- **Full stack:** React/TypeScript UI, APIs and databases. Wake Forest dashboard, Accolite ERP, Atriveo console and
  extension.
- **Backend / platform:** scale, reliability, design. Accolite BT APIs, CI/CD, incident fixes, Kafka and Elasticsearch,
  Stony Brook pipelines.

The blind test decides whether two are needed.

## 3. Your material (first pass)

| Layer | Strong now | Needs a fact or a fix |
|---|---|---|
| Scale / performance | BT 10K+ daily transactions at 200 ms P99; ERP API 350 → 80 ms; Atriveo 50K+ applications and 50K+ resumes in a year, 99.9% uptime across 2K+ daily queries (earlier FastAPI/PostgreSQL/Cloudflare version) | Stony Brook backend numbers (latency, requests, services) |
| Design / ownership | Atriveo end to end; Oracle CRM → React/MongoDB ERP for 3,000 employees; insurance microservices (8 services, Kafka, gateway) | Which Atriveo parts you built yourself |
| Reliability / quality | CI/CD for 20 engineers; Redis/Elasticsearch incident fix (P99 −40%); 75+ production fixes; observability stack | Context for "6 h → 90 s"; whose "100K+ users"; testing evidence |
| Full stack | Wake Forest React/TypeScript dashboard; Accolite React ERP; Atriveo console and Chrome extension | What front end you built at Accolite (BT Angular pages?) |

**Lines to retire on SWE resumes:**
- "27% portfolio return and $2.6K backtesting profit" (every reviewer flagged it).
- The duplicate FOMC "3 days → under 20 minutes" pair.
- Atriveo stacks without their era. Earlier FastAPI/PostgreSQL vs today's Node/MongoDB must say which, so they never
  read as a contradiction.
