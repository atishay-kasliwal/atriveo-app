/** Compact tailor explain payload — mirrors scripts/ac-compose-explain.mjs output. */

export interface TailorExplainIdentity {
  primary: string;
  secondary?: string | null;
  confidence?: number | null;
  coherence?: number | null;
}

export interface TailorExplainSwap {
  from: string;
  to: string;
  role: string;
  position?: number;
  reason?: string;
  delta?: number | null;
}

export interface TailorExplainBulletGain {
  ac_id: string;
  position: number;
  gain: number;
  adds?: string[];
  redundant?: string[];
}

export interface TailorExplainRejection {
  rejected: string;
  selected: string;
  role: string;
  information_gain?: number;
  reasons: string[];
}

export interface TailorExplainSummary {
  outcome?: string;
  borderline?: boolean;
  engineering_identity?: TailorExplainIdentity | null;
  global_score?: {
    before?: number | null;
    after?: number | null;
    delta?: number | null;
    applied?: boolean;
  } | null;
  information_gain?: number | null;
  per_bullet_gain?: TailorExplainBulletGain[];
  swaps?: TailorExplainSwap[];
  rejections_sample?: TailorExplainRejection[];
  jd_gate?: {
    outcome?: string;
    message?: string;
    warnings?: string[];
    confidence?: number | null;
  } | null;
}
