// Deterministic LaTeX assembly from AC compose() output — no Ollama rewrite.

import {
  ROLE_META,
  PROJECT_META,
  stripBanned,
} from "./tailor-dynamic.mjs";
import {
  ROLE_SLUG_TO_NAME,
  PROJECT_SLUG_TO_NAME,
  resolveExperienceMeta,
  resolveProjectMeta,
  projectRecencyMs,
  sortProjectsByRecency,
} from "./ac-role-meta.mjs";
import { buildSkillsFromComposition } from "./ac-skills.mjs";
import { SKILLS_MAX_CATEGORIES } from "./skills-library.mjs";
import { resolveBankDir } from "./ac-bank.mjs";

const PREAMBLE = `\\documentclass[letterpaper,11pt]{article}
\\usepackage{latexsym}\\usepackage[empty]{fullpage}\\usepackage{titlesec}
\\usepackage[usenames,dvipsnames]{color}\\usepackage{verbatim}\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}\\usepackage{fancyhdr}\\usepackage[english]{babel}\\usepackage{tabularx}
\\pagestyle{fancy}\\fancyhf{}\\fancyfoot{}\\renewcommand{\\headrulewidth}{0pt}\\renewcommand{\\footrulewidth}{0pt}
\\addtolength{\\oddsidemargin}{-0.5in}\\addtolength{\\evensidemargin}{-0.5in}\\addtolength{\\textwidth}{1in}
\\addtolength{\\topmargin}{-.5in}\\addtolength{\\textheight}{1.0in}
\\urlstyle{same}\\raggedbottom\\raggedright\\setlength{\\tabcolsep}{0in}
\\titleformat{\\section}{\\vspace{-1pt}\\raggedright\\large}{}{0em}{}[\\color{black}\\titlerule \\vspace{2pt}]
\\titlespacing*{\\section}{0pt}{2pt}{2pt}
\\newcommand{\\resumeItem}[1]{\\item\\small{{#1 \\vspace{-2pt}}}}
\\newcommand{\\resumeSubheading}[4]{\\vspace{-2pt}\\item\\begin{tabular*}{0.97\\textwidth}[t]{l@{\\extracolsep{\\fill}}r}\\textbf{#1} & #2 \\\\ \\textit{\\small#3} & \\textit{\\small #4} \\\\ \\end{tabular*}\\vspace{-7pt}}
\\newcommand{\\resumeProjectHeading}[2]{\\item\\begin{tabular*}{0.97\\textwidth}{l@{\\extracolsep{\\fill}}r}\\small#1 & #2 \\\\ \\end{tabular*}\\vspace{-7pt}}
\\renewcommand\\labelitemii{$\\vcenter{\\hbox{\\tiny$\\bullet$}}$}
\\newcommand{\\resumeSubHeadingListStart}{\\begin{itemize}[leftmargin=0.15in, label={}]}
\\newcommand{\\resumeSubHeadingListEnd}{\\end{itemize}}
\\newcommand{\\resumeItemListStart}{\\begin{itemize}}
\\newcommand{\\resumeItemListEnd}{\\end{itemize}\\vspace{-5pt}}`;

const EDUCATION = `\\section{Education}
  \\resumeSubHeadingListStart
    \\resumeSubheading{Stony Brook University}{Stony Brook, New York}{Master of Science in Data Science}{Aug. 2024 -- May 2026}
    \\resumeSubheading{Symbiosis University of Applied Sciences}{Indore, Madhya Pradesh}{Bachelor of Technology in Computer Science and Information Technology}{Aug. 2018 -- May 2022}
  \\resumeSubHeadingListEnd`;

const ROLE_STACK_DEFAULTS = {
  "wake-forest": ["Python", "GCP", "SimpleITK", "React", "TypeScript", "Apache Airflow"],
  atriveo: ["React", "TypeScript", "FastAPI", "LangChain", "Cloudflare"],
  "insurance-platform": ["Java", "Spring Boot", "Kafka", "Elasticsearch", "Docker"],
  insureraft: ["C++", "Raft", "NuRaft", "CMake"],
  "job-pipeline": ["Python", "MongoDB", "JobSpy", "pandas"],
  "bayesian-mmm": ["Python", "scikit-learn", "pandas", "Tableau"],
  "mri-research": ["Python", "scikit-learn", "XGBoost", "lifelines", "SHAP"],
  medledger: ["Node.js", "Express.js", "MongoDB", "JWT", "EJS"],
  "user-data-platform": ["FastAPI", "Python", "X25519", "AES-GCM", "MCP"],
  accolite: ["Java", "Spring Boot", "Python", "React", "Angular", "AWS", "Azure", "GCP", "MySQL", "MongoDB"],
  shriffle: ["Python", "JavaScript"],
};

const TOOL_PATTERNS = [
  ["FastAPI", /fastapi/i],
  ["Python", /\bpython\b/i],
  ["Java", /\bjava\b/i],
  ["Spring Boot", /spring/i],
  ["Kafka", /kafka/i],
  ["AWS", /\baws\b/i],
  ["Healthcare Data", /healthcare|clinical|physician|clinician/i],
  ["ETL", /\betl\b|preprocessing|ingestion/i],
  ["GCP", /\bgcp\b|google cloud/i],
  ["SimpleITK", /simpleitk/i],
  ["Radiomics", /radiomic|pyradiomic/i],
  ["MRI", /\bmri\b|brain scan|segmentation/i],
  ["LLMs", /\bllm/i],
  ["RAG", /\brag\b/i],
  ["LangChain", /langchain/i],
  ["LangGraph", /langgraph/i],
  ["Docker", /docker/i],
  ["PostgreSQL", /postgres/i],
  ["Redis", /redis/i],
  ["React", /react/i],
  ["PyTorch", /pytorch/i],
  ["Cloudflare", /cloudflare/i],
];

function esc(s) {
  return String(s)
    .replace(/^\s*[•·▪\-*]\s+/, "")
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/→/g, "$\\to$").replace(/×/g, "$\\times$")
    .replace(/[—–]/g, "-");
}

function toolsFromBullets(bullets, roleSlug) {
  const text = bullets.map((b) => b.text || "").join(" ");
  const out = [];
  for (const [name, re] of TOOL_PATTERNS) {
    if (re.test(text)) out.push(name);
  }
  for (const d of (ROLE_STACK_DEFAULTS[roleSlug] || [])) {
    if (!out.includes(d)) out.push(d);
  }
  return [...new Set(out)].slice(0, 5);
}

function bulletText(bullet) {
  return stripBanned(bullet.text || bullet.face?.text || "");
}

// Closed set only — never the JD's raw/verbatim job title. A JD titled
// "Software Development Engineer, AWS Agentic AI" must map to one of these,
// not be copied onto the resume as-is.
const VALID_HEADER_TITLES = new Set([
  "Software Engineer",
  "Backend Engineer",
  "Full Stack Engineer",
  "AI Engineer",
  "Machine Learning Engineer",
  "Data Engineer",
  "Research Scientist",
]);

// Map a specific/long job title to the closest canonical archetype using the
// title's OWN words (not the JD body). Ordered most-specific first.
function canonicalFromTitle(rawTitle) {
  const t = String(rawTitle || "").toLowerCase();
  if (!t) return null;
  if (/research scientist|applied scientist|research engineer/.test(t)) return "Research Scientist";
  if (/machine learning|\bml\b|deep learning|ml engineer/.test(t)) return "Machine Learning Engineer";
  if (/\bai\b|agentic|\bllm\b|generative|genai/.test(t)) return "AI Engineer";
  if (/data engineer|data platform|etl|analytics engineer/.test(t)) return "Data Engineer";
  if (/full.?stack|fullstack/.test(t)) return "Full Stack Engineer";
  if (/back.?end|backend|platform engineer|infrastructure|distributed systems/.test(t)) return "Backend Engineer";
  if (/front.?end|frontend|\bui\b/.test(t)) return "Full Stack Engineer";
  // Recognizable "…Engineer" / "…Developer" titles that don't match an archetype
  // still deserve a sane default rather than a JD-body guess.
  if (/engineer|developer|swe/.test(t)) return "Software Engineer";
  return null;
}

// Count meaningful words in a title (ignores separators/parentheticals).
function titleWordCount(rawTitle) {
  return String(rawTitle || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

// Titles of 3 words or fewer are already clean and specific — keep them
// verbatim. Longer/specific titles get mapped to a canonical archetype so we
// never mislabel e.g. "Forward Deployment Engineer" as "Full Stack".
function cleanShortTitle(rawTitle) {
  return String(rawTitle || "")
    .replace(/\([^)]*\)/g, "")     // drop parentheticals
    .replace(/[,–—|].*$/, "")      // drop ", Backend" / "| Team" tails
    .replace(/\s+/g, " ")
    .trim();
}

export function deriveHeaderTitle(jd, composition, rawTitle) {
  // 1) Title-first: use the actual job title before any JD-body guessing.
  if (rawTitle) {
    const wc = titleWordCount(rawTitle);
    if (wc > 0 && wc <= 3) {
      const kept = cleanShortTitle(rawTitle);
      if (kept) return kept;               // ≤3 words → keep verbatim
    }
    const mapped = canonicalFromTitle(rawTitle);
    if (mapped) return mapped;             // >3 words → map from the title itself
  }

  // 2) Fall back to the narrative / JD-signal heuristic (legacy behavior).
  const narrativeTitle = composition?.narrative?.header_title;
  if (narrativeTitle && VALID_HEADER_TITLES.has(narrativeTitle)) return narrativeTitle;
  const hay = String(jd || "").toLowerCase();
  if (/research scientist|applied scientist/.test(hay)) return "Research Scientist";
  if (/machine learning engineer|ml engineer/.test(hay)) return "Machine Learning Engineer";
  if (/\bai engineer|llm|agentic|generative ai/.test(hay)) return "AI Engineer";
  if (/data engineer/.test(hay)) return "Data Engineer";
  if (/full.?stack|fullstack/.test(hay)) return "Full Stack Engineer";
  if (/backend/.test(hay)) return "Backend Engineer";
  if (composition.theme === "ai-llm") return "AI Engineer";
  if (composition.theme === "data-engineering") return "Data Engineer";
  return "Software Engineer";
}

export function assembleAcResume(composition, { headerTitle, skillsLines, bank } = {}) {
  const bankDir = bank?.bank_dir || resolveBankDir();
  const title = stripBanned(headerTitle || "Software Engineer");
  const header = `\\begin{center}
    \\textbf{\\Huge \\scshape Atishay Kasliwal} \\\\ \\vspace{1pt}
    \\small ${esc(title)} $|$ 934-246-1198 $|$ \\href{mailto:katishay@gmail.com}{katishay@gmail.com} $|$
    \\href{https://www.linkedin.com/in/atishay-kasliwal}{Linkedin} $|$
    \\href{https://github.com/atishay-kasliwal}{Github} $|$
    \\href{https://atishaykasliwal.com}{Portfolio} $|$ New York, NY
\\end{center}`;

  const skills = skillsLines?.length
    ? skillsLines
    : (composition.skills || []);

  const expBlocks = (composition.experience || [])
    .filter((role) => (role.bullets || []).length > 0)
    .map((role) => {
      const name = ROLE_SLUG_TO_NAME[role.role] || role.role;
      const meta = resolveExperienceMeta(role.role, bankDir);
      const bullets = (role.bullets || []).map((b) => ({
        text: bulletText(b),
        ac_id: b.ac_id,
      }));
      const stack = toolsFromBullets(bullets, role.role);
      const titleLine = `${esc(meta.title)}${stack.length ? " $|$ " + stack.map(esc).join(", ") : ""}`;
      const items = bullets.map((b) => `        \\resumeItem{${esc(b.text)}}`).join("\n");
      return {
        order: meta.order || 0,
        tex: `    \\resumeSubheading{${esc(name)}}{${meta.dates}}{${titleLine}}{${esc(meta.loc)}}\n      \\resumeItemListStart\n${items}\n      \\resumeItemListEnd`,
      };
    })
    .sort((a, b) => b.order - a.order)
    .map((b) => b.tex)
    .join("\n\n");

  const projBlocks = sortProjectsByRecency(
    (composition.projects || []).filter((project) => (project.bullets || []).length > 0),
    bankDir,
  )
    .map((project) => {
      const name = PROJECT_SLUG_TO_NAME[project.role] || project.role;
      const meta = resolveProjectMeta(project.role, bankDir);
      const bullets = (project.bullets || []).map((b) => ({ text: bulletText(b) }));
      const stack = toolsFromBullets(bullets, project.role);
      const items = bullets.map((b) => `      \\resumeItem{${esc(b.text)}}`).join("\n");
      return `    \\resumeProjectHeading{\\textbf{${esc(name)}}${stack.length ? " $|$ \\emph{" + esc(stack.join(", ")) + "}" : ""}}{${meta.dates}}\n    \\resumeItemListStart\n${items}\n    \\resumeItemListEnd`;
    })
    .join("\n\n");

  const skillsTex = skills.filter(Boolean)
    .map((s) => `     \\textbf{${esc(s.split(":")[0])}}{: ${esc(s.split(":").slice(1).join(":").trim())}} \\\\`)
    .join("\n");

  return `${PREAMBLE}

\\begin{document}
${header}

${EDUCATION}

\\section{Experience}
  \\resumeSubHeadingListStart
${expBlocks}
  \\resumeSubHeadingListEnd

\\section{Projects}
  \\resumeSubHeadingListStart
${projBlocks}
  \\resumeSubHeadingListEnd

\\section{Technical Skills}
 \\begin{itemize}[leftmargin=0.15in, label={}]
    \\small{\\item{
${skillsTex}
    }}
 \\end{itemize}

\\end{document}`;
}

export function compactCompositionForTex(result) {
  return {
    theme: result.theme,
    plan: result.plan,
    narrative: result.narrative,
    quality: result.quality,
    skills_audit: result.skills_audit,
    skills: result.skills,
    coverage: result.coverage,
    planner_config: result.planner_config,
    selection_trace: result.selection_trace,
    experience: result.experience.map((role) => ({
      role: role.role,
      bullets: role.bullets.map(({ ac, face }) => ({
        ac_id: ac.id,
        facet: face.facet,
        text: face.text,
      })),
    })),
    projects: result.projects.map((project) => ({
      role: project.role,
      bullets: project.bullets.map(({ ac, face }) => ({
        ac_id: ac.id,
        facet: face.facet,
        text: face.text,
      })),
    })),
  };
}

export function prepareResumeArtifacts({ jd, composition, bank, headerTitle }) {
  const compact = composition.experience?.[0]?.bullets?.[0]?.ac
    ? compactCompositionForTex(composition)
    : composition;
  const skillsCfg = composition.minimum_visual_targets?.skills || {};
  const skills = composition.skills?.length
    ? composition.skills
    : buildSkillsFromComposition(compact, bank, jd, {
      maxCategories: skillsCfg.max_categories ?? SKILLS_MAX_CATEGORIES,
      useSelectedAcCorpus: skillsCfg.use_selected_ac_corpus !== false,
    });
  // headerTitle here is the RAW job title. Pass it into deriveHeaderTitle so the
  // title-first rule applies (≤3 words kept verbatim, longer mapped to canonical),
  // instead of discarding it whenever it isn't an exact canonical match.
  const title = deriveHeaderTitle(jd, compact, headerTitle);
  const tex = assembleAcResume(compact, { headerTitle: title, skillsLines: skills, bank });
  return { compact, skills, headerTitle: title, tex };
}
