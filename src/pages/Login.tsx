import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AtriveoLogo from "../components/AtriveoLogo";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed");
      } else {
        navigate("/");
      }
    } catch {
      setError("Network error — try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-root">

      {/* ── Left: info panel ── */}
      <div className="login-left">
        <div className="login-left-inner">
          <a href="/landing/index.html" className="login-back">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
            Back
          </a>

          <div className="login-brand">
            <div className="login-brand-icon">
              <AtriveoLogo size={22} fill="oklch(0.66 0.19 255)" />
            </div>
            <span className="login-brand-name">Atriveo</span>
          </div>

          <div className="login-left-copy">
            <p className="login-left-eyebrow">Self-hosted · Local-first · Open source</p>
            <h1 className="login-left-headline">
              A self-hosted job search<br />
              <em>intelligence platform.</em>
            </h1>
            <p className="login-left-sub">
              Scrape. Score. Tailor. Apply. Everything runs on your machine —
              your data never leaves.
            </p>
          </div>

          <div className="login-features">
            <div className="login-feature">
              <div className="login-feature-icon">🔍</div>
              <div>
                <div className="login-feature-title">Multi-source scraper</div>
                <div className="login-feature-sub">Greenhouse, Lever, LinkedIn — hourly, automated</div>
              </div>
            </div>
            <div className="login-feature">
              <div className="login-feature-icon">✍️</div>
              <div>
                <div className="login-feature-title">LLM resume tailoring</div>
                <div className="login-feature-sub">Local Ollama · zero API cost · your bullets only</div>
              </div>
            </div>
            <div className="login-feature">
              <div className="login-feature-icon">📡</div>
              <div>
                <div className="login-feature-title">Recon + outreach</div>
                <div className="login-feature-sub">Email finder, templates, full pipeline tracking</div>
              </div>
            </div>
            <div className="login-feature">
              <div className="login-feature-icon">☁️</div>
              <div>
                <div className="login-feature-title">Cloudflare · Docker · OpenShift</div>
                <div className="login-feature-sub">Deploy anywhere — or stay fully local</div>
              </div>
            </div>
          </div>

          <div className="login-gh-link">
            <a href="https://github.com/atishay-kasliwal/Atriveo-JD-Extractor" target="_blank" rel="noopener">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
              </svg>
              Open source on GitHub
            </a>
          </div>
        </div>
      </div>

      {/* ── Right: login form ── */}
      <div className="login-right">
        <div className="login-form-wrap">
          <div className="login-form-header">
            <h2>Welcome back</h2>
            <p>Sign in to your Atriveo instance</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form-new">
            <div className="login-field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
              />
            </div>
            <div className="login-field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            {error && <div className="login-error-new">{error}</div>}
            <button type="submit" className="login-submit" disabled={loading}>
              {loading
                ? <><span className="login-spin" /> Signing in…</>
                : "Sign in →"
              }
            </button>
          </form>

          <div className="login-form-footer">
            <p>
              Don't have an instance?{" "}
              <a href="https://github.com/atishay-kasliwal/Atriveo-JD-Extractor" target="_blank" rel="noopener">
                Deploy your own →
              </a>
            </p>
          </div>
        </div>
      </div>

    </div>
  );
}
