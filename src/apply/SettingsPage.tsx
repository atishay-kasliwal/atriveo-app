import { useEffect, useRef, useState, type ReactNode } from "react";
import { getJson } from "./engine";
import WidgetPreview, { ACCENT_COLOR, DEFAULT_WIDGET, SAMPLE, type WidgetData, type WidgetPrefs } from "./WidgetPreview";
import "./settings.css";

const PRESETS = [10, 15, 20, 25, 30];
const FLAGS: { key: "responses" | "interviews" | "review" | "streak" | "trend"; label: string; hint: string }[] = [
  { key: "streak", label: "Day streak", hint: "Days in a row that met your goal" },
  { key: "trend", label: "14-day bars", hint: "A bar for each of the last two weeks" },
  { key: "responses", label: "Replies", hint: "Employer emails received today" },
  { key: "interviews", label: "Interviews", hint: "Interview emails received today" },
  { key: "review", label: "To review", hint: "Emails waiting for you to confirm" },
];
type Saved = "idle" | "saving" | "saved" | "error";

async function api(init?: RequestInit) {
  const res = await fetch("/api/progress/preferences", { credentials: "include", cache: "no-store", ...init });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json as { goal: number; widget: WidgetPrefs };
}

export default function SettingsPage({ header }: { header?: ReactNode }) {
  const [goal, setGoal] = useState<number | null>(null);
  const [prefs, setPrefs] = useState<WidgetPrefs>(DEFAULT_WIDGET);
  const [data, setData] = useState<WidgetData | null>(null);
  const [error, setError] = useState("");
  const [state, setState] = useState<Saved>("idle");
  const loaded = useRef(false), timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    api().then((r) => { setGoal(r.goal); setPrefs({ ...DEFAULT_WIDGET, ...r.widget }); loaded.current = true; }, (e) => setError(e instanceof Error ? e.message : "Settings could not load."));
    getJson<WidgetData>("/applications/widget").then(setData, () => setData(null));
  }, []);
  const save = (nextGoal: number, nextPrefs: WidgetPrefs) => {
    window.clearTimeout(timer.current); setState("saving");
    timer.current = window.setTimeout(() => {
      api({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal: nextGoal, widget: nextPrefs }) }).then(() => setState("saved"), (e) => { setState("error"); setError(e instanceof Error ? e.message : "Not saved."); });
    }, 450);
  };
  const changeGoal = (value: number) => { const g = Math.min(200, Math.max(1, Math.round(value) || 1)); setGoal(g); save(g, prefs); };
  const change = (patch: Partial<WidgetPrefs>) => { const next = { ...prefs, ...patch }; setPrefs(next); if (goal != null) save(goal, next); };
  const live = Boolean(data);
  const preview = data ?? SAMPLE;
  return (
    <div className="rv-page st-page">
      {header}
      <main className="st-main">
        <div className="st-title"><h1>Settings</h1><p>What your daily goal is, and what the Mac widget shows. Changes save as you make them. <a href="/usage">See how you use Atriveo →</a></p></div>
        {error && goal == null && <p className="st-error" role="alert">{error}</p>}
        <div className="st-grid">
          <div className="st-controls">
            <section aria-labelledby="st-goal">
              <h2 id="st-goal">Daily goal</h2>
              <p className="st-hint">How many applications make a day complete. It drives the ring, the streak and the goal on Today.</p>
              <div className="st-presets" role="group" aria-label="Daily goal presets">
                {PRESETS.map((p) => <button key={p} type="button" className={goal === p ? "on" : ""} aria-pressed={goal === p} onClick={() => changeGoal(p)}>{p}</button>)}
              </div>
              <div className="st-stepper">
                <button type="button" aria-label="One fewer" onClick={() => goal != null && changeGoal(goal - 1)} disabled={goal == null || goal <= 1}>−</button>
                <input type="number" min={1} max={200} value={goal ?? ""} aria-label="Daily goal" onChange={(e) => e.target.value && changeGoal(Number(e.target.value))} disabled={goal == null} />
                <button type="button" aria-label="One more" onClick={() => goal != null && changeGoal(goal + 1)} disabled={goal == null || goal >= 200}>+</button>
                <span className="st-saved" role="status">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? error : ""}</span>
              </div>
            </section>
            <section aria-labelledby="st-content">
              <h2 id="st-content">What the widget shows</h2>
              <ul className="st-flags">
                {FLAGS.map((f) => (
                  <li key={f.key}>
                    <span><b>{f.label}</b><small>{f.hint}</small></span>
                    <button type="button" role="switch" aria-checked={prefs[f.key]} aria-label={f.label} className={prefs[f.key] ? "on" : ""} onClick={() => change({ [f.key]: !prefs[f.key] } as Partial<WidgetPrefs>)}><i /></button>
                  </li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="st-accent">
              <h2 id="st-accent">Accent</h2>
              <div className="st-accents" role="radiogroup" aria-label="Accent colour">
                {(Object.keys(ACCENT_COLOR) as WidgetPrefs["accent"][]).map((a) => <button key={a} type="button" role="radio" aria-checked={prefs.accent === a} aria-label={a} className={prefs.accent === a ? "on" : ""} style={{ background: ACCENT_COLOR[a] }} onClick={() => change({ accent: a })} />)}
              </div>
            </section>
            <p className="st-note">The widget refreshes about every 15 minutes while Atriveo is open in your Mac's menu bar. Progress uses the New York day, like the rest of Atriveo.</p>
          </div>
          <aside className="st-preview" aria-label="Widget preview">
            <div className="st-card st-card-medium"><WidgetPreview data={preview} goal={goal ?? 15} prefs={prefs} size="medium" /></div>
            <div className="st-card st-card-small"><WidgetPreview data={preview} goal={goal ?? 15} prefs={prefs} size="small" /></div>
            <p className="st-hint">{live ? "Live numbers from today." : "Sample numbers while the live ones load."}</p>
          </aside>
        </div>
      </main>
    </div>
  );
}
