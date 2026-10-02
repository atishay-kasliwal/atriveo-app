import { useEffect, useId, useState } from "react";
import { getJson, questionKind, type PendingQ, type Scope } from "./engine";

/** Longer lists than this get a type-to-search box instead of a dropdown. */
const MAX_DROPDOWN = 60;

/** The question's choices; very long lists are fetched when the question is shown. */
function useOptions(q: PendingQ, appId: string): { list: string[]; loading: boolean; error: string | null } {
  const missing = (q.optionCount ?? q.options.length) > q.options.length;
  const [loaded, setLoaded] = useState<{ list: string[]; error: string | null } | null>(null);
  useEffect(() => {
    if (!missing) return;
    let live = true;
    getJson<{ options: string[] }>(`/applications/question-options?id=${encodeURIComponent(appId)}&fp=${encodeURIComponent(q.fingerprint)}`)
      .then((r) => { if (live) setLoaded({ list: r.options, error: null }); })
      .catch((e) => { if (live) setLoaded({ list: [], error: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [missing, appId, q.fingerprint]);
  if (!missing) return { list: q.options, loading: false, error: null };
  return { list: loaded?.list ?? [], loading: !loaded, error: loaded?.error ?? null };
}

/** A search box over a long list. Only an exact choice counts as an answer, so the engine can select it. */
function SearchChoice({ list, value, onValue }: { list: string[]; value: string; onValue: (v: string) => void }) {
  const listId = useId();
  const [text, setText] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    if (value) setText(value);
  }
  const exact = list.includes(text);
  return (
    <>
      <input list={listId} value={text} placeholder={`Type to search ${list.length.toLocaleString()} choices`}
        onChange={(e) => { setText(e.target.value); onValue(list.includes(e.target.value) ? e.target.value : ""); }} />
      <datalist id={listId}>{list.map((o) => <option key={o} value={o} />)}</datalist>
      {text && !exact && <p className="apps-q-note warn">Pick one of the choices exactly as listed.</p>}
    </>
  );
}

/** One unanswered question: the right input for its type, and where the answer is remembered. */
export default function QuestionField({ q, appId, company, value, scope, onValue, onScope, note, hideScope = false }: {
  hideScope?: boolean;
  q: PendingQ; appId: string; company: string; value: string; scope: Scope;
  onValue: (v: string) => void; onScope: (s: Scope) => void;
  /** Shown under the input, e.g. where a pre-filled answer came from. */
  note?: string | null;
}) {
  const kind = questionKind(q);
  const options = useOptions(q, appId);
  const total = q.optionCount ?? q.options.length;

  let input: React.ReactNode;
  if (kind === "file") {
    input = null;
  } else if (q.type === "checkbox") {
    input = (
      <select value={value} onChange={(e) => onValue(e.target.value)}>
        <option value="">Choose…</option>
        <option value="true">Check this box</option>
        <option value="false">Leave unchecked</option>
      </select>
    );
  } else if (options.loading) {
    input = <input disabled placeholder={`Loading ${total.toLocaleString()} choices…`} />;
  } else if (options.error) {
    input = <p className="apps-q-note warn">Couldn't load the choices: {options.error}</p>;
  } else if (options.list.length > MAX_DROPDOWN) {
    input = <SearchChoice list={options.list} value={value} onValue={onValue} />;
  } else if (options.list.length) {
    input = (
      <select value={value} onChange={(e) => onValue(e.target.value)}>
        <option value="">Choose…</option>
        {options.list.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (q.type !== "textarea") {
    input = <input value={value} onChange={(e) => onValue(e.target.value)} placeholder="Your answer" />;
  } else {
    input = <textarea rows={q.type === "textarea" ? 3 : 1} value={value} onChange={(e) => onValue(e.target.value)} placeholder="Your answer" />;
  }

  return (
    <div className={`apps-q ${kind !== "question" ? `is-${kind}` : ""}`}>
      <label>
        <span className="apps-q-label">{q.label}{q.required ? " *" : ""}{q.sensitive ? <em> · {q.sensitive.replace(/_/g, " ")}</em> : null}</span>
        {input}
      </label>
      {kind === "file" && <p className="apps-q-note">An attachment the engine couldn't add. Open the form to attach it yourself, or skip this job.</p>}
      {kind === "unreadable" && <p className="apps-q-note">The engine couldn't read this field's label. Open the form to see what it asks. Your answer is kept for this application only.</p>}
      {q.type === "checkbox" && q.sensitive && <p className="apps-q-note">Read the notice or declaration before choosing. A required box left unchecked keeps this application in review.</p>}
      {note && <p className="apps-q-note">{note}</p>}
      {kind === "question" && !hideScope && (
        <select className="apps-q-scope" aria-label="Use this answer for" value={scope} onChange={(e) => onScope(e.target.value as Scope)}>
          <option value="application">Only this application</option>
          <option value="company">All {company} jobs</option>
          <option value="global">Every application</option>
        </select>
      )}
    </div>
  );
}
