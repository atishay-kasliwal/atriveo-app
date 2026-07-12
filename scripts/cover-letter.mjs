#!/usr/bin/env node
/**
 * Template-based cover letter generator — NO AI.
 *
 * Fills a fixed 3-paragraph LaTeX template with the candidate's identity and
 * two bank bullets chosen by keyword overlap with the JD. Deterministic,
 * instant, private. Compiles to PDF with tectonic in the given job folder.
 *
 * Exported: buildCoverLetter({ company, role, jd, dir, bank }, onLog) -> { ok, pdf }
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// ─── Identity (matches resume header) ────────────────────────────────────────
const NAME     = "Atishay Kasliwal";
const EMAIL    = "katishay@gmail.com";
const PHONE    = "934-246-1198";
const LINKEDIN = "https://www.linkedin.com/in/atishay-kasliwal";

// ─── LaTeX escaping (same rules as the resume path) ──────────────────────────
function escapeTex(s) {
  return String(s || "")
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/→/g, "$\\to$")
    .replace(/×/g, "$\\times$")
    .replace(/[—–]/g, "-");
}

// Strip latex commands so bank bullets read as plain prose in a paragraph.
function stripTex(text) {
  return String(text || "")
    .replace(/\\[a-zA-Z]+\{?|\}/g, " ")
    .replace(/\\[#$%&_~^]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Turn a metric-dense resume bullet into ONE clean narrative sentence.
 * Resume bullets stack 3–5 metrics; a cover letter reads better with just the
 * single strongest outcome. We keep the action + first quantified result and
 * drop the rest so the prose doesn't become a data dump.
 */
function bulletToProse(text) {
  let s = stripTex(text).replace(/[.,;:]+$/, "");

  // Trim trailing metric pileups so ONE number carries the sentence. These
  // strip the *tail* only — never mid-sentence — so we can't create fragments.
  //   "...to under 20 minutes at 67.7% signal accuracy and +27% return" → "...to under 20 minutes"
  //   "...pipeline, achieving 27% return" → "...pipeline"
  s = s.replace(/\s+(?:at|reaching|achieving|hitting|yielding|delivering)\s+[+\-]?[\d.].*$/i, "");
  s = s.replace(/,?\s+and\s+[+\-]?\d[\d.,%]*.*$/i, "");

  // If a numeric result already appears, drop any trailing "and <verb-ing> ..."
  // second outcome so we keep just the first, headline metric.
  //   "reducing P99 latency by 40% and eliminating Sev1 incidents ..." → "reducing P99 latency by 40%"
  if (/\d/.test(s)) {
    s = s.replace(/\s+and\s+\w+ing\b.*$/i, "");
    // Also drop a trailing "in/for/across <long scope phrase>" tail after a metric.
    s = s.replace(/(\d[\d.,%+xX]*)\s+(?:in|for|across|within|serving)\s+.*$/i, "$1");
  }

  // Clean up any dangling punctuation left after trimming.
  s = s.replace(/[\s,;:]+$/, "").replace(/\s+/g, " ").trim();

  // lower-case the leading verb so it flows after "I ..."
  return s.replace(/^([A-Z])(\w+)/, (_, a, b) => a.toLowerCase() + b).trim();
}

/**
 * Clean a raw job title into something that reads well mid-sentence:
 * "Software Engineer II, Backend (Merchant & Partner Lifecycle)" → "Software Engineer II"
 * Drops parentheticals and trailing team/scope after a comma.
 */
function cleanRole(role) {
  return String(role || "role")
    .replace(/\([^)]*\)/g, "")       // drop (Merchant & Partner Lifecycle)
    .replace(/[,–—-].*$/, "")        // drop ", Backend" / "– Team" tails
    .replace(/\s+/g, " ")
    .trim() || "role";
}

// ─── Keyword matching (deterministic, no AI) ─────────────────────────────────
const STOP = new Set(["the","and","for","with","you","our","are","that","this","will","have","from","your","their","all","any","who","has","was","not","but","can","may","were","they","its","into","per","via"]);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9+#. ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/** Flatten all bank bullets into a single ranked list, tagged with their source. */
function allBullets(bank) {
  const out = [];
  for (const role of bank?.roles ?? []) {
    for (const b of role.bullets ?? []) {
      if (b?.text && !b.weak) out.push({ ...b, _src: role.name ?? "role" });
    }
  }
  for (const proj of bank?.projects ?? []) {
    for (const b of proj.bullets ?? []) {
      if (b?.text && !b.weak) out.push({ ...b, _src: proj.name ?? "project" });
    }
  }
  return out;
}

/** Pick the top N bullets whose tokens overlap most with the JD. */
function pickBullets(bank, jd, n = 2) {
  const jdTokens = new Set(tokenize(jd));
  const scored = allBullets(bank).map((b) => {
    const bTokens = new Set([...tokenize(b.text), ...(b.tech ?? [])]);
    let overlap = 0;
    for (const t of bTokens) if (jdTokens.has(t)) overlap++;
    // ★-metric bullets get a small boost — they're the strongest quantified wins
    const boost = b.metric === "★" ? 1 : 0;
    return { b, score: overlap + boost };
  });
  scored.sort((a, b) => b.score - a.score);
  // Pick the top N but from DISTINCT sources so the two stories aren't the
  // same project described twice.
  const picked = [];
  const usedSrc = new Set();
  for (const { b } of scored) {
    if (usedSrc.has(b._src)) continue;
    picked.push(b);
    usedSrc.add(b._src);
    if (picked.length >= n) break;
  }
  // If we couldn't fill N from distinct sources, top up with next best regardless.
  if (picked.length < n) {
    for (const { b } of scored) {
      if (picked.includes(b)) continue;
      picked.push(b);
      if (picked.length >= n) break;
    }
  }
  return picked;
}

/** Top skills line from the highest-overlap bullets' tech tags. */
function topSkills(bullets) {
  const seen = [];
  const TECH_LABELS = {
    py: "Python", aws: "AWS", fastapi: "FastAPI", react: "React", ts: "TypeScript",
    js: "JavaScript", node: "Node.js", docker: "Docker", k8s: "Kubernetes",
    sql: "SQL", mongo: "MongoDB", ml: "machine learning", ai: "AI",
    prometheus: "Prometheus", cloudwatch: "CloudWatch", grafana: "Grafana",
    kafka: "Kafka", redis: "Redis", postgres: "PostgreSQL", gcp: "GCP",
    tf: "Terraform", go: "Go", java: "Java", spark: "Spark",
  };
  for (const b of bullets) {
    for (const t of b.tech ?? []) {
      // Fall back to Capitalizing unknown tech tags instead of leaving them lowercase
      const label = TECH_LABELS[t] ?? (t.charAt(0).toUpperCase() + t.slice(1));
      if (!seen.includes(label)) seen.push(label);
    }
  }
  return seen.slice(0, 4);
}

// ─── Template ────────────────────────────────────────────────────────────────
function joinList(items) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function buildTex({ company, role, skills, bullets }) {
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const cRole = cleanRole(role);
  // Keep the skills line short — 3 max reads cleaner than a laundry list.
  const skillsPhrase = skills.length ? joinList(skills.slice(0, 3)) : "building full-stack systems";

  // Opening — warm, specific, no "I am writing to express my strong interest".
  const body1 = `I'm reaching out about the ${escapeTex(cRole)} role at ${escapeTex(company)}. I'm a software engineer who enjoys taking systems from a rough idea all the way to production, and my work with ${escapeTex(skillsPhrase)} lines up closely with what your team is building. I'd be genuinely glad to bring that experience to ${escapeTex(company)}.`;

  // Body — up to two distinct achievements as narrative, one clean metric each.
  const proseBullets = bullets.map((b) => escapeTex(bulletToProse(b.text))).filter(Boolean);
  const lead = proseBullets[0];
  const second = proseBullets[1];

  const body2 = lead
    ? `Most recently, I ${lead}. Projects like that are where I do my best work — owning something end to end, making the hard tradeoffs, and shipping it so it holds up under real load.${second ? ` Before that, I ${second}, which taught me how much of good engineering is really about clarity and follow-through.` : ""}`
    : `Across my projects I've shipped production systems that pair solid engineering fundamentals with real, measurable impact. I like owning problems end to end and following them through to something that actually works in the hands of users.`;

  const body3 = `What draws me to ${escapeTex(company)} specifically is the chance to work on problems that matter at scale, alongside people who care about doing them well. I'd bring curiosity, a bias toward shipping, and a habit of leaving things better than I found them.`;

  const body4 = `I'd welcome the chance to talk about how I can help your team. Thank you for taking the time to consider my application — I hope we get to speak soon.`;

  return `\\documentclass[letterpaper,11pt]{article}
\\usepackage[empty]{fullpage}
\\usepackage[hidelinks]{hyperref}
\\usepackage[english]{babel}
\\usepackage{setspace}
\\addtolength{\\oddsidemargin}{-0.4in}
\\addtolength{\\textwidth}{0.8in}
\\addtolength{\\topmargin}{-.4in}
\\addtolength{\\textheight}{0.8in}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{14pt}
\\onehalfspacing
\\pagestyle{empty}
\\begin{document}

{\\Huge \\scshape ${escapeTex(NAME)}}\\\\[2pt]
{\\small ${escapeTex(PHONE)} $|$ \\href{mailto:${EMAIL}}{${escapeTex(EMAIL)}} $|$ \\href{${LINKEDIN}}{LinkedIn}}

\\vspace{18pt}

${escapeTex(date)}

Hiring Team\\\\
${escapeTex(company)}

\\vspace{6pt}

Dear Hiring Team,

${body1}

${body2}

${body3}

${body4}

\\vspace{6pt}

Sincerely,\\\\[6pt]
${escapeTex(NAME)}

\\end{document}
`;
}

// ─── Public API ──────────────────────────────────────────────────────────────
export function buildCoverLetter({ company, role, jd, dir, bank }, onLog) {
  onLog?.("step", "Selecting bank bullets by JD keyword overlap…");
  const bullets = pickBullets(bank, jd, 2);
  const skills = topSkills(bullets.length ? bullets : allBullets(bank).slice(0, 2));
  onLog?.("result", `Matched ${bullets.length} bullets · skills: ${skills.join(", ") || "—"}`);

  const tex = buildTex({ company, role, skills, bullets });
  const texPath = path.join(dir, "cover-letter.tex");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(texPath, tex);
  onLog?.("step", "Compiling cover letter with tectonic…");

  const r = spawnSync("tectonic", ["cover-letter.tex"], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim().slice(-400);
    onLog?.("error", `Tectonic failed: ${err}`);
    return { ok: false, err };
  }

  const pdf = path.join(dir, "cover-letter.pdf");
  const named = path.join(dir, `${NAME} - Cover Letter.pdf`);
  if (fs.existsSync(pdf)) {
    fs.renameSync(pdf, named);
    onLog?.("result", `Cover letter ready · ${named}`);
    return { ok: true, pdf: named };
  }
  return { ok: false, err: "cover-letter.pdf not found after compile" };
}
