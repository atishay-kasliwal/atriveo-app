// Resume header identity — the one editable source for everything printed in
// the contact line at the top of every resume.
//
// Previously name/phone/email/links/city were literal strings inside two
// separate LaTeX builders, so changing an email meant editing code in two
// places. This module owns them instead: defaults live here, overrides live in
// data/resume-profile.json, and both the dock and the web Settings page edit
// that file through tailor-server's /resume-profile endpoints.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function resolveProfilePath() {
  return process.env.RESUME_PROFILE_PATH || path.join(APP_ROOT, "data", "resume-profile.json");
}

/** Shipped defaults — the values the header carried before it was editable. */
export const PROFILE_DEFAULTS = Object.freeze({
  name:      "Atishay Kasliwal",
  title:     "Software Engineer",
  email:     "katishay@gmail.com",
  phone:     "934-246-1198",
  location:  "New York, NY",
  linkedin:  "https://www.linkedin.com/in/atishay-kasliwal",
  github:    "https://github.com/atishay-kasliwal",
  portfolio: "https://atishaykasliwal.com",
});

export const PROFILE_FIELDS = Object.freeze(Object.keys(PROFILE_DEFAULTS));

// Long enough for real values, short enough that the header can't wrap onto a
// second line and blow the one-page budget.
const MAX_LEN = {
  name: 60, title: 40, email: 80, phone: 24, location: 40,
  linkedin: 200, github: 200, portfolio: 200,
};

function clean(value, field) {
  if (typeof value !== "string") return null;
  // Control characters would corrupt the .tex; newlines would break the header.
  const flat = value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.slice(0, MAX_LEN[field] ?? 100);
}

/**
 * Coerce arbitrary input into a valid profile patch.
 * Unknown keys are dropped; blank values mean "fall back to the default".
 */
export function sanitizeProfile(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const field of PROFILE_FIELDS) {
    if (!(field in input)) continue;
    const value = clean(input[field], field);
    if (value) out[field] = value;
  }
  return out;
}

let cache = null;
let cacheMtime = 0;

/**
 * Current profile: defaults with the saved overrides applied.
 * Re-reads only when the file's mtime moves, so the compose path can call this
 * per candidate without hitting the disk every time.
 */
export function loadResumeProfile() {
  const file = resolveProfilePath();
  let mtime = 0;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    // No file yet — that's the normal first-run state, not an error.
    cache = { ...PROFILE_DEFAULTS };
    cacheMtime = 0;
    return cache;
  }
  if (cache && mtime === cacheMtime) return cache;
  let saved = {};
  try {
    saved = sanitizeProfile(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    // Corrupt file shouldn't take resume builds down — fall back to defaults.
    saved = {};
  }
  cache = { ...PROFILE_DEFAULTS, ...saved };
  cacheMtime = mtime;
  return cache;
}

/**
 * Merge a patch into the saved profile and persist it. Returns the new profile.
 *
 * A field sent as an empty string is an explicit "reset this one", so it goes
 * back to the shipped default rather than being silently ignored — that's what
 * both Settings screens tell the user clearing a box does.
 */
export function saveResumeProfile(patch) {
  const file = resolveProfilePath();
  const current = loadResumeProfile();
  const resets = {};
  if (patch && typeof patch === "object") {
    for (const field of PROFILE_FIELDS) {
      if (typeof patch[field] === "string" && !patch[field].trim()) {
        resets[field] = PROFILE_DEFAULTS[field];
      }
    }
  }
  const next = { ...current, ...resets, ...sanitizeProfile(patch) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  cache = null;          // force a re-read so mtime and cache stay honest
  cacheMtime = 0;
  return loadResumeProfile();
}
