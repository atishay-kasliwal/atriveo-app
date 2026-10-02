// Text patterns the ATS parser recognizes: dates, contact fields, bullets, locations.

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const POINT = `(?:${MONTH}\\s+\\d{4}|\\d{1,2}/\\d{4}|\\d{4})`;
const END = `(?:${POINT}|present|current|now|today|ongoing)`;
const DASH = "(?:\\s*[-–—]\\s*|\\s+to\\s+)";

/** A date range a parser can turn into a duration: "Aug. 2024 – May 2026", "2019 - Present". */
export const DATE_RANGE_RE = new RegExp(`(?<![\\w/])${POINT}${DASH}${END}(?![\\w/])`, "i");
/** Dates written in a way a parser cannot turn into a duration: seasons, apostrophe years. */
export const NONSTANDARD_DATE_RE = /\b(?:spring|summer|fall|autumn|winter)\s+'?\d{2,4}\b|(?<![\w])'\d{2}\b/i;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function parsePoint(s) {
  const t = s.trim().toLowerCase().replace(/\.$/, "");
  if (/^(present|current|now|today|ongoing)$/.test(t)) return { current: true };
  let m = t.match(/^([a-z]+)\.?\s+(\d{4})$/);
  if (m) return { year: Number(m[2]), month: MONTHS.indexOf(m[1].slice(0, 3)) + 1 };
  m = t.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return { year: Number(m[2]), month: Number(m[1]) };
  m = t.match(/^(\d{4})$/);
  return m ? { year: Number(m[1]), month: null } : null;
}

/** "Aug. 2024 – May 2026" → { text, start: {year, month}, end: {year, month} | null, current }. */
export function parseDateRange(text) {
  const m = String(text || "").match(DATE_RANGE_RE);
  if (!m) return null;
  const [from, to] = m[0].split(new RegExp(DASH, "i"));
  const start = parsePoint(from);
  const end = parsePoint(to);
  return {
    text: m[0],
    start: start && !start.current ? start : null,
    end: end && !end.current ? end : null,
    current: Boolean(end?.current),
  };
}

export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
export const PHONE_RE = /(?<![\d/])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)|\+\d{1,3}[\s-]\d{2,5}[\s-]\d{3,5}[\s-]?\d{3,5}/;
/** A web address as printed: linkedin.com/in/x, https://github.com/x, name.dev. */
export const URL_RE = /(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s|,]*)?/i;
/** "City, ST", "City, State", "City, Country", "City, State, Country", or "Remote". */
export const LOCATION_RE = /^(?:[Rr]emote(?:\s*\([^)]*\))?|REMOTE|[A-Z][\w.'’-]*(?:[ -][A-Z][\w.'’-]*){0,3},\s*(?:[A-Z]{2}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?:,\s*[A-Z][\w]+(?:\s+[A-Z][a-z]+)?)?)$/;
export const BULLET_RE = /^[•●▪◦‣∙·*–-]\s+/;

/** One spelling for comparing text across views: dashes unified, whitespace collapsed. */
export function normalizeText(s) {
  return String(s || "").replace(/\u00ad/g, "").replace(/[‐‑‒–—―−]/g, "-").replace(/[ \t]+/g, " ").trim();
}

/** "https://www.linkedin.com/in/x/" → "linkedin.com/in/x" */
export function displayUrl(url) {
  return String(url).replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
}

export const countWords = (text) => (String(text || "").match(/\S+/g) || []).length;
