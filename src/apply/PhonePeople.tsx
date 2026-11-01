import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { answerCheckIn, checkInToast, loadReminders, loadWholeNetwork, post, type Person, type Reminder } from "./network";
import "./phone.css";

// People on a phone: who needs you now (the Network reminders), with one-tap Email / Call / LinkedIn. After you reach
// out, a sheet logs it (the same history entry the desktop writes), snoozes it, or answers an outreach check-in.

type Channel = "email" | "call" | "linkedin";
const LOGGED: Record<Channel, "email" | "call" | "message"> = { email: "email", call: "call", linkedin: "message" };
const VIA: Record<Channel, string> = { email: "emailed", call: "called", linkedin: "messaged" };

const linkedinUrl = (v: string) => (/^https?:\/\//i.test(v) ? v : `https://www.linkedin.com/in/${v.replace(/^@/, "")}`);
const contacts = (p: Person | undefined): [Channel, string, string][] => {
  if (!p) return [];
  const out: [Channel, string, string][] = [];
  if (p.email) out.push(["email", "Email", `mailto:${p.email}`]);
  if (p.phone) out.push(["call", "Call", `tel:${p.phone.replace(/[^\d+]/g, "")}`]);
  if (p.linkedin) out.push(["linkedin", "LinkedIn", linkedinUrl(p.linkedin)]);
  return out;
};

export default function PhonePeople({ header }: { header: ReactNode }) {
  const [list, setList] = useState<Reminder[] | null>(null);
  const [people, setPeople] = useState<Map<string, Person>>(new Map());
  const [error, setError] = useState("");
  const [ask, setAsk] = useState<{ r: Reminder; channel: Channel | null } | null>(null);
  const [note, setNote] = useState("");

  const show = useCallback(([r, n]: [Reminder[], { people: Person[] }]) => { setList(r); setPeople(new Map(n.people.map((p) => [p.id, p]))); setError(""); }, []);
  useEffect(() => {
    let alive = true;
    Promise.all([loadReminders(), loadWholeNetwork()]).then((x) => { if (alive) show(x); }, (e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [show]);
  const reload = () => Promise.all([loadReminders(), loadWholeNetwork()]).then(show, (e) => setError(e instanceof Error ? e.message : String(e)));

  const done = (r: Reminder, text: string) => { setList((l) => (l ?? []).filter((x) => x.key !== r.key)); setAsk(null); setNote(text); };
  const fail = (e: unknown) => setNote(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
  const name = (r: Reminder) => (r.personId ? people.get(r.personId)?.name : undefined) ?? "They";

  async function logged(r: Reminder, channel: Channel | null) {
    try { await post("history", { id: r.personId, type: channel ? LOGGED[channel] : "message", text: "" }); done(r, `Logged: you ${channel ? VIA[channel] : "reached"} ${name(r)}.`); }
    catch (e) { fail(e); }
  }
  async function snooze(r: Reminder, days: number) {
    try { await post("reminders/snooze", { key: r.key, days }); done(r, `Snoozed for ${days} days.`); } catch (e) { fail(e); }
  }
  async function checkIn(r: Reminder, a: "accepted" | "replied" | "no") {
    try { const res = await answerCheckIn(r.personId!, r.hour!, a); done(r, checkInToast(name(r), res)); } catch (e) { fail(e); }
  }

  return (
    <div className="ph-page">
      {header}
      <main className="ph-activity">
        <div className="ph-people-head">
          <p className="ph-triage-count">{list ? `${list.length} ${list.length === 1 ? "person needs" : "need"} you` : "Loading…"}</p>
          <Link className="ph-link" to="/network?all=1">All of Network</Link>
        </div>
        {error && !list && <div className="ph-empty"><strong>Couldn't load Network</strong><span>{error}</span><button type="button" className="ph-btn" onClick={() => void reload()}>Try again</button></div>}
        {list && !list.length && <div className="ph-empty"><strong>Nobody is waiting on you</strong><span>Follow-ups and check-ins show up here when they're due.</span></div>}
        <ul className="ph-people">
          {(list ?? []).map((r) => {
            const p = r.personId ? people.get(r.personId) : undefined;
            const ways = contacts(p);
            return (
              <li key={r.key} className={`ph-person is-${r.kind}`}>
                <div className="ph-person-top">
                  <span className="ph-person-name"><b>{r.title}</b><small>{[p && [p.role, p.company].filter(Boolean).join(" · "), r.detail].filter(Boolean).join(" — ")}</small></span>
                </div>
                <div className="ph-ways">
                  {ways.map(([ch, label, href]) => (
                    <a key={ch} className="ph-btn" href={href} target={ch === "linkedin" ? "_blank" : undefined} rel="noreferrer" onClick={() => setAsk({ r, channel: ch })}>{label}</a>
                  ))}
                  {r.kind === "outreach" || (p && !ways.length) ? <button type="button" className="ph-btn" onClick={() => setAsk({ r, channel: null })}>{r.kind === "outreach" ? "Did they respond?" : "I reached out"}</button> : null}
                  {!p && <Link className="ph-btn" to={r.workId ? `/network?work=${r.workId}` : "/network?view=due"}>Open in Network</Link>}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="ph-note" role="status">{note}</p>
      </main>

      {ask && (
        <div className="ph-sheet-wrap" onClick={() => setAsk(null)}>
          <div className="ph-sheet ph-posting" role="dialog" aria-modal="true" aria-label={ask.r.kind === "outreach" ? "Did they respond?" : "Did you reach them?"} onClick={(e) => e.stopPropagation()}>
            <i className="ph-grab" aria-hidden="true" />
            <h2>{ask.r.kind === "outreach" ? `Did ${name(ask.r)} respond?` : `Did you reach ${name(ask.r)}?`}</h2>
            <p className="ph-meta">{ask.r.title}</p>
            {ask.r.kind === "outreach" ? (
              <div className="ph-marks">
                <button type="button" className="ph-btn is-primary" onClick={() => void checkIn(ask.r, "replied")}>They replied</button>
                <button type="button" className="ph-btn" onClick={() => void checkIn(ask.r, "accepted")}>Accepted</button>
                <button type="button" className="ph-btn" onClick={() => void checkIn(ask.r, "no")}>No reply yet</button>
                <button type="button" className="ph-btn" onClick={() => setAsk(null)}>Not now</button>
              </div>
            ) : (
              <div className="ph-marks">
                <button type="button" className="ph-btn is-primary ph-wide" onClick={() => void logged(ask.r, ask.channel)}>Yes, I {ask.channel ? VIA[ask.channel] : "reached out to"} them</button>
                <button type="button" className="ph-btn" onClick={() => void snooze(ask.r, 2)}>Snooze 2 days</button>
                <button type="button" className="ph-btn" onClick={() => setAsk(null)}>Not now</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
