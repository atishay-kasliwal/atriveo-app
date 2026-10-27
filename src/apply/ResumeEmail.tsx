import { useEffect, useRef, useState } from "react";
import { fetchJson } from "./engine";
import { getTailorServerBase } from "../utils/tailorServer";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
async function call<T>(path: string, body?: object): Promise<T> {
  const { res, json } = await fetchJson<T & { ok?: boolean; error?: string }>(`${getTailorServerBase()}/resume-builder/${path}`, body ? { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "include", cache: "no-store" });
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json as T;
}

/** The email printed on this job's resume, edited in place: saving rebuilds the PDF with the new address. */
export default function ResumeEmail({ jobUrl, onSaved }: { jobUrl: string; onSaved: (email: string) => void }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setOpen(false); setCurrent(null); setError(""); }, [jobUrl]);
  useEffect(() => {
    if (!open || current !== null) return;
    let alive = true;
    call<{ email: string }>(`load?job=${encodeURIComponent(jobUrl)}`).then((r) => { if (alive) { setCurrent(r.email || ""); setValue(r.email || ""); } }, (e) => { if (alive) setError(e instanceof Error ? e.message : "Could not read the resume's email."); });
    return () => { alive = false; };
  }, [open, current, jobUrl]);
  useEffect(() => { if (open && current !== null) input.current?.select(); }, [open, current]);
  const clean = value.trim();
  const valid = EMAIL.test(clean), changed = clean !== (current ?? "");
  const save = async () => {
    if (!valid || !changed || busy) return;
    setBusy(true); setError("");
    try { const r = await call<{ email: string }>("set-email", { jobUrl, email: clean }); setCurrent(r.email); setOpen(false); onSaved(r.email); }
    catch (e) { setError(e instanceof Error ? e.message : "The email was not changed."); }
    finally { setBusy(false); }
  };
  return (
    <span className="re">
      <button type="button" className="re-chip" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Change the email printed on this resume">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.500"/><path d="m3.500 7.500 8.500 6 8.500-6"/></svg>
        {current || "Email"}
      </button>
      {open && (
        <form className="re-pop" onSubmit={(e) => { e.preventDefault(); void save(); }} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
          <label>Email on this resume
            <input ref={input} type="email" autoComplete="email" value={value} maxLength={80} disabled={busy || current === null} placeholder={current === null ? "Loading…" : "you@example.com"} aria-invalid={Boolean(clean) && !valid} onChange={(e) => setValue(e.target.value)} />
          </label>
          <div className="re-row">
            <small>{busy ? "Rebuilding the resume · about 10 seconds" : error ? "" : "Only the email changes. The rest of the resume stays as it is."}</small>
            <button type="button" className="apps-btn" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            <button type="submit" className="rv-primary" disabled={!valid || !changed || busy}>{busy ? "Saving…" : "Save"}</button>
          </div>
          {error && <p className="re-error" role="alert">{error}</p>}
        </form>
      )}
    </span>
  );
}
