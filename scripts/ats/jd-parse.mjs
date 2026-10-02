// Parse what a job description actually asks for. Background and benefits never enter the score.
// Ambiguous prose is retained as an unparsed requirement rather than silently becoming a match.

const BACKGROUND = /^(?:about(?: us| the | our| \w+)?|who we are|company|our mission|benefits|job benefits|perks|compensation|salary|base salary|actual compensation|equal opportunity|committed to equal opportunities|eeo|what we offer|what's in it for you|why join|privacy|our culture|how we work|our approach|important note|you want to know more|a quick note about the process|a note on ai|health and wellbeing|growth and future|community|you belong here|usa-based roles only|canada-based roles only|why your work matters|a day in the life)/i;
const REQUIRED = /^(?:required skills?(?: and experience)?|requirements?|qualifications?|minimum qualifications?|must haves?|what you(?:'ll| will) need|what we're looking for|what we look for|what you bring|who you are|basic qualifications?|additional considerations|you might thrive in this role|experience we value|mindset we value|is it you we're looking for|about you|you likely)/i;
const PREFERRED = /^(?:preferred qualifications?|nice[- ]to[- ]haves?|bonus points for|bonus|preferred|desirable|what sets you apart)$/i;
const RESPONSIBILITIES = /^(?:key job responsibilities?|key responsibilities?|responsibilities?|in this role,? you will|what you(?:'ll| will) (?:do|be doing)|what you can expect|what success looks like|as an early engineer|role overview|duties|your impact|what you will build)/i;
const MARK_REQUIRED = /\b(?:required|must have|minimum|need to have|essential)\b/i;
const DEGREE = /\b(?:associate(?:'s)?|bachelor(?:'s)?|master(?:'s)?|ph\.?d\.?|doctorate|BS|BA|MS|MA|BTech)\b[^\n.;]{0,90}/gi;
const YEARS = /\b(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/gi;
const CERT = /\b(?:certification|certified|certificate)\b[^\n.;]{0,70}/gi;

export function termRegex(term, config = null) {
  const esc = String(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sensitive = config?.scoring?.job_match?.case_sensitive_terms?.includes(term);
  return new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, sensitive ? "" : "i");
}

export function phrase(text, term, config = null) {
  return termRegex(term, config).test(String(text));
}

function clean(line) {
  return line.replace(/[’‘]/g, "'").replace(/\\([+&#-])/g, "$1").replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "")
    .replace(/^\s*#{1,6}\s*/, "").replace(/^\*+|\*+$/g, "").replace(/^[^A-Za-z0-9]+/, "").replace(/\s+/g, " ").trim().replace(/\*+$/, "").trim();
}

function sectionOf(line) {
  const s = line.replace(/[:\s]+$/, "").trim();
  if (s.length > 80) return null;
  if (/^you likely\b/i.test(s) && !/^you likely$/i.test(s)) return null;
  if (REQUIRED.test(s)) return "required";
  if (PREFERRED.test(s)) return "preferred";
  if (RESPONSIBILITIES.test(s)) return "responsibilities";
  if (BACKGROUND.test(s)) return "background";
  return null;
}

function skillHits(text, config) {
  const hits = [];
  for (const [name, cfg] of Object.entries(config.skills)) {
    const spellings = [name, ...(cfg.variants || [])];
    let at = Infinity;
    let found = null;
    for (const s of spellings) {
      const m = String(text).match(termRegex(s, config));
      if (m && m.index < at) [at, found] = [m.index, m[0]];
    }
    if (found) hits.push({ name, at, spelling: found });
  }
  // A long recognized name absorbs shorter nested ones (e.g. Kubernetes security).
  const known = hits.sort((a, b) => a.at - b.at || b.spelling.length - a.spelling.length)
    .filter((h, _, a) => !a.some((other) => other !== h && other.at <= h.at && other.at + other.spelling.length >= h.at + h.spelling.length && other.spelling.length > h.spelling.length));
  const stop = new Set(config.scoring.job_match.unknown_skill_stopwords);
  const cue = /\b(?:experience with|experience in|proficiency in|skills in|knowledge of|familiarity with|tools such as|frameworks such as|using|including)\b/i.exec(text);
  const unknown = cue
    ? [...String(text).matchAll(/\b[A-Z][A-Za-z0-9+#.]{2,}\b/g)]
    .filter((m) => m.index > cue.index && !stop.has(m[0]) && !known.some((k) => m.index >= k.at && m.index + m[0].length <= k.at + k.spelling.length))
    .map((m) => ({ name: m[0], at: m.index, spelling: m[0], unknown: true })) : [];
  return [...known, ...unknown].sort((a, b) => a.at - b.at || a.name.localeCompare(b.name));
}

function extractAlternatives(line, hits) {
  const groups = [];
  const commaOrList = /,\s*or\s+(?:[A-Za-z][\w.-]*\s*)?/i.test(line);
  for (const h of hits) {
    const last = groups.at(-1);
    const prev = last?.at(-1);
    const between = prev && line.slice(prev.at + prev.spelling.length, h.at);
    if (last && (/^(?:\s*\/\s*|\s*,?\s*or\s+)$/i.test(between) || (commaOrList && /^\s*,\s*$/.test(between)))) last.push(h);
    else groups.push([h]);
  }
  return groups.map((g) => [...new Set(g.map((h) => h.name))]);
}

export function parseJobDescription(text, config) {
  const lines = String(text || "").split(/\r?\n/).map((raw) => ({ text: clean(raw), bullet: /^\s*(?:[-•*]|\d+[.)])\s+/.test(raw) })).filter((x) => x.text);
  const first = lines[0]?.text || "";
  const title = /^job title\s*:/i.test(first) ? first.replace(/^job title\s*:\s*/i, "")
    : first.length <= config.scoring.job_match.jd_parser.max_title_chars && !/[.!?]$/.test(first) && !/^(?:we |our |the |description|location|employment type|work arrangement)\b/i.test(first) && !sectionOf(first) ? first : null;
  const parsed = { title, required: [], preferred: [], responsibilities: [], domains: [], years: null, degree: null, certifications: [], potential_knockouts: [], unparsed: [] };
  let section = "background";
  const seen = new Set();
  const relevant = [];
  const qualifications = [];
  for (let i = title ? 1 : 0; i < lines.length; i++) {
    let { text: line, bullet } = lines[i];
    const heading = sectionOf(line);
    if (!bullet && heading && (/:$/.test(line) || line.length < config.scoring.job_match.jd_parser.max_heading_chars)) {
      section = heading;
      const colon = line.indexOf(":");
      if (colon < 0 || !line.slice(colon + 1).trim()) continue;
      line = line.slice(colon + 1).trim();
    }
    if (/\b(?:equal opportunity employer|base salary|actual compensation|competitive compensation|benefits program|benefit offerings|sign-on payments|pay transparency notice)\b/i.test(line)) { section = "background"; continue; }
    if (section === "background") continue;
    relevant.push(line);
    const kind = /^(?:preferred|nice to have|bonus)\b/i.test(line) || /\b(?:is a plus|a bonus)\b/i.test(line) ? "preferred" : MARK_REQUIRED.test(line) ? "required" : section;
    const target = kind === "preferred" || kind === "required" ? kind : null;
    if (target) {
      qualifications.push(line);
      const groups = extractAlternatives(line, skillHits(line, config));
      for (const alternatives of groups) {
        const itemKind = target === "required" && alternatives.some((name) => new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+preferred`, "i").test(line)) ? "preferred" : target;
        const id = `${itemKind}:${alternatives.join("|")}`;
        if (!seen.has(id)) { parsed[itemKind].push({ label: alternatives.join(" / "), alternatives, source: line }); seen.add(id); }
      }
      if (!groups.length && !/\b(?:associate|bachelor|master|ph\.?d|doctorate|BS|BA|MS|MA|BTech|\d+\s*\+?\s*years?|certification|certified|certificate)\b/i.test(line)) parsed.unparsed.push({ classification: target, source: line });
      for (const m of line.matchAll(DEGREE)) {
        const level = /ph\.?d\.?|doctorate/i.test(m[0]) ? "phd" : /master|\bMS\b|\bMA\b/i.test(m[0]) ? "master" : /bachelor|\bBS\b|\bBA\b|BTech/i.test(m[0]) ? "bachelor" : "associate";
        if (!parsed.degree || config.scoring.job_match.education.degree_levels[level] > config.scoring.job_match.education.degree_levels[parsed.degree.level]) parsed.degree = { level, source: line, classification: target, equivalent_experience: /equivalent experience/i.test(line) };
      }
      for (const m of line.matchAll(YEARS)) {
        const n = Number(m[1]);
        if (!parsed.years || n > parsed.years.minimum) parsed.years = { minimum: n, source: line, classification: target };
      }
      for (const m of line.matchAll(CERT)) parsed.certifications.push({ text: m[0], source: line, classification: target });
    }
    if (section === "responsibilities") parsed.responsibilities.push(line);
  }
  for (const [id, item] of Object.entries(config.responsibilities)) {
    const source = [...parsed.responsibilities, ...qualifications].find((line) => item.terms.some((term) => phrase(line, term)));
    if (source) (parsed.responsibility_concepts ??= []).push({ id, label: item.label, source });
  }
  parsed.responsibility_concepts ??= [];
  for (const [id, item] of Object.entries(config.domains)) {
    const source = relevant.find((line) => item.terms.some((term) => phrase(line, term)));
    if (source) parsed.domains.push({ id, label: item.label, source });
  }
  if (relevant.some((line) => /\b(?:citizenship|security clearance|visa sponsorship|work authorization|legally authorized|without employer sponsorship|no sponsorship)\b/i.test(line))) parsed.potential_knockouts.push({ type: "authorization", status: "unknown", source: "Requirements mention authorization or clearance; candidate settings are not supplied" });
  if (relevant.some((line) => /\b(?:onsite|on-site|hybrid|relocat(?:e|ion))\b/i.test(line))) parsed.potential_knockouts.push({ type: "location", status: "unknown", source: "Requirements mention location or attendance; candidate settings are not supplied" });
  if (/\bexport control\b/i.test(text)) parsed.potential_knockouts.push({ type: "export_control", status: "unknown", source: "JD mentions export control; eligibility needs manual review" });
  return parsed;
}
