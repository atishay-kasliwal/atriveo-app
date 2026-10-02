import { test } from "node:test";
import assert from "node:assert/strict";
import { parseResume } from "../../scripts/ats/resume-parse.mjs";
import { parseDateRange } from "../../scripts/ats/patterns.mjs";
import { CLEAN_LAYOUT, config } from "./helpers.mjs";

const parse = (layout) => parseResume(layout, config.sections);

test("contact block: name, email, phone, location and printed profile URLs", () => {
  const { contact } = parse(CLEAN_LAYOUT);
  assert.equal(contact.name, "Jordan Rivera");
  assert.equal(contact.email, "jordan.rivera@example.com");
  assert.equal(contact.phone, "555-201-4477");
  assert.equal(contact.location, "Austin, TX");
  assert.deepEqual(contact.urls, ["linkedin.com/in/jordan-rivera", "github.com/jrivera"]);
  assert.deepEqual(contact.other, ["Backend Engineer"]);
});

test("sections are recognized by heading, in page order", () => {
  assert.deepEqual(parse(CLEAN_LAYOUT).sections.map((s) => s.key), ["experience", "education", "projects", "skills"]);
  const variants = parse("A B\nPROFESSIONAL EXPERIENCE\nWork History:\nSkills & Tools\nTools and Technologies\n");
  assert.deepEqual(variants.sections.map((s) => s.key), ["experience", "experience", "skills"]);
});

test("positions: employer, title, dates, location, and wrapped bullets joined", () => {
  const [first, second] = parse(CLEAN_LAYOUT).experience;
  assert.equal(first.company, "Northwind Labs");
  assert.equal(first.title, "Senior Software Engineer");
  assert.equal(first.title_extra, null);
  assert.deepEqual(first.dates, { text: "Jan 2022 – Present", start: { year: 2022, month: 1 }, end: null, current: true });
  assert.equal(first.location, "Austin, TX");
  assert.equal(first.bullets.length, 3);
  assert.match(first.bullets[1], /three regions and reduced deploy time/);
  assert.equal(second.company, "Contoso Health");
  assert.equal(second.dates.text, "Jun 2019 – Dec 2021");
});

test("a title line carrying a stack is read whole, and the extra text is separated out", () => {
  const layout = CLEAN_LAYOUT.replace("  Senior Software Engineer          ", "  Senior Software Engineer | Python, AWS, Kafka");
  const [first] = parse(layout).experience;
  assert.equal(first.title, "Senior Software Engineer | Python, AWS, Kafka");
  assert.equal(first.title_extra, "Python, AWS, Kafka");
  // A dash that isn't followed by a list is part of the title.
  const dashed = parse(CLEAN_LAYOUT.replace("  Senior Software Engineer          ", "  Software Engineer - Payments      ")).experience[0];
  assert.equal(dashed.title, "Software Engineer - Payments");
  assert.equal(dashed.title_extra, null);
});

test("education: left-aligned and two-column layouts give the same fields", () => {
  const left = parse(CLEAN_LAYOUT).education;
  assert.deepEqual(left.map(({ institution, degree, location }) => ({ institution, degree, location })), [
    { institution: "University of Texas at Austin", degree: "Bachelor of Science in Computer Science", location: "Austin, TX" },
  ]);
  assert.equal(left[0].dates.text, "Aug. 2015 – May 2019");

  const twoCol = parse(`Jordan Rivera
Education
  University of Texas at Austin                                Austin, TX
  Bachelor of Science in Computer Science            Aug. 2015 – May 2019
  Austin Community College                                     Austin, TX
  Associate of Science                               Aug. 2013 – May 2015
`).education;
  assert.equal(twoCol.length, 2);
  assert.deepEqual(twoCol.map((e) => [e.institution, e.degree, e.dates.text, e.location]), [
    ["University of Texas at Austin", "Bachelor of Science in Computer Science", "Aug. 2015 – May 2019", "Austin, TX"],
    ["Austin Community College", "Associate of Science", "Aug. 2013 – May 2015", "Austin, TX"],
  ]);
});

test("a second role under the same employer inherits the employer", () => {
  const roles = parse(`Jordan Rivera
Experience
  Northwind Labs                                               Austin, TX
  Senior Software Engineer                              Jan 2022 – Present
     • Led the platform team.
  Software Engineer                                     Jun 2019 – Dec 2021
     • Built the billing service.
`).experience;
  assert.deepEqual(roles.map((r) => [r.company, r.title, r.dates.text, Boolean(r.company_inherited)]), [
    ["Northwind Labs", "Senior Software Engineer", "Jan 2022 – Present", false],
    ["Northwind Labs", "Software Engineer", "Jun 2019 – Dec 2021", true],
  ]);
});

test("projects split name from stack; skills split into labeled groups", () => {
  const p = parse(CLEAN_LAYOUT);
  assert.deepEqual(p.projects.map((x) => [x.name, x.stack, x.dates.text, x.bullets.length]), [["Ledgerline", "Go, PostgreSQL", "Mar 2023 – Present", 2]]);
  assert.deepEqual(p.skills.groups.map((g) => [g.label, g.items.length]), [["Languages", 4], ["Cloud & DevOps", 5], ["Data", 3]]);
});

test("date ranges a parser can read", () => {
  assert.deepEqual(parseDateRange("Aug. 2024 – May 2026").start, { year: 2024, month: 8 });
  assert.deepEqual(parseDateRange("November 2024 — May 2026").end, { year: 2026, month: 5 });
  assert.deepEqual(parseDateRange("2019 - Present"), { text: "2019 - Present", start: { year: 2019, month: null }, end: null, current: true });
  assert.deepEqual(parseDateRange("01/2020 to 03/2021").end, { year: 2021, month: 3 });
  assert.equal(parseDateRange("Summer '19 – Fall '20"), null);
});
