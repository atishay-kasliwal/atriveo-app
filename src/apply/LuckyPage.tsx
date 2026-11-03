import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { clock, countdown, loadLucky, postLucky, uOf, useLucky, useNow, zonedToUtc, type LuckyData, type LuckyDay } from "./lucky";
import "./lucky.css";

// The Lucky page (docs/lucky.md): the day drawn as the sun's path. Sunrise on the left, sunset on the right, the night underneath;
// the eight Choghadiya as bands, Rahu Kaal in red, your lucky hour in gold, and the countdown inside the dome.
const CX = 500, H = 276, RX = 440, RY = 232, RN = 44;
const GOOD = new Set(["Amrit", "Shubh", "Labh"]);
const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const pt = (u: number): [number, number] => (u <= 1 ? [CX - RX * Math.cos(Math.PI * u), H - RY * Math.sin(Math.PI * u)] : [CX + RX * Math.cos(Math.PI * (u - 1)), H + RN * Math.sin(Math.PI * (u - 1))]);
const pathU = (a: number, b: number, n = 40) => Array.from({ length: n + 1 }, (_, i) => pt(a + ((b - a) * i) / n)).map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
const outward = (u: number, d: number): [number, number] => { const [x, y] = pt(u), nx = (x - CX) / RX, ny = (y - H) / (u <= 1 ? RY : RN), l = Math.hypot(nx, ny) || 1; return [x + (nx / l) * d, y + (ny / l) * d]; };
const tangent = (u: number) => { const [x1, y1] = pt(u - 0.002), [x2, y2] = pt(u + 0.002); return (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI; };
const at = (iso: string) => Date.parse(iso);

interface Arcs { la: number | null; lb: number | null; ra: number; rb: number }
const arcsOf = (d: LuckyDay): Arcs => ({ la: d.lucky ? uOf(d, at(d.lucky.start)) : null, lb: d.lucky ? uOf(d, at(d.lucky.end)) : null, ra: uOf(d, at(d.rahu.start)), rb: uOf(d, at(d.rahu.end)) });
/** Slides the gold and red stretches along the arc to another day's places. */
function useSlide(target: Arcs): Arcs {
  const [cur, setCur] = useState(target), last = useRef(target);
  useEffect(() => {
    const a = last.current, b = target;
    if (reduce) { last.current = b; return; }
    const t0 = performance.now(); let raf = 0;
    const mix = (x: number | null, y: number | null, e: number) => (x == null || y == null ? y : x + (y - x) * e);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 900), e = ease(k);
      const st = { la: mix(a.la, b.la, e), lb: mix(a.lb, b.lb, e), ra: mix(a.ra, b.ra, e)!, rb: mix(a.rb, b.rb, e)! };
      setCur(st); last.current = st;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target.la, target.lb, target.ra, target.rb]); // eslint-disable-line react-hooks/exhaustive-deps
  return reduce ? target : cur;
}
/** 0 to 1 once, after the bands have drawn: the sun climbing to where it is now. */
function useSunrise(): number {
  const [k, setK] = useState(reduce ? 1 : 0);
  useEffect(() => {
    if (reduce) return;
    const t0 = performance.now() + 600; let raf = 0;
    const step = (now: number) => { const x = Math.max(0, Math.min(1, (now - t0) / 1700)); setK(ease(x)); if (x < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return k;
}
/** Digits that roll up when they change: a changed digit gets a new key, so only it mounts again and plays the roll. */
function Roll({ text }: { text: string }) {
  return <span className="lk-count" aria-label={text}>{[...text].map((ch, i) => <span key={`${i}-${ch}`} aria-hidden="true" className="roll">{ch === " " ? "\u00a0" : ch}</span>)}</span>;
}

function phaseOf(d: LuckyDay, now: number) {
  const rise = at(d.sunrise), set = at(d.sunset);
  if (now < rise - 30 * 60_000 || now > set + 60 * 60_000) return "night";
  if (now < rise + 60 * 60_000) return "dawn";
  if (now > set - 60 * 60_000) return "dusk";
  return "day";
}

function Sky({ day, live, now, tz }: { day: LuckyDay; live: boolean; now: number; tz: string }) {
  const arcs = useSlide(arcsOf(day)), sun = useSunrise();
  const nowU = uOf(day, now), sunU = nowU * sun, [sx, sy] = pt(sunU);
  const hours: { u: number; label: string | null }[] = [];
  for (let h = 7; h <= 18; h++) {
    const hourAt = at(zonedToUtc(day.day, `${h}:00`, tz));
    if (hourAt <= at(day.sunrise) + 15 * 60_000 || hourAt >= at(day.sunset) - 15 * 60_000) continue;
    hours.push({ u: uOf(day, hourAt), label: h % 2 === 0 ? String(h > 12 ? h - 12 : h) : null });
  }
  const mid = arcs.la != null && arcs.lb != null ? (arcs.la + arcs.lb) / 2 : null;
  const label = (u: number, d: number, text: string, cls: string, key: string, hidden = false) => { const [x, y] = outward(u, d); return <text key={key} className={cls} x={x} y={y} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${tangent(u).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})`} visibility={hidden ? "hidden" : undefined}>{text}</text>; };
  const dayParts = day.choghadiya.slice(0, 8);
  return (
    <svg className="lk-arc" viewBox="0 0 1000 350" role="img" aria-label={`Today as the sun's path. ${day.lucky ? `Lucky hour ${clock(day.lucky.start, tz)} to ${clock(day.lucky.end, tz)}.` : "No lucky hour."} Rahu Kaal ${clock(day.rahu.start, tz)}.`}>
      <line className="lk-horizon" x1={20} x2={980} y1={H} y2={H} />
      <path className="lk-night" d={pathU(1, 2, 90)} />
      {dayParts.map((c, k) => <path key={k} className={`lk-band${GOOD.has(c.name) ? " good" : ""}`} d={pathU(k / 8 + 0.005, (k + 1) / 8 - 0.005, 24)} pathLength={1} style={{ "--i": k } as CSSProperties} />)}
      {dayParts.map((c, k) => { const rahu = at(day.rahu.start) < at(c.end) - 60_000 && at(day.rahu.end) > at(c.start) + 60_000, lucky = day.lucky && at(day.lucky.start) < at(c.end) && at(day.lucky.end) > at(c.start); return label((k + 0.5) / 8, 22, c.name, `lk-cname${GOOD.has(c.name) ? " good" : ""}`, `n${k}`, !!(rahu || lucky)); })}
      <g className="lk-hours">{hours.map((h, i) => { const [x1, y1] = outward(h.u, -6), [x2, y2] = outward(h.u, -12), [lx, ly] = outward(h.u, -26); return <g key={i}><line x1={x1} y1={y1} x2={x2} y2={y2} />{h.label && <text x={lx} y={ly + 4} textAnchor="middle">{h.label}</text>}</g>; })}</g>
      {live && sunU > 0.002 && <path className="lk-elapsed" d={pathU(0, Math.min(sunU, 1), 60)} />}
      <text className="lk-hlabel" x={CX - RX} y={H + 26} textAnchor="middle">sunrise {clock(day.sunrise, tz)}</text>
      <text className="lk-hlabel" x={CX + RX} y={H + 26} textAnchor="middle">sunset {clock(day.sunset, tz)}</text>
      <path className="lk-rahu" d={pathU(arcs.ra, arcs.rb, 24)} />
      {label((arcs.ra + arcs.rb) / 2, 22, `Rahu Kaal ${clock(day.rahu.start, tz)}`, "lk-rlabel", "rahu")}
      {mid != null && day.lucky && <>
        <path className="lk-halo" d={pathU(arcs.la!, arcs.lb!, 24)} />
        <path className="lk-lucky" d={pathU(arcs.la!, arcs.lb!, 24)}><title>{`${clock(day.lucky.start, tz)} to ${clock(day.lucky.end, tz)}`}</title></path>
        {(() => { const below = mid > 1, [x1, y1] = outward(mid, 60), [x2, y2] = outward(mid, 34); return <><text className="lk-llabel" x={x1} y={y1 + (below ? 16 : 0)} textAnchor="middle">{clock(day.lucky.start, tz)}</text><text className="lk-lsub" x={x2} y={y2 + (below ? 12 : 0)} textAnchor="middle">{day.lucky.choghadiya} · {day.lucky.hora} hora</text></>; })()}
      </>}
      <g className={`lk-sun${live ? "" : " away"}`} transform={`translate(${sx.toFixed(1)} ${sy.toFixed(1)})`}><circle className="lk-sunglow" r={24} /><circle className={sunU <= 1 ? "lk-suncore" : "lk-mooncore"} r={sunU <= 1 ? 13 : 10} /></g>
    </svg>
  );
}

function MiniArc({ day }: { day: LuckyDay }) {
  const w = 120, base = 34;
  const mp = (u: number): [number, number] => (u <= 1 ? [w / 2 - (w / 2 - 4) * Math.cos(Math.PI * u), base - (base - 4) * Math.sin(Math.PI * u)] : [w / 2 + (w / 2 - 4) * Math.cos(Math.PI * (u - 1)), base + 9 * Math.sin(Math.PI * (u - 1))]);
  const seg = (a: number, b: number, n = 24) => Array.from({ length: n + 1 }, (_, i) => mp(a + ((b - a) * i) / n)).map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const a = arcsOf(day);
  return <svg viewBox={`0 0 ${w} 46`} aria-hidden="true"><path className="n" d={seg(1, 2)} /><path className="d" d={seg(0, 1, 40)} /><path className="r" d={seg(a.ra, a.rb, 8)} />{a.la != null && <path className="g" d={seg(a.la, a.lb!, 8)} />}</svg>;
}

const PLACES = [
  { name: "New York", lat: 40.7128, lon: -74.006, tz: "America/New_York" },
  { name: "Raleigh", lat: 35.7796, lon: -78.6382, tz: "America/New_York" },
  { name: "San Francisco", lat: 37.7749, lon: -122.4194, tz: "America/Los_Angeles" },
  { name: "Seattle", lat: 47.6062, lon: -122.3321, tz: "America/Los_Angeles" },
  { name: "Chicago", lat: 41.8781, lon: -87.6298, tz: "America/Chicago" },
  { name: "Austin", lat: 30.2672, lon: -97.7431, tz: "America/Chicago" },
];

function Details({ data, onClose }: { data: LuckyData; onClose: () => void }) {
  const p = data.profile;
  const [place, setPlace] = useState(PLACES.find((x) => x.name === p.location.name)?.name ?? PLACES[0]!.name);
  const [form, setForm] = useState({ birthDate: "", birthTime: "", birthTz: "Asia/Kolkata", birthPlace: p.birthPlace, workStart: String(p.workStart), workEnd: String(p.workEnd) });
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const body: Record<string, unknown> = { location: PLACES.find((x) => x.name === place), workStart: Number(form.workStart), workEnd: Number(form.workEnd), birthPlace: form.birthPlace };
      if (form.birthDate && form.birthTime) { body.birthUtc = zonedToUtc(form.birthDate, form.birthTime, form.birthTz); body.birthLocal = `${new Date(`${form.birthDate}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}, ${form.birthTime} (${form.birthTz})`; }
      await postLucky("/lucky/profile", body); await loadLucky(true); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };
  return (
    <form className="lk-details" onSubmit={save} aria-labelledby="lk-details-h">
      <h2 id="lk-details-h">Your details</h2>
      <p>Your birth moment sets your nakshatra and moon sign. Where you are now sets every time on this page.</p>
      <fieldset><legend>Birth {p.hasBirth && <small>saved: {p.birthLocal || "on file"}</small>}</legend>
        <label>Date<input type="date" value={form.birthDate} onChange={set("birthDate")} /></label>
        <label>Time<input type="time" value={form.birthTime} onChange={set("birthTime")} /></label>
        <label>Time zone of birth<select value={form.birthTz} onChange={set("birthTz")}><option value="Asia/Kolkata">India (IST)</option><option value="America/New_York">US Eastern</option><option value="America/Chicago">US Central</option><option value="America/Los_Angeles">US Pacific</option><option value="UTC">UTC</option></select></label>
        <label>Place<input value={form.birthPlace} onChange={set("birthPlace")} placeholder="e.g. Ujjain" /></label>
      </fieldset>
      <fieldset><legend>Now</legend>
        <label>Where you are<select value={place} onChange={(e) => setPlace(e.target.value)}>{PLACES.map((x) => <option key={x.name}>{x.name}</option>)}</select></label>
        <label>Work from<input type="number" min={0} max={23} value={form.workStart} onChange={set("workStart")} /></label>
        <label>until<input type="number" min={1} max={24} value={form.workEnd} onChange={set("workEnd")} /></label>
      </fieldset>
      {error && <p className="lk-error" role="alert">{error}</p>}
      <div className="lk-details-act"><button type="button" className="lk-btn ghost" onClick={onClose}>Cancel</button><button className="lk-btn gold" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
    </form>
  );
}

function CalendarLink() {
  const [url, setUrl] = useState(""), [msg, setMsg] = useState("");
  const get = async (reset = false) => { try { const { token } = await postLucky<{ ok: boolean; token: string }>("/lucky/calendar", { reset }); setUrl(`${location.origin}/calendar/lucky/${token}.ics`); setMsg(reset ? "New link made. The old one stopped working." : ""); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } };
  if (!url) return <button type="button" className="lk-btn ghost" onClick={() => void get()}>Add to Google Calendar</button>;
  const google = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(url.replace(/^https:/, "webcal:"))}`;
  return (
    <div className="lk-cal" role="group" aria-label="Calendar link">
      <a className="lk-btn gold" href={google} target="_blank" rel="noreferrer">Open Google Calendar ↗</a>
      <button type="button" className="lk-btn ghost" onClick={() => { navigator.clipboard.writeText(url).then(() => setMsg("Link copied"), () => setMsg(url)); }}>Copy link</button>
      <button type="button" className="lk-btn ghost" onClick={() => void get(true)} title="Make a new private link; the old one stops working">New link</button>
      {msg && <span className="lk-cal-msg" role="status">{msg}</span>}
    </div>
  );
}

export default function LuckyPage({ header }: { header?: ReactNode }) {
  const data = useLucky(), now = useNow(1000);
  const [picked, setPicked] = useState(0), [editing, setEditing] = useState(false);
  const today = data?.days[0];
  const phase = today ? phaseOf(today, now) : "night";
  useEffect(() => { document.body.dataset.luckyPhase = phase; return () => { delete document.body.dataset.luckyPhase; }; }, [phase]);
  if (!data || !today) return <div className="rv-page lk-page" data-phase="night">{header}<main className="lk-main"><p className="lk-loading">Reading the sky…</p></main></div>;
  const tz = data.location.tz, day = data.days[Math.min(picked, data.days.length - 1)]!;
  let label = "", count = "", cap = "";
  const w = day.lucky;
  if (picked > 0) { label = `${new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(new Date(day.sunrise))}’s lucky hour`; count = w ? clock(w.start, tz) : "Rest"; cap = w ? `${clock(w.start, tz)} to ${clock(w.end, tz)} · ${w.choghadiya} · ${w.hora} hora` : "No good window this day"; }
  else if (w && now >= at(w.start) && now <= at(w.end)) { label = "Lucky hour is on · ends in"; count = countdown(at(w.end) - now); cap = `${data.appliedInWindow} applied so far · ${w.choghadiya} · ${w.hora} hora`; }
  else if (w && now < at(w.start)) { label = "Your lucky hour starts in"; count = countdown(at(w.start) - now); cap = `${clock(w.start, tz)} to ${clock(w.end, tz)} · ${w.choghadiya} · ${w.hora} hora`; }
  else { const next = data.days.slice(1).find((d) => d.lucky); label = next ? "Tomorrow’s lucky hour starts in" : "No lucky hour soon"; count = next?.lucky ? countdown(at(next.lucky.start) - now) : "Rest"; cap = next?.lucky ? `${next.weekday} ${clock(next.lucky.start, tz)} · ${next.lucky.choghadiya} · ${next.lucky.hora} hora` : ""; }
  const s = day.strength;
  return (
    <div className="rv-page lk-page" data-phase={phase}>
      {header}
      <main className="lk-main">
        <div className="lk-top">
          <p className="lk-where">{data.location.name} · {new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(new Date(now))}</p>
          <h1 className="lk-sr">Lucky hours</h1>
          <div className="lk-actions"><CalendarLink /><Link className="lk-btn gold" to="/job-matching">Open Matching</Link></div>
        </div>
        <div className="lk-stage">
          <Sky day={day} live={picked === 0} now={now} tz={tz} />
          <div className="lk-dome" aria-live="polite">
            <span className="lk-dome-label">{label}</span>
            <Roll text={count} />
            <span className="lk-dome-cap">{cap}</span>
            {s && <span className={`lk-tone ${s.verdict}`}>{s.verdict === "good" ? "A good day for you" : s.verdict === "avoid" ? "A careful day for you" : "A mixed day for you"} · Tara {s.tara}</span>}
          </div>
        </div>
        <div className="lk-dock" role="group" aria-label="This week">
          {data.days.slice(0, 7).map((d, k) => (
            <button key={d.day} type="button" className="lk-day" aria-pressed={k === picked} onClick={() => setPicked(k)}>
              <MiniArc day={d} />
              <span className="dd">{k === 0 ? "Today" : `${d.weekday} ${Number(d.day.slice(8))}`}</span>
              <span className="dt">{d.lucky ? clock(d.lucky.start, tz) : "Rest"}</span>
              <span className="dl">{d.lucky ? `${d.lucky.choghadiya} · ${d.lucky.hora}` : "no good window"}{d.strength?.verdict === "good" ? " · good day" : ""}</span>
            </button>
          ))}
        </div>
        <p className="lk-foot">
          {data.chart ? <>Your moon: {data.chart.nakshatraName}, pada {data.chart.pada}, in {data.chart.rashiName}{data.profile.birthPlace ? ` · born in ${data.profile.birthPlace}` : ""} · </> : <>Add your birth details for a personal day rating · </>}
          <button type="button" className="lk-link" onClick={() => setEditing(true)}>Your details</button>
        </p>
        {editing && <Details data={data} onClose={() => setEditing(false)} />}
      </main>
    </div>
  );
}
