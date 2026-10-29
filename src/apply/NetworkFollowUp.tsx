import { useState, type FormEvent } from "react";
import { FOLLOW_UP_PLATFORMS, followUpSummary, plusDays, post, type FollowUpPlan, type Person } from "./network";

export default function NetworkFollowUp({ person, onChange }: { person: Person; onChange: (person: Person) => void }) {
  const [mode, setMode] = useState<"plan" | "log">("plan");
  const [plan, setPlan] = useState<FollowUpPlan>(person.followUpPlan || { enabled: true, platform: person.linkedin ? "linkedin" : person.email ? "email" : "phone", regarding: "", nextNotes: "" });
  const [date, setDate] = useState(person.nextFollowUp || "");
  const [completed, setCompleted] = useState<boolean | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const summary = followUpSummary(person);
  function changeMode(next: "plan" | "log") {
    if (next === mode) return;
    setMode(next); setError(""); setMessage("");
    setDate(next === "log" ? "" : person.nextFollowUp || "");
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setError(""); setMessage("");
    if (mode === "log" && completed === null) { setError("Choose whether you followed up."); return; }
    setBusy(true);
    try {
      const result = await post<{ person: Person }>("follow-up", { id: person.id, plan, nextFollowUp: date || null, ...(mode === "log" ? { outcome: { completed, notes } } : {}) });
      onChange(result.person); setNotes(""); setCompleted(null); setMode("plan");
      setMessage(mode === "log" ? "Outcome recorded. Your next step is saved." : "Follow-up plan saved.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <form className="nf" onSubmit={submit} aria-label="Follow-up plan">
    <div className="nf-heading"><div><span className="nf-caption">{mode === "log" ? "Conversation review" : "Next conversation"}</span><h3>{mode === "log" ? "Record this follow-up" : summary.title}</h3></div><span className={`nf-state${summary.due ? " due" : ""}`}>{summary.due ? "Action due" : person.followUpPlan?.enabled === false ? "Paused" : person.nextFollowUp ? "Planned" : "Not planned"}</span></div>
    <div className="nf-modes" role="group" aria-label="Follow-up action"><button type="button" aria-pressed={mode === "plan"} onClick={() => changeMode("plan")}>Plan next step</button><button type="button" aria-pressed={mode === "log"} onClick={() => changeMode("log")}>Log an outcome</button></div>
    {mode === "log" && <section className="nf-current" aria-label="Current follow-up">
      <h4 className="nf-section-title">Current follow-up</h4>
      <p className="nf-context">{person.followUpPlan?.regarding || "Your latest conversation"}{person.followUpPlan?.platform && <small>{FOLLOW_UP_PLATFORMS.find(([key]) => key === person.followUpPlan?.platform)?.[1]}</small>}</p>
      {person.followUpPlan?.nextNotes && <p className="nf-planned-note"><b>Your planned note</b>{person.followUpPlan.nextNotes}</p>}
      <fieldset className="nf-choice"><legend>Did you follow up?</legend><div>{[[true, "Yes, contacted"], [false, "Not yet"]].map(([value, label]) => <button key={String(value)} type="button" aria-pressed={completed === value} onClick={() => setCompleted(value as boolean)}>{label}</button>)}</div></fieldset>
      {completed === false && <p className="nf-help">This attempt will be saved. Your last-contact date stays the same.</p>}
      <label className="nw-f"><span>Notes from this follow-up</span><textarea maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} placeholder={completed === false ? "What got in the way?" : "What did you discuss? What did they say?"} /></label>
    </section>}
    {mode === "log" && <div className="nf-next-heading"><h4 className="nf-section-title">Next follow-up</h4><p>Decide what happens after this attempt.</p></div>}
    <fieldset className="nf-choice"><legend>{mode === "log" ? "Schedule another follow-up?" : "Do you need to follow up?"}</legend><div><button type="button" aria-pressed={plan.enabled} onClick={() => setPlan({ ...plan, enabled: true })}>Yes</button><button type="button" aria-pressed={!plan.enabled} onClick={() => setPlan({ ...plan, enabled: false })}>Not needed now</button></div></fieldset>
    {plan.enabled ? <>
      <div className="nf-pair"><label className="nw-f"><span>Platform</span><select aria-label="Platform" value={plan.platform} onChange={e => setPlan({ ...plan, platform: e.target.value as FollowUpPlan["platform"] })}>{FOLLOW_UP_PLATFORMS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="nw-f"><span>{mode === "log" ? "Next follow-up date" : "Follow-up date"}</span><input type="date" required value={date} onChange={e => setDate(e.target.value)} /></label></div>
      <div className="nf-timeframes" role="group" aria-label="Next timeframe">{[["3 days", 3], ["1 week", 7], ["2 weeks", 14], ["1 month", 30]].map(([label, days]) => <button key={label} type="button" aria-pressed={date === plusDays(days as number)} onClick={() => setDate(plusDays(days as number))}>{label}</button>)}</div>
      <label className="nw-f"><span>Regarding</span><input required maxLength={240} value={plan.regarding} onChange={e => setPlan({ ...plan, regarding: e.target.value })} placeholder="Referral, role update, introduction…" /></label>
      <label className="nw-f"><span>Notes for the next follow-up</span><textarea maxLength={2000} value={plan.nextNotes} onChange={e => setPlan({ ...plan, nextNotes: e.target.value })} placeholder="What should you remember or ask next time?" /></label>
    </> : <p className="nf-help">No reminder will be scheduled. Your conversation history stays here.</p>}
    {error && <p className="nf-error" role="alert">{error}</p>}{message && <p className="nf-success" role="status">{message}</p>}
    <div className="nf-footer"><span>{mode === "log" ? "Records the outcome and next step together." : "A reminder for you. No message is sent."}</span><button type="submit" disabled={busy} className="nw-btn main">{busy ? "Saving…" : mode === "log" ? completed === false ? "Save attempt & next step" : "Save outcome & next step" : "Save plan"}</button></div>
  </form>;
}
