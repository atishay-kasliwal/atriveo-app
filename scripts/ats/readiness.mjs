// ATS Readiness: can a parser read this resume? Every check either passes or produces findings
// that name the text responsible, and every finding's penalty comes from data/ats/scoring.yaml.
// Parseability = start − Σ penalties, kept in tenths of a point so the sum is exact. A critical
// finding fails the resume whatever the number is.
//
// This says nothing about fit to a job (that is Job Match, a separate score), and it is our own
// check, not the score any employer's ATS gives.

import { LOCATION_RE, DATE_RANGE_RE, displayUrl, normalizeText } from "./patterns.mjs";
import { headingKey, parseResume } from "./resume-parse.mjs";

export const READINESS_VERSION = "1.0.1";
const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };
const VIEW_NAMES = { reading: "poppler reading order", raw: "content-stream order" };

const tenths = (n) => Math.round(Number(n || 0) * 10);
const quote = (s, n = 70) => `'${s.length > n ? `${s.slice(0, n - 1)}…` : s}'`;

/** The parts of each entry that must stay together, in page order. */
function entryItems(parsed) {
  const out = [];
  for (const key of ["experience", "education", "projects", "leadership"]) {
    parsed[key].forEach((e, i) => {
      const anchor = key === "education" ? e.institution : key === "projects" ? e.name : (e.company_inherited ? null : e.company);
      const fields = key === "education"
        ? [["degree", e.degree], ["dates", e.dates?.text], ["location", e.location]]
        : key === "projects"
          ? [["dates", e.dates?.text]]
          : [["title", e.title], ["dates", e.dates?.text], ["location", e.location]];
      out.push({ key, index: i, anchor, label: anchor ?? e.title ?? `${key} ${i + 1}`, fields: fields.filter(([, t]) => t) });
    });
  }
  return out;
}

/**
 * Where each text sits in view[from, to): whole-word matches only, longest texts placed first so
 * "Software Engineer" can't land inside "Senior Software Engineer", and the k-th copy of a
 * repeated text goes to its k-th place on the page. -1 when a text isn't found.
 */
function locate(view, from, to, texts) {
  const at = texts.map(() => -1);
  const claimed = [];
  const free = (s, e) => claimed.every(([cs, ce]) => e <= cs || s >= ce);
  const isWordChar = (ch) => /[A-Za-z0-9]/.test(ch ?? "");
  const order = texts.map((t, i) => ({ i, needle: normalizeText(t) })).filter((x) => x.needle)
    .sort((a, b) => b.needle.length - a.needle.length || a.i - b.i);
  const used = new Map();
  for (const { i, needle } of order) {
    const skip = used.get(needle) ?? 0;
    used.set(needle, skip + 1);
    let seen = 0;
    for (let p = view.indexOf(needle, from); p >= 0 && p < to; p = view.indexOf(needle, p + 1)) {
      const end = p + needle.length;
      if (isWordChar(view[p - 1]) || isWordChar(view[end]) || !free(p, end)) continue;
      if (seen++ < skip) continue;
      at[i] = p;
      claimed.push([p, end]);
      break;
    }
  }
  return at;
}

/** Line-normalized view text and where each heading line starts. */
function viewIndex(text, headings) {
  const lines = String(text || "").split(/\n|\f/).map(normalizeText);
  const starts = [];
  let offset = 0;
  const marks = [];
  for (const line of lines) {
    starts.push(offset);
    const key = line && headingKey(line, headings);
    if (key) marks.push({ key, at: offset, text: line });
    offset += line.length + 1;
  }
  return { text: lines.join("\n"), marks };
}

/**
 * Entries whose fields are split up in a reading-order view: something from another entry sits
 * between an entry's name and its dates, title or location.
 */
function orderProblems(parsed, views, viewNames, headingsCfg) {
  const items = entryItems(parsed);
  const problems = new Map();
  for (const viewName of viewNames) {
    const { text, marks } = viewIndex(views[viewName], headingsCfg);
    for (const key of ["experience", "education", "projects", "leadership"]) {
      const own = items.filter((it) => it.key === key);
      if (!own.length) continue;
      const mark = marks.find((m) => m.key === key);
      if (!mark) continue;
      const end = marks.find((m) => m.at > mark.at)?.at ?? text.length;
      const flat = own.flatMap((it) => [{ it, kind: "name", text: it.anchor }, ...it.fields.map(([kind, t]) => ({ it, kind, text: t }))])
        .filter((x) => x.text);
      locate(text, mark.at, end, flat.map((x) => x.text)).forEach((at, i) => { flat[i].at = at; });
      for (const it of own) {
        const name = flat.find((x) => x.it === it && x.kind === "name");
        if (!name || name.at < 0) continue;
        for (const field of flat.filter((x) => x.it === it && x.kind !== "name" && x.at >= 0)) {
          const lo = Math.min(name.at, field.at);
          const hi = Math.max(name.at, field.at);
          const intruder = flat.filter((x) => x.it !== it && x.at > lo && x.at < hi).sort((a, b) => a.at - b.at)[0];
          if (!intruder) continue;
          const id = `${key}#${it.index}`;
          if (!problems.has(id)) problems.set(id, { it, details: [] });
          problems.get(id).details.push(`${VIEW_NAMES[viewName] ?? viewName} puts ${quote(intruder.text, 45)} between it and its ${field.kind} ${quote(field.text, 40)}`);
        }
      }
    }
  }
  return [...problems.values()];
}

function sectionOrderProblems(parsed, views, viewNames, headingsCfg) {
  const expected = parsed.sections.map((s) => s.key);
  const out = [];
  for (const viewName of viewNames) {
    const got = viewIndex(views[viewName], headingsCfg).marks.map((m) => m.key);
    if (got.join() !== expected.join()) out.push(`${VIEW_NAMES[viewName] ?? viewName}: ${got.join(" → ")} (page order: ${expected.join(" → ")})`);
  }
  return out;
}

/** Body lines that carry two blocks of prose side by side. */
function columnLines(layout, cfg) {
  const isProse = (c) => c.split(/\s+/).length >= cfg.min_words_per_cell && !DATE_RANGE_RE.test(c) && !LOCATION_RE.test(c);
  return String(layout || "").split("\n").map((l) => l.trim().split(/ {3,}/)).filter((cells) => cells.filter(isProse).length >= 2).map((c) => c.join(" ‖ "));
}

function glyphCounts(text) {
  const chars = String(text || "").replace(/\s/g, "");
  const count = (re) => (chars.match(re) || []).length;
  return {
    total: chars.length,
    unreadable: count(/[\uFFFD\uE000-\uF8FF\u0000-\u0008\u000E-\u001F]/g),
    ligatures: count(/[\uFB00-\uFB06]/g),
  };
}

function repeatedPageLines(layout) {
  const pages = String(layout || "").split("\f").map((p) => p.split("\n").map((l) => l.trim()).filter(Boolean)).filter((p) => p.length);
  if (pages.length < 2) return [];
  const ends = pages.flatMap((p) => [p[0], p[p.length - 1]]);
  return [...new Set(ends.filter((l, i) => ends.indexOf(l) !== i))];
}

/**
 * @param {object} extraction  extractPdf() result (views, pages, images, links)
 * @param {object} config      loadAtsConfig() result
 * @param {object} [opts]
 * @param {{experience?: number, education?: number, projects?: number}} [opts.expected]
 *        how many entries the resume was built with, when known (tailoring run folders)
 */
export function assessReadiness(extraction, config, { expected = null } = {}) {
  const rcfg = config.scoring.readiness;
  const checks = rcfg.checks;
  const parsed = parseResume(extraction.views.layout, config.sections);
  const findings = [];
  const passed = [];
  const pass = (check, label) => passed.push({ check, label });

  /** One finding per item; per-item penalty until the check's cap is used up. */
  function charge(check, items, { severity, penalty } = {}) {
    const c = checks[check];
    const per = tenths(penalty ?? c.penalty);
    const cap = c.cap != null ? tenths(c.cap) : Infinity;
    let used = 0;
    for (const { message, evidence = [] } of items) {
      const points = Math.max(0, Math.min(per, cap - used));
      used += points;
      findings.push({
        check, severity: severity ?? c.severity, penalty: points / 10, message, evidence,
        ...(points < per && { note: "cap for this check reached" }),
      });
    }
  }

  // ── Text ──────────────────────────────────────────────────────────────────
  const minWords = checks.text_extractable.min_words;
  if (parsed.words < minWords) {
    charge("text_extractable", [{ message: `Only ${parsed.words} words could be extracted (fewer than ${minWords}); the text is likely in images or an unreadable layout` }]);
  } else pass("text_extractable", `Text extracted: ${parsed.words} words on ${extraction.pages} page${extraction.pages === 1 ? "" : "s"}`);

  const glyphs = glyphCounts(extraction.views.layout);
  const share = glyphs.total ? glyphs.unreadable / glyphs.total : 0;
  if (glyphs.unreadable) {
    const critical = share > checks.unreadable_glyphs.max_share;
    charge("unreadable_glyphs", [{
      message: `${glyphs.unreadable} character${glyphs.unreadable === 1 ? "" : "s"} came out as replacement, private-use or control characters (${(share * 100).toFixed(2)}% of the text)`,
    }], critical ? {} : { severity: "warning", penalty: checks.unreadable_glyphs.warning_penalty });
  }
  if (glyphs.ligatures) {
    charge("ligature_glyphs", [{ message: `${glyphs.ligatures} ligature character${glyphs.ligatures === 1 ? "" : "s"} (such as "\uFB01"): words containing them do not match their plain spelling` }]);
  }
  if (!glyphs.unreadable && !glyphs.ligatures) pass("glyphs", "Every character maps back to readable text");

  if (extraction.images > 0) {
    charge("images", Array.from({ length: extraction.images }, (_, i) => ({
      message: `Embedded image ${i + 1} of ${extraction.images}: parsers don't read text inside images, and this check can't see what it contains`,
    })));
  } else pass("images", "No embedded images");

  if (extraction.pages > checks.page_count.max_pages) {
    charge("page_count", [{ message: `${extraction.pages} pages; most parsers read them all, but recruiters rarely do` }]);
  }
  const repeated = repeatedPageLines(extraction.views.layout);
  if (repeated.length) charge("repeated_page_lines", [{ message: "The same line opens or closes several pages (a header or footer)", evidence: repeated.slice(0, 3) }]);

  // ── Contact ───────────────────────────────────────────────────────────────
  const c = parsed.contact;
  if (c.name) pass("name", `Name: ${c.name}`);
  else charge("name", [{ message: "No name found at the top of the resume" }]);
  if (c.email) pass("email", `Email: ${c.email}${c.email_in_header ? "" : " (found below the header)"}`);
  else charge("email", [{ message: "No email address in the extracted text" }]);
  if (c.phone) pass("phone", `Phone: ${c.phone}${c.phone_in_header ? "" : " (found below the header)"}`);
  else charge("phone", [{ message: "No phone number in the extracted text" }]);
  if (c.location) pass("location", `Location: ${c.location}`);
  else charge("location", [{ message: "No city, state or 'Remote' in the contact block" }]);

  const compact = (s) => String(s).toLowerCase().replace(/\s+/g, "");
  const visible = compact(extraction.views.layout);
  const webLinks = extraction.links.filter((l) => !/^(mailto|tel):/i.test(l.url));
  const hidden = webLinks.filter((l) => !visible.includes(compact(displayUrl(l.url))));
  if (hidden.length) {
    charge("link_url_hidden", hidden.map((l) => ({
      message: `Link to ${displayUrl(l.url)} is clickable but its address is not printed; extracted text keeps only the label`,
      evidence: [l.url],
    })));
  }
  if (webLinks.length && !hidden.length) pass("link_url_hidden", `Profile links printed as text: ${webLinks.map((l) => displayUrl(l.url)).join(", ")}`);

  // ── Sections ──────────────────────────────────────────────────────────────
  const has = (key) => parsed.sections.some((s) => s.key === key);
  for (const key of ["experience", "education", "skills"]) {
    if (!has(key)) charge(`section_${key}`, [{ message: `No recognizable ${key} heading; parsers file content by its heading` }]);
  }
  if (["experience", "education", "skills"].every(has)) {
    pass("sections", `Sections recognized: ${parsed.sections.map((s) => s.heading).join(", ")}`);
  }
  const viewNames = rcfg.order_views;
  const sectionOrder = sectionOrderProblems(parsed, extraction.views, viewNames, config.sections.headings);
  if (sectionOrder.length) charge("section_order", [{ message: "Sections come out in a different order than they appear on the page", evidence: sectionOrder }]);
  else pass("section_order", `Section order is the same in ${viewNames.map((v) => VIEW_NAMES[v] ?? v).join(" and ")}`);

  // ── Positions ─────────────────────────────────────────────────────────────
  const positions = parsed.experience;
  const complete = positions.filter((p) => p.company && p.title && p.dates);
  if (has("experience")) {
    if (!positions.some((p) => p.company && p.dates)) {
      charge("positions_found", [{ message: "No position with both an employer and a date range under Experience" }]);
    }
    if (expected?.experience != null && complete.length < expected.experience) {
      const missing = expected.experience - complete.length;
      charge("positions_expected", Array.from({ length: missing }, () => ({
        message: `The resume was built with ${expected.experience} positions; only ${complete.length} parsed with employer, title and dates`,
      })));
    }
    const undated = positions.filter((p) => !p.dates);
    if (undated.length) charge("position_dates", undated.map((p) => ({ message: `No date range a parser can read for ${quote(p.company ?? p.title ?? "a position")}`, evidence: p.header })));
    const untitled = positions.filter((p) => !p.title);
    if (untitled.length) charge("position_title", untitled.map((p) => ({ message: `No job title found for ${quote(p.company ?? "a position")}`, evidence: p.header })));
    if (positions.length && !undated.length && !untitled.length) {
      pass("positions", `Positions: ${positions.length} parsed${expected?.experience != null ? ` of ${expected.experience} built` : ""}, each with employer, title and dates`);
    }
  }
  const cluttered = positions.filter((p) => p.title_extra);
  if (cluttered.length) {
    charge("title_extra_text", cluttered.map((p) => ({
      message: `Title line for ${quote(p.company ?? "a position", 40)} reads ${quote(p.title, 80)}; a parser files the whole line as the job title`,
      evidence: [p.title_extra],
    })));
  } else if (positions.length) pass("title_extra_text", "Job titles carry the title only");

  // ── Education ─────────────────────────────────────────────────────────────
  if (has("education")) {
    const gaps = parsed.education.map((e) => ({ e, missing: ["institution", "degree", "dates"].filter((k) => !e[k]) })).filter((x) => x.missing.length);
    if (gaps.length) charge("education_fields", gaps.map(({ e, missing }) => ({ message: `Education entry ${quote(e.institution ?? e.degree ?? "?")} is missing its ${missing.join(", ")}`, evidence: e.header })));
    else if (parsed.education.length) pass("education_fields", `Education: ${parsed.education.length} entr${parsed.education.length === 1 ? "y" : "ies"}, each with school, degree and dates`);
  }

  // ── Reading order and layout ──────────────────────────────────────────────
  const order = orderProblems(parsed, extraction.views, viewNames, config.sections.headings);
  if (order.length) {
    charge("entry_order", order.map(({ it, details }) => ({
      message: `${it.key[0].toUpperCase()}${it.key.slice(1)} entry ${quote(it.label, 45)}: its details are separated from it in reading order, so a parser can attach them to the wrong entry`,
      evidence: details,
    })));
  } else pass("entry_order", `Each entry's title, dates and location stay with it in ${viewNames.map((v) => VIEW_NAMES[v] ?? v).join(" and ")}`);

  const odd = [...positions, ...parsed.education, ...parsed.projects].filter((e) => e.nonstandard_dates?.length);
  if (odd.length) charge("nonstandard_dates", odd.map((e) => ({ message: `Date written in a form a parser can't turn into a duration: ${quote(e.nonstandard_dates[0])}` })));

  const cols = columnLines(extraction.views.layout, checks.multi_column);
  if (cols.length >= checks.multi_column.min_lines) {
    charge("multi_column", [{ message: `${cols.length} lines carry two blocks of text side by side; parsers may read across the columns`, evidence: cols.slice(0, 2) }]);
  } else pass("multi_column", "Single-column body text");

  // ── Score ─────────────────────────────────────────────────────────────────
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.penalty - a.penalty
    || a.check.localeCompare(b.check) || a.message.localeCompare(b.message));
  const lost = findings.reduce((n, f) => n + tenths(f.penalty), 0);
  const raw = tenths(rcfg.start) - lost;
  const parseability = Math.max(tenths(rcfg.floor), raw) / 10;
  const critical = findings.filter((f) => f.severity === "critical");
  const warnings = findings.some((f) => f.severity === "warning");
  const status = critical.length ? "FAIL" : (warnings || parseability < rcfg.pass_min) ? "WARN" : "PASS";

  const byCheck = new Map();
  for (const f of findings) if (f.penalty) byCheck.set(f.check, (byCheck.get(f.check) ?? 0) + tenths(f.penalty));
  return {
    kind: "ats-readiness",
    version: READINESS_VERSION,
    config_hash: config.hash,
    status,
    parseability,
    max: rcfg.start,
    accounting: {
      start: rcfg.start,
      penalties: [...byCheck].map(([check, t]) => ({ check, points: t / 10 })),
      total_penalty: lost / 10,
      floor_applied: raw < tenths(rcfg.floor),
      parseability,
    },
    critical: critical.map((f) => f.message),
    findings,
    passed,
    input: {
      file: extraction.file ? extraction.file.split("/").pop() : null,
      sha256: extraction.sha256 ?? null,
      pages: extraction.pages,
      words: parsed.words,
      images: extraction.images,
      links: extraction.links.map((l) => l.url),
      fonts_without_unicode: extraction.fonts.filter((f) => !f.unicode).map((f) => f.name),
    },
    expected,
    parsed,
  };
}
