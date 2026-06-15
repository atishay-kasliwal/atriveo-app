// ─── Curated skills library ──────────────────────────────────────────────────
// Canonical skill graph for evidence-backed resume skills generation.
//
// Skill schema:
//   name, displayName, aliases, match, marketFrequency, priority, tier,
//   evidence ("direct" | "inferred"), related, bankBacked

// Layout rules (rulebook):
//   • Exactly SKILLS_MAX_CATEGORIES lines (JD-ranked)
//   • Each line MUST fit one physical row — never wrap

export const SKILLS_MAX_CATEGORIES = 5;
/** @deprecated Use single-line greedy fit; no minimum fill that causes wraps. */
export const SKILLS_MIN_PER_CATEGORY = 0;

export const TIER_RANK = { A: 3, B: 2, C: 1 };

/**
 * @typedef {"direct"|"inferred"} EvidenceMode
 * @typedef {"A"|"B"|"C"} SkillTier
 * @typedef {{
 *   name: string,
 *   displayName: string,
 *   aliases: string[],
 *   match: string[],
 *   marketFrequency: number,
 *   priority: number,
 *   tier: SkillTier,
 *   evidence: EvidenceMode,
 *   related: string[],
 *   bankBacked: boolean,
 * }} SkillEntry
 */

/** @param {Partial<SkillEntry> & Pick<SkillEntry, "name"|"match">} opts */
export function defineSkill(opts) {
  const {
    name,
    displayName = name,
    aliases = [],
    match,
    marketFrequency = 0,
    priority = 5,
    tier = "B",
    evidence = "direct",
    related = [],
    bankBacked = true,
  } = opts;

  const normalizedMatch = [...new Set([
    name.toLowerCase(),
    ...match.map((m) => m.toLowerCase()),
  ])];

  return {
    name,
    displayName,
    aliases: aliases.map((a) => a.toLowerCase()),
    match: normalizedMatch,
    marketFrequency,
    priority,
    tier,
    evidence,
    related,
    bankBacked,
  };
}

/** All haystack tokens for JD / corpus matching (match + aliases). */
export function skillHaystack(skill) {
  return [...new Set([...skill.match, ...skill.aliases])];
}

export const SKILLS_LIBRARY = [
  {
    label: "Languages",
    kind: "technology",
    skills: [
      defineSkill({ name: "Python", displayName: "Python", aliases: ["python3", "py"], match: ["python", "py"], marketFrequency: 18017, priority: 10, tier: "A", related: ["FastAPI", "PyTorch", "Machine Learning"] }),
      defineSkill({ name: "Java", displayName: "Java", aliases: ["jvm"], match: ["java"], marketFrequency: 9040, priority: 10, tier: "A", related: ["Spring Boot", "REST APIs"] }),
      defineSkill({ name: "TypeScript", displayName: "TypeScript", aliases: ["ts"], match: ["typescript"], marketFrequency: 4200, priority: 9, tier: "A", related: ["React", "Node.js"] }),
      defineSkill({ name: "JavaScript", displayName: "JavaScript", aliases: ["js", "ecmascript"], match: ["javascript"], marketFrequency: 4100, priority: 9, tier: "A", related: ["React", "Node.js"] }),
      defineSkill({ name: "SQL", displayName: "SQL", aliases: ["structured query language"], match: ["sql"], marketFrequency: 7500, priority: 10, tier: "A", related: ["PostgreSQL", "Data Modeling"] }),
      defineSkill({ name: "HTML", displayName: "HTML", match: ["html", "html5"], marketFrequency: 2800, priority: 6, tier: "B" }),
      defineSkill({ name: "CSS", displayName: "CSS", aliases: ["scss", "sass"], match: ["css"], marketFrequency: 2600, priority: 6, tier: "B" }),
      defineSkill({ name: "Shell Scripting", displayName: "Shell Scripting", aliases: ["bash", "sh"], match: ["shell", "bash"], marketFrequency: 1200, priority: 5, tier: "B" }),
      defineSkill({ name: "JSON", displayName: "JSON", match: ["json"], marketFrequency: 800, priority: 2, tier: "C" }),
      defineSkill({ name: "GraphQL", displayName: "GraphQL", aliases: ["gql"], match: ["graphql"], marketFrequency: 1800, priority: 6, tier: "B" }),
    ],
  },
  {
    label: "Backend Frameworks",
    kind: "technology",
    skills: [
      defineSkill({ name: "FastAPI", displayName: "FastAPI", match: ["fastapi", "fast api"], marketFrequency: 3200, priority: 10, tier: "A", related: ["Python", "REST APIs", "Microservices"] }),
      defineSkill({ name: "Spring Boot", displayName: "Spring Boot", aliases: ["springboot", "spring framework"], match: ["spring boot", "spring"], marketFrequency: 4800, priority: 9, tier: "A", related: ["Java", "REST APIs", "Microservices"] }),
      defineSkill({ name: "Node.js", displayName: "Node.js", aliases: ["nodejs"], match: ["node.js", "nodejs", "node"], marketFrequency: 3600, priority: 9, tier: "A", related: ["Express.js", "JavaScript"] }),
      defineSkill({ name: "Express.js", displayName: "Express.js", aliases: ["expressjs"], match: ["express.js", "express"], marketFrequency: 2400, priority: 7, tier: "B", related: ["Node.js", "REST APIs"] }),
      defineSkill({ name: "NestJS", displayName: "NestJS", match: ["nestjs", "nest.js"], marketFrequency: 900, priority: 5, tier: "C", related: ["Node.js", "TypeScript"] }),
      defineSkill({ name: "REST APIs", displayName: "REST APIs", aliases: ["restful api", "web api"], match: ["rest api", "rest apis", "restful"], marketFrequency: 4297, priority: 9, tier: "A", related: ["FastAPI", "OpenAPI"] }),
      defineSkill({ name: "GraphQL APIs", displayName: "GraphQL", match: ["graphql api"], marketFrequency: 1800, priority: 6, tier: "B", related: ["GraphQL"] }),
      defineSkill({ name: "Kafka", displayName: "Kafka", aliases: ["apache kafka"], match: ["kafka"], marketFrequency: 2200, priority: 8, tier: "B", related: ["Event-Driven Architecture", "Stream Processing"] }),
      defineSkill({ name: "API Gateway", displayName: "API Gateway", match: ["api gateway", "gateway"], marketFrequency: 1100, priority: 6, tier: "B", related: ["REST APIs", "OAuth"] }),
      defineSkill({ name: "OpenAPI", displayName: "OpenAPI", aliases: ["swagger"], match: ["openapi", "swagger"], marketFrequency: 1400, priority: 5, tier: "B", related: ["REST APIs"] }),
      defineSkill({ name: "OAuth", displayName: "OAuth", aliases: ["oauth2", "oidc"], match: ["oauth"], marketFrequency: 1200, priority: 7, tier: "B", related: ["JWT", "Authentication"] }),
      defineSkill({ name: "JWT", displayName: "JWT", aliases: ["json web token"], match: ["jwt"], marketFrequency: 1100, priority: 6, tier: "B", related: ["OAuth", "Authentication"] }),
      defineSkill({ name: "Rate Limiting", displayName: "Rate Limiting", match: ["rate limiting", "rate limit", "throttling"], marketFrequency: 800, priority: 5, tier: "B", related: ["API Gateway"] }),
      defineSkill({ name: "Authentication", displayName: "Authentication", aliases: ["authn"], match: ["authentication", "auth"], marketFrequency: 2000, priority: 7, tier: "B", related: ["OAuth", "JWT"] }),
    ],
  },
  {
    label: "Software Engineering",
    kind: "concept",
    skills: [
      defineSkill({ name: "Scalability", displayName: "Scalability", match: ["scalability", "scalable", "high throughput"], marketFrequency: 11848, priority: 8, tier: "B", evidence: "inferred", related: ["Distributed Systems", "Microservices"] }),
      defineSkill({ name: "Distributed Systems", displayName: "Distributed Systems", match: ["distributed system", "distributed systems", "distributed architecture"], marketFrequency: 4316, priority: 8, tier: "B", evidence: "inferred", related: ["Microservices", "Kafka"] }),
      defineSkill({ name: "Microservices", displayName: "Microservices", match: ["microservice", "microservices"], marketFrequency: 3800, priority: 8, tier: "B", evidence: "direct", related: ["Distributed Systems", "REST APIs"] }),
      defineSkill({ name: "Event-Driven Architecture", displayName: "Event-Driven Architecture", match: ["event-driven", "event driven"], marketFrequency: 2100, priority: 7, tier: "B", evidence: "direct", related: ["Kafka", "Stream Processing"] }),
      defineSkill({ name: "API Design", displayName: "API Design", match: ["api design"], marketFrequency: 1800, priority: 6, tier: "B", evidence: "inferred", related: ["REST APIs", "OpenAPI"] }),
      defineSkill({ name: "Performance Optimization", displayName: "Performance Optimization", match: ["performance optimization", "optimization", "latency reduction"], marketFrequency: 2200, priority: 7, tier: "B", evidence: "inferred", related: ["Scalability"] }),
      defineSkill({ name: "Code Review", displayName: "Code Review", match: ["code review", "peer review", "pull request review"], marketFrequency: 5944, priority: 6, tier: "B", evidence: "inferred" }),
      defineSkill({ name: "Cross-Functional Collaboration", displayName: "Cross-Functional Collaboration", aliases: ["cross functional"], match: ["cross-functional", "cross functional", "stakeholder collaboration"], marketFrequency: 4200, priority: 5, tier: "C", evidence: "inferred" }),
      defineSkill({ name: "Mentorship", displayName: "Mentorship", aliases: ["mentoring"], match: ["mentorship", "mentoring", "mentor"], marketFrequency: 5685, priority: 5, tier: "C", evidence: "inferred" }),
      defineSkill({ name: "Agile/Scrum", displayName: "Agile/Scrum", aliases: ["agile", "scrum"], match: ["agile", "scrum", "sprint"], marketFrequency: 4573, priority: 5, tier: "C", evidence: "inferred" }),
    ],
  },
  {
    label: "AI & Machine Learning",
    kind: "technology",
    skills: [
      defineSkill({ name: "LLMs", displayName: "LLMs", aliases: ["large language models", "foundation models", "generative ai", "genai"], match: ["llm", "llms"], marketFrequency: 9453, priority: 10, tier: "A", related: ["RAG", "LangChain", "Agent Systems"] }),
      defineSkill({ name: "RAG", displayName: "RAG", aliases: ["retrieval augmented generation"], match: ["rag"], marketFrequency: 2800, priority: 9, tier: "A", related: ["LLMs", "LangChain", "Vector Retrieval"] }),
      defineSkill({ name: "LangChain", displayName: "LangChain", match: ["langchain"], marketFrequency: 1600, priority: 8, tier: "B", related: ["RAG", "LLMs", "Vector Retrieval"] }),
      defineSkill({ name: "LangGraph", displayName: "LangGraph", match: ["langgraph"], marketFrequency: 900, priority: 6, tier: "B", related: ["LangChain", "Agent Systems"] }),
      defineSkill({ name: "PyTorch", displayName: "PyTorch", match: ["pytorch", "torch"], marketFrequency: 2400, priority: 8, tier: "B", related: ["Machine Learning", "Transformers"] }),
      defineSkill({ name: "Transformers", displayName: "Transformers", aliases: ["hugging face", "huggingface"], match: ["transformer", "transformers", "bert"], marketFrequency: 1800, priority: 7, tier: "B", related: ["NLP", "LLMs"] }),
      defineSkill({ name: "MCP", displayName: "MCP", aliases: ["model context protocol"], match: ["mcp"], marketFrequency: 400, priority: 4, tier: "C", related: ["Agent Systems"] }),
      defineSkill({ name: "NLP", displayName: "NLP", aliases: ["natural language processing"], match: ["nlp"], marketFrequency: 3200, priority: 8, tier: "B", related: ["Transformers", "Machine Learning"] }),
      defineSkill({ name: "Reinforcement Learning", displayName: "Reinforcement Learning", match: ["reinforcement learning", " rl "], marketFrequency: 1100, priority: 6, tier: "B", related: ["Machine Learning", "Agent Systems"] }),
      defineSkill({ name: "Agent Systems", displayName: "Agent Systems", aliases: ["ai agents", "multi-agent systems"], match: ["agent", "agents", "agentic"], marketFrequency: 2600, priority: 8, tier: "B", related: ["LLMs", "LangGraph", "MCP"] }),
      defineSkill({ name: "Prompt Engineering", displayName: "Prompt Engineering", match: ["prompt engineering", "prompting"], marketFrequency: 900, priority: 5, tier: "C", evidence: "inferred", related: ["LLMs"] }),
      defineSkill({ name: "Feature Engineering", displayName: "Feature Engineering", match: ["feature engineering", "feature extraction"], marketFrequency: 1500, priority: 7, tier: "B", related: ["Machine Learning", "ETL Pipelines"] }),
      defineSkill({ name: "Machine Learning", displayName: "Machine Learning", aliases: ["ml"], match: ["machine learning"], marketFrequency: 9453, priority: 9, tier: "A", related: ["PyTorch", "NLP"] }),
      defineSkill({ name: "Healthcare AI", displayName: "Healthcare AI", match: ["healthcare", "clinical"], marketFrequency: 800, priority: 5, tier: "C", related: ["Feature Engineering"] }),
    ],
  },
  {
    label: "Data Engineering",
    kind: "technology",
    skills: [
      defineSkill({ name: "ETL Pipelines", displayName: "ETL Pipelines", aliases: ["elt"], match: ["etl", "data pipeline"], marketFrequency: 3400, priority: 9, tier: "A", related: ["Data Ingestion", "Stream Processing"] }),
      defineSkill({ name: "Data Ingestion", displayName: "Data Ingestion", match: ["data ingestion", "ingestion"], marketFrequency: 1800, priority: 7, tier: "B", related: ["ETL Pipelines"] }),
      defineSkill({ name: "Stream Processing", displayName: "Stream Processing", aliases: ["streaming pipeline"], match: ["stream processing", "streaming"], marketFrequency: 2100, priority: 8, tier: "B", related: ["Apache Kafka", "Event-Driven Architecture"] }),
      defineSkill({ name: "Apache Kafka", displayName: "Apache Kafka", match: ["apache kafka", "kafka streams"], marketFrequency: 2200, priority: 8, tier: "B", related: ["Kafka", "Stream Processing"] }),
      defineSkill({ name: "Workflow Automation", displayName: "Workflow Automation", match: ["workflow automation", "workflow orchestration"], marketFrequency: 1200, priority: 6, tier: "B" }),
      defineSkill({ name: "Data Preprocessing", displayName: "Data Preprocessing", match: ["preprocessing", "data cleaning"], marketFrequency: 1400, priority: 7, tier: "B", related: ["Feature Engineering"] }),
      defineSkill({ name: "Feature Pipelines", displayName: "Feature Pipelines", match: ["feature pipeline", "ml pipeline"], marketFrequency: 1100, priority: 6, tier: "B", related: ["Feature Engineering"] }),
      defineSkill({ name: "Event Pipelines", displayName: "Event Pipelines", match: ["event pipeline", "event processing"], marketFrequency: 1300, priority: 7, tier: "B", related: ["Event-Driven Architecture"] }),
      defineSkill({ name: "Batch Processing", displayName: "Batch Processing", match: ["batch processing", "batch etl"], marketFrequency: 1000, priority: 5, tier: "C" }),
      defineSkill({ name: "Data Validation", displayName: "Data Validation", match: ["data validation", "quality checks"], marketFrequency: 900, priority: 5, tier: "C" }),
    ],
  },
  {
    label: "Databases",
    kind: "technology",
    skills: [
      defineSkill({ name: "PostgreSQL", displayName: "PostgreSQL", aliases: ["postgres", "pg"], match: ["postgresql", "postgres"], marketFrequency: 3800, priority: 9, tier: "A", related: ["SQL", "Relational Databases"] }),
      defineSkill({ name: "MongoDB", displayName: "MongoDB", aliases: ["mongo"], match: ["mongodb", "mongo"], marketFrequency: 2400, priority: 7, tier: "B", related: ["NoSQL"] }),
      defineSkill({ name: "Redis", displayName: "Redis", match: ["redis"], marketFrequency: 2600, priority: 8, tier: "B", related: ["Caching"] }),
      defineSkill({ name: "NoSQL", displayName: "NoSQL", match: ["nosql", "document database"], marketFrequency: 1400, priority: 6, tier: "B", related: ["MongoDB"] }),
      defineSkill({ name: "Relational Databases", displayName: "Relational Databases", aliases: ["rdbms"], match: ["relational database"], marketFrequency: 1800, priority: 6, tier: "B", evidence: "inferred", related: ["PostgreSQL", "SQL"] }),
      defineSkill({ name: "Data Modeling", displayName: "Data Modeling", match: ["data modeling", "schema design"], marketFrequency: 1500, priority: 6, tier: "B", evidence: "inferred", related: ["PostgreSQL"] }),
      defineSkill({ name: "Caching", displayName: "Caching", match: ["caching", "cache layer"], marketFrequency: 1100, priority: 5, tier: "B", related: ["Redis"] }),
      defineSkill({ name: "Database Optimization", displayName: "Database Optimization", match: ["query optimization", "indexing"], marketFrequency: 900, priority: 5, tier: "C", evidence: "inferred" }),
    ],
  },
  {
    label: "Search & Vector",
    kind: "technology",
    skills: [
      defineSkill({ name: "Elasticsearch", displayName: "Elasticsearch", aliases: ["opensearch", "elastic search"], match: ["elasticsearch", "elastic"], marketFrequency: 1600, priority: 7, tier: "B", related: ["Semantic Search"] }),
      defineSkill({ name: "Vector Databases", displayName: "Vector Databases", aliases: ["vector db", "vector store"], match: ["vector database"], marketFrequency: 1200, priority: 7, tier: "B", related: ["Vector Retrieval", "Embeddings"] }),
      defineSkill({ name: "Vector Retrieval", displayName: "Vector Retrieval", aliases: ["vector search"], match: ["vector retrieval"], marketFrequency: 1400, priority: 8, tier: "B", related: ["RAG", "Embeddings"] }),
      defineSkill({ name: "Embeddings", displayName: "Embeddings", aliases: ["vector embedding"], match: ["embedding", "embeddings"], marketFrequency: 1200, priority: 7, tier: "B", related: ["Vector Retrieval", "RAG"] }),
      defineSkill({ name: "Semantic Search", displayName: "Semantic Search", aliases: ["similarity search"], match: ["semantic search"], marketFrequency: 1100, priority: 6, tier: "B", related: ["Vector Retrieval", "RAG"] }),
      defineSkill({ name: "FAISS", displayName: "FAISS", match: ["faiss"], marketFrequency: 600, priority: 4, tier: "C", bankBacked: false, related: ["Vector Retrieval"] }),
      defineSkill({ name: "Pinecone", displayName: "Pinecone", match: ["pinecone"], marketFrequency: 700, priority: 4, tier: "C", bankBacked: false, related: ["Vector Databases"] }),
      defineSkill({ name: "ChromaDB", displayName: "ChromaDB", aliases: ["chroma"], match: ["chromadb", "chroma db"], marketFrequency: 500, priority: 3, tier: "C", bankBacked: false, related: ["Vector Databases"] }),
    ],
  },
  {
    label: "Cloud & DevOps",
    kind: "technology",
    skills: [
      defineSkill({ name: "AWS", displayName: "AWS", aliases: ["amazon web services"], match: ["aws"], marketFrequency: 8483, priority: 10, tier: "A", related: ["Lambda", "S3", "EC2", "Docker"] }),
      defineSkill({ name: "Docker", displayName: "Docker", aliases: ["containerization"], match: ["docker", "container"], marketFrequency: 5200, priority: 9, tier: "A", related: ["Kubernetes", "CI/CD"] }),
      defineSkill({ name: "Kubernetes", displayName: "Kubernetes", aliases: ["k8s"], match: ["kubernetes", "k8s"], marketFrequency: 4100, priority: 7, tier: "B", bankBacked: false, related: ["Docker"] }),
      defineSkill({ name: "Lambda", displayName: "Lambda", aliases: ["aws lambda"], match: ["lambda"], marketFrequency: 2400, priority: 7, tier: "B", related: ["AWS", "Serverless"] }),
      defineSkill({ name: "EC2", displayName: "EC2", match: ["ec2"], marketFrequency: 1800, priority: 6, tier: "B", related: ["AWS"] }),
      defineSkill({ name: "S3", displayName: "S3", aliases: ["aws s3"], match: ["s3", "object storage"], marketFrequency: 2000, priority: 7, tier: "B", related: ["AWS"] }),
      defineSkill({ name: "ECS", displayName: "ECS", match: ["ecs", "aws ecs"], marketFrequency: 900, priority: 5, tier: "C", related: ["AWS", "Docker"] }),
      defineSkill({ name: "CI/CD", displayName: "CI/CD", aliases: ["continuous integration", "continuous delivery"], match: ["ci/cd", "cicd"], marketFrequency: 6062, priority: 8, tier: "B", related: ["GitHub Actions", "Production Deployment"] }),
      defineSkill({ name: "GitHub Actions", displayName: "GitHub Actions", match: ["github actions"], marketFrequency: 1800, priority: 6, tier: "B", related: ["CI/CD"] }),
      defineSkill({ name: "Serverless", displayName: "Serverless", aliases: ["faas"], match: ["serverless"], marketFrequency: 2200, priority: 7, tier: "B", related: ["Lambda", "AWS"] }),
      defineSkill({ name: "Firebase", displayName: "Firebase", match: ["firebase"], marketFrequency: 800, priority: 4, tier: "C", related: ["GCP"] }),
      defineSkill({ name: "Linux", displayName: "Linux", aliases: ["unix"], match: ["linux", "unix"], marketFrequency: 3200, priority: 7, tier: "B" }),
      defineSkill({ name: "Infrastructure as Code", displayName: "Infrastructure as Code", aliases: ["iac"], match: ["infrastructure as code", "terraform"], marketFrequency: 1600, priority: 6, tier: "B", bankBacked: false }),
      defineSkill({ name: "Prometheus", displayName: "Prometheus", match: ["prometheus", "grafana"], marketFrequency: 1400, priority: 5, tier: "C", bankBacked: false, related: ["Observability"] }),
      defineSkill({ name: "Observability", displayName: "Observability", aliases: ["monitoring", "telemetry"], match: ["observability", "monitoring"], marketFrequency: 1800, priority: 6, tier: "B", evidence: "inferred", related: ["Prometheus"] }),
      defineSkill({ name: "Production Deployment", displayName: "Production Deployment", match: ["production deployment", "prod deployment"], marketFrequency: 1500, priority: 7, tier: "B", evidence: "direct", related: ["CI/CD"] }),
      defineSkill({ name: "Azure", displayName: "Azure", aliases: ["microsoft azure"], match: ["azure"], marketFrequency: 4879, priority: 6, tier: "B", bankBacked: false, related: ["Azure OpenAI"] }),
      defineSkill({ name: "Azure OpenAI", displayName: "Azure OpenAI", match: ["azure openai"], marketFrequency: 1200, priority: 5, tier: "C", bankBacked: false, related: ["Azure", "LLMs"] }),
      defineSkill({ name: "GCP", displayName: "GCP", aliases: ["google cloud"], match: ["gcp", "google cloud"], marketFrequency: 4354, priority: 6, tier: "B", bankBacked: false, related: ["BigQuery", "Cloud Run"] }),
      defineSkill({ name: "BigQuery", displayName: "BigQuery", match: ["bigquery"], marketFrequency: 1100, priority: 5, tier: "C", bankBacked: false, related: ["GCP"] }),
      defineSkill({ name: "Cloud Run", displayName: "Cloud Run", match: ["cloud run"], marketFrequency: 800, priority: 4, tier: "C", bankBacked: false, related: ["GCP", "Serverless"] }),
    ],
  },
  {
    label: "Frontend",
    kind: "technology",
    skills: [
      defineSkill({ name: "React", displayName: "React", aliases: ["reactjs"], match: ["react"], marketFrequency: 5200, priority: 10, tier: "A", related: ["TypeScript", "Full Stack"] }),
      defineSkill({ name: "TypeScript", displayName: "TypeScript", aliases: ["ts"], match: ["typescript"], marketFrequency: 4200, priority: 9, tier: "A", related: ["React", "JavaScript"] }),
      defineSkill({ name: "JavaScript", displayName: "JavaScript", aliases: ["js"], match: ["javascript"], marketFrequency: 4100, priority: 9, tier: "A", related: ["React"] }),
      defineSkill({ name: "HTML/CSS", displayName: "HTML/CSS", match: ["html/css", "html", "css"], marketFrequency: 2800, priority: 7, tier: "B" }),
      defineSkill({ name: "Tailwind CSS", displayName: "Tailwind CSS", aliases: ["tailwindcss"], match: ["tailwind"], marketFrequency: 1600, priority: 6, tier: "B" }),
      defineSkill({ name: "Vite", displayName: "Vite", match: ["vite"], marketFrequency: 700, priority: 3, tier: "C" }),
      defineSkill({ name: "Chrome Extensions", displayName: "Chrome Extensions", match: ["chrome extension", "browser extension"], marketFrequency: 400, priority: 2, tier: "C" }),
      defineSkill({ name: "Dashboard UI", displayName: "Dashboard UI", match: ["dashboard", "dashboard ui"], marketFrequency: 1400, priority: 6, tier: "B", related: ["React"] }),
      defineSkill({ name: "Component Design", displayName: "Component Design", match: ["component design", "design system"], marketFrequency: 1200, priority: 5, tier: "B", evidence: "inferred", related: ["React"] }),
      defineSkill({ name: "Responsive Design", displayName: "Responsive Design", match: ["responsive design", "responsive ui"], marketFrequency: 1100, priority: 5, tier: "B", evidence: "inferred" }),
      defineSkill({ name: "Full Stack", displayName: "Full Stack", aliases: ["fullstack"], match: ["full stack", "fullstack"], marketFrequency: 2400, priority: 7, tier: "B", evidence: "direct", related: ["React", "FastAPI"] }),
    ],
  },
];

/** @type {Map<string, SkillEntry & { category: string, kind: string }>} */
export const SKILL_BY_NAME = new Map(
  SKILLS_LIBRARY.flatMap((cat) => cat.skills.map((s) => [s.name.toLowerCase(), { ...s, category: cat.label, kind: cat.kind }])),
);

/** @type {Map<string, SkillEntry & { category: string, kind: string }>} */
export const SKILL_BY_DISPLAY = new Map(
  SKILLS_LIBRARY.flatMap((cat) => cat.skills.map((s) => [s.displayName.toLowerCase(), { ...s, category: cat.label, kind: cat.kind }])),
);

export const SKILL_MARKET_PRIOR = Object.fromEntries(
  SKILLS_LIBRARY.flatMap((cat) => cat.skills.map((s) => [s.name, s.marketFrequency])),
);

function normJd(jd) {
  return ` ${String(jd || "").toLowerCase().replace(/[^a-z0-9+#./ ]/g, " ").replace(/\s+/g, " ")} `;
}

export function jdMentionsSkill(skill, haystack) {
  return skillHaystack(skill).some((t) =>
    haystack.includes(` ${t} `) || haystack.includes(` ${t}.`) || haystack.includes(` ${t},`));
}

export function rankCategoriesForJd(jd, library = SKILLS_LIBRARY) {
  const hay = normJd(jd);
  const score = (cat) => cat.skills.reduce((sum, s) => {
    const hit = jdMentionsSkill(s, hay);
    const w = s.marketFrequency || 100;
    return sum + (hit ? w * 2 : w * 0.05);
  }, 0);
  return [...library].sort((a, b) => score(b) - score(a));
}

/** Pick top N JD-relevant categories that have at least one evidenced skill. */
export function pickCategoriesForJd(jd, { maxCategories = SKILLS_MAX_CATEGORIES, hasEvidence = null } = {}) {
  const ranked = rankCategoriesForJd(jd);
  const picked = [];
  for (const cat of ranked) {
    if (picked.length >= maxCategories) break;
    if (hasEvidence) {
      const any = cat.skills.some((s) => hasEvidence(s));
      if (!any) continue;
    }
    picked.push(cat);
  }
  return picked;
}

/**
 * Planner score: marketFrequency × jdWeight × evidenceConfidence × (priority/10)
 */
export function scoreSkillEntry(skill, { jdHit = false, evidenceConfidence = 1 } = {}) {
  const jdWeight = jdHit ? 1 : 0.25;
  const freq = skill.marketFrequency || 100;
  const pri = skill.priority || 5;
  return freq * jdWeight * evidenceConfidence * (pri / 10);
}

export function sortSkillsByScore(skills, jd, evidenceConfidenceMap = new Map()) {
  const hay = normJd(jd);
  return [...skills].sort((a, b) => {
    const aJd = jdMentionsSkill(a, hay);
    const bJd = jdMentionsSkill(b, hay);
    const aScore = scoreSkillEntry(a, { jdHit: aJd, evidenceConfidence: evidenceConfidenceMap.get(a.name) ?? 1 });
    const bScore = scoreSkillEntry(b, { jdHit: bJd, evidenceConfidence: evidenceConfidenceMap.get(b.name) ?? 1 });
    if (bScore !== aScore) return bScore - aScore;
    return (TIER_RANK[b.tier] || 0) - (TIER_RANK[a.tier] || 0);
  });
}

/** Expand direct related skills when a parent skill is evidenced. */
export function expandRelatedSkills(terms, evidenceBySkill) {
  const out = new Set(terms);
  for (const name of terms) {
    const entry = SKILL_BY_NAME.get(name.toLowerCase());
    if (!entry?.related?.length) continue;
    for (const relName of entry.related) {
      const rel = SKILL_BY_NAME.get(relName.toLowerCase());
      if (!rel || rel.evidence !== "direct" || !rel.bankBacked) continue;
      if (out.has(rel.name)) continue;
      out.add(rel.name);
      const key = rel.name.toLowerCase();
      if (!evidenceBySkill.has(key)) evidenceBySkill.set(key, new Set());
      evidenceBySkill.get(key).add(`related:${entry.name}`);
    }
  }
  return out;
}

const BOLD_FACTOR = 1.18;
/** One physical line on the resume template (\small skills block). */
const LINE_BUDGET = 94;

function lineWidthUnits(label, items) {
  let w = (label.length + 2) * BOLD_FACTOR;
  items.forEach((it, i) => {
    w += it.length;
    if (i < items.length - 1) w += 2;
  });
  return w;
}

export function fitsOnePhysicalLine(label, displayNames) {
  return lineWidthUnits(label, displayNames) <= LINE_BUDGET;
}

/**
 * Greedily add skills in score order. Skip any skill that would wrap the line.
 * Never trim-in-place to force a wrap — omission only.
 */
export function fitSkillsToSingleLine(label, displayNames) {
  const kept = [];
  for (const name of displayNames) {
    const trial = [...kept, name];
    if (fitsOnePhysicalLine(label, trial)) kept.push(name);
  }
  return kept;
}

/** @deprecated Use fitSkillsToSingleLine — minKeep caused multi-line wraps. */
export function capSkillsLineToOnePhysicalLine(label, displayNames, { minKeep = 0 } = {}) {
  return fitSkillsToSingleLine(label, displayNames);
}

export function buildSkillsLines(jd) {
  const seen = new Set();
  const lines = [];

  for (const cat of pickCategoriesForJd(jd)) {
    const pool = cat.skills.filter((s) => s.bankBacked !== false);
    const ordered = sortSkillsByScore(pool, jd).map((s) => s.displayName);
    const capped = fitSkillsToSingleLine(cat.label, ordered);
    capped.forEach((n) => seen.add(n.toLowerCase().replace(/[^a-z0-9+#.]/g, "")));
    if (capped.length) lines.push(`${cat.label}: ${capped.join(", ")}`);
  }
  return lines;
}

export function buildSkillCoverageGaps(skillsAudit = []) {
  return skillsAudit
    .filter((row) => row.jd_relevant && !row.covered && (SKILL_MARKET_PRIOR[row.skill] || 0) >= 1000)
    .sort((a, b) => (SKILL_MARKET_PRIOR[b.skill] || 0) - (SKILL_MARKET_PRIOR[a.skill] || 0))
    .map((row) => ({
      skill: row.skill,
      category: row.category,
      marketFrequency: SKILL_MARKET_PRIOR[row.skill] || 0,
      tier: row.tier,
      action: "author_ac",
    }));
}

// Back-compat alias
export const sortSkillNames = (names, jd) => {
  const entries = names.map((n) => SKILL_BY_DISPLAY.get(n.toLowerCase()) || SKILL_BY_NAME.get(n.toLowerCase())).filter(Boolean);
  return sortSkillsByScore(entries, jd).map((s) => s.displayName);
};
