import { useState, useEffect, useRef } from "react";
import AppHeader from "../components/AppHeader";
import PageIntro from "../components/PageIntro";

const RESUME_KEY = "atriveo_resume";
const OLLAMA_BASE = "http://localhost:11434";

const MODELS = [
  { id: "gemma4:12b", label: "Gemma4 12B",  note: "Best JD-aligned bullets · one-page" },
];

const SYSTEM_PROMPT = `You are an expert ATS resume optimizer and technical recruiter. Your output is a single valid JSON object — no markdown, no explanation, no text outside the JSON.

TRUTH RULES (non-negotiable):
- Only suggest changes that are truthful given the candidate's actual experience.
- Never fabricate tools, metrics, companies, companies, or outcomes.
- Never invent experience the candidate does not have.
- If a JD term has no evidence in the resume, list it as missing. Do not claim it.

BULLET QUALITY STANDARD:
- Every rewritten bullet must contain: strong action verb + scope/stack + measurable impact or concrete scale.
- Put the strongest impact signal in the first 8-12 words.
- One bullet = one clear win. No overloaded bullets.
- No semicolons. No em-dashes. No "leveraged", "spearheaded", "cutting-edge", "dynamic".
- No vague claims ("improved performance", "worked on scalable systems"). Require a number, named tool, named client, or concrete outcome.
- No academic verbs on production work ("researched", "explored"). Use: Built, Shipped, Engineered, Automated, Reduced, Owned, Deployed, Scaled, Architected, Optimized.
- Vary sentence length and structure so output does not read AI-generated.
- ONLY include bullets you actually changed. Do NOT return a bullet unchanged. If a bullet is already strong, leave it out entirely.

ATS KEYWORD RULES:
- Preserve exact JD keyword spelling in rewrites (do not paraphrase "Kubernetes" as "container orchestration").
- No keyword repeated more than 3 times across all rewrites; use semantic variants after that.
- Missing keywords = present in JD, absent from resume AND not fabricatable.

SCORING:
- ats_before: honest estimate of how well the current resume matches this JD (0-100).
- ats_after: honest estimate after applying all suggested changes (0-100).
- human_before: readability/impact score of current resume for a human recruiter (0-100).
- human_after: readability/impact score after changes (0-100).
- If 90+ ATS is not truthfully reachable, cap ats_after honestly and note the gap in quick_wins.

Return this exact JSON shape:
{
  "ats_before": <integer 0-100>,
  "ats_after": <integer 0-100>,
  "human_before": <integer 0-100>,
  "human_after": <integer 0-100>,
  "keyword_audit": {
    "have_now": [<string>, ...],
    "missing": [<string>, ...],
    "likely": [<string>, ...]
  },
  "bullet_rewrites": [
    { "before": "<exact existing bullet text>", "after": "<improved version>", "reason": "<one sentence why this is better for THIS jd>" }
  ],
  "summary_rewrite": { "before": "<existing summary or null>", "after": "<improved version>", "reason": "<one sentence why>" } | null,
  "skills_to_add": [<string>, ...],
  "quick_wins": "<2-3 sentences: highest-impact actions, honest gap report if 90+ is not reachable>"
}`;

// Strict schema passed to Ollama's `format` field (structured outputs). This
// forces every field to exist and be the right type, which kills the empty-
// field dropout and section-misID we saw with free-form JSON on smaller models.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    ats_before:   { type: "integer" },
    ats_after:    { type: "integer" },
    human_before: { type: "integer" },
    human_after:  { type: "integer" },
    keyword_audit: {
      type: "object",
      properties: {
        have_now: { type: "array", items: { type: "string" } },
        missing:  { type: "array", items: { type: "string" } },
        likely:   { type: "array", items: { type: "string" } },
      },
      required: ["have_now", "missing", "likely"],
    },
    bullet_rewrites: {
      type: "array",
      items: {
        type: "object",
        properties: {
          before: { type: "string" },
          after:  { type: "string" },
          reason: { type: "string" },
        },
        required: ["before", "after", "reason"],
      },
    },
    summary_rewrite: {
      type: ["object", "null"],
      properties: {
        before: { type: ["string", "null"] },
        after:  { type: "string" },
        reason: { type: "string" },
      },
    },
    skills_to_add: { type: "array", items: { type: "string" } },
    quick_wins:    { type: "string" },
  },
  required: [
    "ats_before", "ats_after", "human_before", "human_after",
    "keyword_audit", "bullet_rewrites", "skills_to_add", "quick_wins",
  ],
} as const;

type BulletRewrite = {
  before: string;
  after: string;
  reason: string;
};

type SummaryRewrite = {
  before: string | null;
  after: string;
  reason: string;
} | null;

type KeywordAudit = {
  have_now: string[];
  missing: string[];
  likely: string[];
};

type OptimizeResult = {
  ats_before: number;
  ats_after: number;
  human_before: number;
  human_after: number;
  keyword_audit: KeywordAudit;
  bullet_rewrites: BulletRewrite[];
  summary_rewrite: SummaryRewrite;
  skills_to_add: string[];
  quick_wins: string;
};

function extractJSON(raw: string): string {
  // Strip any wrapping markdown code fences
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  // Find first { ... } block
  const start = raw.indexOf("{");
  const end   = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}

export default function ResumeOptimizer() {
  const [resumeText, setResumeText] = useState("");
  const [jdText, setJdText]         = useState("");
  const [model, setModel]           = useState("gemma4:12b");
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState<OptimizeResult | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [streamLog, setStreamLog]   = useState("");
  const abortRef                    = useRef<AbortController | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(RESUME_KEY) || "";
    setResumeText(saved);
  }, []);

  function saveResume() {
    localStorage.setItem(RESUME_KEY, resumeText);
  }

  async function runOptimize() {
    if (!resumeText.trim()) { setError("Paste your resume first."); return; }
    if (!jdText.trim())     { setError("Paste a job description first."); return; }

    setLoading(true);
    setError(null);
    setResult(null);
    setStreamLog("");

    abortRef.current = new AbortController();

    const userMessage =
      `--- JOB DESCRIPTION ---\n${jdText.trim()}\n\n--- MY RESUME ---\n${resumeText.trim()}`;

    try {
      const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user",   content: userMessage },
          ],
          stream: true,
          think: false,
          format: RESPONSE_SCHEMA,
          options: { temperature: 0.15, num_predict: 3584 },
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Ollama error ${res.status}: ${txt}`);
      }

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let   full         = "";
      let   doneReason   = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            const token  = parsed?.message?.content ?? "";
            full += token;
            if (parsed?.done) doneReason = parsed?.done_reason ?? "";
            setStreamLog(full);
          } catch { /* ignore malformed lines */ }
        }
      }

      // The model hit its token budget and was cut off mid-JSON. Smaller models
      // (qwen3) do this; show a clear message instead of a cryptic parse crash.
      if (doneReason === "length") {
        throw new Error(
          `The ${MODELS.find(m => m.id === model)?.label ?? model} response was cut off at its token limit, so the result is incomplete. Try again, or switch to Gemma4 12B which completes more reliably.`,
        );
      }

      const jsonStr = extractJSON(full);
      let   parsed: OptimizeResult;
      try {
        parsed = JSON.parse(jsonStr) as OptimizeResult;
      } catch {
        throw new Error(
          "The model returned malformed JSON. Try again, or switch to Gemma4 12B for more reliable output.",
        );
      }
      // Smaller models pad the list with unchanged "no-op" bullets. Drop any
      // rewrite where before === after so only real edits are shown.
      const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
      parsed.bullet_rewrites = (parsed.bullet_rewrites ?? []).filter(
        (b) => b.before && b.after && norm(b.before) !== norm(b.after),
      );
      setResult(parsed);
      setStreamLog("");
    } catch (e: unknown) {
      if ((e as Error).name === "AbortError") return;
      const msg = (e as Error).message || String(e);
      if (msg.includes("Failed to fetch") || msg.includes("ERR_CONNECTION_REFUSED") || msg.includes("NetworkError") || msg.includes("403")) {
        setError(
          window.location.hostname !== "localhost"
            ? "Resume Optimizer requires local access. Open the app at http://localhost:5173 — Ollama runs on your machine and cannot be reached from the deployed URL."
            : "Cannot reach Ollama at localhost:11434. Make sure Ollama is running: ollama serve"
        );
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  function stopGeneration() {
    abortRef.current?.abort();
    setLoading(false);
  }

  const isLocalhost = typeof window !== "undefined" && window.location.hostname === "localhost";
  const canRun = resumeText.trim().length > 50 && jdText.trim().length > 50;

  const scoreDelta = result ? result.ats_after - result.ats_before : 0;

  return (
    <div>
      <AppHeader />
      <div className="legacy-tool-banner wrapper">
        <strong>Legacy Optimizer</strong> — Gemma rewrite playground. Does not use the evidence compiler.
        Use <a href="/">Feed</a> for production PDFs.
      </div>

      <div className="wrapper page-shell page-shell-narrow">
        <PageIntro
          kicker="Resume Optimizer"
          title="ATS optimization powered by local AI"
          description="Paste your resume and a job description. The model runs entirely on your machine — nothing is sent to any server."
          stats={[
            { label: "Model",   value: MODELS.find(m => m.id === model)?.label ?? model, tone: "blue" },
            { label: "Resume",  value: resumeText ? `${resumeText.length.toLocaleString()} chars` : "Empty", tone: resumeText.length > 50 ? "green" : "red" },
            { label: "JD",      value: jdText     ? `${jdText.length.toLocaleString()} chars`     : "Empty", tone: jdText.length     > 50 ? "green" : "red" },
          ]}
        />

        {/* ── Local-only warning ── */}
        {!isLocalhost && (
          <div className="optimizer-error" style={{ marginTop: 16 }}>
            This page requires local access. Open the app at{" "}
            <strong>http://localhost:5173</strong> — Ollama runs on your machine
            and cannot be reached from the deployed URL.
          </div>
        )}

        {/* ── Inputs ── */}
        <div className="optimizer-grid">

          {/* Resume */}
          <div className="optimizer-input-block">
            <div className="optimizer-input-label">
              Your Resume
              <span className="optimizer-input-hint">Stored locally · same as Settings</span>
            </div>
            <textarea
              className="optimizer-textarea"
              placeholder="Paste your resume text here…"
              value={resumeText}
              onChange={e => { setResumeText(e.target.value); saveResume(); }}
              rows={14}
            />
          </div>

          {/* JD */}
          <div className="optimizer-input-block">
            <div className="optimizer-input-label">
              Job Description
              <span className="optimizer-input-hint">Paste the full JD text</span>
            </div>
            <textarea
              className="optimizer-textarea"
              placeholder="Paste the job description here…"
              value={jdText}
              onChange={e => setJdText(e.target.value)}
              rows={14}
            />
          </div>
        </div>

        {/* ── Controls ── */}
        <div className="optimizer-controls">
          <div className="optimizer-model-row">
            {MODELS.map(m => (
              <button
                key={m.id}
                className={`optimizer-model-btn${model === m.id ? " active" : ""}`}
                onClick={() => setModel(m.id)}
                disabled={loading}
              >
                <span className="optimizer-model-name">{m.label}</span>
                <span className="optimizer-model-note">{m.note}</span>
              </button>
            ))}
          </div>

          <div className="optimizer-action-row">
            {loading ? (
              <button className="optimizer-stop-btn" onClick={stopGeneration}>
                Stop
              </button>
            ) : (
              <button
                className="optimizer-run-btn"
                onClick={runOptimize}
                disabled={!canRun}
              >
                Optimize Resume
              </button>
            )}
            {loading && (
              <span className="optimizer-loading-label">
                <span className="spin" style={{ display: "inline-block", width: 12, height: 12, marginRight: 6, verticalAlign: "middle" }} />
                Running {MODELS.find(m => m.id === model)?.label}…
              </span>
            )}
          </div>

          {!canRun && !loading && (
            <div className="optimizer-hint-row">
              {!resumeText.trim() && <span>Add your resume · </span>}
              {!jdText.trim()     && <span>Add a job description</span>}
            </div>
          )}
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="optimizer-error">{error}</div>
        )}

        {/* ── Streaming preview ── */}
        {loading && streamLog && (
          <div className="optimizer-stream-box">
            <div className="optimizer-stream-label">Generating…</div>
            <pre className="optimizer-stream-pre">{streamLog}</pre>
          </div>
        )}

        {/* ── Results ── */}
        {result && (
          <div className="optimizer-results">

            {/* Score banner */}
            <div className="optimizer-score-banner">
              <div className="optimizer-score-block">
                <div className="optimizer-score-num muted">{result.ats_before}%</div>
                <div className="optimizer-score-lbl">ATS Before</div>
              </div>
              <div className="optimizer-score-arrow">→</div>
              <div className="optimizer-score-block">
                <div className={`optimizer-score-num ${scoreDelta >= 10 ? "green" : "blue"}`}>{result.ats_after}%</div>
                <div className="optimizer-score-lbl">ATS After</div>
              </div>
              {scoreDelta > 0 && (
                <div className="optimizer-score-delta">+{scoreDelta} pts</div>
              )}
              <div className="optimizer-score-divider" />
              <div className="optimizer-score-block">
                <div className="optimizer-score-num muted">{result.human_before}%</div>
                <div className="optimizer-score-lbl">Human Before</div>
              </div>
              <div className="optimizer-score-arrow">→</div>
              <div className="optimizer-score-block">
                <div className={`optimizer-score-num ${(result.human_after - result.human_before) >= 10 ? "green" : "blue"}`}>{result.human_after}%</div>
                <div className="optimizer-score-lbl">Human After</div>
              </div>
            </div>

            {/* Quick wins */}
            <div className="optimizer-section">
              <div className="optimizer-section-title">Quick Wins</div>
              <div className="optimizer-quick-wins">{result.quick_wins}</div>
            </div>

            {/* Keyword audit */}
            {(result.keyword_audit.have_now.length > 0 || result.keyword_audit.missing.length > 0 || result.keyword_audit.likely.length > 0) && (
              <div className="optimizer-section">
                <div className="optimizer-section-title">Keyword Audit</div>
                <div className="optimizer-keyword-audit">
                  {result.keyword_audit.have_now.length > 0 && (
                    <div className="optimizer-audit-group">
                      <div className="optimizer-audit-label green">Have Now</div>
                      <div className="optimizer-keyword-chips">
                        {result.keyword_audit.have_now.map((kw: string) => (
                          <span key={kw} className="optimizer-keyword-chip green">{kw}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {result.keyword_audit.missing.length > 0 && (
                    <div className="optimizer-audit-group">
                      <div className="optimizer-audit-label red">Missing</div>
                      <div className="optimizer-keyword-chips">
                        {result.keyword_audit.missing.map((kw: string) => (
                          <span key={kw} className="optimizer-keyword-chip">{kw}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {result.keyword_audit.likely.length > 0 && (
                    <div className="optimizer-audit-group">
                      <div className="optimizer-audit-label muted">Likely / Confirm</div>
                      <div className="optimizer-keyword-chips">
                        {result.keyword_audit.likely.map((kw: string) => (
                          <span key={kw} className="optimizer-keyword-chip muted">{kw}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Skills to add */}
            {result.skills_to_add.length > 0 && (
              <div className="optimizer-section">
                <div className="optimizer-section-title">Skills to Add</div>
                <div className="optimizer-keyword-chips">
                  {result.skills_to_add.map((s: string) => (
                    <span key={s} className="optimizer-keyword-chip green">{s}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Summary rewrite */}
            {result.summary_rewrite && (
              <div className="optimizer-section">
                <div className="optimizer-section-title">Summary Rewrite</div>
                <div className="optimizer-rewrite-card">
                  {result.summary_rewrite.before && (
                    <div className="optimizer-rewrite-before">
                      <div className="optimizer-rewrite-tag before">Before</div>
                      <div className="optimizer-rewrite-text">{result.summary_rewrite.before}</div>
                    </div>
                  )}
                  <div className="optimizer-rewrite-after">
                    <div className="optimizer-rewrite-tag after">After</div>
                    <div className="optimizer-rewrite-text">{result.summary_rewrite.after}</div>
                  </div>
                  <div className="optimizer-rewrite-reason">{result.summary_rewrite.reason}</div>
                </div>
              </div>
            )}

            {/* Bullet rewrites */}
            {result.bullet_rewrites.length > 0 && (
              <div className="optimizer-section">
                <div className="optimizer-section-title">Bullet Rewrites</div>
                <div className="optimizer-rewrites-list">
                  {result.bullet_rewrites.map((rw, i) => (
                    <div key={i} className="optimizer-rewrite-card">
                      <div className="optimizer-rewrite-before">
                        <div className="optimizer-rewrite-tag before">Before</div>
                        <div className="optimizer-rewrite-text">{rw.before}</div>
                      </div>
                      <div className="optimizer-rewrite-after">
                        <div className="optimizer-rewrite-tag after">After</div>
                        <div className="optimizer-rewrite-text">{rw.after}</div>
                      </div>
                      <div className="optimizer-rewrite-reason">{rw.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <footer>
        <div className="wrapper">Atriveo · Resume Optimizer · Local AI</div>
      </footer>
    </div>
  );
}
