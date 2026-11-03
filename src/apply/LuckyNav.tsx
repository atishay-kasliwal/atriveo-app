import { Link } from "react-router-dom";
import { clock, countdown, navState, uOf, useLucky, useNow } from "./lucky";
import "./lucky.css";

// The Lucky nav item: a tiny sky (your window in gold, the sun where it is now), the time, and a loading bar that charges up over the
// six hours before the window, glows in the last 15 minutes, and drains while the window is on.
const mp = (u: number): [number, number] => [13 - 11 * Math.cos(Math.PI * u), 13 - 11 * Math.sin(Math.PI * u)];

export function LuckyNav({ current }: { current: boolean }) {
  const data = useLucky(), now = useNow(1000);
  if (!data) return <Link to="/lucky" className="lk-nav" data-state="none" aria-current={current ? "page" : undefined}>Lucky</Link>;
  const st = navState(data, now), today = data.days[0]!, w = today.lucky;
  const gold = w && uOf(today, Date.parse(w.end)) <= 1
    ? Array.from({ length: 7 }, (_, i) => { const a = uOf(today, Date.parse(w.start)), b = uOf(today, Date.parse(w.end)); return mp(a + ((b - a) * i) / 6); }).map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ")
    : "M23 14.5 L25 14.5";
  const u = uOf(today, now), [sx, sy] = mp(Math.min(1, u));
  const spoken = st.state === "on" ? `Lucky hour on, ${countdown(Date.parse(w!.end) - now)} left` : st.text ? `Lucky hour ${st.text}` : "Lucky hours";
  return (
    <Link to="/lucky" className="lk-nav" data-state={st.state} aria-current={current ? "page" : undefined} title={st.title} aria-label={spoken}>
      <svg className="lk-nav-arc" viewBox="0 0 26 15" aria-hidden="true"><path className="d" d="M2 13 A11 11 0 0 1 24 13" /><path className="g" d={gold} /><circle cx={sx} cy={sy} r={2.3} style={{ opacity: u <= 1 ? 1 : 0 }} /></svg>
      <span>Lucky</span>{st.text && <b>{st.text}</b>}
      <i className="lk-nav-bar" aria-hidden="true"><i style={{ width: `${(st.fill * 100).toFixed(1)}%` }} /></i>
    </Link>
  );
}

/** On Matching while a window is on: how much of it is left and how many you have applied in it. */
export function LuckyStrip() {
  const data = useLucky(), now = useNow(1000);
  const w = data?.days[0]?.lucky;
  if (!data || !w) return null;
  const s = Date.parse(w.start), e = Date.parse(w.end);
  if (now < s || now > e) return null;
  return (
    <div className="lk-strip" role="status">
      <span>Lucky hour until {clock(e, data.location.tz)}</span>
      <span className="lk-strip-track" aria-hidden="true"><i style={{ width: `${(((e - now) / (e - s)) * 100).toFixed(1)}%` }} /></span>
      <b>{countdown(e - now)} left</b>
      <span><b>{data.appliedInWindow}</b> applied this hour</span>
      <Link to="/lucky">Lucky</Link>
    </div>
  );
}
