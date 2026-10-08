// Your own bullets (resume builder, docs/resume-builder.md): bullets you wrote or reworded, kept in Mongo
// `bank_overlay` so every machine sees them, and merged over the git bank (data/ac-bank) by loadBank().
//
//   { _id: "AC-U001", type: "new", ac: {…a full bank entry…} }                  a bullet you wrote
//   { _id: "AC-026:default", type: "reword", ac_id, facet, text, previous }   your wording of a bank bullet
//
// loadBank() is synchronous, so it reads a local copy (OVERLAY_FILE); syncOverlay(db) refreshes that copy and is
// called before each resume build (tailor-worker) and by the builder. The bank's version then carries the
// overlay's fingerprint, so resumes cached before a change are rebuilt.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const OVERLAY_COLLECTION = "bank_overlay";
export const OVERLAY_FILE = process.env.AC_BANK_OVERLAY || path.join(os.tmpdir(), "atriveo-bank-overlay.json");

/** Refresh the local copy from Mongo; returns the entries. */
export async function syncOverlay(db) {
  const entries = await db.collection(OVERLAY_COLLECTION).find({}).sort({ _id: 1 }).toArray();
  const body = JSON.stringify({ entries });
  const tmp = `${OVERLAY_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, OVERLAY_FILE);
  return entries;
}

/** The local copy ({ entries, fingerprint }), or null when there is none (CI, tests, a machine that never synced). */
export function readOverlay(file = OVERLAY_FILE) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const { entries } = JSON.parse(raw);
    if (!Array.isArray(entries) || !entries.length) return null;
    return { entries, fingerprint: crypto.createHash("sha256").update(raw).digest("hex").slice(0, 8) };
  } catch { return null; }
}

/** The bank entries with your bullets merged in: new entries added, reworded variants replaced. */
export function applyOverlay(acs, overlay) {
  if (!overlay) return acs;
  const out = acs.map((ac) => ({ ...ac, variants: (ac.variants || []).map((v) => ({ ...v })) }));
  const byId = new Map(out.map((ac) => [ac.id, ac]));
  for (const e of overlay.entries) {
    if (e.type === "new" && e.ac?.id && !byId.has(e.ac.id)) { out.push(e.ac); byId.set(e.ac.id, e.ac); }
  }
  for (const e of overlay.entries) {
    if (e.type !== "reword") continue;
    const ac = byId.get(e.ac_id);
    const v = ac?.variants?.find((x) => (x.facet ?? "default") === (e.facet ?? "default"));
    if (v) v.text = e.text;
  }
  return out;
}
