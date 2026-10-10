// The bank page (/bank, docs/bank-page.md): every bullet in the bank, with its wordings, scores and the tracks whose
// tested resume prints it. It shapes loadBank() (git bank + your overlay) and TRACKS.yaml for the page. Edits go through
// the resume builder's saveBullet (rewords); retiring and restoring are overlay entries written here.

import { loadBank } from "./ac-bank.mjs";
import { OVERLAY_COLLECTION, readOverlay, syncOverlay } from "./ac-bank-overlay.mjs";
import { allPinnedSets, loadTracks } from "./ac-tracks.mjs";
import { PROJECT_SLUG_TO_NAME, ROLE_SLUG_TO_NAME } from "./ac-role-meta.mjs";

const RETIRED = "retired";
const ownTracks = (x) => (Array.isArray(x?.tracks) ? x.tracks.filter((t) => t !== RETIRED) : []);
const isRetired = (x) => Array.isArray(x?.tracks) && x.tracks.includes(RETIRED);

/**
 * Where each wording is pinned: "AC-001:fde" → [{ track, set }]. A bare id in TRACKS.yaml means the entry's first
 * wording (as in applyTrackPins), so it is keyed under that wording's facet.
 */
function pinIndex(bank, doc) {
  const first = new Map(bank.acs.map((ac) => [ac.id, ac.variants?.[0]?.facet ?? "default"]));
  const out = new Map();
  for (const track of Object.keys(doc.tracks || {})) {
    for (const set of allPinnedSets(track, doc)) {
      const ids = [...Object.values(set.experience || {}), ...Object.values(set.projects || {})].flat();
      for (const ref of ids) {
        const [id, facet] = String(ref).split(":");
        const key = `${id}:${facet ?? first.get(id) ?? "default"}`;
        const list = out.get(key) || [];
        if (!list.some((p) => p.track === track && p.set === set.name)) list.push({ track, set: set.name });
        out.set(key, list);
      }
    }
  }
  return out;
}

export class BankPageError extends Error {}

export function bankView(bank = loadBank(), doc = loadTracks(), overlay = readOverlay()) {
  const pins = pinIndex(bank, doc);
  // What you changed on this page or in the builder and haven't exported to git yet.
  const mine = overlay?.entries ?? [];
  const reworded = new Map(mine.filter((e) => e.type === "reword").map((e) => [`${e.ac_id}:${e.facet ?? "default"}`, e]));
  const scored = new Map(mine.filter((e) => e.type === "score").map((e) => [`${e.ac_id}:${e.facet}`, e]));
  const facts = (id) => mine.filter((e) => e.type === "fact" && e.ac_id === id).map((e) => ({ text: e.text, at: e.createdAt ?? null }));
  const retiredHere = new Map(mine.filter((e) => e.type === "retire").map((e) => [e.facet == null ? e.ac_id : `${e.ac_id}:${e.facet}`, e]));
  const entries = bank.acs.map((ac) => ({
    id: ac.id,
    role: ac.role,
    label: ROLE_SLUG_TO_NAME[ac.role] || PROJECT_SLUG_TO_NAME[ac.role] || ac.role,
    kind: ac.slot_kind === "project" ? "project" : "experience",
    theme: ac.achievement_theme || "",
    fact: ac.fact || "",
    confirmedAt: ac.provenance?.level === "USER_CONFIRMED" ? ac.provenance.confirmed_at ?? null : null,
    tracks: ownTracks(ac),
    // Roles the bullet is good for (`fits:`), for reading and filtering only; resume selection never reads it.
    fits: Array.isArray(ac.fits) ? ac.fits : [],
    retired: isRetired(ac),
    retiredHere: retiredHere.get(ac.id)?.reason ?? (retiredHere.has(ac.id) ? "" : null),
    yours: ac.source === "resume-builder",
    yourFacts: facts(ac.id),
    variants: (ac.variants || []).map((v) => {
      const facet = v.facet ?? "default";
      return {
        facet,
        text: String(v.text || "").trim(),
        strength: typeof v.strength === "number" ? v.strength : null,
        // Under 9: what the wording is missing (a number or result only you can give).
        note: v.strength_note || null,
        tracks: ownTracks(v),
        retired: isRetired(v),
        pinned: pins.get(`${ac.id}:${facet}`) || [],
        // Reworded since it was scored (the score is the old wording's).
        edited: reworded.has(`${ac.id}:${facet}`) && !(String(scored.get(`${ac.id}:${facet}`)?.updatedAt ?? "") >= String(reworded.get(`${ac.id}:${facet}`).updatedAt ?? "")),
        retiredHere: retiredHere.get(`${ac.id}:${facet}`)?.reason ?? (retiredHere.has(`${ac.id}:${facet}`) ? "" : null),
      };
    }),
  }));
  const tracks = Object.entries(doc.tracks || {}).map(([id, t]) => ({ id, label: t.label || id, hasSet: Boolean(t.pinned) }));
  return { ok: true, version: String(bank.bank_version), updatedAt: bank.bank_updated_at, tracks, entries };
}

/**
 * Retire an entry (facet null) or one wording: hidden from every future resume through an overlay entry, until it is
 * restored here or exported to git (npm run bank:export). A wording a track's tested set prints can't be retired: the set
 * would lose a bullet nobody re-tested (change TRACKS.yaml first). restore: undo a retirement made here.
 */
export async function retireBullet(db, { acId, facet = null, reason = "", restore = false } = {}) {
  await syncOverlay(db);
  const bank = loadBank();
  const ac = bank.acs.find((a) => a.id === acId);
  if (!ac) throw new BankPageError(`${acId} isn't in the bank.`);
  if (facet != null && !(ac.variants || []).some((v) => (v.facet ?? "default") === facet)) throw new BankPageError(`${acId} has no wording "${facet}".`);
  const _id = facet == null ? `retire:${acId}` : `retire:${acId}:${facet}`;
  const col = db.collection(OVERLAY_COLLECTION);
  if (restore) {
    const { deletedCount } = await col.deleteOne({ _id });
    if (!deletedCount) throw new BankPageError("Only a retirement made on this page can be restored here; this one is in git.");
  } else {
    const pins = pinIndex(bank, loadTracks());
    const pinned = (ac.variants || []).filter((v) => facet == null || (v.facet ?? "default") === facet)
      .flatMap((v) => pins.get(`${acId}:${v.facet ?? "default"}`) || []);
    if (pinned.length) {
      const sets = [...new Set(pinned.map((p) => `${p.track}${p.set === "default" ? "" : ` (${p.set})`}`))].join(", ");
      throw new BankPageError(`Not retired: the tested ${sets} resume prints it. Take it out of that set in TRACKS.yaml first.`);
    }
    const at = new Date().toISOString();
    await col.updateOne({ _id }, { $set: { type: "retire", ac_id: acId, facet, reason: String(reason || "").trim().slice(0, 200), updatedAt: at }, $setOnInsert: { createdAt: at } }, { upsert: true });
  }
  await syncOverlay(db);
  return bankView();
}
