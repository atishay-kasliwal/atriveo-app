import AtriveoLogo from "../components/AtriveoLogo";
import type { User } from "../types";

async function signOut() {
  try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* the cookie clears server-side */ }
  window.location.replace("/login");
}

export default function ApplyHeader({ user }: { user: User }) {
  const initial = (user.name || user.email || "A").trim().charAt(0).toUpperCase();
  return (
    <div className="apply-header">
      <a className="apply-brand" href="/" aria-label="Atriveo Apply home">
        <AtriveoLogo />
        <span>Atriveo <b>Apply</b></span>
      </a>
      <div className="apply-header-right">
        <a className="apply-ext" href="https://application.atriveo.com" target="_blank" rel="noreferrer">Job feed ↗</a>
        <span className="apply-user" title={user.email}><span className="apply-avatar" aria-hidden>{initial}</span><span className="apply-user-name">{user.name || user.email}</span></span>
        <button type="button" className="apply-signout" onClick={() => void signOut()}>Sign out</button>
      </div>
    </div>
  );
}
