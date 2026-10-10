// The bank page (/bank, docs/bank-page.md): every bullet in the bank, with its wordings, scores and the tracks whose
// tested resume prints it. Read-only: it shapes loadBank() (git bank + your builder bullets) and TRACKS.yaml for the page.

import { loadBank } from "./ac-bank.mjs";
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

export function bankView(bank = loadBank(), doc = loadTracks()) {
  const pins = pinIndex(bank, doc);
  const entries = bank.acs.map((ac) => ({
    id: ac.id,
    role: ac.role,
    label: ROLE_SLUG_TO_NAME[ac.role] || PROJECT_SLUG_TO_NAME[ac.role] || ac.role,
    kind: ac.slot_kind === "project" ? "project" : "experience",
    theme: ac.achievement_theme || "",
    fact: ac.fact || "",
    confirmedAt: ac.provenance?.level === "USER_CONFIRMED" ? ac.provenance.confirmed_at ?? null : null,
    tracks: ownTracks(ac),
    retired: isRetired(ac),
    variants: (ac.variants || []).map((v) => {
      const facet = v.facet ?? "default";
      return {
        facet,
        text: String(v.text || "").trim(),
        strength: typeof v.strength === "number" ? v.strength : null,
        tracks: ownTracks(v),
        retired: isRetired(v),
        pinned: pins.get(`${ac.id}:${facet}`) || [],
      };
    }),
  }));
  const tracks = Object.entries(doc.tracks || {}).map(([id, t]) => ({ id, label: t.label || id, hasSet: Boolean(t.pinned) }));
  return { ok: true, version: String(bank.bank_version), updatedAt: bank.bank_updated_at, tracks, entries };
}
