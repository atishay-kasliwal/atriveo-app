// Extracts a human-readable compensation label from a job summary.
// Returns null if nothing recognisable is found.

const K_RE = /\$(\d{1,3}(?:,\d{3})*(?:\.\d+)?)[Kk]?\s*(?:–|-|to)\s*\$?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)[Kk]?/;
const SINGLE_RE = /\$(\d{1,3}(?:,\d{3})*(?:\.\d+)?)[Kk]?\s*(?:\/\s*(?:yr|year|hour|hr))?/;

function toK(raw: string, isK: boolean): number {
  const n = parseFloat(raw.replace(/,/g, ""));
  return isK ? n : n / 1000;
}

export function extractComp(summary?: string | null): string | null {
  if (!summary) return null;
  const text = summary.slice(0, 2000);

  const range = K_RE.exec(text);
  if (range) {
    const isK = /[Kk]/.test(range[0]);
    const lo = toK(range[1], isK);
    const hi = toK(range[2], isK);
    if (lo >= 20 && hi <= 1000 && hi > lo) {
      return `$${Math.round(lo)}–${Math.round(hi)}K`;
    }
  }

  const single = SINGLE_RE.exec(text);
  if (single) {
    const isK = /[Kk]/.test(single[0]);
    const val = toK(single[1], isK);
    if (val >= 20 && val <= 1000) {
      return `~$${Math.round(val)}K`;
    }
  }

  return null;
}
