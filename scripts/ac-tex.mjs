// Deterministic LaTeX assembly from AC compose() output — no Ollama rewrite.

import {
  ROLE_META,
  PROJECT_META,
  stripBanned,
} from "./tailor-dynamic.mjs";
import { buildSkillsFromComposition } from "./ac-skills.mjs";
import { SKILLS_MAX_CATEGORIES } from "./skills-library.mjs";

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

const ROLE_SLUG_TO_NAME = {
  "stony-brook": "Stony Brook University",
  "wake-forest": "Wake Forest – CAIR",
  shriffle: "Shriffle",
  accolite: "Accolite Digital",
};

const PROJECT_SLUG_TO_NAME = {
  atriveo: "Atriveo",
  "insurance-platform": "Insurance Microservices Platform",
  insureraft: "InsureRaft",
  "job-pipeline": "Atriveo Job Intelligence Pipeline",
  "bayesian-mmm": "Bayesian Marketing Mix Model",
  "mri-research": "Advanced Radiomics Research Pipeline",
  medledger: "MedLedger",
  "user-data-platform": "User Data Platform",
  "radiomics-pipeline": "Advanced Radiomics Research Pipeline",
  "cpp-encryption": "Encryption and Decryption Application",
  "fomc-dashboard": "FOMC Intelligence Dashboard",
};

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

export function deriveHeaderTitle(jd, composition) {
  if (composition?.narrative?.header_title) return composition.narrative.header_title;
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
      const meta = ROLE_META[name] || { title: "Software Engineer", loc: "", dates: "", order: 0 };
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

  const projBlocks = (composition.projects || [])
    .filter((project) => (project.bullets || []).length > 0)
    .map((project) => {
      const name = PROJECT_SLUG_TO_NAME[project.role] || project.role;
      const meta = PROJECT_META[name] || { dates: "", order: 0 };
      const bullets = (project.bullets || []).map((b) => ({ text: bulletText(b) }));
      const stack = toolsFromBullets(bullets, project.role);
      const items = bullets.map((b) => `      \\resumeItem{${esc(b.text)}}`).join("\n");
      return {
        order: meta.order || 0,
        tex: `    \\resumeProjectHeading{\\textbf{${esc(name)}}${stack.length ? " $|$ \\emph{" + esc(stack.join(", ")) + "}" : ""}}{${meta.dates}}\n    \\resumeItemListStart\n${items}\n    \\resumeItemListEnd`,
      };
    })
    .sort((a, b) => b.order - a.order)
    .map((b) => b.tex)
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
  const title = headerTitle || deriveHeaderTitle(jd, compact);
  const tex = assembleAcResume(compact, { headerTitle: title, skillsLines: skills, bank });
  return { compact, skills, headerTitle: title, tex };
}
