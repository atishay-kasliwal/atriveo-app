import fs from "node:fs";
import path from "node:path";
import { buildCoverLetter } from "./cover-letter.mjs";
import { enqueueJob, fetchDescription } from "./resume-queue.mjs";
import { compileOwner } from "./worker-id.mjs";

/**
 * Apply with Atriveo's Resume and Cover letter tabs (fill-routes.mjs) use this backend's own pipeline; playatriveo
 * has already checked that the application is yours and its posting has a job description.
 *
 * Tailoring: the compile queue exactly as /compile-enqueue (resume-queue enqueueJob), never forced, so a finished,
 * queued or running build is left alone; owned like every job this backend queues (worker-id.mjs compileOwner).
 *
 * Cover letters: the template generator (cover-letter.mjs) into a new folder per generation, next to the posting's
 * resume when there is one, so an existing letter is never overwritten.
 */
export function applyHereDocs({ withMongo, outRoot, bank, log = () => {}, workerId = compileOwner, now = () => new Date() }) {
  const mongo = (fn) => withMongo(fn, { appName: "AtriveoTailorServer" });
  return {
    enqueueTailoring: (job) => mongo((db) => enqueueJob(db, { ...job, source: "extension", priority: 1001, owner: workerId() })),
    generateCoverLetter: async ({ jobUrl, company, title, resumeDir }) => {
      const jd = await mongo((db) => fetchDescription(db, jobUrl));
      if (!jd || jd.length < 200) return { ok: false, err: "No full job description saved for this posting" };
      const stamp = now().toISOString().replace(/[:.]/g, "-");
      const slug = String(company || "company").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "company";
      const dir = resumeDir && fs.existsSync(resumeDir) ? path.join(resumeDir, "cover-letters", stamp) : path.join(outRoot, "cover-letters", slug, stamp);
      if (fs.existsSync(dir)) return { ok: false, err: "A cover letter is already being generated at this moment; try again" };
      return buildCoverLetter({ company, role: title, jd, dir, bank }, (kind, text) => log(`[cover] ${kind}: ${text}`));
    },
  };
}
