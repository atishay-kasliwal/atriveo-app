/**
 * Dynamic resume tailoring (truthful-but-aggressive, fully dynamic, one page).
 *
 * Unlike the template-reword approach, this:
 *   1. Shows the model the FULL 45-bullet tagged bank + the JD.
 *   2. Model runs an eligibility screen (sponsorship / work-auth).
 *   3. Model SELECTS which roles + projects + bullets best fit the JD, in
 *      reverse-chronological order, and rewrites each selected bullet hard for
 *      the JD's keywords — but only using skills the candidate truly has.
 *   4. Server validates claims against the safe-claim allowlist (drops
 *      fabrications), strips banned phrases, and assembles a fresh one-page .tex.
 *
 * Node built-ins only.
 */
import { bankToPrompt, loadBannedPhrases } from "./tailor-bank.mjs";

// Canonical role/project metadata (title, location, stack, dates). The bullet
// bank has dates in headers; titles/locations live here (from QUESTION_ANSWERS +
// the engine template). SBU title is ALWAYS "Software Engineer" (never Research).
export const ROLE_META = {
  "Stony Brook University": { title: "Software Engineer", loc: "Stony Brook, NY", dates: "November 2024 -- May 2026", order: 5 },
  "Wake Forest – CAIR":     { title: "Software Engineer", loc: "Winston-Salem, NC", dates: "May 2025 -- August 2025", order: 3 },
  "Accolite Digital":       { title: "Senior Software Engineer", loc: "Hyderabad, TG", dates: "August 2021 -- August 2024", order: 2 },
  "Shriffle":               { title: "Software Engineer - Intern", loc: "Remote", dates: "January 2021 -- July 2021", order: 1 },
};
export const PROJECT_META = {
  "Atriveo":                         { dates: "September 2025 -- Present", order: 6 },
  "Insurance Microservices Platform":{ dates: "June 2025 -- August 2025", order: 5 },
  "InsureRaft":                      { dates: "2025", order: 4 },
  "Bayesian Marketing Mix Model":    { dates: "March 2025 -- May 2025", order: 3 },
  "Advanced Radiomics Research Pipeline": { dates: "2025", order: 2 },
  "Encryption and Decryption Application": { dates: "2024", order: 1 },
};

export const SYSTEM_PROMPT = `You are an elite technical recruiter and resume strategist. Goal: build the resume MOST LIKELY TO LAND AN INTERVIEW for this exact job. Output ONE valid JSON object only — no markdown, no prose.

STRATEGY (SELECT-FIRST — the bank bullets are already excellent, do NOT degrade them):
- The bank bullets are pre-written, expert-rated 9+/10. Your PRIMARY job is SELECTION: pick the bullets from the bank that best match THIS JD. You do NOT have to use every role.
- PRESERVE every concrete detail in the bullet you pick: named clients (e.g. "for Fidelity", "for BT Telecom"), every tool (e.g. "Spring Cloud"), and EVERY metric (some bullets carry two — keep both). Never drop a detail to make a bullet shorter.
- TUNE, do not rewrite: only adjust wording lightly so the bullet mirrors the JD's exact keywords for tools the candidate already used. If a bullet already fits, copy it verbatim. Re-write substantially ONLY when a bullet is weak for this JD.
- Order experience reverse-chronologically (most recent first).
- Front-load impact (metric/scale in first 8-12 words). Strong verbs: Built, Engineered, Architected, Automated, Optimized, Scaled, Shipped, Reduced, Owned, Deployed.

TRUTH (non-negotiable — this is what survives the interview):
- Only claim tools/skills the candidate actually has (they are in the bank's bullets and tags). NEVER invent a tool, metric, or experience.
- You may re-emphasize and re-word real experience aggressively, but not fabricate.
- If the JD wants something the candidate lacks, leave it out — do not claim it.

STYLE (humanize — must not read AI-generated):
- No semicolons, no em-dashes, no "leveraged"/"spearheaded"/"utilized"/"cutting-edge"/"showcase"/"foster"/"seamless"/"robust".
- Active voice, real verbs, no passive fragments. Vary bullet structure and length.
- No rule-of-three padding ("X, Y, and Z" stacking). No synonym-cycling. One bullet = one concrete win with a number or named tool.

QUALITY BAR (this is why a resume gets the interview — enforce all):
- STRONG OPENER: the FIRST bullet of the first role (Stony Brook) must carry the single strongest metric AND a clear architecture/system-design signal AND the tightest match to this JD's domain. It alone should earn a callback.
- METRIC CREDIBILITY: NEVER invent, round, or inflate a number. Use ONLY numbers that already appear in the candidate's bank bullet you are rewriting. Prefer before→after with context ("from 11 min to 90s") over bare percentages. Do not stack round numbers (90%, 40%, 99.9%) back to back.
- DEPTH, NOT LISTING: every bullet must show HOW something was built or WHY it mattered — architecture, a tradeoff, or a concrete outcome. Never "Built X with Python, Kafka, Redis" as a tool dump. Each tool named must be shown in use.
- BULLET UNIQUENESS: within a section, every bullet must carry a DIFFERENT signal — pick across {architecture/system design, scale/throughput, ownership/initiative, reliability/uptime, latency/performance, user or business impact, automation}. No two bullets telling the same story.
- CADENCE VARIATION: do not start consecutive bullets with the same verb or the same structure. Mix bullet lengths. It must read like a human engineer wrote it.
- KEYWORD CEILING: do not repeat any single keyword more than 3 times across the whole resume. Use semantic variants (distributed systems / event-driven / async; LLM pipelines / agentic workflows / retrieval).
- SENIOR FRAMING: bullets read as owning a system, not completing a task. Ban "implemented a feature", "assisted with", "worked on".

ELIGIBILITY: read the JD for work-authorization / sponsorship / security-clearance / citizenship bars. If it HARD-blocks an international candidate needing future sponsorship, set "eligible": false and "no_go_reason"; otherwise "eligible": true.

EXPERIENCE STRUCTURE (FIXED — do not deviate):
- Stony Brook University (role_id 0): ALWAYS include, exactly 4 bullets.
- Accolite Digital (role_id 3): ALWAYS include, exactly 4 bullets.
- THIRD role: choose Wake Forest (role_id 1) OR Shriffle (role_id 2) — whichever fits the JD better — with exactly 2 bullets. Pick exactly ONE of them, never both, never neither.
- So "experience" has EXACTLY 3 entries: role_id 0, role_id 3, and ONE of (1 or 2).

PROJECTS: choose the 2 projects that best fit the JD, 2 bullets each.
HEADER: mirror the JD's role title.
SKILLS: exactly 5 lines (category + comma list), ONLY skills the candidate has, prioritized by JD relevance.

Reference each selected bullet by its id (e.g. "R0.2", "P0.1") AND provide the rewritten text.

Return ONLY:
{
  "eligible": <bool>,
  "no_go_reason": "<string or empty>",
  "header_title": "<role title mirroring the JD>",
  "ats_before": <int 0-100>, "ats_after": <int 0-100>,
  "experience": [ { "role_id": <int index into roles>, "bullets": [ { "id": "R<r>.<b>", "text": "<rewritten>" } ] } ],
  "projects": [ { "project_id": <int index into projects>, "bullets": [ { "id": "P<p>.<b>", "text": "<rewritten>" } ] } ],
  "skills": [ "Languages: ...", "Backend: ...", "Frontend: ...", "Data and AI: ...", "Cloud and Delivery: ..." ],
  "selection_reason": "<1 sentence: why these roles/bullets fit this JD>",
  "notes": "<1 sentence: biggest gap not claimable>"
}`;

export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    eligible: { type: "boolean" },
    no_go_reason: { type: "string" },
    header_title: { type: "string" },
    ats_before: { type: "integer" },
    ats_after: { type: "integer" },
    experience: {
      type: "array", maxItems: 3,
      items: {
        type: "object",
        properties: {
          role_id: { type: "integer" },
          bullets: {
            type: "array", maxItems: 4,
            items: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["id", "text"] },
          },
        },
        required: ["role_id", "bullets"],
      },
    },
    projects: {
      type: "array", maxItems: 3,
      items: {
        type: "object",
        properties: {
          project_id: { type: "integer" },
          bullets: {
            type: "array", maxItems: 2,
            items: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["id", "text"] },
          },
        },
        required: ["project_id", "bullets"],
      },
    },
    skills: { type: "array", maxItems: 5, items: { type: "string" } },
    selection_reason: { type: "string" },
    notes: { type: "string" },
  },
  required: ["eligible", "header_title", "ats_before", "ats_after", "experience", "projects", "skills"],
};

export function buildUserMessage(bank, jd) {
  return `JOB DESCRIPTION:\n${jd.trim()}\n\n=== CANDIDATE BULLET BANK (select & rewrite from these only) ===\n${bankToPrompt(bank)}`;
}

// ─── Self-critique pass (rule 8 / 43: every bullet must be 9+/10) ─────────────
// Second model call. Takes the drafted bullets + the JD, scores each 1-10
// against the quality bar, and rewrites any bullet under 9. Truth rules still
// apply: it may only re-word real bullets, never add new numbers.
export const CRITIQUE_SYSTEM = `You are a brutal senior hiring manager reviewing a resume draft for THIS job. Output ONE valid JSON object only — no markdown, no prose.

For each bullet you are given, score it 1-10 on this bar:
- Carries a concrete metric or named scale (the strongest bullets carry TWO metrics — reward that).
- Names the client/system where real (e.g. "for Fidelity") and shows architecture or a real outcome — not a tool dump.
- Reads as OWNING a system, not completing a task.
- Distinct signal from the other bullets in its section.
- Natural human cadence, varied structure, no AI-vocabulary, no semicolons/em-dashes, no hyphenated compounds.

RULES for any rewrite:
- Rewrite ONLY bullets scoring below 9. Leave 9-10 bullets unchanged (return them as-is).
- NEVER add, change, round, or inflate a number that is not already in the original bullet text.
- When rewriting, ADD BACK detail, do not strip it: keep every client name, every tool, and every metric already present. A bullet should get RICHER, never thinner.
- Keep every JD keyword and tool that was already present. Do not weaken ATS signal.
- Keep it one line, impact-forward, truthful.

Return ONLY:
{
  "bullets": [ { "id": "<same id>", "score": <int 1-10>, "text": "<final bullet — rewritten if it was <9, else unchanged>" } ]
}`;

export const CRITIQUE_SCHEMA = {
  type: "object",
  properties: {
    bullets: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, score: { type: "integer" }, text: { type: "string" } },
        required: ["id", "score", "text"],
      },
    },
  },
  required: ["bullets"],
};

// Flatten the drafted AI plan into an id->text list for the critique pass.
export function collectDraftBullets(ai) {
  const out = [];
  for (const exp of ai.experience || []) for (const b of exp.bullets || []) out.push({ id: b.id, text: b.text });
  for (const proj of ai.projects || []) for (const b of proj.bullets || []) out.push({ id: b.id, text: b.text });
  return out;
}

export function buildCritiqueMessage(jd, draftBullets) {
  const lines = draftBullets.map((b) => `${b.id}: ${b.text}`).join("\n");
  return `JOB DESCRIPTION (score relevance against this):\n${jd.trim()}\n\n=== DRAFTED BULLETS (score each, rewrite any below 9) ===\n${lines}`;
}

// Merge critique results back into the AI plan by id, and record scores.
export function applyCritique(ai, critique) {
  const byId = new Map((critique.bullets || []).map((b) => [b.id, b]));
  const apply = (b) => {
    const c = byId.get(b.id);
    if (c) { b.text = c.text; b.score = c.score; }
    return b;
  };
  for (const exp of ai.experience || []) exp.bullets = (exp.bullets || []).map(apply);
  for (const proj of ai.projects || []) proj.bullets = (proj.bullets || []).map(apply);
  return ai;
}

// ─── Truth guard: strip skills not backed by the safe-claim allowlist ────────
// Applied to the skills lines. A skill token survives only if some allowlist
// entry matches it (case-insensitive, ignoring punctuation/spacing).
export function filterSkillsLine(line, safeClaims) {
  const colon = line.indexOf(":");
  if (colon === -1) return { line, dropped: [] };
  const label = line.slice(0, colon);
  // Flatten parenthetical sub-lists into flat comma items so we never split
  // "AWS (Lambda, EC2)" into "AWS (Lambda" + "EC2)" and orphan a paren.
  const flat = line.slice(colon + 1).replace(/[()]/g, ",");
  const items = flat.split(",").map((s) => s.trim()).filter(Boolean);
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9+#.]/g, "");
  const safeNorm = new Set([...safeClaims].map(norm));
  const kept = [], dropped = [];
  for (const it of items) {
    const n = norm(it);
    if (!n) continue;
    // keep if exact, or any safe term is a token of it / it is a token of a safe term
    const ok = safeNorm.has(n) || [...safeNorm].some((s) => s.length > 2 && (n.includes(s) || s.includes(n)));
    (ok ? kept : dropped).push(it);
  }
  // De-dupe (flattening "AWS (Lambda)" can surface "AWS" twice) preserving order.
  const seen = new Set();
  const finalKept = kept.filter((k) => { const n = norm(k); if (seen.has(n)) return false; seen.add(n); return true; });
  return { line: finalKept.length ? `${label}: ${finalKept.join(", ")}` : "", dropped };
}

const BANNED = loadBannedPhrases();
export function stripBanned(text) {
  let t = text;
  for (const p of BANNED) {
    t = t.replace(new RegExp(`\\b${p.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "gi"), "");
  }
  return t.replace(/\s{2,}/g, " ").replace(/\s+([.,])/g, "$1").trim();
}

// LaTeX-escape (shared shape with the server's escapeTex).
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

// Derive a short heading stack (Title | Tool, Tool, Tool) from the tools that
// actually appear in the SELECTED bullets — so every heading tool is supported.
function headingStack(selectedBullets, bankBullets) {
  const tools = new Map();
  selectedBullets.forEach((sb) => {
    const src = bankBullets[Number(sb.id.split(".")[1])];
    if (src) src.tech.forEach((t) => tools.set(t, (tools.get(t) || 0) + 1));
  });
  const pretty = { py: "Python", java: "Java", ts: "TypeScript", js: "JavaScript", react: "React", spring: "Spring Boot", fastapi: "FastAPI", kafka: "Kafka", aws: "AWS", gcp: "GCP", llm: "LLMs", rag: "RAG", mcp: "MCP", docker: "Docker", redis: "Redis", pg: "PostgreSQL", dynamo: "DynamoDB", es: "Elasticsearch", graphql: "GraphQL", pytorch: "PyTorch", terraform: "Terraform", lambda: "Lambda", langchain: "LangChain", langgraph: "LangGraph", firebase: "Firebase", prometheus: "Prometheus", "ci-cd": "CI/CD", cpp: "C++", pymc: "PyMC", tableau: "Tableau" };
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  return [...tools.keys()].slice(0, 4).map((t) => pretty[t] || cap(t));
}

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

// Assemble a complete one-page resume from the model's selections.
export function assembleResume(ai, bank) {
  const title = stripBanned(ai.header_title || "Software Engineer");
  const header = `\\begin{center}
    \\textbf{\\Huge \\scshape Atishay Kasliwal} \\\\ \\vspace{1pt}
    \\small ${esc(title)} $|$ 934-246-1198 $|$ \\href{mailto:katishay@gmail.com}{katishay@gmail.com} $|$
    \\href{https://www.linkedin.com/in/atishay-kasliwal}{Linkedin} $|$
    \\href{https://github.com/atishay-kasliwal}{Github} $|$
    \\href{https://atishaykasliwal.com}{Portfolio} $|$ New York, NY
\\end{center}`;

  // Enforce the FIXED experience structure regardless of what the model returned:
  // SBU (0) + Accolite (3) are always present; the 3rd slot is Wake (1) OR
  // Shriffle (2). role indexes: 0=SBU, 1=Wake, 2=Shriffle, 3=Accolite.
  const byId = new Map((ai.experience || []).filter((e) => bank.roles[e.role_id]).map((e) => [e.role_id, e]));
  const fallbackBullets = (roleIdx, n) =>
    bank.roles[roleIdx].bullets.filter((b) => !b.weak).slice(0, n).map((b, i) => ({ id: `R${roleIdx}.${i}`, text: b.text }));
  const pick = (idx, n) => {
    const e = byId.get(idx);
    return { role_id: idx, bullets: (e?.bullets?.length ? e.bullets : fallbackBullets(idx, n)).slice(0, n) };
  };
  // third role: whichever of Wake(1)/Shriffle(2) the model chose; default Wake.
  const third = byId.has(1) ? 1 : byId.has(2) ? 2 : 1;
  const enforced = [pick(0, 4), pick(3, 4), pick(third, 2)];

  // Experience — reverse-chron by ROLE_META.order
  const expSel = enforced
    .map((e) => ({ ...e, group: bank.roles[e.role_id] }))
    .filter((e) => e.group)
    .sort((a, b) => (ROLE_META[b.group.name]?.order ?? 0) - (ROLE_META[a.group.name]?.order ?? 0));

  const expBlocks = expSel.map((e) => {
    const meta = ROLE_META[e.group.name] || { title: "Software Engineer", loc: "", dates: "" };
    const stack = headingStack(e.bullets, e.group.bullets);
    // Escape title + each tool separately; the $|$ separator is literal LaTeX.
    const titleLine = `${esc(meta.title)}${stack.length ? " $|$ " + stack.map(esc).join(", ") : ""}`;
    const items = e.bullets.map((b) => `        \\resumeItem{${esc(stripBanned(b.text))}}`).join("\n");
    return `    \\resumeSubheading{${esc(e.group.name)}}{${meta.dates}}{${titleLine}}{${esc(meta.loc)}}\n      \\resumeItemListStart\n${items}\n      \\resumeItemListEnd`;
  }).join("\n\n");

  // Projects — reverse-chron by PROJECT_META.order
  const projSel = (ai.projects || [])
    .map((p) => ({ ...p, group: bank.projects[p.project_id] }))
    .filter((p) => p.group)
    .sort((a, b) => (PROJECT_META[b.group.name]?.order ?? 0) - (PROJECT_META[a.group.name]?.order ?? 0));

  const projBlocks = projSel.map((p) => {
    const meta = PROJECT_META[p.group.name] || { dates: "" };
    const stack = headingStack(p.bullets, p.group.bullets);
    const items = p.bullets.map((b) => `      \\resumeItem{${esc(stripBanned(b.text))}}`).join("\n");
    return `    \\resumeProjectHeading{\\textbf{${esc(p.group.name)}}${stack.length ? " $|$ \\emph{" + esc(stack.join(", ")) + "}" : ""}}{${meta.dates}}\n    \\resumeItemListStart\n${items}\n    \\resumeItemListEnd`;
  }).join("\n\n");

  const skills = (ai.skills || []).filter(Boolean)
    .map((s) => `     \\textbf{${esc(s.split(":")[0])}}{: ${esc(s.split(":").slice(1).join(":").trim())}} \\\\`).join("\n");

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
${skills}
    }}
 \\end{itemize}

\\end{document}`;
}
