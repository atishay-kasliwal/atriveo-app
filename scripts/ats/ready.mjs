// Resume Ready: is the tailored resume safe to send? A status (Ready / Review / Needs Work), never a score, and
// nothing here feeds Fit. It checks the resume's own text and that it still shows the skills Fit says you have.
import { skillEvidence } from "./evidence.mjs";

// How a date is written, as a parser sees it. Mixed styles on one resume make parsers miscount experience.
const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
export function dateStyle(text) {
  const t = String(text || "").trim();
  if (/^(present|current|now)$/i.test(t)) return null;
  if (/^(?:19|20)\d{2}[-/]\d{1,2}$/.test(t)) return "2024-08";
  if (/^\d{1,2}[/.-](?:19|20)\d{2}$/.test(t)) return "08/2024";
  if (new RegExp(`^${MONTH}\\.?,?\\s+(?:19|20)\\d{2}$`, "i").test(t)) return "Aug 2024";
  if (/^(?:19|20)\d{2}$/.test(t)) return "2024";
  return "other";
}

const TITLE_STOP = new Set(["a", "an", "and", "the", "of", "for", "in", "to", "at", "i", "ii", "iii", "iv", "jr", "sr", "senior", "junior", "entry", "level", "intern", "new", "grad", "remote", "hybrid", "full", "time"]);
const words = (s) => new Set(String(s || "").toLowerCase().match(/[a-z0-9+#.]+/g)?.filter((w) => !TITLE_STOP.has(w)) ?? []);

// The page rules (the user's, 2026-10-24): two projects with at least two bullets each, and one page with no empty line at
// the bottom. A line of \small text is about 12pt.
const MIN_PROJECTS = 2, MIN_PROJECT_BULLETS = 2, EMPTY_LINE_PT = 12;

export function resumeReady({ readiness, tailored, ledger, config, pages = null, jobTitle = null, pageFill = null }) {
  const cfg = config.scoring.resume_ready;
  const reasons = [];
  let needsWork = false;
  let review = false;

  if (readiness?.status === "FAIL") { needsWork = true; reasons.push(...(readiness.critical || ["A parser cannot read this resume"])); }
  else if (readiness?.status === "WARN") { review = true; reasons.push(`A parser may misread parts of it (${readiness.parseability}/100)`); }
  if (pages != null && pages > cfg.max_pages) { needsWork = true; reasons.push(`${pages} pages; the limit is ${cfg.max_pages}`); }

  const projects = tailored?.projects ?? [];
  if (tailored && projects.length < MIN_PROJECTS) {
    needsWork = true; reasons.push(`${projects.length} project${projects.length === 1 ? "" : "s"} on the resume; the rule is ${MIN_PROJECTS}, each with at least ${MIN_PROJECT_BULLETS} bullets`);
  }
  const shortProjects = projects.filter((p) => (p.bullets ?? []).length < MIN_PROJECT_BULLETS).map((p) => p.name || p.title || "a project");
  if (shortProjects.length) { review = true; reasons.push(`${shortProjects.join(", ")}: fewer than ${MIN_PROJECT_BULLETS} bullets`); }
  const emptyLines = pageFill?.final_gap_pt != null ? Math.floor(pageFill.final_gap_pt / EMPTY_LINE_PT) : 0;
  if (emptyLines >= 1) { review = true; reasons.push(`About ${emptyLines} empty line${emptyLines === 1 ? "" : "s"} at the bottom of the page`); }

  // Dates written in more than one style (for example "Aug 2024" in one place and "08/2024" in another) confuse parsers.
  const dates = [...(tailored?.experience ?? []), ...(tailored?.projects ?? []), ...(tailored?.education ?? [])]
    .flatMap((e) => [e.dates?.start && e.dates?.text?.split(/\s*[–—-]\s*/)[0], e.dates?.text?.split(/\s*[–—-]\s*/)[1]]).filter(Boolean)
    .map(dateStyle).filter(Boolean);
  const styles = [...new Set(dates)];
  if (dates.length >= 2 && styles.length > 1) { review = true; reasons.push(`Dates are written in ${styles.length} different styles (${styles.join(", ")}); a parser can miscount your experience. Use one style.`); }

  // Recruiters filter on the job title. Informational: your headline names a role per job, not necessarily the posting's exact words.
  const notes = [];
  const headline = (tailored?.contact?.other ?? []).find((s) => /engineer|scientist|analyst|developer|manager|architect|specialist/i.test(s)) ?? null;
  if (jobTitle && headline) {
    const want = words(jobTitle), have = words(headline);
    const shared = [...want].filter((w) => have.has(w));
    if (want.size && shared.length === 0) notes.push(`The posting's title (“${jobTitle}”) shares no words with your headline (“${headline}”).`);
  }

  // Skills with evidence in the bank must still show on the resume that gets sent. Required ones decide the status; preferred
  // ones are listed too (they are what the posting would like), without changing it.
  const onResume = (s) => { const e = skillEvidence(s.alternatives, tailored, config); return e.kind === "exact" || e.kind === "equivalent"; };
  const have = ledger.skills.filter((s) => s.class === "required" && s.status === "matched");
  const leftOffSkills = have.filter((s) => !onResume(s));
  const leftOff = leftOffSkills.map((s) => s.label);
  const preferredLeftOff = ledger.skills.filter((s) => s.class === "preferred" && s.status === "matched" && !onResume(s));
  if (have.length && leftOff.length) {
    if (leftOff.length / have.length >= cfg.needs_work_left_off_share) needsWork = true; else review = true;
    reasons.push(`${leftOff.length} of ${have.length} required skills you have are not on this resume: ${leftOff.join(", ")}`);
  }
  // For each one: where in your bank it is proven, so you can add that bullet instead of guessing.
  const detail = (s) => ({ label: s.label, class: s.class, entry: s.evidence?.entry ?? null, text: s.evidence?.text ?? null, tier: s.evidence?.tier ?? null,
    as: /_tools$/.test(s.evidence?.tier ?? "") ? "tools" : s.evidence?.tier === "skills_only" ? "skills" : "bullet" });
  return {
    status: needsWork ? "Needs Work" : review ? "Review" : "Ready", reasons, notes,
    checks: { readable: readiness?.status ?? null, pages, date_styles: styles, headline,
      projects: projects.map((p) => ({ name: p.name || p.title || null, bullets: (p.bullets ?? []).length })),
      bottom_gap_pt: pageFill?.final_gap_pt ?? null, skills_on_resume: { present: have.length - leftOff.length, total: have.length, left_off: leftOff, left_off_detail: [...leftOffSkills, ...preferredLeftOff].map(detail) } },
  };
}
