// Resume tracks (data/ac-bank/TRACKS.yaml): which identity a job's resume takes, from its title,
// and what that changes — planner settings, the title shown at each employer, confirmed skills.

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { resolveBankDir } from "./ac-role-meta.mjs";

export function loadTracks(bankDir = resolveBankDir()) {
  return yaml.load(fs.readFileSync(path.join(bankDir, "TRACKS.yaml"), "utf8")) || {};
}

const matches = (patterns, title) => (patterns || []).some((p) => new RegExp(p, "i").test(title));

/** The track id for a job title (first match in TRACKS.yaml `order`), or null when none fits. */
export function classifyTrack(title, doc = loadTracks()) {
  const t = String(title || "");
  for (const id of doc.order || Object.keys(doc.tracks || {})) {
    const track = doc.tracks?.[id];
    if (track && matches(track.title_patterns, t) && !matches(track.exclude_patterns, t)) return id;
  }
  return null;
}

/**
 * The bank as one track sees it. An entry or wording with `tracks: [...]` exists only on those tracks; untagged ones
 * are on every track. track null (a title on no track) sees only untagged ones.
 */
export function bankForTrack(bank, track) {
  const on = (x) => !Array.isArray(x?.tracks) || (track != null && x.tracks.includes(track));
  let changed = false;
  const acs = [];
  for (const ac of bank.acs) {
    if (!on(ac)) { changed = true; continue; }
    const variants = (ac.variants || []).filter(on);
    if (variants.length !== (ac.variants || []).length) changed = true;
    if (!variants.length) continue;
    acs.push(variants.length === (ac.variants || []).length ? ac : { ...ac, variants });
  }
  return changed ? { ...bank, acs } : bank;
}

/**
 * A track's pinned bullet set for a posting (TRACKS.yaml tracks.<id>.pinned), or null. With a title and JD, the first
 * of `pinned_variants` whose rule matches wins: `when.min_signals` distinct `when.signals` words in the title + JD.
 * The chosen set carries its `name` ("default" for `pinned`).
 */
export function trackPins(track, doc = loadTracks(), { title = "", jd = "" } = {}) {
  const t = track ? doc.tracks?.[track] : null;
  if (!t?.pinned) return null;
  // Markdown-escaped JDs write "C\\+\\+": unescape before matching signals.
  const text = `${title}\n${jd}`.replace(/\\([+&#.*-])/g, "$1").toLowerCase();
  for (const v of t.pinned_variants || []) {
    const n = (v.when?.signals || []).filter((s) => new RegExp(`(^|[^a-z0-9])${String(s).toLowerCase().replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}($|[^a-z0-9])`).test(text)).length;
    if (v.when?.min_signals && n >= v.when.min_signals) return { ...v, signals_found: n };
  }
  return { name: "default", ...t.pinned };
}

/** Every pinned set a track has (the default and its variants), for checks that cover them all. */
export function allPinnedSets(track, doc = loadTracks()) {
  const t = doc.tracks?.[track];
  return t?.pinned ? [{ name: "default", ...t.pinned }, ...(t.pinned_variants || [])] : [];
}

/** Planner settings a track changes, applied over the planner's own (see buildPlannerRuntimeConfig). */
export function trackPlannerOverrides(runtime, title, doc = loadTracks()) {
  const id = classifyTrack(title, doc);
  const track = id ? doc.tracks[id] : null;
  const out = { track: id };
  if (!track) return out;
  if (track.experience_bullets) {
    out.min_bullets_per_role = { ...runtime.min_bullets_per_role, ...track.experience_bullets };
    const experience = { ...runtime.minimum_visual_targets?.experience };
    for (const [role, n] of Object.entries(track.experience_bullets)) experience[role] = { preferred: n, minimum: n };
    out.minimum_visual_targets = { ...runtime.minimum_visual_targets, experience };
  }
  if (track.projects) {
    out.resume_project_pool = track.projects;
    out.fixed_project_roles = null;
  }
  if (track.max_ai_bullets != null) out.concept_caps = { ...runtime.concept_caps, ai: track.max_ai_bullets };
  if (track.ats_matrix === false) out.ats_matrix = false;
  return out;
}

// Seniority and level words a past job title doesn't take from the posting.
const LEVEL_WORDS = /\b(?:senior|sr|staff|lead|principal|junior|jr|associate|entry level|new grad(?:uate)?|graduate|intern(?:ship)?|[ivx]+|\d+)\b\.?/gi;

/**
 * The title shown at an employer. Stony Brook, the latest role, shows the role being applied for
 * (the header title without seniority words); the others come from TRACKS.yaml. Null keeps the
 * bank's own title.
 */
export function employerTitle(roleSlug, headerTitle, doc = loadTracks()) {
  if (roleSlug === "stony-brook") {
    const role = String(headerTitle || "").replace(LEVEL_WORDS, " ").replace(/[\s,–—-]+$/, "").replace(/\s+/g, " ").trim();
    if (!role) return null;
    const exact = doc.stony_brook_title_overrides?.[role];
    if (exact) return exact;
    // Words only: "Forward-Deployed" and "forward deployed" match the same pattern.
    const words = (s) => ` ${String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
    const pattern = (doc.stony_brook_title_patterns || []).find((p) => p?.match && words(role).includes(words(p.match)));
    if (pattern?.title) return pattern.title;
    // The job's track may name Stony Brook's title on all its resumes (tracks.<id>.stony_brook_title).
    const track = classifyTrack(headerTitle, doc);
    if (doc.tracks?.[track]?.stony_brook_title) return doc.tracks[track].stony_brook_title;
    // A level-stripped posting title that no longer names a role ("AI Software" from "AI Software Intern") is never
    // printed as a job title: the track's fallback title, else Software Engineer.
    return /\b(?:engineer|developer|scientist|analyst|architect|researcher|consultant|programmer|specialist|designer)s?\b/i.test(role) ? role : doc.tracks?.[track]?.stony_brook_fallback_title ?? "Software Engineer";
  }
  // A track may name other employers' titles on its resumes (tracks.<id>.employer_titles).
  const track = classifyTrack(headerTitle, doc);
  return doc.tracks?.[track]?.employer_titles?.[roleSlug] ?? doc.employer_titles?.[roleSlug] ?? null;
}

const skillKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9+#.]/g, "");

/** Skills Atishay confirmed using (any employer), as normalized names; never the not-confirmed ones. */
export function confirmedSkillKeys(doc = loadTracks()) {
  const lists = Object.entries(doc.confirmed_skills || {}).filter(([key]) => key !== "not_confirmed");
  return new Set(lists.flatMap(([, skills]) => skills || []).map(skillKey));
}

/** Whether a skills-library entry is one Atishay confirmed (by its name, never an alias). */
export function isConfirmedSkill(skill, keys) {
  return keys.has(skillKey(skill.name)) || keys.has(skillKey(skill.displayName));
}
