// Resume builder (apply.atriveo.com/resume_builder): edit a resume's content, keep the template.
// Design, data flow and decisions: docs/resume-builder.md.
//
// A resume is its composition (which bank bullets, in which order, under which employer or project), its header
// title and its skills lines. The builder edits only those and renders them with the pipeline's own renderer
// (assembleAcResume) and compiler (tectonic), so the template can't change.
//
//   loadResume   a job's current resume (job_url) or a track's general resume, as editable sections, plus the
//                bank bullets each section may use
//   renderDraft  composes the edit, compiles it into OUT_ROOT/.builder-drafts/<id>/, runs the checks
//   saveDraft    keeps a draft: a job gets <run dir>/edits/<n>/ and its resume (and its applications') point there;
//                a track's general resume is replaced in place, the generated one kept in generated/
//   revertJob    a job back to its generated resume
//   startPasted  a resume from a job description you paste: the pipeline's own build (tailorOneAc), kept under
//                OUT_ROOT/pasted/<id>/ and listed in Mongo builder_resumes; standalone (never a job, never on Today)
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadBank } from "./ac-bank.mjs";
import { assembleAcResume, EDUCATION_ROWS, toolsFromBullets } from "./ac-tex.mjs";
import { displayUrl } from "./ats/patterns.mjs";
import { bankForTrack, classifyTrack, employerTitle, loadTracks } from "./ac-tracks.mjs";
import { resolveExperienceMeta, resolveProjectMeta, sortProjectsByRecency } from "./ac-role-meta.mjs";
import { jdSkillMatch, loadSkills } from "./ac-jd-skills.mjs";
import { resolveHeaderLocation } from "./ac-header-location.mjs";
import { loadResumeProfile } from "./resume-profile.mjs";
import { lintBullet, openingVerb as bankVerb, resumeRoles, techPattern } from "./ac-bullet-rules.mjs";
import { OVERLAY_COLLECTION, readOverlay, syncOverlay } from "./ac-bank-overlay.mjs";
import { PROJECT_SLUG_TO_NAME, ROLE_SLUG_TO_NAME } from "./ac-role-meta.mjs";

export const OUT_ROOT = process.env.TAILOR_OUT_ROOT?.trim() || path.join(os.homedir(), "Documents", "tailored-resumes");
const PDF = "Atishay Kasliwal.pdf";

/** The general resume of each track (scripts/general-resumes.mjs builds them): its folder under OUT_ROOT/general. */
export const GENERAL_RESUMES = {
  "software-engineer": { label: "SWE", title: "Software Engineer", folder: "Software Engineer" },
  "ai-engineer": { label: "AI", title: "AI Engineer", folder: "AI Engineer" },
  "data-analytics": { label: "Data Analyst", title: "Data Analyst", folder: "Data Analyst" },
  "data-science": { label: "DS", title: "Data Scientist", folder: "Data Scientist" },
  "forward-deployed": { label: "FDE", title: "Forward Deployed Engineer", folder: "Forward Deployed Engineer" },
};

export class BuilderError extends Error {}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const inOutRoot = (p) => path.resolve(p).startsWith(path.resolve(OUT_ROOT) + path.sep);
const openingVerb = (text) => (String(text).trim().match(/^([A-Za-z]+)/) || [])[1]?.toLowerCase() ?? "";

/** A saved edit keeps the composition it was rendered from here; a generated run keeps it in composition.json. */
const EDIT_FILE = "builder.json";
function compositionAt(dir) {
  const edit = readJson(path.join(dir, EDIT_FILE));
  if (edit?.sections) return { headerTitle: edit.headerTitle, skills: edit.skills, sections: edit.sections, location: edit.location ?? null, email: edit.email ?? null, city: edit.city ?? null };
  const run = readJson(path.join(dir, "composition.json"));
  if (!run?.composition) throw new BuilderError("This resume has no composition to edit (built before the builder existed). Rebuild it first.");
  const c = run.composition;
  const sec = (kind) => (b) => ({ role: b.role, kind, bullets: (b.bullets || []).map((x) => ({ ac_id: x.ac_id, facet: x.facet ?? null, text: x.text })), stack: null });
  return {
    headerTitle: run.header_title ?? null,
    skills: run.skills ?? c.skills ?? [],
    sections: [...(c.experience || []).map(sec("experience")), ...(c.projects || []).map(sec("project"))],
    location: null,
    email: null,
    city: null,
  };
}

/** Every bank bullet a section may use: each variant of each entry for that employer or project. */
function bankOptions(bank) {
  const out = {};
  for (const ac of bank.acs) {
    if (!ac.role) continue;
    for (const v of ac.variants || []) {
      if (!v?.text) continue;
      (out[ac.role] ??= []).push({ ac_id: ac.id, facet: v.facet ?? null, text: String(v.text).replace(/\s+/g, " ").trim() });
    }
  }
  return out;
}

/**
 * The template's fixed parts, for the page's live preview (HTML in the same layout as the PDF): your name and links,
 * education, each employer's dates, place and title, each project's dates and order. Stony Brook's title follows the
 * header title (sbTitleOverrides, levelWords: as ac-tracks.employerTitle does).
 */
function layoutOf(bank) {
  const me = loadResumeProfile();
  const kinds = roleKind(bank);
  const exp = Object.keys(kinds).filter((r) => kinds[r] === "experience");
  const projs = Object.keys(kinds).filter((r) => kinds[r] === "project");
  const ranked = sortProjectsByRecency(projs.map((role) => ({ role }))).map((p) => p.role);
  return {
    name: me.name, phone: me.phone || null, linkedinUrl:me.linkedin||null,githubUrl:me.github||null, linkedin: me.linkedin ? displayUrl(me.linkedin) : null, github: me.github ? displayUrl(me.github) : null,
    education: EDUCATION_ROWS,
    roles: Object.fromEntries(exp.map((r) => { const m = resolveExperienceMeta(r); return [r, { name: labelOf(r), dates: m.dates, place: m.loc, order: m.order || 0,
      title: r === "stony-brook" ? null : employerTitle(r, null) || (r === "wake-forest" ? "AI/ML Engineer" : m.title) }]; })),
    projects: Object.fromEntries(projs.map((r) => [r, { name: labelOf(r), dates: resolveProjectMeta(r).dates, rank: ranked.indexOf(r) }])),
    sbTitleOverrides: loadTracks().stony_brook_title_overrides ?? {},
    sbTitlePatterns: loadTracks().stony_brook_title_patterns ?? [],
  };
}

const roleKind = (bank) => Object.fromEntries(bank.acs.filter((a) => a.role).map((a) => [a.role, a.slot_kind === "project" ? "project" : "experience"]));
const labelOf = (role) => ROLE_SLUG_TO_NAME[role] || PROJECT_SLUG_TO_NAME[role] || role;

async function jobDoc(db, jobUrl) {
  const docs = await db.collection("jobs").find({ job_url: jobUrl }, { projection: { _id: 0, job_url: 1, company: 1, title: 1, location: 1, resume: 1 } }).toArray();
  const doc = docs.find((d) => d.resume?.status === "success" && d.resume?.pdf_path) ?? null;
  if (!doc) throw new BuilderError("This job has no resume yet.");
  return { doc, docs };
}
const jdOf = async (db, jobUrl) => (await db.collection("descriptions").findOne({ job_url: jobUrl }, { projection: { description: 1 } }))?.description ?? null;

// ── Resumes from a pasted job description ─────────────────────────────────────────────────────────────────────

export const PASTED_COLLECTION = "builder_resumes";
const pastedDir = (id) => path.join(OUT_ROOT, "pasted", String(id).replace(/[^a-f0-9]/g, ""));
/** A track's general resume or a pasted resume: both live in one folder, edits replace the PDF in place. */
const folderOf = (source) => source.kind === "track" ? (GENERAL_RESUMES[source.track] ? path.join(OUT_ROOT, "general", GENERAL_RESUMES[source.track].folder) : null)
  : source.kind === "pasted" ? pastedDir(source.pasted) : null;

// A role as a posting's heading writes it: a capitalised role noun ("Senior Data Engineer", not "a full-stack engineer").
const ROLE_WORDS = /\b(Engineer|Developer|Scientist|Analyst|Architect|Manager|Specialist|Consultant|Intern|Designer|Researcher|Administrator|Programmer)s?\b/;
const NOT_A_NAME = /^(the|our|this|us|you|your|role|team|job|company|position|opportunity|we|it)$/i;
const US_STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));
const tidy = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** Company, role title and location as the posting's text gives them (a first guess you can correct). */
export function guessPosting(jd) {
  // Plain text: no HTML tags, no Markdown escapes ("Software Engineer\-React").
  const text = String(jd || "").replace(/\r/g, "").replace(/<\/(p|div|li|h\d)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\\([-+()#*_.!\[\]|\\])/g, "$1");
  const lines = text.split("\n").map((l) => l.replace(/^[#*\s-]+|[*\s]+$/g, "").trim()).filter(Boolean).slice(0, 60);
  const label = (re) => { for (const l of lines) { const m = l.match(re); if (m?.[1]?.trim()) return m[1].trim(); } return ""; };
  let title = label(/^(?:job\s*title|title|position|role(?:\s*name)?|job)\s*[:\-–]\s*(.{3,90})$/i);
  // The first short line naming a role, that isn't a requirement ("4+ years of software engineering…") or a sentence.
  if (!title) title = lines.find((l) => l.length <= 90 && l.split(/\s+/).length <= 12 && ROLE_WORDS.test(l) && !/[:.?!]$/.test(l)
    && !/^[\d\\(+]/.test(l) && !/https?:|www\./i.test(l) && !/\b(years?|experience|degree|you|we|our|will|with|ability|skills?|interview|compensation|salary|benefits|description|pay)\b/i.test(l) && /^[A-Z]/.test(l) && !/^(about|as a|in this|the|a|an|track \d)\b/i.test(l)) ?? "";
  title = title.replace(/\s+(?:at|@)\s+.+$/i, "").replace(/\s*[|(].*$/, "").replace(/[\\\s]+$/, "").trim();
  let company = label(/^(?:company|employer|organization)\s*[:\-–]\s*(.{2,60})$/i);
  // A name: capitalised words on one line ("Amazon Web Services", "Bank of America").
  const name = "([A-Z][\\w&.'’-]*(?:[ \\t]+(?:[A-Z][\\w&.'’-]*|of|and|&)){0,4})";
  const patterns = [
    [new RegExp(`${name}[ \\t]+(?:is|are)[ \\t]+(?:an|a|proud to be an?)[ \\t]+equal[ \\t]+(?:opportunity|employment)`), text], // most postings end with this
    [new RegExp(`\\bAbout[ \\t]+${name}`), text.slice(0, 6000)],
    [new RegExp(`\\b(?:[Aa]t|[Jj]oin|[Ww]elcome to|[Ww]hy)[ \\t]+${name}[,.!?]`), text.slice(0, 6000)],
    [new RegExp(`(?:^|\\n)${name}[ \\t]+is[ \\t]+(?:a|an|the|hiring)\\b`), text.slice(0, 6000)],
  ];
  for (const [re, hay] of patterns) {
    if (company) break;
    const m = hay.match(re);
    const c = m?.[1]?.replace(/\s+(?:and|of|&)$/i, "").trim();
    if (c && !NOT_A_NAME.test(c.split(/\s+/)[0])) company = c;
  }
  let location = label(/^(?:location|locations|office|based in)\s*[:\-–]\s*(.{2,60})$/i);
  if (!location) {
    for (const m of text.slice(0, 6000).matchAll(/\b([A-Z][a-zA-Z.]+(?:[ \t][A-Z][a-zA-Z.]+){0,2}),[ \t]?([A-Z]{2})\b/g)) if (US_STATES.has(m[2]) && !/^(USA?|United States)$/i.test(m[1])) { location = `${m[1]}, ${m[2]}`; break; }
  }
  if (!location && /\bremote\b/i.test(text.slice(0, 3000))) location = "Remote";
  location = location.replace(/\s*\(.*$/, "").replace(/\s+\d{5}(?:-\d{4})?\b.*$/, "");
  return { company: tidy(company, 60), title: tidy(title, 90), location: tidy(location, 60) };
}

/** Build a resume for a pasted job description; returns { source } to open in the builder. */
export async function startPasted(db, { jd, company = "", title = "", location = "" } = {}) {
  const text = String(jd || "").replace(/\r/g, "").trim().slice(0, 30_000);
  if (text.length < 300) throw new BuilderError("Paste the whole job description: a few paragraphs at least.");
  const g = guessPosting(text);
  // The title steers the track and prints in the header, so it's never made up.
  const posting = { company: tidy(company, 60) || g.company || "Pasted job", title: tidy(title, 90) || g.title, location: tidy(location, 60) || g.location || null };
  if (!posting.title) throw new BuilderError("Add the role title (the posting's text doesn't say it).");
  await syncOverlay(db);
  const id = crypto.randomBytes(5).toString("hex");
  // Its own build folder, built fresh: a cached compile is copied in without the composition the builder edits.
  const buildDir = path.join(OUT_ROOT, "pasted", ".build", id);
  fs.mkdirSync(buildDir, { recursive: true });
  // The pipeline that builds Today's resumes: track, bullets and skills chosen for this posting. You chose it, so a
  // borderline fit still builds; a posting you can't apply to (eligibility) is refused with its reason.
  const { tailorOneAc } = await import("./tailor-ac.mjs");
  const result = await tailorOneAc({ ...posting, job_url: `pasted:${id}`, jd: text, force_borderline: true }, 1, buildDir, { sendPhase: () => {}, log: () => {} }, { planner: "v2", forceRecompile: true });
  try {
    if (result.status !== "ok" || !result.pdfPath || !fs.existsSync(result.pdfPath)) throw new BuilderError(result.error ? `Couldn't build it: ${result.error}` : `Couldn't build it (${result.status}).`);
    const dir = pastedDir(id);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(result.pdfPath, path.join(dir, PDF));
    for (const f of ["composition.json", "resume.tex"]) fs.copyFileSync(path.join(path.dirname(result.pdfPath), f), path.join(dir, f));
  } finally {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
  const at = new Date().toISOString();
  await db.collection(PASTED_COLLECTION).insertOne({ _id: id, ...posting, jd: text, edited: false, createdAt: at, updatedAt: at });
  return { ok: true, source: { kind: "pasted", pasted: id, company: posting.company, title: posting.title, location: posting.location } };
}

/** Your pasted resumes, newest first. */
export async function listPasted(db) {
  const docs = await db.collection(PASTED_COLLECTION).find({}, { projection: { jd: 0 } }).sort({ createdAt: -1 }).limit(50).toArray();
  return { ok: true, resumes: docs.map((d) => ({ id: d._id, company: d.company, title: d.title, location: d.location ?? null, edited: Boolean(d.edited), createdAt: d.createdAt, updatedAt: d.updatedAt, pdfPath: fs.existsSync(path.join(pastedDir(d._id), PDF)) ? path.join(pastedDir(d._id), PDF) : null })) };
}

/** Delete a pasted resume (its record and its folder). */
export async function deletePasted(db, id) {
  const dir = pastedDir(id);
  if (!String(id || "").match(/^[a-f0-9]{10}$/)) throw new BuilderError("Unknown resume");
  await db.collection(PASTED_COLLECTION).deleteOne({ _id: id });
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true };
}

/** What the builder opens: { source, headerTitle, skills, sections, options, roles, current, jd }. */
export async function loadResume(db, { jobUrl = null, track = null, appId = null, pasted = null } = {}) {
  if (db) await syncOverlay(db);
  // An application (a Today card) edits the resume of its job: the first of its job URLs that has one.
  if (!jobUrl && appId) {
    const app = await db.collection("applications").findOne({ _id: appId }, { projection: { jobUrls: 1 } });
    const urls = app?.jobUrls ?? [];
    const withResume = await db.collection("jobs").findOne({ job_url: { $in: urls }, "resume.status": "success", "resume.pdf_path": { $ne: null } }, { projection: { job_url: 1 } });
    if (!withResume) throw new BuilderError("This application's job has no resume yet.");
    jobUrl = withResume.job_url;
  }
  const bank = loadBank();
  let source, dir, jd = null, generated = null;
  if (jobUrl) {
    const { doc } = await jobDoc(db, jobUrl);
    dir = path.dirname(doc.resume.pdf_path);
    generated = doc.resume.generated_pdf_path ?? null;
    source = { kind: "job", jobUrl, company: doc.company ?? "", title: doc.title ?? "", location: doc.location ?? null };
    jd = await jdOf(db, jobUrl);
  } else if (pasted) {
    const doc = await db.collection(PASTED_COLLECTION).findOne({ _id: String(pasted) });
    if (!doc) throw new BuilderError("That resume was deleted.");
    dir = pastedDir(doc._id);
    generated = fs.existsSync(path.join(dir, "generated", PDF)) ? path.join(dir, "generated", PDF) : null;
    source = { kind: "pasted", pasted: doc._id, company: doc.company ?? "", title: doc.title ?? "", location: doc.location ?? null };
    jd = doc.jd ?? null;
  } else if (track && GENERAL_RESUMES[track]) {
    dir = path.join(OUT_ROOT, "general", GENERAL_RESUMES[track].folder);
    generated = fs.existsSync(path.join(dir, "generated", PDF)) ? path.join(dir, "generated", PDF) : null;
    source = { kind: "track", track, company: "", title: GENERAL_RESUMES[track].title, location: null };
  } else throw new BuilderError("Open a job's resume, a track's general resume or a pasted one.");
  if (!fs.existsSync(path.join(dir, PDF))) throw new BuilderError("The resume file isn't on this server yet.");
  const c = compositionAt(dir);
  const kinds = roleKind(bank);
  // The header's email and city as this resume prints them (yours if you changed them, else the profile's / the posting's).
  const me = loadResumeProfile();
  return {
    ok: true,
    source,
    headerTitle: c.headerTitle,
    email: c.email ?? me.email ?? "",
    city: c.city ?? resolveHeaderLocation(source.location, me.location) ?? "",
    skills: c.skills,
    // A project's tools line: yours (stack set) or the one the bullets give (stackAuto), as the PDF shows it.
    sections: c.sections.map((s) => ({ ...s, label: labelOf(s.role), stack: s.stack ?? null, stackAuto: toolsFromBullets(s.bullets, s.role) })),
    // Bullets this resume's track may use: a track's own bullets (tracks: [...]) only on that track's resumes.
    options: bankOptions(bankForTrack(bank, classifyTrack(c.headerTitle || source.title))),
    // Projects you could add (every project with bank bullets).
    roles: Object.entries(kinds).map(([role, kind]) => ({ role, kind, label: labelOf(role) })),
    current: { pdfPath: path.join(dir, PDF), edited: Boolean(generated), generatedPdfPath: generated, pages: pageCount(path.join(dir, PDF)), room: pageRoom(path.join(dir, PDF)) },
    jd: jd ? jd.slice(0, 20_000) : null,
    layout: layoutOf(bank),
  };
}

// ── Your bullets: reworded or new, checked by the bank's rules (ac-bullet-rules.mjs) ──────────────────────────────

/** Technologies the text names (skills-library names found in it, as the bank lint matches them). */
function techsIn(text) {
  return [...new Set(loadSkills().map((sk) => sk.name).filter((n) => n && techPattern(n).test(text)))];
}

/**
 * What's wrong with a bullet you wrote, by the bank's rules (RESUME_BULLET_GUIDE.md): length, an approved action
 * verb (not Built / Developed / Trained), no puffery, at most 3 technologies, no "research" at Stony Brook. For the
 * bank (bankWide), also an opening verb no other bullet that can share a resume uses (the bank lint's rule).
 */
export function checkText(role, text, bank = loadBank(), { bankWide = true, acId = null } = {}) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return ["Write the bullet first."];
  const techs = techsIn(t);
  const issues = lintBullet({ id: acId ?? "new", role, signature_technologies: techs.slice(0, 3) }, t).issues
    .filter((i) => !/^signature tech mismatch/.test(i));
  if (techs.length > 3) issues.push(`names ${techs.length} technologies (${techs.join(", ")}); 3 at most`);
  if (bankWide) {
    const roles = resumeRoles(bank.bank_dir);
    const verb = bankVerb(t);
    const clash = bank.acs.find((a) => a.id !== acId && roles.has(a.role) && (a.variants || []).some((v) => bankVerb(v.text) === verb));
    if (clash && roles.has(role)) issues.push(`"${verb}" already opens ${clash.id} (bullets that can share a resume each need their own opening verb)`);
  }
  return issues;
}

/** Approved action verbs no bullet that can share a resume opens with yet (suggestions when yours is taken). */
export function freeVerbs(bank = loadBank(), limit = 14) {
  const roles = resumeRoles(bank.bank_dir);
  const used = new Set(bank.acs.filter((a) => roles.has(a.role)).flatMap((a) => (a.variants || []).map((v) => bankVerb(v.text))));
  const all = JSON.parse(fs.readFileSync(path.join(bank.bank_dir, "HARVARD_ACTION_VERBS.json"), "utf8"));
  const verbs = [...new Set(Object.values(all.categories).flat().map((v) => String(v)))].filter((v) => /^[A-Za-z]+$/.test(v) && !used.has(v.toLowerCase()) && !/^(built|developed|trained)$/i.test(v));
  return verbs.slice(0, limit);
}

/** A new bank entry for a bullet you wrote: its employer or project, technologies from the text, the role's usual scores. */
function newEntry(id, role, text, bank) {
  const techs = techsIn(text).slice(0, 3);
  const siblings = bank.acs.filter((a) => a.role === role && a.capabilities);
  const caps = {};
  for (const k of ["ai", "backend", "frontend", "data", "cloud", "ml"]) caps[k] = siblings.length ? Math.round(siblings.reduce((n, a) => n + (a.capabilities[k] ?? 0), 0) / siblings.length) : 60;
  return {
    id, role, slot_kind: siblings[0]?.slot_kind ?? (bank.acs.find((a) => a.role === role)?.slot_kind ?? "experience"),
    engineering_identity: siblings[0]?.engineering_identity ?? null, achievement_theme: "your-bullet", display_order: 900, wow_score: 0.7,
    metrics_claimed: [], concepts_claimed: [], signature_technologies: techs, fact: text, capabilities: caps, strength: { recruiter: 7 },
    ats_keywords: techs, facets: { default: { phrase: "your-bullet", keywords: techs.map((x) => x.toLowerCase()) } },
    variants: [{ facet: "default", emphasis: "default", strength: 8, text }], source: "resume-builder",
  };
}

/**
 * Save a bullet to the bank. mode "reword": your wording replaces that bank bullet's (this version of it) for every
 * future resume; mode "new": a new bank entry for that employer or project. Returns the bullet as the resume uses it.
 */
export async function saveBullet(db, { role, text, mode, acId = null, facet = null }) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  await syncOverlay(db);
  const bank = loadBank();
  if (!bank.acs.some((a) => a.role === role)) throw new BuilderError(`Unknown employer or project: ${role}`);
  const original = mode === "reword" ? bank.acs.find((a) => a.id === acId) : null;
  if (mode === "reword" && (!original || original.role !== role)) throw new BuilderError("That bullet isn't in the bank for this section.");
  const issues = checkText(role, t, bank, { acId: original?.id ?? null });
  if (issues.length) throw new BuilderError(`Not saved: ${issues.join("; ")}`);
  const col = db.collection(OVERLAY_COLLECTION);
  const at = new Date().toISOString();
  let bullet;
  if (mode === "reword") {
    const f = facet ?? original.variants?.[0]?.facet ?? "default";
    const previous = original.variants?.find((v) => (v.facet ?? "default") === f)?.text ?? null;
    await col.updateOne({ _id: `${acId}:${f}` }, { $set: { type: "reword", ac_id: acId, facet: f, text: t, updatedAt: at }, $setOnInsert: { previous, createdAt: at } }, { upsert: true });
    bullet = { ac_id: acId, facet: f, text: t };
  } else if (mode === "new") {
    const n = (await col.countDocuments({ type: "new" })) + 1;
    let id = `AC-U${String(n).padStart(3, "0")}`;
    while (bank.acs.some((a) => a.id === id) || await col.findOne({ _id: id })) id = `AC-U${String(Number(id.slice(4)) + 1).padStart(3, "0")}`;
    await col.insertOne({ _id: id, type: "new", ac: newEntry(id, role, t, bank), createdAt: at });
    bullet = { ac_id: id, facet: "default", text: t };
  } else throw new BuilderError("mode is reword or new");
  await syncOverlay(db);
  return { ok: true, bullet };
}

/** Plain text of a composition, for the JD skill match (what an ATS reads, near enough). */
const textOf = (c) => [c.headerTitle, ...c.sections.flatMap((s) => s.bullets.map((b) => b.text)), ...(c.skills || [])].filter(Boolean).join("\n");

/** Pages, from pdfinfo (tectonic compresses its page objects, so scanning the file for them undercounts). */
function pageCount(pdfPath) {
  const r = spawnSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const n = Number((r.stdout || "").match(/^Pages:\s+(\d+)/m)?.[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Room on the page, in bullet lines (10pt type on a 12pt baseline): lines free under the last text of a one-page
 *  resume, or negative, the lines past the first page. From the words' boxes (pdftotext -bbox); null when unreadable.
 *  The template's margins are 0.5in (36pt). */
export function pageRoom(pdfPath) {
  const r = spawnSync("pdftotext", ["-bbox", pdfPath, "-"], { encoding: "utf8", maxBuffer: 16 << 20 });
  if (r.status !== 0 || !r.stdout) return null;
  const pages = r.stdout.split("<page ").slice(1).map((pg) => ({
    height: Number(pg.match(/height="([\d.]+)"/)?.[1]),
    bottom: Math.max(0, ...[...pg.matchAll(/yMax="([\d.]+)"/g)].map((m) => Number(m[1]))),
  }));
  if (!pages.length || !pages[0].height) return null;
  if (pages.length === 1) return Math.floor((pages[0].height - 36 - pages[0].bottom) / 12);
  return -Math.ceil(pages.slice(1).reduce((n, p) => n + Math.max(0, p.bottom - 36), 0) / 12);
}

/** The edit, checked against the bank: known bullets only (Phase 1), each section's own, no repeated opening verb. */
function validate(edit, bank) {
  const byId = new Map(bank.acs.map((a) => [a.id, a]));
  const problems = [];
  const seen = new Map();
  // A bullet you reworded for the bank keeps its old wording valid on resumes built before (it was the bank's then).
  const earlier = new Map();
  for (const e of readOverlay()?.entries ?? []) if (e.type === "reword" && e.previous) earlier.set(e.ac_id, [...(earlier.get(e.ac_id) ?? []), String(e.previous).replace(/\s+/g, " ").trim()]);
  for (const s of edit.sections) {
    for (const b of s.bullets) {
      // Your wording for this resume only: the bullet rules instead of a bank match.
      if (b.custom) {
        for (const issue of checkText(s.role, b.text, bank, { bankWide: false })) problems.push(`"${b.text.slice(0, 40)}…": ${issue}`);
        const verb = openingVerb(b.text);
        if (seen.has(verb)) problems.push(`"${verb}" opens two bullets (${seen.get(verb)} and your edit)`);
        seen.set(verb, "your edit");
        continue;
      }
      const ac = byId.get(b.ac_id);
      if (!ac) { problems.push(`${b.ac_id} isn't in the bank`); continue; }
      if (ac.role !== s.role) problems.push(`${b.ac_id} belongs to ${labelOf(ac.role)}, not ${labelOf(s.role)}`);
      // Earlier wordings: in the overlay (previous) or, once exported to git, the variant's earlier_texts.
      const versions = [...(ac.variants || []).flatMap((v) => [v.text, ...(v.earlier_texts ?? [])]).map((t) => String(t).replace(/\s+/g, " ").trim()), ...(earlier.get(b.ac_id) ?? [])];
      if (!versions.includes(b.text.trim())) problems.push(`${b.ac_id}'s text isn't one of its bank versions`);
      const verb = openingVerb(b.text);
      if (seen.has(verb)) problems.push(`"${verb}" opens two bullets (${seen.get(verb)} and ${b.ac_id})`);
      seen.set(verb, b.ac_id);
    }
  }
  return problems;
}

/**
 * Render an edit into a draft PDF and check it. edit = { source, headerTitle, skills, sections } as loadResume gave
 * it, changed. Returns { draftId, pdfPath, pages, problems, jdMatch: { before, after, missing } }.
 */
export async function renderDraft(db, edit) {
  if (db) await syncOverlay(db);
  const bank = loadBank();
  const base = await loadResume(db, edit.source);
  const clean = {
    headerTitle: String(edit.headerTitle || base.headerTitle || "").trim().slice(0, 60),
    email: String(edit.email ?? base.email ?? "").trim().slice(0, 80),
    city: String(edit.city ?? base.city ?? "").trim().slice(0, 40),
    skills: (edit.skills || []).map((s) => String(s).trim()).filter((s) => s.includes(":")).slice(0, 8),
    sections: (edit.sections || []).map((s) => {
      const kind = s.kind === "project" ? "project" : "experience";
      const bullets = (s.bullets || []).map((b) => ({ ac_id: String(b.ac_id), facet: b.facet ?? null, text: String(b.text || "").replace(/\s+/g, " ").trim(), ...(b.custom ? { custom: true } : {}) }));
      // Your tools line (up to 8, short names). None: a project's comes from its bullets, as generated resumes do;
      // an employer prints none.
      const stack = Array.isArray(s.stack) ? [...new Set(s.stack.map((t) => String(t).trim().slice(0, 30)).filter(Boolean))].slice(0, 8) : [];
      return { role: s.role, kind, bullets, stack: stack.length ? stack : null };
    }),
  };
  const problems = validate(clean, bank);
  if (clean.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) problems.push(`"${clean.email}" isn't an email address`);
  const composition = {
    experience: clean.sections.filter((s) => s.kind === "experience").map((s) => ({ role: s.role, bullets: s.bullets, stack: s.stack })),
    projects: clean.sections.filter((s) => s.kind === "project").map((s) => ({ role: s.role, bullets: s.bullets, stack: s.stack })),
  };
  const me = loadResumeProfile();
  const tex = assembleAcResume(composition, { headerTitle: clean.headerTitle, skillsLines: clean.skills, bank, location: base.source.location,
    profile: { ...me, email: clean.email || me.email }, city: clean.city || null });
  const draftId = crypto.createHash("sha256").update(JSON.stringify([edit.source, tex])).digest("hex").slice(0, 16);
  const dir = path.join(OUT_ROOT, ".builder-drafts", draftId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "resume.tex"), tex);
  fs.writeFileSync(path.join(dir, EDIT_FILE), JSON.stringify({ source: edit.source, ...clean, location: base.source.location, renderedAt: new Date().toISOString() }, null, 2));
  const pdfPath = path.join(dir, PDF);
  if (!fs.existsSync(pdfPath)) {
    const r = spawnSync("tectonic", ["resume.tex"], { cwd: dir, encoding: "utf8", timeout: 120_000 });
    if (r.status !== 0 || !fs.existsSync(path.join(dir, "resume.pdf"))) throw new BuilderError(`The resume didn't compile: ${(r.stderr || r.error || "").toString().slice(-400)}`);
    fs.renameSync(path.join(dir, "resume.pdf"), pdfPath);
  }
  const pages = pageCount(pdfPath);
  if (pages !== 1) problems.push(`It runs to ${pages ?? "?"} pages; one page only.`);
  let jdMatch = null;
  if (base.jd) {
    const skills = loadSkills();
    const before = jdSkillMatch(base.jd, textOf(base), skills);
    const after = jdSkillMatch(base.jd, textOf(clean), skills);
    jdMatch = { before: before.score, after: after.score, missing: after.missing.slice(0, 8).map((m) => m.skill) };
  }
  // Each project's tools line as this draft prints it (the page shows the automatic one while you haven't set yours).
  const stacks = Object.fromEntries(clean.sections.map((s) => [s.role, s.stack ?? (s.kind === "project" ? toolsFromBullets(s.bullets, s.role) : [])]));
  return { ok: true, draftId, pdfPath, pages, room: pages ? pageRoom(pdfPath) : null, problems, jdMatch, stacks };
}

const nextEditDir = (runDir) => {
  const base = path.join(runDir, "edits");
  fs.mkdirSync(base, { recursive: true });
  const n = fs.readdirSync(base).map(Number).filter(Number.isInteger).reduce((m, x) => Math.max(m, x), 0) + 1;
  return path.join(base, String(n));
};

/** The job's resume (every job doc of the posting) and its applications' resume point at pdfPath. */
async function pointJobAt(db, jobUrl, pdfPath, generated) {
  const now = new Date().toISOString();
  const set = { "resume.pdf_path": pdfPath, "resume.edited_at": generated ? now : null, "resume.generated_pdf_path": generated };
  await db.collection("jobs").updateMany({ job_url: jobUrl, "resume.status": "success" }, { $set: set });
  // Applications re-verify the file before they attach it (sha256 cleared); the file name stays the same.
  await db.collection("applications").updateMany({ jobUrls: jobUrl, status: { $nin: ["APPLIED", "SUBMITTING"] } },
    { $set: { "resume.path": pdfPath, "resume.sha256": null, "resume.fileName": PDF }, $unset: { "extension.resumeChoice": "" } });
}

/** Keep a draft. Returns { pdfPath }. */
export async function saveDraft(db, { source, draftId }) {
  const draft = path.join(OUT_ROOT, ".builder-drafts", String(draftId || "").replace(/[^a-f0-9]/g, ""));
  const saved = readJson(path.join(draft, EDIT_FILE));
  if (!saved || !fs.existsSync(path.join(draft, PDF))) throw new BuilderError("That draft is gone; render it again.");
  if (JSON.stringify(saved.source) !== JSON.stringify(source)) throw new BuilderError("That draft belongs to another resume.");
  const problems = validate(saved, loadBank());
  if (problems.length || pageCount(path.join(draft, PDF)) !== 1) throw new BuilderError(`Not saved: ${problems[0] ?? "it isn't one page"}`);
  if (source.kind === "job") {
    const { doc } = await jobDoc(db, source.jobUrl);
    const current = doc.resume.pdf_path;
    const generated = doc.resume.generated_pdf_path ?? current;
    // Edits sit under the generated run's folder, never under another edit.
    const runDir = path.dirname(generated);
    const dest = nextEditDir(runDir);
    fs.cpSync(draft, dest, { recursive: true });
    const pdfPath = path.join(dest, PDF);
    if (!inOutRoot(pdfPath)) throw new BuilderError("Bad resume folder");
    await pointJobAt(db, source.jobUrl, pdfPath, generated);
    return { ok: true, pdfPath };
  }
  const dir = folderOf(source);
  if (!dir) throw new BuilderError("Unknown resume");
  // The first edit keeps the generated resume in generated/ (Revert puts it back).
  if (!fs.existsSync(path.join(dir, "generated", PDF))) {
    fs.mkdirSync(path.join(dir, "generated"), { recursive: true });
    for (const f of [PDF, "composition.json", "resume.tex"]) if (fs.existsSync(path.join(dir, f))) fs.copyFileSync(path.join(dir, f), path.join(dir, "generated", f));
  }
  for (const f of [PDF, EDIT_FILE, "resume.tex"]) fs.copyFileSync(path.join(draft, f), path.join(dir, f));
  if (source.kind === "pasted") await db.collection(PASTED_COLLECTION).updateOne({ _id: source.pasted }, { $set: { edited: true, updatedAt: new Date().toISOString() } });
  return { ok: true, pdfPath: path.join(dir, PDF) };
}

/** A job (or a track's general resume) back to the generated resume. */
export async function revertResume(db, source) {
  if (source.kind === "job") {
    const { doc } = await jobDoc(db, source.jobUrl);
    const generated = doc.resume.generated_pdf_path;
    if (!generated) return { ok: true, pdfPath: doc.resume.pdf_path };
    await pointJobAt(db, source.jobUrl, generated, null);
    return { ok: true, pdfPath: generated };
  }
  const dir = folderOf(source);
  if (!dir || !fs.existsSync(path.join(dir, "generated", PDF))) throw new BuilderError("No generated resume to go back to.");
  for (const f of [PDF, "composition.json", "resume.tex"]) if (fs.existsSync(path.join(dir, "generated", f))) fs.copyFileSync(path.join(dir, "generated", f), path.join(dir, f));
  fs.rmSync(path.join(dir, EDIT_FILE), { force: true });
  fs.rmSync(path.join(dir, "generated"), { recursive: true, force: true });
  if (source.kind === "pasted") await db.collection(PASTED_COLLECTION).updateOne({ _id: source.pasted }, { $set: { edited: false, updatedAt: new Date().toISOString() } });
  return { ok: true, pdfPath: path.join(dir, PDF) };
}
