import { useEffect, useRef, useState } from "react";
import { fetchJson } from "./engine";
import { getTailorServerBase } from "../utils/tailorServer";

type Kind = "why-company" | "why-hire" | "custom";
type Length = "short" | "standard" | "long";
interface Answer { id: string; provider: string; kind: Kind; question: string; text: string; words: number; used: { id: string; employer: string; text: string }[]; companyPoints: string[]; note: string }
interface Job { id: string; company: string; title: string }

const KINDS: { value: Kind; label: string; hint: string }[] = [
  { value: "why-company", label: "Why this company", hint: "Built from what the posting says about them and the evidence in your bank that connects." },
  { value: "why-hire", label: "Right hire for this role", hint: "The role's top requirements, each met by one piece of your evidence." },
  { value: "custom", label: "Another question", hint: "Paste the question exactly as the form asks it." },
];
const LENGTHS: { value: Length; label: string }[] = [{ value: "short", label: "Short · ~70 words" }, { value: "standard", label: "Standard · ~120" }, { value: "long", label: "Long · ~200" }];
const PROVIDERS = [{ value: "codex", label: "Codex" }, { value: "claude", label: "Claude" }, { value: "claude-codex", label: "Claude writes · Codex checks" }];
const STAGES: Record<string, string> = { reading: "Reading the posting and your bank…", queued: "Waiting for your Mac…", thinking: "Writing the answer…", checking: "Checking it…", verifying: "Checking it…", offline: "Your Mac is offline. Wake it and this continues.", reconnecting: "Reconnecting · your request is still saved" };

const safeGet = (key: string) => { try { return sessionStorage.getItem(key); } catch { return null; } };
const safeSet = (key: string, value: string) => { try { sessionStorage.setItem(key, value); } catch { /* the answer is still on screen */ } };
async function call<T>(op: string, body: object): Promise<T> {
  const { res, json } = await fetchJson<T & { ok?: boolean; error?: string }>(`${getTailorServerBase()}/resume-builder/${op}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json as T;
}

/** "Why do you want to join this company?" and similar: an answer written from this posting and your own evidence bank. */
export default function AskPanel({ job }: { job: Job }) {
  const [kind, setKind] = useState<Kind>("why-company");
  const [question, setQuestion] = useState("");
  const [length, setLength] = useState<Length>("standard");
  const [provider, setProvider] = useState(() => safeGet("ask-provider") || "codex");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const run = useRef(0);
  const cacheKey = `ask:${job.id}:${kind}:${kind === "custom" ? question.trim() : ""}:${length}`;
  // Another job: start clean. Coming back to a question already answered for this job: show that answer.
  useEffect(() => { run.current++; setBusy(false); setError(""); const saved = safeGet(cacheKey); if (saved) { try { const a = JSON.parse(saved) as Answer; setAnswer(a); setText(a.text); return; } catch { /* write a new one */ } } setAnswer(null); setText(""); }, [cacheKey]);
  useEffect(() => { if (!busy) return; const started = Date.now(); setElapsed(0); const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000); return () => clearInterval(t); }, [busy]);
  const ready = kind !== "custom" || question.trim().length >= 5;
  const write = async () => {
    if (busy || !ready) return;
    const generation = ++run.current;
    setBusy(true); setError(""); setStage("reading"); setCopied(false); safeSet("ask-provider", provider);
    try {
      const submitted = await call<{ jobId: string }>("ai-answer", { requestId: crypto.randomUUID(), jobUrl: job.id, kind, question: kind === "custom" ? question.trim() : undefined, length, provider });
      let result: Answer | undefined;
      while (!result) {
        if (generation !== run.current) return;
        try {
          const r = await call<{ status: string; stage?: string; workerOnline?: boolean; analysis?: Answer; error?: string }>("ai-result", { jobId: submitted.jobId });
          if (r.status === "failed") throw new Error(r.error || "The answer could not be written.");
          setStage(r.workerOnline === false ? "offline" : r.stage || "thinking"); result = r.analysis;
        } catch (e) { if (e instanceof Error && /fetch|network|HTTP 5|Failed to fetch/i.test(e.message)) setStage("reconnecting"); else throw e; }
        if (!result) await new Promise((r) => setTimeout(r, 2500));
      }
      if (generation !== run.current) return;
      safeSet(cacheKey, JSON.stringify(result)); setAnswer(result); setText(result.text);
    } catch (e) { if (generation === run.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (generation === run.current) setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setError("Copy was blocked. Select the text and copy it."); } };
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <section className="jm-card jm-full-card ak" aria-label="Write an application answer">
      <h2>Answer an application question <small>{job.company}</small></h2>
      <p className="jm-muted">Written from this posting and your evidence bank. Every claim about you cites a bank entry; every claim about the company comes from the posting.</p>
      <div className="ak-kinds" role="radiogroup" aria-label="Question">
        {KINDS.map((k) => <button key={k.value} type="button" role="radio" aria-checked={kind === k.value} className={kind === k.value ? "on" : ""} onClick={() => setKind(k.value)} disabled={busy}>{k.label}</button>)}
      </div>
      <p className="ak-hint">{KINDS.find((k) => k.value === kind)!.hint}</p>
      {kind === "custom" && <label className="ak-question">Question from the form<textarea value={question} maxLength={800} rows={2} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Tell us about a time you shipped something under a tight deadline." disabled={busy} /></label>}
      <div className="ak-row">
        <label>Length<select value={length} onChange={(e) => setLength(e.target.value as Length)} disabled={busy}>{LENGTHS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</select></label>
        <label>Written by<select value={provider} onChange={(e) => setProvider(e.target.value)} disabled={busy}>{PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
        <button type="button" className="rv-primary ak-go" onClick={() => void write()} disabled={busy || !ready}>{busy ? "Writing…" : answer ? "Write another" : "Write answer"}</button>
      </div>
      {busy && <div className="ak-progress" role="status" aria-live="polite"><span className="spin" aria-hidden="true" /><span><b>{STAGES[stage] || "Working…"}</b><small>{elapsed}s</small></span></div>}
      {error && <p className="td-error" role="alert">{error}<button type="button" className="apps-link" onClick={() => void write()}>Retry</button></p>}
      {answer && !busy && (
        <div className="ak-result">
          <label className="ak-q">{answer.question}<textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(14, Math.max(5, Math.ceil(words / 14)))} aria-label="Answer, editable" /></label>
          <div className="ak-bar"><span>{words} words · {PROVIDERS.find((p) => p.value === answer.provider)?.label ?? answer.provider}</span><button type="button" className="apps-btn" onClick={() => setText(answer.text)} disabled={text === answer.text}>Undo edits</button><button type="button" className="rv-primary" onClick={() => void copy()}>{copied ? "Copied ✓" : "Copy"}</button></div>
          {answer.note && <p className="ak-note" role="note">{answer.note}</p>}
          <div className="ak-sources">
            <div><h3>From the posting</h3>{answer.companyPoints.length ? <ul>{answer.companyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul> : <p className="jm-muted">Nothing specific about the company was used.</p>}</div>
            <div><h3>From your bank</h3>{answer.used.length ? <ul>{answer.used.map((u) => <li key={u.id}><b>{u.employer}</b>{u.text}</li>)}</ul> : <p className="jm-muted">No bank entry was cited.</p>}</div>
          </div>
        </div>
      )}
    </section>
  );
}
