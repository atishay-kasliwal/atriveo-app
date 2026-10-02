import { test } from "node:test";
import assert from "node:assert/strict";
import { assessReadiness } from "../../scripts/ats/readiness.mjs";
import { canonicalJson, loadAtsConfig } from "../../scripts/ats/config.mjs";
import { CLEAN_LAYOUT, checksOf, config, configWith, extraction, flatten } from "./helpers.mjs";

const assess = (x, opts, cfg = config) => assessReadiness(x, cfg, opts);
const penalty = (check) => config.scoring.readiness.checks[check].penalty;

test("a clean one-column resume passes with every check green", () => {
  const r = assess(extraction(CLEAN_LAYOUT), { expected: { experience: 2, education: 1, projects: 1 } });
  assert.equal(r.status, "PASS");
  assert.equal(r.parseability, 100);
  assert.deepEqual(r.findings, []);
  for (const check of ["name", "email", "phone", "location", "link_url_hidden", "sections", "positions", "title_extra_text", "education_fields", "entry_order", "multi_column"]) {
    assert.ok(r.passed.some((p) => p.check === check), `expected ${check} to pass`);
  }
});

test("missing email is critical: FAIL whatever the number", () => {
  const r = assess(extraction(CLEAN_LAYOUT.replace(" | jordan.rivera@example.com", "")));
  assert.equal(r.status, "FAIL");
  assert.deepEqual(checksOf(r), ["email"]);
  assert.equal(r.parseability, 100 - penalty("email"));
  assert.equal(r.critical.length, 1);
});

test("an unrecognized Experience heading fails; missing Education and Skills headings warn", () => {
  const noExp = assess(extraction(CLEAN_LAYOUT.replace("\nExperience\n", "\nWhere I've Worked\n")));
  assert.equal(noExp.status, "FAIL");
  assert.ok(checksOf(noExp).includes("section_experience"));

  const noEduSkills = assess(extraction(CLEAN_LAYOUT.replace("\nEducation\n", "\nWhere I Studied\n").replace("\nTechnical Skills\n", "\nToolbox\n")));
  assert.deepEqual(checksOf(noEduSkills).sort(), ["section_education", "section_skills"]);
  assert.equal(noEduSkills.status, "WARN");
});

test("a position without readable dates, and one without a title, are reported", () => {
  const layout = CLEAN_LAYOUT.replace("Jun 2019 – Dec 2021", "Summer '19 – Fall '21").replace("  Senior Software Engineer          ", "                                    ");
  const r = assess(extraction(layout));
  assert.ok(checksOf(r).includes("position_dates"));
  assert.ok(checksOf(r).includes("position_title"));
  assert.ok(checksOf(r).includes("nonstandard_dates"));
});

test("fewer positions parsed than the resume was built with", () => {
  const r = assess(extraction(CLEAN_LAYOUT), { expected: { experience: 3, education: 1, projects: 1 } });
  assert.deepEqual(checksOf(r), ["positions_expected"]);
  assert.match(r.findings[0].message, /built with 3 positions; only 2 parsed/);
});

test("stack text on the title line: one finding per title, capped", () => {
  const layout = CLEAN_LAYOUT
    .replace("  Senior Software Engineer          ", "  Senior Software Engineer | Python, AWS")
    .replace("  Software Engineer          ", "  Software Engineer | FastAPI, SQL");
  const r = assess(extraction(layout));
  const found = r.findings.filter((f) => f.check === "title_extra_text");
  assert.equal(found.length, 2);
  assert.match(found[0].message, /a parser files the whole line as the job title/);
  assert.equal(r.parseability, 100 - 2 * penalty("title_extra_text"));

  // Four cluttered titles cost no more than the cap.
  const cap = config.scoring.readiness.checks.title_extra_text.cap;
  const many = `Jordan Rivera\njordan@example.com | 555-201-4477 | Austin, TX\nExperience\n${[1, 2, 3, 4].map((i) =>
    `  Company ${i}                         Jan 201${i} – Dec 201${i}\n  Engineer | Go, Rust             Austin, TX\n     • Shipped feature ${i}.`).join("\n")}\nEducation\n  State University, Austin, TX\n  Bachelor of Science, Aug. 2005 – May 2009\nSkills\n  Go, Rust\n${"filler words ".repeat(80)}`;
  const capped = assess(extraction(many));
  const cluttered = capped.findings.filter((f) => f.check === "title_extra_text");
  assert.equal(cluttered.length, 4);
  assert.equal(cluttered.reduce((n, f) => n + f.penalty, 0), cap);
  assert.equal(cluttered[3].note, "cap for this check reached");
});

test("a link whose address isn't printed is reported per link", () => {
  const layout = CLEAN_LAYOUT.replace("linkedin.com/in/jordan-rivera | github.com/jrivera", "LinkedIn | GitHub");
  const r = assess(extraction(layout));
  assert.deepEqual(checksOf(r), ["link_url_hidden", "link_url_hidden"]);
  assert.equal(r.status, "WARN", "a warning cannot be averaged into PASS");
  assert.match(r.findings[0].message, /address is not printed/);
});

test("education dates read after the next school are flagged with the text that separates them", () => {
  const layout = `Jordan Rivera
jordan@example.com | 555-201-4477 | Austin, TX
Education
  University of Texas at Austin                                Austin, TX
  Bachelor of Science in Computer Science            Aug. 2015 – May 2019
  Austin Community College                                  Round Rock, TX
  Associate of Science                               Aug. 2013 – May 2015
Experience
  Northwind Labs                                         Jan 2022 – Present
  Senior Software Engineer                                       Austin, TX
     • ${"Built services. ".repeat(60)}
Skills
  Python, Go
`;
  // Column-aware reading order: both schools, then both right-hand columns.
  const reading = `Jordan Rivera
jordan@example.com | 555-201-4477 | Austin, TX
Education
University of Texas at Austin
Bachelor of Science in Computer Science
Austin Community College
Associate of Science
Austin, TX
Aug. 2015 – May 2019
Round Rock, TX
Aug. 2013 – May 2015
${flatten(layout).split("\nExperience\n")[1] ? `Experience\n${flatten(layout).split("\nExperience\n")[1]}` : ""}`;
  const r = assess(extraction(layout, { views: { reading } }));
  const order = r.findings.filter((f) => f.check === "entry_order");
  assert.equal(order.length, 2);
  const ut = order.find((f) => f.message.includes("'University of Texas at Austin'"));
  assert.match(ut.evidence.join("\n"), /poppler reading order puts 'Austin Community College' between it and its location 'Austin, TX'/);
  assert.match(ut.evidence.join("\n"), /poppler reading order puts 'Austin Community College' between it and its dates 'Aug. 2015 – May 2019'/);
  // The same text in content-stream order keeps each school together.
  assert.equal(assess(extraction(layout)).findings.filter((f) => f.check === "entry_order").length, 0);
});

test("sections coming out in a different order is flagged", () => {
  const flat = flatten(CLEAN_LAYOUT);
  const [head, rest] = flat.split("\nExperience\n");
  const [exp, after] = rest.split("\nEducation\n");
  const reading = `${head}\nEducation\n${after}\nExperience\n${exp}`;
  const r = assess(extraction(CLEAN_LAYOUT, { views: { reading } }));
  assert.ok(checksOf(r).includes("section_order"));
});

test("two columns of prose side by side are flagged as a multi-column layout", () => {
  const rows = Array.from({ length: 6 }, (_, i) => `  Led a team of engineers on project ${i}              Python Go Rust Kubernetes Terraform`).join("\n");
  const r = assess(extraction(`${CLEAN_LAYOUT}\nLeadership\n${rows}\n`));
  assert.ok(checksOf(r).includes("multi_column"));
});

test("unreadable glyphs: critical above the share, a warning below it; ligatures warn", () => {
  const garbled = assess(extraction(CLEAN_LAYOUT.replace(/e/g, "\uFFFD")));
  assert.equal(garbled.status, "FAIL");
  assert.equal(garbled.findings.find((f) => f.check === "unreadable_glyphs").severity, "critical");

  const few = assess(extraction(CLEAN_LAYOUT.replace("Northwind", "North\uFFFDind")));
  const f = few.findings.find((x) => x.check === "unreadable_glyphs");
  assert.equal(f.severity, "warning");
  assert.equal(f.penalty, config.scoring.readiness.checks.unreadable_glyphs.warning_penalty);

  assert.ok(checksOf(assess(extraction(CLEAN_LAYOUT.replace("financial", "\uFB01nancial").replace("fraud", "\uFB01raud")))).includes("ligature_glyphs"));
});

test("images and too little text", () => {
  assert.deepEqual(checksOf(assess(extraction(CLEAN_LAYOUT, { images: 2 }))), ["images", "images"]);
  const thin = assess(extraction("Jordan Rivera\njordan@example.com\nExperience\n"));
  assert.equal(thin.status, "FAIL");
  assert.ok(checksOf(thin).includes("text_extractable"));
});

test("accounting: start minus every finding's penalty equals parseability, never below the floor", () => {
  const inputs = [
    extraction(CLEAN_LAYOUT),
    extraction(CLEAN_LAYOUT.replace(" | jordan.rivera@example.com", "").replace("\nExperience\n", "\nWork Stuff\n"), { images: 3 }),
    extraction(CLEAN_LAYOUT.replace("linkedin.com/in/jordan-rivera | github.com/jrivera", "LinkedIn | GitHub")),
    extraction("x"),
  ];
  for (const x of inputs) {
    const r = assess(x);
    const lost = r.findings.reduce((n, f) => n + Math.round(f.penalty * 10), 0) / 10;
    assert.equal(r.accounting.total_penalty, lost);
    assert.equal(r.accounting.penalties.reduce((n, p) => n + p.points * 10, 0) / 10, lost);
    assert.equal(r.parseability, Math.max(config.scoring.readiness.floor, config.scoring.readiness.start - lost));
    assert.ok(r.parseability >= config.scoring.readiness.floor);
  }
});

test("penalties, caps and the pass threshold come from config, not code", () => {
  const layout = CLEAN_LAYOUT.replace("  Senior Software Engineer          ", "  Senior Software Engineer | Python, AWS");
  const base = assess(extraction(layout));
  const heavier = assess(extraction(layout), {}, configWith((c) => { Object.assign(c.scoring.readiness.checks.title_extra_text, { penalty: 17.5, cap: 30 }); }));
  assert.equal(base.parseability, 100 - penalty("title_extra_text"));
  assert.equal(heavier.parseability, 82.5);
  assert.equal(heavier.status, "WARN");
  assert.notEqual(heavier.config_hash, base.config_hash);
  const lenient = assess(extraction(layout), {}, configWith((c) => {
    Object.assign(c.scoring.readiness.checks.title_extra_text, { penalty: 17.5, cap: 30 });
    c.scoring.readiness.pass_min = 80;
  }));
  assert.equal(lenient.status, "WARN", "a lower score threshold does not hide an explicit warning");
  const strictThreshold = assess(extraction(CLEAN_LAYOUT), {}, configWith((c) => { c.scoring.readiness.pass_min = 101; }));
  assert.equal(strictThreshold.status, "WARN", "a clean resume below the configured threshold warns");
  // With the shipped cap, the same edit is limited to the cap.
  const capped = assess(extraction(layout), {}, configWith((c) => { c.scoring.readiness.checks.title_extra_text.penalty = 17.5; }));
  assert.equal(capped.parseability, 100 - config.scoring.readiness.checks.title_extra_text.cap);
});

test("determinism: the same input and config give byte-identical results", () => {
  const layout = CLEAN_LAYOUT.replace("linkedin.com/in/jordan-rivera | github.com/jrivera", "LinkedIn | GitHub");
  const a = assess(extraction(layout));
  const b = assess(extraction(layout));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  // Reloading the config, or reordering its keys, changes neither the hash nor the result.
  const shuffled = JSON.parse(canonicalJson(loadAtsConfig()));
  const reversed = Object.fromEntries(Object.entries(shuffled.scoring.readiness.checks).reverse());
  const cfg2 = configWith((c) => { c.scoring.readiness.checks = reversed; });
  assert.equal(cfg2.hash, config.hash);
  assert.equal(JSON.stringify(assess(extraction(layout), {}, cfg2)), JSON.stringify(a));
});
