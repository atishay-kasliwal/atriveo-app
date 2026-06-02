import type { Job } from "../types";
import { careerOpsRating, jobBoardLabel } from "./jobPresentation";

type SkillPattern = {
  skill: string;
  category: string;
  patterns: RegExp[];
};

export type JobSkillHit = {
  skill: string;
  category: string;
  jobCount: number;
  percent: number;
  inResume: boolean;
};

export type JobThemeHit = {
  theme: string;
  count: number;
  percent: number;
};

export type SelectedJobAnalysis = {
  selectedCount: number;
  fullDescriptionCount: number;
  avgCareerOps: number;
  topBoards: Array<{ board: string; count: number }>;
  topCompanies: Array<{ company: string; count: number }>;
  topSkills: JobSkillHit[];
  missingSkills: JobSkillHit[];
  coveredSkills: JobSkillHit[];
  themes: JobThemeHit[];
  actionBullets: string[];
  hasResume: boolean;
};

const SKILL_PATTERNS: SkillPattern[] = [
  { category: "Languages", skill: "Python", patterns: [/\bpython\b/i] },
  { category: "Languages", skill: "Java", patterns: [/\bjava\b/i] },
  { category: "Languages", skill: "JavaScript", patterns: [/\bjavascript\b|\bjs\b/i] },
  { category: "Languages", skill: "TypeScript", patterns: [/\btypescript\b|\bts\b/i] },
  { category: "Languages", skill: "SQL", patterns: [/\bsql\b|postgres|mysql/i] },
  { category: "Languages", skill: "C++", patterns: [/\bc\+\+\b|\bcpp\b/i] },
  { category: "Languages", skill: "C#", patterns: [/\bc#\b|c sharp|\.net/i] },
  { category: "Languages", skill: "Go", patterns: [/\bgolang\b|\bgo\b/i] },
  { category: "Languages", skill: "Rust", patterns: [/\brust\b/i] },
  { category: "Frontend", skill: "React", patterns: [/\breact\b|react\.js|reactjs/i] },
  { category: "Frontend", skill: "Angular", patterns: [/\bangular\b/i] },
  { category: "Frontend", skill: "Next.js", patterns: [/\bnext\.?js\b|nextjs/i] },
  { category: "Backend", skill: "Node.js", patterns: [/\bnode\.?js\b|nodejs/i] },
  { category: "Backend", skill: "FastAPI", patterns: [/\bfastapi\b/i] },
  { category: "Backend", skill: "Django", patterns: [/\bdjango\b/i] },
  { category: "Backend", skill: "Flask", patterns: [/\bflask\b/i] },
  { category: "Backend", skill: "Spring Boot", patterns: [/spring boot/i] },
  { category: "Backend", skill: "REST APIs", patterns: [/rest api|restful|\brest\b|api design|api development/i] },
  { category: "Backend", skill: "GraphQL", patterns: [/\bgraphql\b/i] },
  { category: "Backend", skill: "Microservices", patterns: [/microservices?|distributed services?/i] },
  { category: "Backend", skill: "Distributed Systems", patterns: [/distributed systems?|distributed computing/i] },
  { category: "Cloud", skill: "AWS", patterns: [/\baws\b|amazon web services/i] },
  { category: "Cloud", skill: "Azure", patterns: [/\bazure\b|microsoft azure/i] },
  { category: "Cloud", skill: "GCP", patterns: [/\bgcp\b|google cloud/i] },
  { category: "Cloud", skill: "Docker", patterns: [/\bdocker\b|containerization/i] },
  { category: "Cloud", skill: "Kubernetes", patterns: [/\bkubernetes\b|\bk8s\b/i] },
  { category: "Cloud", skill: "Terraform", patterns: [/\bterraform\b/i] },
  { category: "Cloud", skill: "CI/CD", patterns: [/ci\/cd|continuous integration|continuous deployment|github actions|jenkins/i] },
  { category: "Data", skill: "Spark", patterns: [/\bspark\b|pyspark|apache spark/i] },
  { category: "Data", skill: "Kafka", patterns: [/\bkafka\b/i] },
  { category: "Data", skill: "Airflow", patterns: [/\bairflow\b/i] },
  { category: "Data", skill: "ETL/Data Pipelines", patterns: [/\betl\b|\belt\b|data pipeline|data ingestion/i] },
  { category: "Data", skill: "MongoDB", patterns: [/\bmongodb\b/i] },
  { category: "Data", skill: "Redis", patterns: [/\bredis\b/i] },
  { category: "AI/ML", skill: "Machine Learning", patterns: [/machine learning|\bml\b/i] },
  { category: "AI/ML", skill: "LLMs", patterns: [/\bllm\b|large language model/i] },
  { category: "AI/ML", skill: "GenAI", patterns: [/generative ai|\bgenai\b|gen ai/i] },
  { category: "AI/ML", skill: "RAG", patterns: [/\brag\b|retrieval.augmented/i] },
  { category: "AI/ML", skill: "PyTorch", patterns: [/\bpytorch\b/i] },
  { category: "AI/ML", skill: "TensorFlow", patterns: [/\btensorflow\b/i] },
  { category: "AI/ML", skill: "Pandas/NumPy", patterns: [/\bpandas\b|\bnumpy\b/i] },
  { category: "AI/ML", skill: "Agents", patterns: [/agentic|ai agents?|llm agents?/i] },
  { category: "Security", skill: "OAuth/OIDC", patterns: [/\boauth\b|\boidc\b|openid connect/i] },
  { category: "Security", skill: "JWT", patterns: [/\bjwt\b/i] },
  { category: "Security", skill: "IAM", patterns: [/\biam\b|identity and access/i] },
  { category: "Quality", skill: "Testing", patterns: [/\btesting\b|unit tests?|integration tests?|test automation|pytest|jest/i] },
  { category: "Quality", skill: "Observability", patterns: [/observability|monitoring|logging|metrics|prometheus|grafana|datadog/i] },
];

const THEME_PATTERNS: Array<{ theme: string; patterns: RegExp[] }> = [
  { theme: "Backend / APIs", patterns: [/backend|api|microservice|distributed|server.side/i] },
  { theme: "AI / ML", patterns: [/machine learning|\bml\b|ai|llm|genai|model|pytorch|tensorflow/i] },
  { theme: "Cloud / Platform", patterns: [/aws|azure|gcp|cloud|kubernetes|docker|terraform|platform/i] },
  { theme: "Data / Analytics", patterns: [/data pipeline|analytics|sql|spark|etl|warehouse|database/i] },
  { theme: "Frontend / Product", patterns: [/frontend|front.end|react|angular|ui|user experience|product/i] },
  { theme: "Quality / Reliability", patterns: [/testing|reliability|observability|monitoring|scalability|performance/i] },
];

function jobText(job: Job, descriptionsByUrl: Record<string, string>): string {
  return [
    job.title,
    job.company,
    job.level,
    job.search_term,
    descriptionsByUrl[job.job_url],
    job.summary,
  ].filter(Boolean).join("\n");
}

function countBy<T extends string>(values: T[]): Array<{ value: T; count: number }> {
  const counts = new Map<T, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

function inResume(skill: SkillPattern, resumeText: string): boolean {
  return Boolean(resumeText) && skill.patterns.some((pattern) => pattern.test(resumeText));
}

export function analyzeSelectedJobs(
  jobs: Job[],
  descriptionsByUrl: Record<string, string>,
  resumeText: string,
): SelectedJobAnalysis {
  const selectedCount = jobs.length;
  const fullDescriptionCount = jobs.filter((job) => descriptionsByUrl[job.job_url]).length;
  const texts = jobs.map((job) => jobText(job, descriptionsByUrl));
  const hasResume = resumeText.trim().length > 50;

  const topSkills = SKILL_PATTERNS
    .map((skill) => {
      const jobCount = texts.filter((text) => skill.patterns.some((pattern) => pattern.test(text))).length;
      return {
        skill: skill.skill,
        category: skill.category,
        jobCount,
        percent: selectedCount ? Math.round((jobCount / selectedCount) * 100) : 0,
        inResume: inResume(skill, resumeText),
      };
    })
    .filter((hit) => hit.jobCount > 0)
    .sort((a, b) => b.jobCount - a.jobCount || a.skill.localeCompare(b.skill));

  const themes = THEME_PATTERNS
    .map((theme) => {
      const count = texts.filter((text) => theme.patterns.some((pattern) => pattern.test(text))).length;
      return { theme: theme.theme, count, percent: selectedCount ? Math.round((count / selectedCount) * 100) : 0 };
    })
    .filter((theme) => theme.count > 0)
    .sort((a, b) => b.count - a.count);

  const avgCareerOps = selectedCount
    ? Math.round(jobs.reduce((sum, job) => sum + careerOpsRating(job).score, 0) / selectedCount)
    : 0;
  const missingSkills = topSkills.filter((skill) => !skill.inResume).slice(0, 10);
  const coveredSkills = topSkills.filter((skill) => skill.inResume).slice(0, 10);
  const strongestTheme = themes[0]?.theme || "Selected jobs";
  const strongestMissing = missingSkills.slice(0, 4).map((skill) => skill.skill);
  const actionBullets = [
    `${strongestTheme} is the dominant cluster across this selection.`,
    fullDescriptionCount === selectedCount
      ? "All selected jobs used full descriptions."
      : `${fullDescriptionCount}/${selectedCount} selected jobs had exported full descriptions; the rest used captured summaries.`,
    strongestMissing.length
      ? `Resume gap to patch first: ${strongestMissing.join(", ")}.`
      : hasResume
        ? "Your saved resume covers the top repeated skills in this selection."
        : "Paste/save your resume in Settings to unlock gap analysis.",
    avgCareerOps >= 70
      ? "This is a strong batch — apply first, then tailor bullets."
      : avgCareerOps >= 45
        ? "This is a mixed batch — prioritize jobs with overlapping skill clusters."
        : "This is a low-signal batch — use the gaps before spending application time.",
  ];

  return {
    selectedCount,
    fullDescriptionCount,
    avgCareerOps,
    topBoards: countBy(jobs.map((job) => jobBoardLabel(job.site, job.job_url))).slice(0, 5)
      .map(({ value, count }) => ({ board: value, count })),
    topCompanies: countBy(jobs.map((job) => job.company || "Unknown")).slice(0, 5)
      .map(({ value, count }) => ({ company: value, count })),
    topSkills: topSkills.slice(0, 14),
    missingSkills,
    coveredSkills,
    themes,
    actionBullets,
    hasResume,
  };
}
