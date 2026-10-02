export interface AtsItem {
  label: string;
  max: number;
  earned: number;
  classification?: string;
  source?: string;
  evidence?: string | null;
  evidence_entry?: string | null;
  evidence_tier?: string | null;
  warning?: string;
}

export interface AtsAssessment {
  schema_version: number;
  as_of: string;
  config_hash: string;
  note?: string | null;
  readiness: {
    status: string;
    parseability: number;
    findings: Array<{ message: string; severity: string }>;
    critical: string[];
  };
  job_match: {
    score: number;
    coverage: { status: string; unparsed_requirements: number; no_skill_requirements: boolean; missing_job_title: boolean };
    requirement_counts: { required: { matched: number; total: number }; preferred: { matched: number; total: number } };
    categories: Array<{ key: string; earned: number; max: number; note?: string; items: AtsItem[] }>;
    unparsed_requirements: Array<{ classification: string; source: string }>;
    potential_knockouts: Array<{ type: string; status: string; source: string }>;
    recommendations: Array<{ message: string; recoverable_points: number }>;
  } | null;
}
