import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

type DeployTab = "docker" | "node" | "cloudflare" | "openshift";

const DEPLOY_TABS: { id: DeployTab; label: string }[] = [
  { id: "docker", label: "Docker" },
  { id: "node", label: "Node / Python" },
  { id: "cloudflare", label: "Cloudflare" },
  { id: "openshift", label: "OpenShift" },
];

const DEPLOY_COMMANDS: Record<DeployTab, { lines: string[]; note: string }> = {
  docker: {
    lines: [
      "git clone https://github.com/atishay-kasliwal/Atriveo-JD-Extractor",
      "cd Atriveo-JD-Extractor",
      "cp .env.example .env   # add your MONGO_URI + API_KEY",
      "docker compose up -d",
      "",
      "# Your endpoint will be: http://localhost:3001",
    ],
    note: "Requires Docker Desktop. Starts the server + scraper in one command.",
  },
  node: {
    lines: [
      "git clone https://github.com/atishay-kasliwal/Atriveo-JD-Extractor",
      "cd Atriveo-JD-Extractor",
      "cp .env.example .env   # add your MONGO_URI + API_KEY",
      "",
      "# Server",
      "cd server && npm install && npm start",
      "",
      "# Your endpoint will be: http://localhost:3001",
    ],
    note: "Requires Node 18+ and a MongoDB instance (local or Atlas free tier).",
  },
  cloudflare: {
    lines: [
      "git clone https://github.com/atishay-kasliwal/Atriveo-JD-Extractor",
      "cd Atriveo-JD-Extractor",
      "cp .env.example .env",
      "npm install",
      "npx wrangler deploy",
      "",
      "# Your endpoint will be: https://<name>.workers.dev",
    ],
    note: "Deploys to Cloudflare Workers. Requires a Cloudflare account (free tier works).",
  },
  openshift: {
    lines: [
      "git clone https://github.com/atishay-kasliwal/Atriveo-JD-Extractor",
      "cd Atriveo-JD-Extractor/k8s",
      "",
      "# Edit values in openshift/values.yaml",
      "oc apply -f openshift/",
      "",
      "# Your endpoint will be your OpenShift route URL",
    ],
    note: "For enterprise or team deployments. Includes CronJob for hourly scraping.",
  },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="ob-copy-btn"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

function Step1({ onNext }: { onNext: () => void }) {
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0] ?? "there";

  return (
    <div className="ob-step">
      <div className="ob-step-icon">👋</div>
      <h1 className="ob-step-title">Welcome, {firstName}</h1>
      <p className="ob-step-desc">
        Atriveo is a self-hosted job search platform. It scrapes jobs from LinkedIn,
        Greenhouse, and Lever — then scores, tailors, and tracks them, all on <em>your</em> machine.
      </p>

      <div className="ob-bullets">
        <div className="ob-bullet">
          <span className="ob-bullet-dot" />
          <div>
            <strong>Your data never leaves your machine.</strong> The backend runs locally or on your own cloud — we never see your jobs or resumes.
          </div>
        </div>
        <div className="ob-bullet">
          <span className="ob-bullet-dot" />
          <div>
            <strong>This app is just the UI.</strong> application.atriveo.com is a thin shell that connects to your backend via an endpoint you provide.
          </div>
        </div>
        <div className="ob-bullet">
          <span className="ob-bullet-dot" />
          <div>
            <strong>You can connect multiple instances.</strong> Work laptop, home server, cloud — switch between them from the header.
          </div>
        </div>
      </div>

      <button className="ob-next-btn" onClick={onNext}>
        Got it — let's set up my backend →
      </button>
    </div>
  );
}

function Step2({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [activeTab, setActiveTab] = useState<DeployTab>("docker");
  const { lines, note } = DEPLOY_COMMANDS[activeTab];
  const codeText = lines.filter(l => !l.startsWith("#") && l !== "").join("\n");

  return (
    <div className="ob-step">
      <div className="ob-step-icon">🚀</div>
      <h1 className="ob-step-title">Start your backend</h1>
      <p className="ob-step-desc">
        Pick your deploy method, run the commands, then come back here once it's running.
      </p>

      <div className="ob-tabs">
        {DEPLOY_TABS.map(tab => (
          <button
            key={tab.id}
            className={`ob-tab ${activeTab === tab.id ? "ob-tab-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="ob-terminal">
        <div className="ob-terminal-header">
          <span className="ob-terminal-dot red" />
          <span className="ob-terminal-dot yellow" />
          <span className="ob-terminal-dot green" />
          <span className="ob-terminal-title">Terminal</span>
          <CopyButton text={codeText} />
        </div>
        <pre className="ob-terminal-body">
          {lines.map((line, i) => (
            <div key={i} className={line.startsWith("#") ? "ob-comment" : ""}>
              {line.startsWith("#") ? line : line === "" ? " " : `$ ${line}`}
            </div>
          ))}
        </pre>
      </div>

      <p className="ob-note">{note}</p>

      <div className="ob-step-actions">
        <button className="ob-back-btn" onClick={onBack}>← Back</button>
        <button className="ob-next-btn" onClick={onNext}>
          My backend is running →
        </button>
      </div>
    </div>
  );
}

function Step3({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState("My Instance");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, endpoint_url: url, api_key: key }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };

      if (!res.ok) {
        setError(data.error ?? "Connection failed");
      } else {
        navigate("/");
      }
    } catch {
      setError("Network error — check your connection and try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ob-step">
      <div className="ob-step-icon">🔌</div>
      <h1 className="ob-step-title">Connect your instance</h1>
      <p className="ob-step-desc">
        Paste your backend's URL and API key. We'll verify the connection before saving.
      </p>

      <form className="ob-connect-form" onSubmit={handleConnect}>
        <div className="ob-field">
          <label>Instance name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="My Home Instance"
            required
          />
        </div>

        <div className="ob-field">
          <label>Endpoint URL</label>
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="http://localhost:3001"
            required
          />
          <span className="ob-field-hint">The URL where your backend is running</span>
        </div>

        <div className="ob-field">
          <label>API Key</label>
          <input
            type="password"
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="sk_••••••••••••••••"
            required
          />
          <span className="ob-field-hint">From your <code>.env</code> file — <code>API_KEY=...</code></span>
        </div>

        {error && <div className="ob-error">{error}</div>}

        <div className="ob-step-actions">
          <button type="button" className="ob-back-btn" onClick={onBack}>← Back</button>
          <button type="submit" className="ob-next-btn" disabled={loading}>
            {loading ? (
              <><span className="login-spin" /> Testing connection…</>
            ) : (
              "Connect & open dashboard →"
            )}
          </button>
        </div>
      </form>

      <div className="ob-skip">
        <button onClick={() => navigate("/")} className="ob-skip-btn">
          Skip for now — I'll connect later
        </button>
      </div>
    </div>
  );
}

export default function Onboarding() {
  const [step, setStep] = useState(1);

  return (
    <div className="ob-root">
      <div className="ob-card">
        {/* Progress */}
        <div className="ob-progress">
          {[1, 2, 3].map(n => (
            <div key={n} className={`ob-progress-dot ${step >= n ? "ob-progress-dot-active" : ""} ${step > n ? "ob-progress-dot-done" : ""}`}>
              {step > n ? "✓" : n}
            </div>
          ))}
          <div className="ob-progress-line" style={{ "--fill": `${((step - 1) / 2) * 100}%` } as React.CSSProperties} />
        </div>

        {step === 1 && <Step1 onNext={() => setStep(2)} />}
        {step === 2 && <Step2 onNext={() => setStep(3)} onBack={() => setStep(1)} />}
        {step === 3 && <Step3 onBack={() => setStep(2)} />}
      </div>
    </div>
  );
}
