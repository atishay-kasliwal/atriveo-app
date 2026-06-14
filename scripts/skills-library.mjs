// ─── Curated skills library ──────────────────────────────────────────────────
// The candidate's REAL skills, hand-curated from the engine bank tags and the
// confirmed safe-claims in QUESTION_ANSWERS.md. Nothing here is invented: every
// entry is backed by a bank bullet or an explicit "safe claim" note.
//
// Why a library: the model no longer has to DECIDE what skills the candidate has
// (that never changes per job) — it only has to MATCH the JD. We do the matching
// deterministically here so it is fast, truthful, canonically named, and always
// fits exactly one physical line. The model's free-form skills are used only as a
// fallback when the library is somehow empty.
//
// Each skill:  { name, match: [aliases the JD might use] }
// The 5 lines map 1:1 to the rulebook categories.

export const SKILLS_LIBRARY = [
  {
    label: "Languages",
    skills: [
      { name: "Python", match: ["python", "py"] },
      { name: "Java", match: ["java"] },
      { name: "TypeScript", match: ["typescript", "ts"] },
      { name: "JavaScript", match: ["javascript", "js", "node", "nodejs", "node.js"] },
      { name: "SQL", match: ["sql"] },
      { name: "C++", match: ["c++", "cpp", "c plus plus"] },
    ],
  },
  {
    label: "Backend",
    skills: [
      { name: "FastAPI", match: ["fastapi", "fast api"] },
      { name: "Spring Boot", match: ["spring", "spring boot", "springboot"] },
      { name: "Node.js", match: ["node", "nodejs", "node.js", "express"] },
      { name: "NestJS", match: ["nest", "nestjs", "nest.js"] },
      { name: "REST APIs", match: ["rest", "rest api", "rest apis", "restful", "api"] },
      { name: "GraphQL", match: ["graphql"] },
      { name: "Microservices", match: ["microservice", "microservices", "distributed"] },
      { name: "Kafka", match: ["kafka", "event streaming", "messaging", "pub/sub"] },
    ],
  },
  {
    label: "Frontend",
    skills: [
      { name: "React", match: ["react", "react.js", "reactjs"] },
      { name: "TypeScript", match: ["typescript", "ts"] },
      { name: "JavaScript", match: ["javascript", "js"] },
      { name: "HTML/CSS", match: ["html", "css", "scss", "tailwind"] },
      { name: "Vite", match: ["vite"] },
      { name: "Chrome Extensions", match: ["chrome extension", "browser extension", "extension"] },
    ],
  },
  {
    label: "Data and AI",
    skills: [
      { name: "PostgreSQL", match: ["postgresql", "postgres", "pg", "neondb", "relational"] },
      { name: "MongoDB", match: ["mongodb", "mongo", "nosql", "atlas"] },
      { name: "Redis", match: ["redis", "cache", "caching"] },
      { name: "DynamoDB", match: ["dynamodb", "dynamo"] },
      { name: "Elasticsearch", match: ["elasticsearch", "elastic", "es", "search"] },
      { name: "PyTorch", match: ["pytorch", "torch"] },
      { name: "LLMs", match: ["llm", "llms", "large language model", "gpt", "generative ai", "genai"] },
      { name: "RAG", match: ["rag", "retrieval augmented", "retrieval-augmented", "vector"] },
      { name: "LangChain", match: ["langchain"] },
      { name: "LangGraph", match: ["langgraph"] },
      { name: "MCP", match: ["mcp", "model context protocol"] },
      { name: "ETL Pipelines", match: ["etl", "pipeline", "data pipeline", "ingestion"] },
    ],
  },
  {
    label: "Cloud and Delivery",
    skills: [
      { name: "AWS", match: ["aws", "amazon web services", "lambda", "ec2", "s3"] },
      { name: "GCP", match: ["gcp", "google cloud", "google cloud platform"] },
      { name: "Docker", match: ["docker", "container", "containerization"] },
      { name: "Kubernetes", match: ["kubernetes", "k8s"] },
      { name: "Terraform", match: ["terraform", "iac", "infrastructure as code"] },
      { name: "CI/CD", match: ["ci/cd", "cicd", "ci cd", "continuous integration", "continuous delivery", "github actions", "jenkins"] },
      { name: "Firebase", match: ["firebase"] },
      { name: "Prometheus", match: ["prometheus", "grafana", "observability", "monitoring", "metrics"] },
    ],
  },
];

// Width model for the one-physical-line guard. We are not laying out LaTeX
// glyph-by-glyph; we approximate rendered width in "character units" where a
// normal-weight character is 1.0 and a bold label character is 1.18 (the label
// is \textbf). Tuned against rendered PDFs: a \small skills line on this
// template wraps past ~95 chars, so we budget conservatively below that.
const BOLD_FACTOR = 1.18;   // label is \textbf
const LINE_BUDGET = 92;     // safe one-physical-line width in normal-char units

function lineWidthUnits(label, items) {
  // "Label: item, item, item"  — label (+ ": ") is bold, items are normal.
  let w = (label.length + 2) * BOLD_FACTOR; // label + ": "
  items.forEach((it, i) => {
    w += it.length;
    if (i < items.length - 1) w += 2; // ", "
  });
  return w;
}

/** Trim items from the END until the rendered line fits one physical line. */
export function capSkillsLineToOnePhysicalLine(label, items) {
  const kept = [...items];
  while (kept.length > 1 && lineWidthUnits(label, kept) > LINE_BUDGET) {
    kept.pop();
  }
  return kept;
}

// Build a haystack of normalized JD text for alias matching.
function normJd(jd) {
  return ` ${String(jd || "").toLowerCase().replace(/[^a-z0-9+#./ ]/g, " ").replace(/\s+/g, " ")} `;
}

function jdMentions(haystack, aliases) {
  return aliases.some((a) => haystack.includes(` ${a} `) || haystack.includes(` ${a}.`) || haystack.includes(` ${a},`));
}

/**
 * Build the 5 skills lines by SELECTING from the library:
 *   1. JD-relevant skills first (matched by alias), in library order
 *   2. then fill with the rest of the line's skills so it never reads thin
 *   3. cap each line to one physical line, trimming the LEAST relevant from the end
 *   4. de-dupe a skill that already appeared on an earlier line (e.g. TypeScript)
 */
export function buildSkillsLines(jd) {
  const hay = normJd(jd);
  const seen = new Set();
  const lines = [];

  for (const cat of SKILLS_LIBRARY) {
    const relevant = [];
    const filler = [];
    for (const skill of cat.skills) {
      const key = skill.name.toLowerCase().replace(/[^a-z0-9+#.]/g, "");
      if (seen.has(key)) continue; // already shown on an earlier line
      if (jdMentions(hay, skill.match)) relevant.push(skill.name);
      else filler.push(skill.name);
    }
    // JD-relevant lead, then filler to make the line full.
    const ordered = [...relevant, ...filler];
    const capped = capSkillsLineToOnePhysicalLine(cat.label, ordered);
    capped.forEach((n) => seen.add(n.toLowerCase().replace(/[^a-z0-9+#.]/g, "")));
    if (capped.length) lines.push(`${cat.label}: ${capped.join(", ")}`);
  }
  return lines;
}
