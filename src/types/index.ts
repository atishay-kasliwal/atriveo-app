export interface Job {
  session_id?: string;
  title: string;
  company: string;
  location: string;
  level: string;
  min_exp: number | null;
  max_exp: number | null;
  job_url: string;
  date_posted: string;
  batch_time: string;
  score: number;
  score_pct: number;
  competition_score: number;
  site: string;
  search_term: string;
  summary?: string;
}

export interface RunEntry {
  session_id: string;
  run_at: string;
  total_jobs: number;
  snapshot_file?: string;
}

export interface User {
  email: string;
  name: string;
}
