/** Trust report — recruiter replay + rejections + JD coverage map. */

export interface TrustRejectionRow {
  rejected: string;
  selected: string;
  role: string;
  reasons: string[];
  informationGain?: number | null;
}

export interface TrustCapabilityNode {
  node: string;
  strength: number;
}

export interface TrustJdCoverage {
  weightedPct: number | null;
  missingClaimable: string[];
  unclaimable: string[];
  capabilityMap: TrustCapabilityNode[];
}

export interface TrustReport {
  confidence: "High" | "Medium" | "Low";
  recruiterReplay: string[];
  rejections: TrustRejectionRow[];
  jdCoverage: TrustJdCoverage;
  hiringManager: {
    wouldInterview: boolean | null;
    because: string[];
    concerns: string[];
  } | null;
  borderlineMessage: string | null;
}

export interface TrustReportCompositionExtras {
  coverage?: {
    weighted_coverage?: number | null;
    missing_claimable?: string[];
    unclaimable?: string[];
  } | null;
  graphCoverage?: Record<string, number> | null;
  hiringManager?: {
    would_interview?: boolean;
    because?: string[];
    concerns?: string[];
  } | null;
}
