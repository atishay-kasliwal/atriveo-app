import { useEffect, useRef, useState } from "react";
import { fetchJson } from "./engine";
import { getTailorServerBase } from "../utils/tailorServer";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
async function call<T>(path: string, body?: object): Promise<T> {
  const { res, json } = await fetchJson<T & { ok?: boolean; error?: string }>(`${getTailorServerBase()}/resume-builder/${path}`, body ? { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "include", cache: "no-store" });
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json as T;
}

/** The email printed on this job's resume, edited in the right bar: saving rebuilds the PDF with the new address. */
export default function ResumeEmailForm({ jobUrl, onSaved, onDone }: { jobUrl: string; onSaved: (email: string) => void; onDone: () => void }) {
  const [current, setCurrent] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true;
    setCurrent(null); setError("");
    call<{ email: string }>(`load?job=${encodeURIComponent(jobUrl)}`).then((r) => { if (alive) { setCurrent(r.email || ""); setValue(r.email || ""); } }, (e) => { if (alive) setError(e instanceof Error ? e.message : "Could not read the resume's email."); });
    return () => { alive = false; };
  }, [jobUrl]);
  useEffect(() => { if (current !== null) input.current?.select(); }, [current]);
  const clean = value.trim();
  const valid = EMAIL.test(clean), changed = clean !== (current ?? "");
  const save = async () => {
    if (!valid || !changed || busy) return;
    setBusy(true); setError("");
    try { const r = await call<{ email: string }>("set-email", { jobUrl, email: clean }); setCurrent(r.email); onSaved(r.email); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : "The email was not changed."); }
    finally { setBusy(false); }
  };
  return (
    <form className="re-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="jm-sr-only" htmlFor="re-email">Email on this resume</label>
      <input id="re-email" ref={input} data-popover-focus type="email" autoComplete="email" value={value} maxLength={80} disabled={busy || current === null} placeholder={current === null ? "Loading…" : "you@example.com"} aria-invalid={Boolean(clean) && !valid} onChange={(e) => setValue(e.target.value)} />
      <div className="jm-filter-popup-footer">
        <button type="button" className="apps-link" onClick={onDone} disabled={busy}>Cancel</button>
        <button type="submit" className="jm-filter-done" disabled={!valid || !changed || busy}>{busy ? "Rebuilding…" : "Save"}</button>
      </div>
      <p className="jm-filter-popup-hint" role={error ? "alert" : undefined}>{error || (busy ? "Rebuilding the resume, about 10 seconds." : "Only the email changes; the rest of the resume stays.")}</p>
    </form>
  );
}
