import { useState } from "react";
import { useNavigate } from "react-router-dom";
import ApplyLogo from "./ApplyLogo";

const ERROR_MESSAGES: Record<string, string> = {
  not_allowed: "That account is not an admin of this site.",
  google_denied: "Google sign-in was cancelled.",
  invalid_callback: "Sign-in did not complete. Please try again.",
  invalid_state: "Your sign-in session expired. Please try again.",
  token_exchange: "Could not complete Google sign-in. Please try again.",
  unverified_email: "Your Google account email is not verified.",
};

type Mode = "login" | "signup";

/** Admin sign-in for apply.atriveo.com. The server only accepts allowlisted emails, for sign-up too. */
export default function AdminLogin() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(() => {
    const err = new URLSearchParams(window.location.search).get("error");
    return err ? ERROR_MESSAGES[err] ?? "Something went wrong. Please try again." : "";
  });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "login" ? { email, password } : { name, email, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Sign-in failed (${res.status})`);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="apply-login">
      <div className="apply-login-card">
        <div className="apply-login-brand"><ApplyLogo height={34} /><span className="apply-brand-by">by Atriveo</span></div>
        <h1>{mode === "login" ? "Admin sign in" : "Create the admin account"}</h1>
        <p className="apply-login-sub">The application engine console. Only allowlisted admin emails can sign in or sign up.</p>

        <a className="apply-google" href="/api/auth/google">Continue with Google</a>
        <div className="apply-or"><span>or</span></div>

        <form onSubmit={submit} className="apply-form">
          {mode === "signup" && (
            <label>Name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></label>
          )}
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={mode === "signup" ? 8 : undefined} autoComplete={mode === "login" ? "current-password" : "new-password"} required /></label>
          {error && <p className="apply-error" role="alert">{error}</p>}
          <button type="submit" className="apply-submit" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
        </form>

        <p className="apply-switch">
          {mode === "login"
            ? <>First time here? <button type="button" onClick={() => { setMode("signup"); setError(""); }}>Create the admin account</button></>
            : <>Already have an account? <button type="button" onClick={() => { setMode("login"); setError(""); }}>Sign in</button></>}
        </p>
      </div>
    </main>
  );
}
