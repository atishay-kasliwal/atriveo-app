// Shared fixtures for the ATS tests. Resumes here are synthetic: a made-up candidate, written the
// way `pdftotext -layout` prints a one-column resume (cells separated by runs of spaces).

import { loadAtsConfig, withHash } from "../../scripts/ats/config.mjs";

export const config = loadAtsConfig();

/** A deep copy of the config with `edit` applied, re-hashed. */
export function configWith(edit) {
  const copy = structuredClone(config);
  edit(copy);
  return withHash(copy);
}

export const CLEAN_LAYOUT = `
                                   Jordan Rivera
                  Backend Engineer | 555-201-4477 | jordan.rivera@example.com
               linkedin.com/in/jordan-rivera | github.com/jrivera | Austin, TX
Experience
  Northwind Labs                                                         Jan 2022 – Present
  Senior Software Engineer                                                       Austin, TX
     • Built Python services on AWS ECS that cut API latency by 35% for two million daily
       requests across the payments platform.
     • Led the migration of 14 services to Kubernetes with zero downtime across three regions
       and reduced deploy time from 40 minutes to 6 minutes.
     • Designed an event pipeline on Kafka that processes 80K events per second with exactly-once
       delivery for billing and fraud teams.
  Contoso Health                                                        Jun 2019 – Dec 2021
  Software Engineer                                                              Boston, MA
     • Developed FastAPI microservices processing 500K insurance claims per day with PostgreSQL.
     • Automated test suites in GitHub Actions, raising coverage from 52% to 88% in two quarters.
     • Partnered with clinicians to ship a scheduling tool used by 1,200 staff across 9 hospitals.
Education
  University of Texas at Austin, Austin, TX
  Bachelor of Science in Computer Science, Aug. 2015 – May 2019
Projects
  Ledgerline | Go, PostgreSQL                                                 Mar 2023 – Present
     • Built a double-entry ledger in Go handling 10K transactions per second with PostgreSQL.
     • Wrote property-based tests that found 7 rounding defects before the first release.
Technical Skills
  Languages: Python, Go, SQL, TypeScript
  Cloud & DevOps: AWS, Docker, Kubernetes, Terraform, GitHub Actions
  Data: PostgreSQL, Kafka, Redis
`;

/** Lines as a content-stream reader prints them: cells joined by one space. */
export const flatten = (layout) => layout.split("\n").map((l) => l.trim().split(/ {3,}/).join(" ")).join("\n");

/** An extractPdf()-shaped object built from text, for testing checks without a PDF. */
export function extraction(layout, overrides = {}) {
  return {
    file: "fixture.pdf",
    sha256: "fixture",
    pages: 1,
    views: { layout, reading: flatten(layout), raw: flatten(layout), ...overrides.views },
    fonts: [{ name: "Fixture-Regular", encoding: "Identity-H", embedded: true, unicode: true }],
    images: 0,
    links: [
      { page: 1, url: "mailto:jordan.rivera@example.com" },
      { page: 1, url: "https://www.linkedin.com/in/jordan-rivera" },
      { page: 1, url: "https://github.com/jrivera" },
    ],
    ...overrides,
    ...(overrides.views && { views: { layout, reading: flatten(layout), raw: flatten(layout), ...overrides.views } }),
  };
}

export const checksOf = (result) => result.findings.map((f) => f.check);
