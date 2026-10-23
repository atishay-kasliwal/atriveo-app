// Knockouts: obvious mismatches between a posting and the candidate settings (data/ats/candidate.yaml) or the
// master resume. Anything the settings leave unknown stays "unknown" and is shown, never counted against a job.
// Nothing here rejects a job: `blocked` only means a hard mismatch worth ranking last and looking at.
import { levelFor } from "./match.mjs";
import { phrase } from "./jd-parse.mjs";

const CITIZEN = /\b(?:u\.?s\.?\s+citizen(?:ship)?|citizens? of the (?:u\.?s|united states)|united states citizen(?:ship)?|citizenship (?:is )?required)\b/i;
const CLEARANCE = /\b(?:security clearance|secret clearance|top secret|ts\/sci|public trust|active clearance)\b/i;
// Sponsorship: any line that mentions it is read as "none offered" (negative), "offered" (positive) or neither (a heading such as "Sponsorship:").
const NEGATIVE_SPONSOR = [
  /\b(?:will not|won'?t|does not|do not|doesn'?t|don'?t|unable to|cannot|can'?t|not able to|not willing to|no)\s+(?:be able to\s+)?(?:provide\s+|offer\s+|consider\s+)?(?:\w+\s+){0,2}sponsor/i,
  /without\b[^.]{0,60}?sponsorship/i,
  /\bnot\s+(?:available|offered|provided)\b[^.]{0,40}sponsor|sponsor\w*\s+(?:is\s+)?(?:not|unavailable)/i,
  /\b(?:requiring|require|requires|needing|need|needs)\b[^.]{0,60}sponsorship[^.]{0,80}(?:not be considered|not eligible|ineligible|cannot be|will not)/i,
  /\bnot\s+(?:eligible\s+for\s+)?(?:visa\s+)?sponsor/i,
  /sponsorship\b.{0,60}?\b(?:is|are)\s+not\s+(?:available|offered|provided)/i,
];
const POSITIVE_SPONSOR = /\b(?:visa\s+)?sponsorship\s+(?:is\s+|may be\s+)?(?:available|offered|provided)|\b(?:we|will|can|able to)\s+(?:also\s+)?(?:sponsor|provide\s+(?:visa\s+)?sponsorship)/i;
const FUTURE = /\bfuture\b|\bnow or\b|\bat any time\b/i;
const US_PERSON = /\b(?:u\.?s\.?\s+person|itar|export[- ]control(?:led)?)\b/i;
const ONSITE = /\b(?:onsite|on-site|in[- ]office|hybrid|relocat(?:e|ion))\b/i;

const lineOf = (text, re) => String(text || "").split(/\r?\n/).map((l) => l.trim()).find((l) => re.test(l)) || null;
const short = (s) => (s && s.length > 200 ? `${s.slice(0, 197)}...` : s);

export function evaluateKnockouts({ jd, jdText, ledger, years, candidate, master, config }) {
  const cfg = config.scoring.fit.knockouts;
  const items = [];
  const add = (type, status, reason, source = null) => items.push({ type, status, reason, source: short(source) });

  const citizen = lineOf(jdText, CITIZEN);
  if (citizen) {
    const v = candidate.us_citizen;
    add("citizenship", v === true ? "clear" : v === false ? "blocked" : "unknown", v === "unknown" || v == null ? "The posting asks for US citizenship; your citizenship is not in candidate.yaml" : v ? "You are a US citizen" : "The posting requires US citizenship", citizen);
  }
  const clearance = lineOf(jdText, CLEARANCE);
  if (clearance) {
    const v = candidate.security_clearance;
    add("clearance", v === "unknown" || v == null ? "unknown" : v ? "clear" : "blocked", v === "unknown" || v == null ? "The posting mentions a security clearance; yours is not in candidate.yaml" : v ? "You hold a clearance" : "The posting requires a clearance you do not hold", clearance);
  }
  const sponsorLines = String(jdText || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => /sponsor/i.test(l));
  const sponsor = sponsorLines.find((l) => NEGATIVE_SPONSOR.some((re) => re.test(l)));
  if (sponsor) {
    const wa = candidate.work_authorization || {};
    const during = wa.sponsorship_required_during_authorization === false;
    const future = FUTURE.test(sponsor);
    const after = wa.sponsorship_required_after_authorization;
    if (!during) add("sponsorship", "unknown", "The posting offers no sponsorship; your sponsorship need is not in candidate.yaml", sponsor);
    else if (future && after === "unknown") add("sponsorship", "unknown", `Authorized now (${wa.status}, ${wa.authorized_years_remaining} years) but the posting also rules out future sponsorship; your need after that is unknown`, sponsor);
    else add("sponsorship", "clear", `You need no sponsorship during your ${wa.authorized_years_remaining} years of authorization`, sponsor);
  } else if (sponsorLines.some((l) => POSITIVE_SPONSOR.test(l))) {
    add("sponsorship", "clear", "The posting offers visa sponsorship", sponsorLines.find((l) => POSITIVE_SPONSOR.test(l)));
  }
  const usPerson = lineOf(jdText, US_PERSON);
  if (usPerson && !citizen) add("citizenship", candidate.us_citizen === true ? "clear" : "unknown", "The posting mentions US-person or export-control eligibility; your citizenship is not in candidate.yaml", usPerson);
  const place = lineOf(jdText, ONSITE);
  if (place) add("location", candidate.relocation === true ? "clear" : candidate.relocation === false ? "unknown" : "unknown", candidate.relocation === true ? "You are open to relocating" : "Location or attendance is mentioned; relocation is not in candidate.yaml", place);

  // Seniority: our level is the lower of what our titles and our years of experience imply.
  const [juniorBelow, midBelow, seniorBelow] = cfg.years_to_level;
  const byYears = years < juniorBelow ? "junior" : years < midBelow ? "mid" : years < seniorBelow ? "senior" : "staff";
  const levels = config.scoring.job_match.seniority;
  const ours = levels.levels[byYears];
  const wantedLevel = levelFor(jd.title, levels);
  const yearsAsked = jd.years && jd.years.classification !== "preferred" ? jd.years.minimum : null;
  if (yearsAsked != null && yearsAsked - years >= cfg.years_gap) add("seniority", "blocked", `The posting asks for ${yearsAsked}+ years; you have ${years}`, jd.years.source);
  else if (wantedLevel - ours >= cfg.level_gap) add("seniority", "blocked", `The title is ${Object.keys(levels.levels).find((k) => levels.levels[k] === wantedLevel)} level; your ${years} years read as ${byYears}`, jd.title);

  if (jd.degree && jd.degree.classification !== "preferred") {
    const degreeLevels = config.scoring.job_match.education.degree_levels;
    const held = Math.max(...master.education.flatMap((e) => Object.keys(degreeLevels).filter((l) => phrase(e.degree, l)).map((l) => degreeLevels[l])), 0);
    const asked = degreeLevels[jd.degree.level];
    const equivalent = jd.degree.equivalent_experience && years >= config.scoring.job_match.education.equivalent_experience_years_default;
    if (asked > held && !equivalent) add("degree", "blocked", `The posting requires a ${jd.degree.level} degree; your highest is below that`, jd.degree.source);
  }

  const { min_required_skills: minReq, max_matched_share: share } = cfg.weak_overlap;
  if (ledger.required.total >= minReq && ledger.required.matched / ledger.required.total <= share) {
    add("weak_overlap", "blocked", `${ledger.required.matched} of ${ledger.required.total} required skills have evidence in your whole bank`, null);
  }

  const verdict = items.some((i) => i.status === "blocked") ? "blocked" : items.some((i) => i.status === "unknown") ? "unknown" : "clear";
  return { verdict, auto_reject: false, items };
}
