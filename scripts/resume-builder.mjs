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
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadBank } from "./ac-bank.mjs";
import { assembleAcResume, EDUCATION_ROWS, toolsFromBullets } from "./ac-tex.mjs";
import { displayUrl } from "./ats/patterns.mjs";
import { employerTitle, loadTracks } from "./ac-tracks.mjs";
import { resolveExperienceMeta, resolveProjectMeta, sortProjectsByRecency } from "./ac-role-meta.mjs";
import { jdSkillMatch, loadSkills } from "./ac-jd-skills.mjs";
import { resolveHeaderLocation } from "./ac-header-location.mjs";
import { loadResumeProfile } from "./resume-profile.mjs";
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
  const sec = (kind) => (b) => ({ role: b.role, kind, bullets: (b.bullets || []).map((x) => ({ ac_id: x.ac_id, facet: x.facet ?? null, text: x.text })), ...(kind === "project" ? { stack: null } : {}) });
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
    name: me.name, phone: me.phone || null, linkedin: me.linkedin ? displayUrl(me.linkedin) : null, github: me.github ? displayUrl(me.github) : null,
    education: EDUCATION_ROWS,
    roles: Object.fromEntries(exp.map((r) => { const m = resolveExperienceMeta(r); return [r, { name: labelOf(r), dates: m.dates, place: m.loc, order: m.order || 0,
      title: r === "stony-brook" ? null : employerTitle(r, null) || (r === "wake-forest" ? "AI/ML Engineer" : m.title) }]; })),
    projects: Object.fromEntries(projs.map((r) => [r, { name: labelOf(r), dates: resolveProjectMeta(r).dates, rank: ranked.indexOf(r) }])),
    sbTitleOverrides: loadTracks().stony_brook_title_overrides ?? {},
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

/** What the builder opens: { source, headerTitle, skills, sections, options, roles, current, jd }. */
export async function loadResume(db, { jobUrl = null, track = null, appId = null } = {}) {
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
  } else if (track && GENERAL_RESUMES[track]) {
    dir = path.join(OUT_ROOT, "general", GENERAL_RESUMES[track].folder);
    generated = fs.existsSync(path.join(dir, "generated", PDF)) ? path.join(dir, "generated", PDF) : null;
    source = { kind: "track", track, company: "", title: GENERAL_RESUMES[track].title, location: null };
  } else throw new BuilderError("Open a job's resume or a track's general resume.");
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
    sections: c.sections.map((s) => ({ ...s, label: labelOf(s.role), ...(s.kind === "project" ? { stack: s.stack ?? null, stackAuto: toolsFromBullets(s.bullets, s.role) } : {}) })),
    options: bankOptions(bank),
    // Projects you could add (every project with bank bullets).
    roles: Object.entries(kinds).map(([role, kind]) => ({ role, kind, label: labelOf(role) })),
    current: { pdfPath: path.join(dir, PDF), edited: Boolean(generated), generatedPdfPath: generated },
    jd: jd ? jd.slice(0, 20_000) : null,
    layout: layoutOf(bank),
  };
}

/** Plain text of a composition, for the JD skill match (what an ATS reads, near enough). */
const textOf = (c) => [c.headerTitle, ...c.sections.flatMap((s) => s.bullets.map((b) => b.text)), ...(c.skills || [])].filter(Boolean).join("\n");

/** Pages, from pdfinfo (tectonic compresses its page objects, so scanning the file for them undercounts). */
function pageCount(pdfPath) {
  const r = spawnSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const n = Number((r.stdout || "").match(/^Pages:\s+(\d+)/m)?.[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The edit, checked against the bank: known bullets only (Phase 1), each section's own, no repeated opening verb. */
function validate(edit, bank) {
  const byId = new Map(bank.acs.map((a) => [a.id, a]));
  const problems = [];
  const seen = new Map();
  for (const s of edit.sections) {
    for (const b of s.bullets) {
      const ac = byId.get(b.ac_id);
      if (!ac) { problems.push(`${b.ac_id} isn't in the bank`); continue; }
      if (ac.role !== s.role) problems.push(`${b.ac_id} belongs to ${labelOf(ac.role)}, not ${labelOf(s.role)}`);
      if (!(ac.variants || []).some((v) => String(v.text).replace(/\s+/g, " ").trim() === b.text.trim())) problems.push(`${b.ac_id}'s text isn't one of its bank versions`);
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
  const bank = loadBank();
  const base = await loadResume(db, edit.source);
  const clean = {
    headerTitle: String(edit.headerTitle || base.headerTitle || "").trim().slice(0, 60),
    email: String(edit.email ?? base.email ?? "").trim().slice(0, 80),
    city: String(edit.city ?? base.city ?? "").trim().slice(0, 40),
    skills: (edit.skills || []).map((s) => String(s).trim()).filter((s) => s.includes(":")).slice(0, 8),
    sections: (edit.sections || []).map((s) => {
      const kind = s.kind === "project" ? "project" : "experience";
      const bullets = (s.bullets || []).map((b) => ({ ac_id: String(b.ac_id), facet: b.facet ?? null, text: String(b.text || "").replace(/\s+/g, " ").trim() }));
      // Your tools line for a project (up to 8, short names); none = picked from its bullets, as generated resumes do.
      const stack = kind === "project" && Array.isArray(s.stack) ? [...new Set(s.stack.map((t) => String(t).trim().slice(0, 30)).filter(Boolean))].slice(0, 8) : [];
      return { role: s.role, kind, bullets, ...(kind === "project" ? { stack: stack.length ? stack : null } : {}) };
    }),
  };
  const problems = validate(clean, bank);
  if (clean.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) problems.push(`"${clean.email}" isn't an email address`);
  const composition = {
    experience: clean.sections.filter((s) => s.kind === "experience").map((s) => ({ role: s.role, bullets: s.bullets })),
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
  const stacks = Object.fromEntries(clean.sections.filter((s) => s.kind === "project").map((s) => [s.role, s.stack ?? toolsFromBullets(s.bullets, s.role)]));
  return { ok: true, draftId, pdfPath, pages, problems, jdMatch, stacks };
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
  const g = GENERAL_RESUMES[source.track];
  if (!g) throw new BuilderError("Unknown track");
  const dir = path.join(OUT_ROOT, "general", g.folder);
  // The first edit keeps the generated resume in generated/ (Revert puts it back).
  if (!fs.existsSync(path.join(dir, "generated", PDF))) {
    fs.mkdirSync(path.join(dir, "generated"), { recursive: true });
    for (const f of [PDF, "composition.json", "resume.tex"]) if (fs.existsSync(path.join(dir, f))) fs.copyFileSync(path.join(dir, f), path.join(dir, "generated", f));
  }
  for (const f of [PDF, EDIT_FILE, "resume.tex"]) fs.copyFileSync(path.join(draft, f), path.join(dir, f));
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
  const g = GENERAL_RESUMES[source.track];
  const dir = g && path.join(OUT_ROOT, "general", g.folder);
  if (!dir || !fs.existsSync(path.join(dir, "generated", PDF))) throw new BuilderError("No generated resume to go back to.");
  for (const f of [PDF, "composition.json", "resume.tex"]) if (fs.existsSync(path.join(dir, "generated", f))) fs.copyFileSync(path.join(dir, "generated", f), path.join(dir, f));
  fs.rmSync(path.join(dir, EDIT_FILE), { force: true });
  fs.rmSync(path.join(dir, "generated"), { recursive: true, force: true });
  return { ok: true, pdfPath: path.join(dir, PDF) };
}
