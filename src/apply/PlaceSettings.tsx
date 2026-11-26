import { useState } from "react";
import { STATES, type Place } from "../../scripts/place.mjs";
import { setPlace, usePlace } from "./place";

const NAME = new Map(STATES);

/** Settings → Where I am: the states whose jobs get the ★ and come first on Today, Staffing and the phone. */
export default function PlaceSettings() {
  const place = usePlace();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  async function save(next: Place) {
    const before = place;
    setPlace(next); setState("saving"); setError("");
    try {
      const res = await fetch("/api/progress/preferences", { method: "PUT", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ place: next }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setState("saved");
    } catch (e) { setPlace(before); setState("error"); setError(e instanceof Error ? e.message : "Not saved."); }
  }
  const add = (code: string) => { if (code && !place.states.includes(code)) void save({ ...place, states: [...place.states, code] }); };
  const remove = (code: string) => void save({ ...place, states: place.states.filter((s) => s !== code) });
  return (
    <section aria-labelledby="st-place">
      <h2 id="st-place">Where I am</h2>
      <p className="st-hint">Jobs in these states get a ★ and come first on Today, Staffing and your phone. Change them when you move.</p>
      <ul className="st-places" aria-label="Your states">
        {place.states.map((s) => (
          <li key={s}><span title={NAME.get(s)}>{NAME.get(s) ?? s}</span><button type="button" aria-label={`Remove ${NAME.get(s) ?? s}`} onClick={() => remove(s)}>×</button></li>
        ))}
        {!place.states.length && <li className="st-places-none">No states. Only remote jobs get the ★{place.remote ? "" : " (and remote is off)"}.</li>}
      </ul>
      <select className="st-place-add" aria-label="Add a state" value="" onChange={(e) => add(e.target.value)} disabled={place.states.length >= 20}>
        <option value="">Add a state…</option>
        {STATES.filter(([code]) => !place.states.includes(code)).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </select>
      <ul className="st-flags st-place-remote">
        <li>
          <span><b>Remote and US-wide jobs too</b><small>Postings anyone in the US can take ("Remote", "USA") come right after your states</small></span>
          <button type="button" role="switch" aria-checked={place.remote} aria-label="Remote and US-wide jobs too" className={place.remote ? "on" : ""} onClick={() => void save({ ...place, remote: !place.remote })}><i /></button>
        </li>
      </ul>
      <span className="st-saved" role="status">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? error : ""}</span>
    </section>
  );
}
