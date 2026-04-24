import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../hooks/useAuth";

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
    "Kafka":         [/kafka/i],
    "Flink":         [/\bflink\b/i],
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

function extractResumeSkills(text: string): Set<string> {
  const found = new Set<string>();
  for (const catSkills of Object.values(RESUME_PATTERNS)) {
    for (const [name, patterns] of Object.entries(catSkills)) {
      if (patterns.some(p => p.test(text))) found.add(name);
    }
  }
  return found;
}

function flatTopSkills(summary: SkillSummary, n: number): Array<{ skill: string; count: number; category: string; color: string }> {
  const all: Array<{ skill: string; count: number; category: string; color: string }> = [];
  for (const [cat, { skills, color }] of Object.entries(summary.categories)) {
    for (const [skill, count] of Object.entries(skills)) {
      all.push({ skill, count, category: cat, color });
    }
  }
  return all.sort((a, b) => b.count - a.count).slice(0, n);
}

export default function Skills() {
  const { user, logout } = useAuth();
  const [summary, setSummary] = useState<SkillSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [resumeText, setResumeText] = useState("");
  const [activeTab, setActiveTab] = useState<"market" | "gap">("market");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState("");

  useEffect(() => {
    fetch("/api/jobs?type=skills_summary")
      .then(r => r.json())
      .then(d => { setSummary(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const resumeSkills = useMemo(() => extractResumeSkills(resumeText), [resumeText]);

  const gapData = useMemo(() => {
    if (!summary) return [];
    const all: Array<{ skill: string; count: number; category: string; color: string; have: boolean }> = [];
    for (const [cat, { skills, color }] of Object.entries(summary.categories)) {
      for (const [skill, count] of Object.entries(skills)) {
        all.push({ skill, count, category: cat, color, have: resumeSkills.has(skill) });
      }
    }
    return all.sort((a, b) => b.count - a.count);
  }, [summary, resumeSkills]);

  const top20 = useMemo(() => summary ? flatTopSkills(summary, 20) : [], [summary]);
  const missing = useMemo(() => gapData.filter(s => !s.have).slice(0, 20), [gapData]);
  const covered = useMemo(() => gapData.filter(s => s.have), [gapData]);

  const hasResume = resumeText.trim().length > 50;

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

  return (
    <div>
      <header>
        <div className="wrapper header-inner">
          <div className="logo">
            <div className="logo-icon">A</div>
            <div>
              <div className="logo-name">Atriveo</div>
              <div className="logo-sub">Skills Intel</div>
            </div>
          </div>
          <div className="header-right">
            <nav className="nav-tabs">
              <a href="/" className="nav-tab">Live Feed</a>
              <a href="/weekly" className="nav-tab">Weekly</a>
              <a href="/skills" className="nav-tab active">Skills</a>
              <a href="/settings" className="nav-tab">Settings</a>
            </nav>
            <span className="header-user">Hi, {user?.name}</span>
            <button className="logout-btn" onClick={logout}>Sign out</button>
          </div>
        </div>
      </header>

      <div className="wrapper" style={{ paddingTop: 24, paddingBottom: 48 }}>
        {/* Page header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)" }}>
              Skills Intelligence
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
              {loading
                ? "Loading…"
                : summary
                  ? `Based on ${summary.total_analyzed.toLocaleString()} full job descriptions · Generated ${new Date(summary.generated_at).toLocaleDateString()}`
                  : "Data unavailable"}
            </div>
            {refreshMsg && (
              <div style={{ fontSize: 11, marginTop: 4, color: refreshMsg.includes("error") || refreshMsg.includes("Error") ? "#f87171" : "#4ade80" }}>
                {refreshMsg}
              </div>
            )}
          </div>
          <button
            className="refresh-btn"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Re-run data export from latest job descriptions"
          >
            {refreshing ? "Refreshing…" : "↺ Refresh Data"}
          </button>
        </div>

        {/* Tab bar */}
        <div className="skills-tab-bar">
          <button
            className={`skills-tab${activeTab === "market" ? " active" : ""}`}
            onClick={() => setActiveTab("market")}
          >
            Market Demand
          </button>
          <button
            className={`skills-tab${activeTab === "gap" ? " active" : ""}`}
            onClick={() => setActiveTab("gap")}
          >
            Resume Gap{hasResume ? ` · ${covered.length} covered / ${missing.length} missing` : ""}
          </button>
        </div>

        {loading ? (
          <div className="state-msg"><div className="spin" style={{ margin: "0 auto" }} /></div>
        ) : !summary ? (
          <div className="state-msg">Could not load skills data.</div>
        ) : activeTab === "market" ? (
          <>
            {/* Top 20 ranked */}
            <div className="skills-top-card" style={{ marginTop: 20 }}>
              <div className="skills-section-title">Top 20 Resume-Critical Keywords</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>
                Ranked by frequency across {summary.total_analyzed.toLocaleString()} job descriptions. Add these to your bullets.
              </div>
              <div className="skills-top-grid">
                {top20.map(({ skill, count, color }, i) => (
                  <div key={skill} className="skills-top-chip" style={{ borderLeft: `3px solid ${color}` }}>
                    <span className="skills-top-rank">#{i + 1}</span>
                    <span className="skills-top-name">{skill}</span>
                    <span className="skills-top-count">{count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Category cards */}
            <div className="skills-grid" style={{ marginTop: 24 }}>
              {Object.entries(summary.categories).map(([category, { skills, color }]) => {
                const catSkills = Object.entries(skills);
                if (catSkills.length === 0) return null;
                const maxCount = catSkills[0][1];
                return (
                  <div key={category} className="skills-cat-card">
                    <div className="skills-cat-header">
                      <span className="skills-cat-dot" style={{ background: color }} />
                      <span className="skills-cat-title">{category}</span>
                      <span className="skills-cat-count">{catSkills.length} skills</span>
                    </div>
                    <div className="skills-bars">
                      {catSkills.map(([skill, count]) => (
                        <div key={skill} className="skills-bar-row">
                          <span className="skills-bar-label">{skill}</span>
                          <div className="skills-bar-track">
                            <div
                              className="skills-bar-fill"
                              style={{ width: `${(count / maxCount) * 100}%`, background: color }}
                            />
                          </div>
                          <span className="skills-bar-val">{count.toLocaleString()}</span>
                          <span className="skills-bar-pct">{Math.round((count / summary.total_analyzed) * 100)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          /* ── Resume Gap Tab ─────────────────────────────────────────── */
          <div style={{ marginTop: 20 }}>
            {/* Resume input */}
            <div className="skills-resume-box">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Paste Your Resume</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    We scan it locally — nothing leaves your browser
                  </div>
                </div>
                {hasResume && (
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    <span style={{ color: "#22c55e", fontWeight: 700 }}>{covered.length}</span> skills detected
                  </div>
                )}
              </div>
              <textarea
                className="skills-resume-input"
                placeholder="Paste your resume text here…"
                value={resumeText}
                onChange={e => setResumeText(e.target.value)}
                rows={8}
              />
            </div>

            {!hasResume ? (
              <div className="state-msg" style={{ marginTop: 32, opacity: 0.6 }}>
                Paste your resume above to see the gap analysis
              </div>
            ) : (
              <>
                {/* Gap summary bar */}
                <div className="skills-gap-summary">
                  <div className="skills-gap-stat green">
                    <div className="skills-gap-num">{covered.length}</div>
                    <div className="skills-gap-lbl">Skills Covered</div>
                  </div>
                  <div className="skills-gap-stat red">
                    <div className="skills-gap-num">{missing.length}+</div>
                    <div className="skills-gap-lbl">High-Demand Missing</div>
                  </div>
                  <div className="skills-gap-stat blue">
                    <div className="skills-gap-num">{Math.round((covered.length / (covered.length + missing.length)) * 100)}%</div>
                    <div className="skills-gap-lbl">ATS Coverage</div>
                  </div>
                </div>

                {/* Top missing */}
                <div className="skills-top-card" style={{ marginTop: 20 }}>
                  <div className="skills-section-title" style={{ color: "#f87171" }}>
                    Top Skills to Add to Your Resume
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 14 }}>
                    Highest-demand skills not detected in your resume — sorted by market demand
                  </div>
                  <div className="skills-gap-grid">
                    {missing.map(({ skill, count, color }, i) => (
                      <div key={skill} className="skills-gap-chip missing" style={{ borderLeft: `3px solid ${color}` }}>
                        <span className="skills-gap-rank">#{i + 1}</span>
                        <span className="skills-gap-name">{skill}</span>
                        <span className="skills-gap-count">{count.toLocaleString()} jobs</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Covered skills */}
                <div className="skills-top-card" style={{ marginTop: 20 }}>
                  <div className="skills-section-title" style={{ color: "#4ade80" }}>
                    Skills You Already Cover
                  </div>
                  <div className="skills-gap-grid">
                    {covered.map(({ skill, count, color }) => (
                      <div key={skill} className="skills-gap-chip covered" style={{ borderLeft: `3px solid ${color}` }}>
                        <span className="skills-gap-check">✓</span>
                        <span className="skills-gap-name">{skill}</span>
                        <span className="skills-gap-count">{count.toLocaleString()} jobs</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <footer>
        <div className="wrapper">
          Atriveo &nbsp;·&nbsp; Skills data from {summary?.total_analyzed.toLocaleString() ?? "…"} job descriptions
        </div>
      </footer>
    </div>
  );
}
