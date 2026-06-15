import type { TailorExplainSummary } from "../types/tailorExplain";
import type { TrustReportCompositionExtras } from "../types/trustReport";

export interface ResumeArtifacts extends TrustReportCompositionExtras {
  dir: string;
  selectedAcs: string[];
  explain: TailorExplainSummary | null;
  identity: string | null;
  informationGain: number | null;
  borderline: boolean;
}

export interface SlotChange {
  position: number;
  from: string;
  to: string;
}

export interface ResumeDiffResult {
  identityFrom: string | null;
  identityTo: string | null;
  identityChanged: boolean;
  informationGainFrom: number | null;
  informationGainTo: number | null;
  informationGainDelta: number | null;
  slotChanges: SlotChange[];
  addedAcs: string[];
  removedAcs: string[];
  swapSummary: string[];
}

function acSet(acs: string[]): Set<string> {
  return new Set(acs.filter(Boolean));
}

export function diffResumeArtifacts(from: ResumeArtifacts, to: ResumeArtifacts): ResumeDiffResult {
  const slotChanges: SlotChange[] = [];
  const len = Math.max(from.selectedAcs.length, to.selectedAcs.length);
  for (let i = 0; i < len; i++) {
    const prev = from.selectedAcs[i] || "";
    const next = to.selectedAcs[i] || "";
    if (prev !== next) slotChanges.push({ position: i + 1, from: prev || "—", to: next || "—" });
  }

  const prevSet = acSet(from.selectedAcs);
  const nextSet = acSet(to.selectedAcs);
  const addedAcs = [...nextSet].filter((id) => !prevSet.has(id));
  const removedAcs = [...prevSet].filter((id) => !nextSet.has(id));

  const swapSummary: string[] = [];
  const fromSwaps = from.explain?.swaps || [];
  const toSwaps = to.explain?.swaps || [];
  const swapKeys = new Set<string>();
  for (const s of [...fromSwaps, ...toSwaps]) {
    const key = `${s.role}:${s.from}→${s.to}`;
    if (swapKeys.has(key)) continue;
    swapKeys.add(key);
    if (s.reason) swapSummary.push(s.reason);
    else swapSummary.push(`${s.role}: ${s.from} → ${s.to}`);
  }

  const igFrom = from.informationGain;
  const igTo = to.informationGain;
  const informationGainDelta = igFrom != null && igTo != null ? igTo - igFrom : null;

  return {
    identityFrom: from.identity,
    identityTo: to.identity,
    identityChanged: from.identity !== to.identity,
    informationGainFrom: igFrom,
    informationGainTo: igTo,
    informationGainDelta,
    slotChanges,
    addedAcs,
    removedAcs,
    swapSummary: swapSummary.slice(0, 6),
  };
}
