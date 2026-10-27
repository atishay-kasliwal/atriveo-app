import { useEffect, useRef, useState } from "react";
import { fetchJson, getJson } from "./engine";
import { getTailorServerBase } from "../utils/tailorServer";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
async function call<T>(path: string, body?: object): Promise<T> {
  const { res, json } = await fetchJson<T & { ok?: boolean; error?: string }>(`${getTailorServerBase()}/resume-builder/${path}`, body ? { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "include", cache: "no-store" });
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json as T;
}

async function postEmails(body: object): Promise<Saved> {
  const { res, json } = await fetchJson<Saved & { ok?: boolean; error?: string }>(`${getTailorServerBase()}/applications/resume-emails`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json as Saved;
}

interface Saved { list: string[]; default: string | null; current: string }

/** The email printed on this job's resume, edited in the right bar: saving rebuilds this PDF, and (if ticked) every new resume uses it too. */
export default function ResumeEmailForm({ jobUrl, onSaved, onDone }: { jobUrl: string; onSaved: (email: string) => void; onDone: () => void }) {
  const [current, setCurrent] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [value, setValue] = useState("");
  const [forNew, setForNew] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true;
    setCurrent(null); setError("");
    call<{ email: string }>(`load?job=${encodeURIComponent(jobUrl)}`).then((r) => { if (alive) { setCurrent(r.email || ""); setValue(r.email || ""); } }, (e) => { if (alive) setError(e instanceof Error ? e.message : "Could not read the resume's email."); });
    getJson<Saved>("/applications/resume-emails").then((r) => alive && setSaved(r), () => {});
    return () => { alive = false; };
  }, [jobUrl]);
  useEffect(() => { if (current !== null) input.current?.select(); }, [current]);
  const clean = value.trim().toLowerCase();
  const valid = EMAIL.test(clean), changed = clean !== (current ?? "").toLowerCase();
  const isDefault = saved?.default === clean || (!saved?.default && clean === (saved?.current ?? "").toLowerCase());
  const makeDefault = forNew && valid && !isDefault;
  const manage = async (action: "add" | "default" | "remove", email: string) => {
    const r = await postEmails({ action, email }); setSaved(r); return r;
  };
  const save = async () => {
    if (!valid || busy || (!changed && !makeDefault)) return;
    setBusy(true); setError("");
    try {
      if (changed) { const r = await call<{ email: string }>("set-email", { jobUrl, email: clean }); setCurrent(r.email); onSaved(r.email); }
      await manage(makeDefault ? "default" : "add", clean);
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "The email was not changed."); }
    finally { setBusy(false); }
  };
  return (
    <form className="re-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="jm-sr-only" htmlFor="re-email">Email on this resume</label>
      <input id="re-email" ref={input} data-popover-focus type="email" autoComplete="email" value={value} maxLength={80} disabled={busy || current === null} placeholder={current === null ? "Loading…" : "you@example.com"} aria-invalid={Boolean(clean) && !valid} onChange={(e) => setValue(e.target.value)} />
      {saved && saved.list.length > 0 && (
        <ul className="re-saved" aria-label="Saved emails">
          {saved.list.map((m) => (
            <li key={m} className={m === clean ? "on" : ""}>
              <button type="button" className="re-pick" onClick={() => setValue(m)} disabled={busy}><span>{m}</span>{m === saved.default && <em>new resumes</em>}{m === (current ?? "").toLowerCase() && <em className="cur">this resume</em>}</button>
              <button type="button" className="re-x" aria-label={`Forget ${m}`} title="Forget this address" disabled={busy} onClick={() => void manage("remove", m).catch((e) => setError(e instanceof Error ? e.message : "Could not remove it."))}>✕</button>
            </li>))}
        </ul>)}
      <label className="re-new"><input type="checkbox" checked={forNew} onChange={(e) => setForNew(e.target.checked)} disabled={busy} /> Use for new resumes too{isDefault && valid ? " (already the one)" : ""}</label>
      <div className="jm-filter-popup-footer">
        <button type="button" className="apps-link" onClick={onDone} disabled={busy}>Cancel</button>
        <button type="submit" className="jm-filter-done" disabled={!valid || (!changed && !makeDefault) || busy}>{busy ? (changed ? "Rebuilding…" : "Saving…") : changed ? "Save" : "Set as default"}</button>
      </div>
      <p className="jm-filter-popup-hint" role={error ? "alert" : undefined}>{error || (busy && changed ? "Rebuilding the resume, about 10 seconds." : changed ? "This resume is rebuilt with the new address; the rest stays." : "Pick a saved address, or type a new one.")}</p>
    </form>
  );
}
