import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const RESUME_FILENAME = "Atishay Kasliwal.pdf";

/** Metadata for old and new resume builds, including general track resumes. */
export function resumeDownloadPath(pdfPath, bytes, now = new Date()) {
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(path.dirname(pdfPath), "meta.json"), "utf8")); } catch { /* older/general build */ }
  const slug = (value) => String(value || "unknown").normalize("NFKD").replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "unknown";
  const date = now.toLocaleDateString("sv-SE", { timeZone: "America/New_York" });
  const general = pdfPath.split(path.sep).includes("general");
  const company = slug(meta.company || (general ? "general" : path.basename(path.dirname(pdfPath))));
  const role = slug(meta.role || meta.title || (general ? path.basename(path.dirname(pdfPath)) : "resume"));
  const posting = createHash("sha256").update(String(meta.url || meta.job_url || pdfPath)).digest("hex").slice(0, 12);
  const version = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  return `${date}_${company}_${role}-${posting}-${version}/${RESUME_FILENAME}`;
}
