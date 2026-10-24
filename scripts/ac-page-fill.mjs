// One page, filled to the bottom (the user's rule, 2026-10-24): never a second page, never an empty line at the end, and
// always two projects with at least two bullets each.
//
// How: the pinned or planned bullets go in first; the project rule is enforced; then the resume is compiled and the empty
// space under the last line is measured from the PDF. More than a line left: the best remaining bullet from the bank is
// added. A second page: the weakest removable bullet comes out. When what is left is under a line, a little stretchable
// space between sections takes it up, so the text ends at the bottom margin.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assembleAcResume, toolsFromBullets } from "./ac-tex.mjs";
import { stripBanned } from "./tailor-dynamic.mjs";
import { loadBank } from "./ac-bank.mjs";
import { bankForTrack, loadTracks, trackPins } from "./ac-tracks.mjs";
import { PROJECT_SLUG_TO_NAME as PROJECT_NAME } from "./ac-role-meta.mjs";

// Where the last line of this template ends when the page is full (measured: a resume stretched to the bottom margin ends
// its last printed line at 746pt of 792; the skills list leaves its own small space under it).
export const PAGE_HEIGHT_PT = 792;
export const TEXT_BOTTOM_PT = 746;
// One \small bullet line is about 12pt; more than this left under the last line is an empty line.
export const LINE_PT = 12;
const MAX_ROUNDS = 8;

/** Pages and the empty space under the last printed text, read from the PDF (poppler). */
export function measurePdf(pdfPath) {
  const r = spawnSync("pdftotext", ["-bbox", pdfPath, "-"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`pdftotext failed: ${(r.stderr || "").slice(0, 200)}`);
  const pages = r.stdout.split("<page ").slice(1);
  let lastY = 0;
  for (const m of (pages[0] || "").matchAll(/yMax="([\d.]+)"/g)) lastY = Math.max(lastY, Number(m[1]));
  return { pages: pages.length, last_text_pt: Math.round(lastY * 10) / 10, bottom_gap_pt: Math.round((TEXT_BOTTOM_PT - lastY) * 10) / 10 };
}

/** Compile TeX in a scratch folder and measure it. */
export function compileAndMeasure(tex) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac-fill-"));
  try {
    fs.writeFileSync(path.join(dir, "resume.tex"), tex);
    const r = spawnSync("tectonic", ["resume.tex"], { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) return { ok: false, err: (r.stderr || r.stdout || "").trim().slice(-300) };
    return { ok: true, ...measurePdf(path.join(dir, "resume.pdf")) };
  } catch (e) {
    // No tectonic or poppler here: say so; the build goes on with the planned bullets.
    return { ok: false, err: String(e.message || e).slice(0, 300) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Small stretchable space before each section and each entry after the first, so a page within a line of full ends at the margin. */
export function stretchToBottom(tex) {
  const fill = "\\vspace{0pt plus 1fill}";
  let out = tex.replace(/\n\\section\{(Experience|Projects|Technical Skills)\}/g, `\n${fill}\n\\section{$1}`);
  // Between entries of one list: every heading after the first in its list gets the same space above it.
  out = out.replace(/(\\resumeSubHeadingListStart)([\s\S]*?)(\\resumeSubHeadingListEnd)/g, (all, start, body, end) => {
    let first = true;
    const spaced = body.replace(/\n(\s*)\\(resumeSubheading|resumeProjectHeading)\{/g, (m, ind, cmd) => {
      if (first) { first = false; return m; }
      return `\n${ind}${fill}\\${cmd}{`;
    });
    return `${start}${spaced}${end}`;
  });
  return out;
}

const words = (s) => String(s || "").toLowerCase().match(/[a-z][a-z0-9+#.]*/g) || [];

/** How well a bank bullet serves this posting: its rating, and how many of its tools and keywords the posting names. */
export function bulletScore(ac, face, jdLower) {
  const strength = Number(face?.strength ?? ac?.strength?.recruiter ?? 7) / 10;
  const terms = [...new Set([...(ac?.signature_technologies || []), ...(ac?.ats_keywords || [])].map((t) => String(t).toLowerCase()))];
  const hits = terms.filter((t) => t && jdLower.includes(t)).length;
  const overlap = terms.length ? hits / terms.length : 0;
  return Math.round((strength * 0.6 + overlap * 0.4) * 1000) / 1000;
}

const firstVerb = (text) => (words(text)[0] || "");

/** The wording of an entry to print for this track: its track facet when it has one, otherwise its first. */
function faceFor(ac, track) {
  const v = ac.variants || [];
  return v.find((x) => track && String(x.facet || "").includes(track)) || v.find((x) => x.facet === "default") || v[0];
}

// Figures a bullet states (67.7%, 0.70, 3x): two bullets in one section should not repeat one.
const figures = (text) => new Set(String(text || "").match(/\d+(?:\.\d+)?\s*%|\b\d+\.\d+\b|\b\d+x\b/gi)?.map((f) => f.replace(/\s+/g, "")) ?? []);

/**
 * Bullets the bank offers for one employer or project that the resume does not use yet, best first. Never one whose
 * opening verb is already used, one with a word the renderer strips (it would print "a modular pipeline..." without its
 * verb), or one that repeats a figure another bullet in the same section states.
 */
export function candidatesFor(role, kind, bank, used, jdLower, track, sectionTexts = []) {
  const usedVerbs = new Set([...used.values()].map(firstVerb));
  const sectionFigures = new Set(sectionTexts.flatMap((t) => [...figures(t)]));
  return (bank.acs || [])
    .filter((ac) => ac.role === role && ac.slot_kind === kind && ac.visibility?.default !== false && !used.has(ac.id))
    .map((ac) => ({ ac, face: faceFor(ac, track) }))
    .filter(({ face }) => face?.text && !usedVerbs.has(firstVerb(face.text)))
    .filter(({ face }) => stripBanned(face.text) === face.text && /^[A-Z]/.test(face.text.trim()))
    .filter(({ face }) => ![...figures(face.text)].some((f) => sectionFigures.has(f)))
    .map((c) => ({ ...c, score: bulletScore(c.ac, c.face, jdLower) }))
    .sort((a, b) => b.score - a.score || a.ac.id.localeCompare(b.ac.id));
}

/** The score of a bullet already on the resume (its entry and the wording printed). */
function scoreOfPrinted(b, bank, jdLower) {
  const ac = (bank.acs || []).find((a) => a.id === b.ac_id);
  if (!ac) return 0;
  return bulletScore(ac, (ac.variants || []).find((v) => v.facet === b.facet) || ac.variants?.[0], jdLower);
}

/** Two projects that are the same product ("Atriveo" and "Atriveo Job Intelligence Pipeline") are never shown together. */
const nameWords = (role) => new Set(String(PROJECT_NAME[role] || role).match(/\b[A-Z][A-Za-z]{4,}\b/g) || []);
const sameProduct = (a, b) => [...nameWords(a)].some((w) => nameWords(b).has(w) && !GENERIC_NAME_WORDS.has(w));
const GENERIC_NAME_WORDS = new Set(["Platform", "Pipeline", "Research", "Advanced", "System", "Engine", "Model", "Intelligence", "Microservices", "Data"]);

/** Whether a project is tagged (bank `fits:`) for this track. Untagged tracks accept any project. */
const projectFits = (bank, role, track) => !track
  || (bank.acs || []).some((a) => a.role === role && a.slot_kind === "project" && (a.fits || []).includes(track));

/** Best first, skipping any that repeats a figure of one already kept (a new project's bullets are chosen together). */
function distinctFigures(list) {
  const kept = [], seen = new Set();
  for (const c of list) {
    const f = [...figures(c.face.text)];
    if (f.some((x) => seen.has(x))) continue;
    f.forEach((x) => seen.add(x));
    kept.push(c);
  }
  return kept;
}

const bulletOf = ({ ac, face }) => ({ ac_id: ac.id, facet: face.facet, text: face.text });
const usedMap = (compact) => new Map([...(compact.experience || []), ...(compact.projects || [])]
  .flatMap((s) => (s.bullets || []).map((b) => [b.ac_id, b.text])));

/**
 * Two projects, each with at least two bullets. A missing project comes from the track's project pool (or any project
 * the bank has enough bullets for), the one that fits the posting best; a short project gets its best remaining bullets.
 */
export function enforceProjects(compact, bank, { jd = "", track = null, pool = null, pinned = [], minProjects = 2, minBullets = 2 } = {}) {
  const jdLower = String(jd).toLowerCase();
  const out = { ...compact, projects: (compact.projects || []).map((p) => ({ ...p, bullets: [...(p.bullets || [])] })) };
  const changes = [];
  const have = new Set(out.projects.map((p) => p.role));
  const roles = (pool?.length ? pool : [...new Set((bank.acs || []).filter((a) => a.slot_kind === "project").map((a) => a.role))]);
  while (out.projects.length < minProjects) {
    const used = usedMap(out);
    const options = roles.filter((r) => !have.has(r) && ![...have].some((h) => sameProduct(r, h)))
      .map((role) => ({ role, list: distinctFigures(candidatesFor(role, "project", bank, used, jdLower, track)) }))
      .filter((o) => o.list.length >= minBullets)
      .map((o) => ({ ...o, tagged: projectFits(bank, o.role, track), fit: o.list.slice(0, minBullets).reduce((s, c) => s + c.score, 0) / minBullets }))
      .sort((a, b) => Number(b.tagged) - Number(a.tagged) || b.fit - a.fit || roles.indexOf(a.role) - roles.indexOf(b.role));
    if (!options.length) break;
    const pick = options[0];
    out.projects.push({ role: pick.role, bullets: pick.list.slice(0, minBullets).map(bulletOf) });
    have.add(pick.role);
    changes.push(`added project ${pick.role}`);
  }
  for (const p of out.projects) {
    while (p.bullets.length < minBullets) {
      const [best] = candidatesFor(p.role, "project", bank, usedMap(out), jdLower, track, p.bullets.map((b) => b.text));
      if (!best) break;
      p.bullets.push(bulletOf(best));
      changes.push(`added ${best.ac.id} to ${p.role}`);
    }
  }
  // A project the bank cannot give two clean bullets for is swapped for one that can (the rule outranks a pinned project).
  for (let i = 0; i < out.projects.length; i++) {
    const p = out.projects[i];
    const short = p.bullets.length < minBullets;
    const offTrack = !pinned.includes(p.role) && !projectFits(bank, p.role, track);
    const duplicate = out.projects.slice(0, i).some((q) => sameProduct(q.role, p.role));
    if (!short && !offTrack && !duplicate) continue;
    // Everything else on the resume (experience too), so the replacement repeats no opening verb.
    const others = new Map([...(out.experience || []), ...out.projects.filter((_, j) => j !== i)].flatMap((q) => q.bullets.map((b) => [b.ac_id, b.text])));
    const allRoles = [...new Set([...(roles || []), ...(bank.acs || []).filter((a) => a.slot_kind === "project").map((a) => a.role)])];
    const swap = allRoles.filter((r) => !out.projects.some((q) => q.role === r || sameProduct(q.role, r)))
      .filter((r) => !offTrack || short || duplicate || projectFits(bank, r, track))
      .map((role) => ({ role, list: distinctFigures(candidatesFor(role, "project", bank, others, jdLower, track)) }))
      .filter((o) => o.list.length >= minBullets)
      .map((o) => ({ ...o, tagged: projectFits(bank, o.role, track), fit: o.list.slice(0, minBullets).reduce((x, c) => x + c.score, 0) / minBullets }))
      .sort((a, b) => Number(b.tagged) - Number(a.tagged) || b.fit - a.fit)[0];
    if (!swap || (offTrack && !short && !duplicate && !swap.tagged)) continue;
    out.projects[i] = { role: swap.role, bullets: swap.list.slice(0, minBullets).map(bulletOf) };
    const why = short ? "no second clean bullet" : duplicate ? "same product as another project" : `not tagged for ${track}`;
    changes.push(`replaced project ${p.role} (${why}) with ${swap.role}`);
  }
  return { compact: out, changes };
}

// Never fewer than these when making room; never more than these when filling.
const FLOOR = { experience: { "stony-brook": 4, default: 2 }, project: 2 };
// What goes first when the page runs over: a project's third bullet, then the oldest employer, Stony Brook last.
const REMOVE_ORDER = { project: 0, accolite: 1, "wake-forest": 2, "stony-brook": 9 };
const removeRank = (kind, role) => (kind === "project" ? REMOVE_ORDER.project : REMOVE_ORDER[role] ?? 5);
const CAP = { experience: { "stony-brook": 6, "wake-forest": 5, default: 4 }, project: 3 };
const floorOf = (kind, role) => (kind === "project" ? FLOOR.project : FLOOR.experience[role] ?? FLOOR.experience.default);
const capOf = (kind, role) => (kind === "project" ? CAP.project : CAP.experience[role] ?? CAP.experience.default);

/**
 * Fill exactly one page. render(compact) -> TeX; measure(tex) -> { ok, pages, bottom_gap_pt }.
 * Returns the final compact composition, the final TeX (with the stretch), and what was done.
 */
export function fillOnePage(compact, { bank, jd = "", track = null, render, measure = compileAndMeasure }) {
  const jdLower = String(jd).toLowerCase();
  let cur = compact;
  const log = [];
  const sections = (c) => [
    ...(c.experience || []).map((s) => ({ kind: "experience", s })),
    ...(c.projects || []).map((s) => ({ kind: "project", s })),
  ];
  const clone = (c) => ({ ...c, experience: (c.experience || []).map((s) => ({ ...s, bullets: [...s.bullets] })), projects: (c.projects || []).map((s) => ({ ...s, bullets: [...s.bullets] })) });
  let m = measure(render(cur));
  if (!m.ok) return { compact: cur, tex: render(cur), log: [`compile failed: ${m.err}`], measure: m, filled: false };
  const tried = new Set();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (m.pages > 1) {
      // The weakest bullet above its floor comes out; a project never drops below two bullets.
      const removable = sections(cur).flatMap(({ kind, s }) => (s.bullets.length > floorOf(kind, s.role)
        ? s.bullets.map((b, i) => ({ kind, role: s.role, i, id: b.ac_id, score: scoreOfPrinted(b, bank, jdLower) }))
        : []));
      if (!removable.length) { log.push("second page and nothing left to remove"); break; }
      removable.sort((a, b) => removeRank(a.kind, a.role) - removeRank(b.kind, b.role) || a.score - b.score);
      const r = removable[0];
      const next = clone(cur);
      const sec = (r.kind === "project" ? next.projects : next.experience).find((s) => s.role === r.role);
      sec.bullets.splice(r.i, 1);
      cur = next;
      log.push(`removed ${r.id} (${r.role}) for a second page`);
      m = measure(render(cur));
      continue;
    }
    if (m.bottom_gap_pt < LINE_PT) break;
    // More than a line left: the best bullet that still fits.
    const used = usedMap(cur);
    const options = sections(cur).filter(({ kind, s }) => s.bullets.length < capOf(kind, s.role))
      .flatMap(({ kind, s }) => candidatesFor(s.role, kind, bank, used, jdLower, track, s.bullets.map((b) => b.text)).slice(0, 3).map((c) => ({ ...c, kind, role: s.role })))
      .filter((c) => !tried.has(c.ac.id))
      .sort((a, b) => b.score - a.score);
    let added = false;
    for (const c of options.slice(0, 4)) {
      tried.add(c.ac.id);
      const next = clone(cur);
      (c.kind === "project" ? next.projects : next.experience).find((s) => s.role === c.role).bullets.push(bulletOf(c));
      const mm = measure(render(next));
      if (mm.ok && mm.pages === 1) { cur = next; m = mm; added = true; log.push(`added ${c.ac.id} (${c.role})`); break; }
    }
    if (!added) { log.push(`nothing more fits (${m.bottom_gap_pt}pt left)`); break; }
  }
  const tex = stretchToBottom(render(cur));
  return { compact: cur, tex, log, measure: m, filled: m.pages === 1 };
}

/**
 * The build's entry point: the composition the pipeline chose, made to follow the page rules.
 * Returns { compact, tex, report } where report says what changed and how full the page is.
 */
export function fillResumePage({ compact, skills, headerTitle, location, jd, track, measure = compileAndMeasure, bank = null }) {
  const full = bank || loadBank();
  const trackBank = bankForTrack(full, track || null);
  const pool = track ? loadTracks().tracks?.[track]?.projects : null;
  // A project heading is its name and tools on one line; past about 85 characters the template shrinks the whole heading,
  // so a tools line made from the bullets keeps only as many tools as fit.
  const fitTools = (c) => ({ ...c, projects: (c.projects || []).map((p) => {
    if (p.stack?.length) return p;
    const name = PROJECT_NAME[p.role] || p.role;
    const tools = [];
    for (const t of toolsFromBullets(p.bullets, p.role)) {
      if (`${name} | ${[...tools, t].join(", ")}`.length > 85) break;
      tools.push(t);
    }
    return { ...p, stack: tools };
  }) });
  const render = (c) => assembleAcResume(fitTools(c), { headerTitle, skillsLines: skills, bank: trackBank, location });
  const pinned = Object.keys(trackPins(track, undefined, { jd })?.projects || {});
  const projects = enforceProjects(compact, trackBank, { jd, track, pool, pinned });
  const filled = fillOnePage(projects.compact, { bank: trackBank, jd, track, render, measure });
  const count = (c) => ({
    experience: Object.fromEntries((c.experience || []).map((s) => [s.role, s.bullets.length])),
    projects: Object.fromEntries((c.projects || []).map((s) => [s.role, s.bullets.length])),
  });
  return {
    compact: fitTools(filled.compact),
    tex: filled.tex,
    report: {
      before: count(compact),
      after: count(filled.compact),
      changes: [...projects.changes, ...filled.log],
      pages: filled.measure.pages,
      bottom_gap_pt: filled.measure.bottom_gap_pt,
      filled: filled.filled && filled.measure.bottom_gap_pt < LINE_PT,
    },
  };
}
