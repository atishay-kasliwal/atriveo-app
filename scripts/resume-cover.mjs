import fs from "node:fs";
import path from "node:path";
import { buildCoverLetter } from "./cover-letter.mjs";
import { loadResumeProfile } from "./resume-profile.mjs";
import { updateResumeState } from "./resume-queue.mjs";
import { loadBullets } from "./tailor-bank.mjs";

// Every resume the compile worker builds gets a template cover letter (cover-letter.mjs, no AI) in the same
// folder, recorded on the job as `resume.cover_letter` with status "draft". Nothing approves or attaches it by
// itself: the review and the extension offer it next to the resume (" - Cover Letter.pdf"), and you choose it.
// One already in the folder is kept, never rebuilt over. A failed letter never fails the resume.

let bank = null;

export async function draftCoverLetter(db, { jobUrl, company, title, jd, dir }, { build = buildCoverLetter, log = () => {}, name = () => loadResumeProfile().name } = {}) {
  let state;
  try {
    const existing = path.join(dir, `${name()} - Cover Letter.pdf`);
    if (fs.existsSync(existing)) state = { status: "draft", pdf_path: existing, built_at: fs.statSync(existing).mtime.toISOString() };
    else {
      bank ??= loadBullets();
      const r = build({ company, role: title, jd, dir, bank }, (kind, text) => { if (kind === "error") log("cover", text); });
      state = r.ok ? { status: "draft", pdf_path: r.pdf, built_at: new Date().toISOString() } : { status: "failed", error: String(r.err || "build failed").slice(-300) };
    }
  } catch (e) {
    state = { status: "failed", error: String(e?.message || e).slice(-300) };
  }
  try {
    await updateResumeState(db, jobUrl, { cover_letter: state });
  } catch { /* the letter is on disk; the record catches up on the next build */ }
  log("cover", `${company} · ${state.status === "draft" ? "draft ready" : `failed: ${state.error}`}`);
  return state;
}
