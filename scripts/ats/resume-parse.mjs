// Resume structure from the layout view of the text: contact block, sections, entries
// (organization, title, dates, location, bullets) and skills. It is deliberately conservative:
// a field it cannot find stays null, and the readiness checks report the gap instead of guessing.

import {
  BULLET_RE, DATE_RANGE_RE, EMAIL_RE, LOCATION_RE, NONSTANDARD_DATE_RE, PHONE_RE, URL_RE,
  countWords, parseDateRange,
} from "./patterns.mjs";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (text, words) => words.some((w) => new RegExp(`(?<![a-z])${escapeRe(w)}(?![a-z])`).test(text.toLowerCase()));
const NAME_RE = /^[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,3}$/;

/** Non-empty lines with their page, indentation and cells (runs of 3+ spaces split cells). */
export function layoutLines(layoutText) {
  const out = [];
  String(layoutText || "").split("\f").forEach((page, p) => {
    for (const raw of page.split("\n")) {
      const text = raw.trim();
      if (!text) continue;
      out.push({ page: p + 1, indent: raw.length - raw.trimStart().length, text, cells: text.split(/ {3,}/).map((c) => c.trim()).filter(Boolean) });
    }
  });
  return out;
}

export function headingKey(text, headings) {
  const t = text.toLowerCase().replace(/&/g, " and ").replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  for (const [key, variants] of Object.entries(headings)) if (variants.includes(t)) return key;
  return null;
}

function parseContact(lines, allText) {
  const segments = lines.flatMap((l) => l.text.split(/\s*[|•·]\s*| {3,}/)).map((s) => s.trim()).filter(Boolean);
  const name = lines.map((l) => l.text).concat(segments.slice(0, 1)).find((t) => NAME_RE.test(t) && !/\d/.test(t)) ?? null;
  const contact = { name, email: null, phone: null, location: null, urls: [], other: [] };
  for (const seg of segments) {
    if (seg === name) continue;
    const email = seg.match(EMAIL_RE);
    const phone = seg.match(PHONE_RE);
    const url = !email && seg.match(URL_RE);
    if (email) contact.email ??= email[0];
    else if (phone) contact.phone ??= phone[0].trim();
    else if (LOCATION_RE.test(seg)) contact.location ??= seg;
    else if (url && url[0].length >= 6) contact.urls.push(url[0]);
    else contact.other.push(seg);
  }
  // Anywhere in the document still counts for a parser that scans the whole text.
  contact.email_in_header = Boolean(contact.email);
  contact.phone_in_header = Boolean(contact.phone);
  contact.email ??= allText.match(EMAIL_RE)?.[0] ?? null;
  contact.phone ??= allText.match(PHONE_RE)?.[0]?.trim() ?? null;
  return contact;
}

/** Header lines and the bullets under them; wrapped bullet lines join the bullet they continue. */
function groupLines(lines) {
  const base = Math.min(...lines.filter((l) => !BULLET_RE.test(l.text)).map((l) => l.indent), Infinity);
  const groups = [];
  let cur = null;
  let prev = null;
  for (const l of lines) {
    if (BULLET_RE.test(l.text)) {
      if (!cur) groups.push(cur = { header: [], bullets: [] });
      cur.bullets.push(l.text.replace(BULLET_RE, ""));
      prev = "bullet";
      continue;
    }
    const continues = (prev === "bullet" || prev === "cont") && (l.indent > base + 1
      || (l.cells.length === 1 && !DATE_RANGE_RE.test(l.text) && (/^[a-z]/.test(l.text) || /[.;]$/.test(l.text))));
    if (continues && cur?.bullets.length) {
      cur.bullets[cur.bullets.length - 1] += ` ${l.text}`;
      prev = "cont";
      continue;
    }
    if (!cur || cur.bullets.length) groups.push(cur = { header: [], bullets: [] });
    cur.header.push(l);
    prev = "header";
  }
  return groups;
}

/** Split one header group into entries: a second date range (or second school / degree) starts a new one. */
function splitEntries(key, group, cfg) {
  const entries = [];
  let e = null;
  for (const l of group.header) {
    const kinds = {
      date: DATE_RANGE_RE.test(l.text),
      institution: key === "education" && hasWord(l.text, cfg.institution_words),
      degree: key === "education" && hasWord(l.text, cfg.degree_words),
    };
    if (!e || Object.keys(kinds).some((k) => kinds[k] && e.kinds[k])) entries.push(e = { lines: [], kinds: {}, bullets: [] });
    e.lines.push(l);
    for (const k of Object.keys(kinds)) if (kinds[k]) e.kinds[k] = true;
  }
  if (!entries.length) entries.push({ lines: [], kinds: {}, bullets: [] });
  entries[entries.length - 1].bullets = group.bullets;
  return entries;
}

/** Dates, location and the remaining text cells of one entry's header lines. */
function headerFields(key, lines, cfg) {
  const f = { dates: null, location: null, texts: [], nonstandard_dates: [] };
  lines.forEach((l, li) => {
    l.cells.forEach((cell, ci) => {
      let c = cell;
      const d = c.match(DATE_RANGE_RE);
      if (d) {
        f.dates ??= parseDateRange(d[0]);
        c = (c.slice(0, d.index) + c.slice(d.index + d[0].length)).replace(/^[\s,|–—-]+|[\s,|–—-]+$/g, "");
      } else if (NONSTANDARD_DATE_RE.test(c)) {
        f.nonstandard_dates.push(c);
      }
      if (!c) return;
      // A location is a cell of its own: right of the line's first cell, or alone on a later line.
      // (A whole first line like "Google, Mountain View, CA" is the employer and its city.)
      if ((ci > 0 || (li > 0 && l.cells.length === 1)) && LOCATION_RE.test(c)) {
        f.location ??= c;
        return;
      }
      // "Stony Brook University, Stony Brook, New York": the school, then where it is.
      if (key === "education" && c.includes(",") && hasWord(c.slice(0, c.indexOf(",")), cfg.institution_words)) {
        const rest = c.slice(c.indexOf(",") + 1).trim();
        if (LOCATION_RE.test(rest)) {
          f.texts.push(c.slice(0, c.indexOf(",")).trim());
          f.location ??= rest;
          return;
        }
      }
      f.texts.push(c);
    });
  });
  return f;
}

// "Software Engineer | FastAPI, Python": text after a bar, or after a dash when it is a list.
const TITLE_EXTRA_RE = /^(.*?\S)\s+(?:[|•·]\s+(.+)|[–—-]{1,2}\s+(.+,.+))$/;

function toEntry(key, raw, cfg, previous) {
  const f = headerFields(key, raw.lines, cfg);
  const common = {
    dates: f.dates,
    location: f.location,
    bullets: raw.bullets,
    header: raw.lines.map((l) => l.text),
    ...(f.nonstandard_dates.length && { nonstandard_dates: f.nonstandard_dates }),
  };
  if (key === "education") {
    const institution = f.texts.find((t) => hasWord(t, cfg.institution_words)) ?? f.texts[0] ?? null;
    const degree = f.texts.find((t) => t !== institution && hasWord(t, cfg.degree_words))
      ?? f.texts.find((t) => t !== institution) ?? null;
    return { institution, degree, ...common };
  }
  if (key === "projects") {
    const [name = null, ...stack] = (f.texts[0] ?? "").split(/\s+[|•·]\s+/).filter(Boolean);
    return { name, stack: stack.length ? stack.join(" | ") : null, ...common };
  }
  const isTitle = (t) => hasWord(t, cfg.title_words);
  // The company line is the one carrying a tools list ("Accolite Digital | Java, SQL") when there is one.
  let company = f.texts.find((t) => /\s[|•·]\s/.test(t) && !isTitle(t.split(/\s+[|•·]\s+/)[0]))
    ?? f.texts.find((t) => !isTitle(t)) ?? (f.texts.length > 1 ? f.texts[0] : null);
  // "Accolite Digital | Java, Spring Boot": the employer's tools line rides on the company line.
  const companyLine = company;
  let stack = null;
  if (company && /\s[|•·]\s/.test(company)) [company, stack] = [company.split(/\s+[|•·]\s+/)[0], company.split(/\s+[|•·]\s+/).slice(1).join(" | ")];
  const title = f.texts.find((t) => t !== companyLine && isTitle(t)) ?? f.texts.find((t) => t !== companyLine) ?? null;
  let inherited = false;
  // A second role under the same employer: the header has a title and dates but no employer.
  if (!company && title && previous?.company) [company, inherited] = [previous.company, true];
  const extra = title?.match(TITLE_EXTRA_RE);
  return {
    company,
    ...(inherited && { company_inherited: true }),
    title,
    title_extra: extra ? (extra[2] ?? extra[3]).trim() : null,
    ...(stack && { stack }),
    ...common,
  };
}

function parseEntries(key, lines, cfg) {
  const out = [];
  for (const group of groupLines(lines)) {
    for (const raw of splitEntries(key, group, cfg)) out.push(toEntry(key, raw, cfg, out[out.length - 1]));
  }
  return out;
}

function parseSkills(lines) {
  const groups = [];
  for (const l of lines) {
    const text = l.text.replace(BULLET_RE, "");
    const split = (s) => s.split(/\s*[,;|•·]\s*/).map((x) => x.trim()).filter(Boolean);
    const m = text.match(/^([^:,]{2,40}):\s*(.*)$/);
    if (m) groups.push({ label: m[1].trim(), items: split(m[2]) });
    else if (groups.length) groups[groups.length - 1].items.push(...split(text));
    else groups.push({ label: null, items: split(text) });
  }
  return { groups, items: groups.flatMap((g) => g.items) };
}

/**
 * @param {string} layoutText  pdftotext -layout output
 * @param {object} cfg         data/ats/sections.yaml
 */
export function parseResume(layoutText, cfg) {
  const lines = layoutLines(layoutText);
  const headings = [];
  lines.forEach((l, i) => {
    const key = l.cells.length === 1 ? headingKey(l.text, cfg.headings) : null;
    if (key) headings.push({ key, heading: l.text, line: i });
  });

  const contactLines = lines.slice(0, headings.length ? headings[0].line : Math.min(3, lines.length));
  const result = {
    words: countWords(layoutText),
    contact: parseContact(contactLines, lines.map((l) => l.text).join("\n")),
    sections: headings.map(({ key, heading }) => ({ key, heading })),
    experience: [],
    education: [],
    projects: [],
    leadership: [],
    skills: { groups: [], items: [] },
    summary: null,
  };
  headings.forEach((h, i) => {
    const body = lines.slice(h.line + 1, i + 1 < headings.length ? headings[i + 1].line : lines.length);
    if (cfg.entry_sections.includes(h.key)) result[h.key].push(...parseEntries(h.key, body, cfg));
    else if (h.key === "skills") {
      const s = parseSkills(body);
      result.skills.groups.push(...s.groups);
      result.skills.items.push(...s.items);
    } else if (h.key === "summary") result.summary = body.map((l) => l.text).join(" ");
  });
  return result;
}
