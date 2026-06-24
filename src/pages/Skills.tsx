import { useState, useEffect, useMemo } from "react";
import AppHeader from "../components/AppHeader";

// Mirror of Python extraction patterns — must stay in sync with build_skills_summary.py
const RESUME_PATTERNS: Record<string, Record<string, RegExp[]>> = {
  "Languages": {
    "Python":      [/python/i],
    "Java":        [/\bjava\b/i],
    "JavaScript":  [/javascript/i],
    "TypeScript":  [/typescript/i],
    "Go":          [/golang/i, /\bgo lang\b/i, /go developer/i, /written in go/i],
    "Scala":       [/\bscala\b/i],
    "Kotlin":      [/kotlin/i],
    "C#":          [/\bc#\b/i, /csharp/i, /c sharp/i],
    "C++":         [/c\+\+/i, /\bcpp\b/i],
    "Rust":        [/\brust\b/i],
    "Ruby":        [/\bruby\b/i],
    ".NET":        [/\.net\b/i, /dotnet/i],
    "Swift":       [/\bswift\b/i],
    "PHP":         [/\bphp\b/i],
    "SQL":         [/\bsql\b/i],
    "Bash/Shell":  [/\bbash\b/i, /shell scripting/i],
    "HTML/CSS":    [/\bhtml\b/i, /\bcss\b/i],
    "Elixir":      [/elixir/i],
    "Clojure":     [/clojure/i],
  },
  "Frameworks & Libraries": {
    "Spring Boot":  [/spring boot/i],
    "Spring":       [/\bspring\b/i],
    "FastAPI":      [/fastapi/i],
    "Django":       [/django/i],
    "Flask":        [/\bflask\b/i],
    "Express":      [/express\.js/i, /expressjs/i, /\bexpress\b/i],
    "NestJS":       [/nestjs/i],
    "React":        [/\breact\b/i, /react\.js/i, /reactjs/i],
    "Next.js":      [/next\.js/i, /nextjs/i],
    "Vue":          [/\bvue\b/i, /vue\.js/i],
    "Angular":      [/angular/i],
    "Node.js":      [/node\.js/i, /nodejs/i],
    "GraphQL":      [/graphql/i],
    "Rails":        [/ruby on rails/i, /\brails\b/i],
    "Pydantic":     [/pydantic/i],
    "Celery":       [/celery/i],
    "SQLAlchemy":   [/sqlalchemy/i],
    "Hibernate":    [/hibernate/i],
    "LangChain":    [/langchain/i],
    "Pandas":       [/pandas/i],
    "NumPy":        [/numpy/i],
    "Scikit-learn": [/scikit[- ]learn/i, /sklearn/i],
    "PyTorch":      [/pytorch/i],
    "TensorFlow":   [/tensorflow/i],
    "Playwright":   [/playwright/i],
    "Selenium":     [/selenium/i],
    "Jest":         [/\bjest\b/i],
    "pytest":       [/pytest/i],
  },
  "Cloud": {
    "AWS":           [/\baws\b/i, /amazon web services/i],
    "GCP":           [/\bgcp\b/i, /google cloud/i],
    "Azure":         [/\bazure\b/i, /microsoft azure/i],
    "Lambda":        [/\blambda\b/i],
    "ECS":           [/\becs\b/i],
    "EKS":           [/\beks\b/i],
    "EC2":           [/\bec2\b/i],
    "S3":            [/\bs3\b/i],
    "RDS":           [/\brds\b/i],
    "DynamoDB":      [/dynamodb/i],
    "SQS":           [/\bsqs\b/i],
    "SNS":           [/\bsns\b/i],
    "Kinesis":       [/kinesis/i],
    "CloudWatch":    [/cloudwatch/i],
    "API Gateway":   [/api gateway/i],
    "Cloud Run":     [/cloud run/i],
    "GKE":           [/\bgke\b/i],
    "Serverless":    [/serverless/i],
  },
  "Backend & Architecture": {
    "Microservices":       [/microservices/i, /micro.services/i],
    "REST API":            [/rest api/i, /restful/i, /\brest\b/i],
    "Distributed Systems": [/distributed systems/i, /distributed computing/i],
    "Event-Driven":        [/event.driven/i, /event driven/i],
    "Message Queue":       [/message queue/i, /message broker/i],
    "Kafka":               [/kafka/i],
    "RabbitMQ":            [/rabbitmq/i],
    "gRPC":                [/\bgrpc\b/i],
    "WebSocket":           [/websocket/i, /web socket/i],
    "System Design":       [/system design/i],
    "Scalability":         [/scalab/i, /horizontal scaling/i, /vertical scaling/i],
    "Caching":             [/\bcaching\b/i, /cache layer/i, /caching strategy/i],
    "API Design":          [/api design/i, /api development/i],
    "CQRS":                [/\bcqrs\b/i],
    "Load Balancing":      [/load balanc/i],
    "Service Mesh":        [/service mesh/i, /\bistio\b/i],
  },
  "DevOps & Infrastructure": {
    "Docker":         [/docker/i],
    "Kubernetes":     [/kubernetes/i, /\bk8s\b/i],
    "Terraform":      [/terraform/i],
    "CI/CD":          [/ci\/cd/i, /continuous integration/i, /continuous deploy/i, /continuous deliver/i],
    "GitHub Actions": [/github actions/i],
    "GitLab CI":      [/gitlab ci/i, /gitlab.ci/i],
    "CircleCI":       [/circleci/i],
    "Jenkins":        [/jenkins/i],
    "Helm":           [/\bhelm\b/i],
    "ArgoCD":         [/argocd/i, /argo cd/i],
    "Ansible":        [/ansible/i],
    "Prometheus":     [/prometheus/i],
    "Grafana":        [/grafana/i],
    "Datadog":        [/datadog/i],
    "OpenTelemetry":  [/opentelemetry/i, /\botel\b/i],
    "Nginx":          [/nginx/i],
    "Linux":          [/linux/i, /ubuntu/i],
    "Git":            [/\bgit\b/i],
  },
  "Data & Storage": {
    "PostgreSQL":    [/postgresql/i, /postgres/i],
    "MySQL":         [/mysql/i],
    "MongoDB":       [/mongodb/i],
    "Redis":         [/redis/i],
    "Elasticsearch": [/elasticsearch/i, /opensearch/i],
    "Cassandra":     [/cassandra/i],
    "BigQuery":      [/bigquery/i],
    "Snowflake":     [/snowflake/i],
    "ClickHouse":    [/clickhouse/i],
    "Spark":         [/apache spark/i, /pyspark/i, /\bspark\b/i],
    "Airflow":       [/airflow/i],
    "dbt":           [/\bdbt\b/i],
    "Databricks":    [/databricks/i],
    "ETL/ELT":       [/\betl\b/i, /\belt\b/i, /data pipeline/i, /data ingestion/i],
    "Vector DB":     [/vector database/i, /vector db/i, /pinecone/i, /weaviate/i, /chroma/i, /qdrant/i, /milvus/i],
  },
  "AI & Machine Learning": {
    "LLM":             [/\bllm\b/i, /large language model/i],
    "GenAI":           [/generative ai/i, /gen ai/i, /\bgenai\b/i],
    "RAG":             [/\brag\b/i, /retrieval.augmented/i],
    "OpenAI":          [/openai/i, /gpt-4/i, /gpt-3/i, /chatgpt/i],
    "PyTorch":         [/pytorch/i],
    "TensorFlow":      [/tensorflow/i],
    "Hugging Face":    [/hugging face/i, /huggingface/i, /transformers/i],
    "LangChain":       [/langchain/i],
    "Machine Learning":[/machine learning/i, /\bml\b model/i],
    "Deep Learning":   [/deep learning/i],
    "NLP":             [/\bnlp\b/i, /natural language processing/i],
    "MLflow":          [/mlflow/i],
    "Agents":          [/ai agent/i, /llm agent/i, /agentic/i],
    "Fine-tuning":     [/fine.tun/i, /\brlhf\b/i],
    "Embeddings":      [/embeddings/i, /vector embeddings/i],
    "Prompt Eng":      [/prompt engineering/i],
    "Vertex AI":       [/vertex ai/i],
    "SageMaker":       [/sagemaker/i],
  },
  "Security": {
    "OAuth/OIDC": [/oauth/i, /\boidc\b/i, /openid connect/i],
    "JWT":        [/\bjwt\b/i],
    "TLS/SSL":    [/\btls\b/i, /\bssl\b/i],
    "IAM":        [/aws iam/i, /iam roles/i, /iam policies/i, /identity.*access management/i],
    "Zero Trust": [/zero trust/i],
    "SOC 2":      [/soc 2/i, /soc2/i],
    "GDPR":       [/gdpr/i],
    "RBAC":       [/\brbac\b/i, /role.based access/i],
    "Encryption": [/encrypt/i],
  },
};

type SkillSummary = {
  generated_at: string;
  total_analyzed: number;
  categories: Record<string, {
    color: string;
    skills: Record<string, number>;
  }>;
};

// Category accent colors — blue-only palette (no emerald/amber per design rules)
const CAT_COLOR: Record<string, string> = {
  "Languages":                "oklch(0.66 0.19 255)",
  "Frameworks & Libraries":   "oklch(0.70 0.16 240)",
  "Cloud":                    "oklch(0.62 0.18 265)",
  "Backend & Architecture":   "oklch(0.68 0.17 250)",
  "DevOps & Infrastructure":  "oklch(0.64 0.20 260)",
  "Data & Storage":           "oklch(0.72 0.15 235)",
  "AI & Machine Learning":    "oklch(0.75 0.18 255)",
  "Security":                 "oklch(0.60 0.17 270)",
};

function catColor(cat: string): string {
  return CAT_COLOR[cat] ?? "oklch(0.66 0.19 255)";
}

function extractResumeSkills(text: string): Set<string> {
  const found = new Set<string>();
  for (const catSkills of Object.values(RESUME_PATTERNS)) {
    for (const [name, patterns] of Object.entries(catSkills)) {
      if (patterns.some(p => p.test(text))) found.add(name);
    }
  }
  return found;
}

function flatTopSkills(summary: SkillSummary, n: number) {
  const all: Array<{ skill: string; count: number; category: string }> = [];
  for (const [cat, { skills }] of Object.entries(summary.categories)) {
    for (const [skill, count] of Object.entries(skills)) {
      all.push({ skill, count, category: cat });
    }
  }
  return all.sort((a, b) => b.count - a.count).slice(0, n);
}

export default function Skills() {
  const [summary, setSummary] = useState<SkillSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [resumeText, setResumeText] = useState("");
  const [activeTab, setActiveTab] = useState<"market" | "gap">("market");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/jobs?type=skills_summary")
      .then(r => r.json())
      .then(d => { setSummary(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const resumeSkills = useMemo(() => extractResumeSkills(resumeText), [resumeText]);

  const gapData = useMemo(() => {
    if (!summary) return [];
    const all: Array<{ skill: string; count: number; category: string; have: boolean }> = [];
    for (const [cat, { skills }] of Object.entries(summary.categories)) {
      for (const [skill, count] of Object.entries(skills)) {
        all.push({ skill, count, category: cat, have: resumeSkills.has(skill) });
      }
    }
    return all.sort((a, b) => b.count - a.count);
  }, [summary, resumeSkills]);

  const top20 = useMemo(() => summary ? flatTopSkills(summary, 20) : [], [summary]);
  const missing = useMemo(() => gapData.filter(s => !s.have).slice(0, 20), [gapData]);
  const covered = useMemo(() => gapData.filter(s => s.have), [gapData]);
  const hasResume = resumeText.trim().length > 50;

  const filteredCats = useMemo(() => {
    if (!summary) return [];
    const q = query.toLowerCase();
    return Object.entries(summary.categories).map(([name, { skills }]) => ({
      name,
      skills: Object.entries(skills).filter(([s]) => !q || s.toLowerCase().includes(q)),
    })).filter(c => c.skills.length > 0);
  }, [summary, query]);

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshMsg("");
    try {
      const resume = localStorage.getItem("atriveo_resume") || "";
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume }),
      });
      const data = await res.json() as { ok?: boolean; message?: string; error?: string };
      setRefreshMsg(data.ok ? (data.message ?? "Triggered!") : (data.error ?? "Failed"));
    } catch {
      setRefreshMsg("Network error");
    } finally {
      setRefreshing(false);
    }
  }

  const totalSkills = useMemo(() => {
    if (!summary) return 0;
    return Object.values(summary.categories).reduce((sum, c) => sum + Object.keys(c.skills).length, 0);
  }, [summary]);

  const coveragePct = hasResume && totalSkills > 0
    ? Math.round((covered.length / totalSkills) * 100)
    : null;

  return (
    <div className="arsenal-page">
      <AppHeader />

      <div className="arsenal-body">
        {/* Hero */}
        <section className="arsenal-hero">
          <div className="arsenal-hero-copy">
            <div className="arsenal-eyebrow">
              <span className="arsenal-eyebrow-dot" />
              ARSENAL · SKILLS INTELLIGENCE
            </div>
            <h1 className="arsenal-title">
              Market signal,<br />
              <span className="arsenal-title-accent">resume reality.</span>
            </h1>
            <p className="arsenal-subtitle">
              {summary
                ? `${summary.total_analyzed.toLocaleString()} live job descriptions · pattern-matched against your resume`
                : loading ? "Loading analysis…" : "Data unavailable"
              }
            </p>
          </div>

          <div className="arsenal-hero-actions">
            <div className="arsenal-search-wrap">
              <span className="arsenal-search-icon">⌕</span>
              <input
                className="arsenal-search"
                placeholder={`Search ${totalSkills} skills…`}
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>
            <button
              className="arsenal-btn-ghost"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              ↺ {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </section>

        {refreshMsg && (
          <div className={`arsenal-refresh-msg${refreshMsg.toLowerCase().includes("error") || refreshMsg.toLowerCase().includes("fail") ? " is-err" : " is-ok"}`}>
            {refreshMsg}
          </div>
        )}

        {/* KPI row */}
        <div className="arsenal-kpi-row">
          <div className="arsenal-kpi">
            <div className="arsenal-kpi-label">JDs ANALYZED</div>
            <div className="arsenal-kpi-value">{summary ? summary.total_analyzed.toLocaleString() : "—"}</div>
          </div>
          <div className="arsenal-kpi">
            <div className="arsenal-kpi-label">SKILLS TRACKED</div>
            <div className="arsenal-kpi-value">{totalSkills || "—"}</div>
          </div>
          {hasResume && (
            <>
              <div className="arsenal-kpi arsenal-kpi--green">
                <div className="arsenal-kpi-label">COVERED</div>
                <div className="arsenal-kpi-value">{covered.length}</div>
              </div>
              <div className="arsenal-kpi arsenal-kpi--red">
                <div className="arsenal-kpi-label">HIGH-DEMAND GAPS</div>
                <div className="arsenal-kpi-value">{missing.length}+</div>
              </div>
              <div className="arsenal-kpi arsenal-kpi--blue">
                <div className="arsenal-kpi-label">COVERAGE</div>
                <div className="arsenal-kpi-value">{coveragePct}%</div>
              </div>
            </>
          )}
        </div>

        {/* Tab bar */}
        <div className="arsenal-tabs">
          <button
            className={`arsenal-tab${activeTab === "market" ? " active" : ""}`}
            onClick={() => setActiveTab("market")}
          >
            Market Demand
          </button>
          <button
            className={`arsenal-tab${activeTab === "gap" ? " active" : ""}`}
            onClick={() => setActiveTab("gap")}
          >
            Resume Gap{hasResume ? ` · ${covered.length} covered / ${missing.length} missing` : ""}
          </button>
        </div>

        {loading ? (
          <div className="arsenal-empty"><div className="spin" /></div>
        ) : !summary ? (
          <div className="arsenal-empty">Could not load skills data.</div>
        ) : activeTab === "market" ? (
          <>
            {/* Top 20 */}
            <div className="arsenal-tile">
              <div className="arsenal-tile-label">TOP 20 · MARKET DEMAND</div>
              <p className="arsenal-tile-sub">Ranked by frequency across {summary.total_analyzed.toLocaleString()} JDs</p>
              <div className="arsenal-top-grid">
                {top20.map(({ skill, count, category }, i) => {
                  const col = catColor(category);
                  return (
                    <div key={skill} className="arsenal-top-chip" style={{ borderLeftColor: col }}>
                      <span className="arsenal-top-rank">#{i + 1}</span>
                      <span className="arsenal-top-name">{skill}</span>
                      <span className="arsenal-top-count" style={{ color: col }}>{count.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Category grid */}
            <div className="arsenal-cat-grid">
              {filteredCats.map(({ name, skills }) => {
                const col = catColor(name);
                const maxCount = skills.length > 0 ? skills[0][1] : 1;
                return (
                  <div key={name} className="arsenal-cat-tile">
                    <div className="arsenal-cat-head">
                      <span className="arsenal-cat-dot" style={{ background: col, boxShadow: `0 0 8px ${col}` }} />
                      <span className="arsenal-cat-name">{name}</span>
                      <span className="arsenal-cat-count">{skills.length} skills</span>
                    </div>
                    <div className="arsenal-bars">
                      {skills.slice(0, 10).map(([skill, count]) => (
                        <div key={skill} className="arsenal-bar-row">
                          <span className="arsenal-bar-label">{skill}</span>
                          <div className="arsenal-bar-track">
                            <div
                              className="arsenal-bar-fill"
                              style={{ width: `${(count / maxCount) * 100}%`, background: col }}
                            />
                          </div>
                          <span className="arsenal-bar-val">{count.toLocaleString()}</span>
                          <span className="arsenal-bar-pct">{Math.round((count / summary.total_analyzed) * 100)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          /* Gap tab */
          <div className="arsenal-gap-view">
            <div className="arsenal-tile">
              <div className="arsenal-tile-label">PASTE YOUR RESUME</div>
              <p className="arsenal-tile-sub">Scanned locally — nothing leaves your browser</p>
              {hasResume && (
                <div className="arsenal-resume-found">
                  <span className="arsenal-resume-found-num">{covered.length}</span> skills detected
                </div>
              )}
              <textarea
                className="arsenal-resume-input"
                placeholder="Paste your resume text here…"
                value={resumeText}
                onChange={e => setResumeText(e.target.value)}
                rows={8}
              />
            </div>

            {!hasResume ? (
              <div className="arsenal-empty">Paste your resume above to see the gap analysis</div>
            ) : (
              <>
                {/* Missing */}
                <div className="arsenal-tile">
                  <div className="arsenal-tile-label" style={{ color: "oklch(0.65 0.22 25)" }}>HIGH-DEMAND GAPS — ADD THESE</div>
                  <p className="arsenal-tile-sub">Highest-demand skills not detected in your resume</p>
                  <div className="arsenal-top-grid">
                    {missing.map(({ skill, count, category }, i) => {
                      const col = catColor(category);
                      return (
                        <div key={skill} className="arsenal-top-chip arsenal-top-chip--missing" style={{ borderLeftColor: col }}>
                          <span className="arsenal-top-rank">#{i + 1}</span>
                          <span className="arsenal-top-name">{skill}</span>
                          <span className="arsenal-top-count" style={{ color: "oklch(0.65 0.22 25)" }}>{count.toLocaleString()}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Covered */}
                <div className="arsenal-tile">
                  <div className="arsenal-tile-label" style={{ color: "oklch(0.72 0.18 142)" }}>SKILLS YOU ALREADY COVER</div>
                  <div className="arsenal-top-grid">
                    {covered.map(({ skill, count, category }) => {
                      const col = catColor(category);
                      return (
                        <div key={skill} className="arsenal-top-chip arsenal-top-chip--covered" style={{ borderLeftColor: col }}>
                          <span className="arsenal-top-rank" style={{ color: "oklch(0.72 0.18 142)" }}>✓</span>
                          <span className="arsenal-top-name">{skill}</span>
                          <span className="arsenal-top-count" style={{ color: col }}>{count.toLocaleString()}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
