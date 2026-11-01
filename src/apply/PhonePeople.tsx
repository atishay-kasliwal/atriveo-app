import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { answerCheckIn, checkInToast, followUp, loadReminders, loadWholeNetwork, post, type Person, type Reminder, type Source } from "./network";
import PhonePerson, { Avatar } from "./PhonePerson";
import { contacts, groupBySource, type Channel } from "./peopleContacts";
import "./phone.css";

// People on a phone. Needs you: the Network reminders, with one-tap Email / Call / LinkedIn. Everyone: search your whole network,
// grouped by where you know them from; tap someone for their own screen. After you reach out, a sheet logs it (the same history entry
// the desktop writes), snoozes the reminder, or answers an outreach check-in.

const LOGGED: Record<Channel, "email" | "call" | "message"> = { email: "email", call: "call", linkedin: "message" };
const VIA: Record<Channel, string> = { email: "emailed", call: "called", linkedin: "messaged" };
type Tab = "due" | "all";
const TAB_KEY = "phone.peopleTab";
const readTab = (): Tab => { try { return localStorage.getItem(TAB_KEY) === "all" ? "all" : "due"; } catch { return "due"; } };

export default function PhonePeople({ header }: { header: ReactNode }) {
  const [tab, setTabState] = useState<Tab>(readTab);
  const [list, setList] = useState<Reminder[] | null>(null);
  const [people, setPeople] = useState<Map<string, Person>>(new Map());
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState("");
  const [ask, setAsk] = useState<{ personId: string | null; r: Reminder | null; channel: Channel | null } | null>(null);
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* the tab just is not remembered */ } };

  const show = useCallback(([r, n]: [Reminder[], { people: Person[]; sources: Source[] }]) => { setList(r); setPeople(new Map(n.people.map((p) => [p.id, p]))); setSources(n.sources ?? []); setError(""); }, []);
  useEffect(() => {
    let alive = true;
    Promise.all([loadReminders(), loadWholeNetwork()]).then((x) => { if (alive) show(x); }, (e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [show]);
  const reload = () => Promise.all([loadReminders(), loadWholeNetwork()]).then(show, (e) => setError(e instanceof Error ? e.message : String(e)));

  // A person's screen is a step in the phone's history, so the Back gesture closes it instead of leaving People.
  useEffect(() => {
    const back = () => setOpenId(null);
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  const openPerson = (id: string) => { window.history.pushState({ phPerson: id }, ""); setOpenId(id); };
  const closePerson = () => { if ((window.history.state as { phPerson?: string } | null)?.phPerson) window.history.back(); else setOpenId(null); };

  const replace = (p: Person) => setPeople((m) => new Map(m).set(p.id, p));
  const done = (text: string, r: Reminder | null, p?: Person) => { if (r) setList((l) => (l ?? []).filter((x) => x.key !== r.key)); if (p) replace(p); setAsk(null); setNote(text); };
  const fail = (e: unknown) => setNote(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
  const nameOf = (id: string | null | undefined) => (id ? people.get(id)?.name : undefined) ?? "They";

  async function logged(personId: string, r: Reminder | null, channel: Channel | null) {
    try { const res = await post<{ person?: Person }>("history", { id: personId, type: channel ? LOGGED[channel] : "message", text: "" }); done(`Logged: you ${channel ? VIA[channel] : "reached"} ${nameOf(personId)}.`, r, res.person); }
    catch (e) { fail(e); }
  }
  async function snooze(r: Reminder, days: number) {
    try { await post("reminders/snooze", { key: r.key, days }); done(`Snoozed for ${days} days.`, r); } catch (e) { fail(e); }
  }
  async function checkIn(r: Reminder, a: "accepted" | "replied" | "no") {
    try { const res = await answerCheckIn(r.personId!, r.hour!, a); done(checkInToast(nameOf(r.personId), res), r); } catch (e) { fail(e); }
  }

  const everyone = useMemo(() => groupBySource([...people.values()], sources, query), [people, sources, query]);
  const shownCount = everyone.reduce((n, g) => n + g.people.length, 0);
  const open = openId ? people.get(openId) : undefined;
  const outreach = ask?.r?.kind === "outreach";

  return (
    <div className="ph-page">
      {header}
      <main className="ph-activity">
        <div className="ph-seg ph-seg-2" role="tablist" aria-label="Who to show">
          <button type="button" role="tab" aria-selected={tab === "due"} onClick={() => setTab("due")}>Needs you{list ? ` · ${list.length}` : ""}</button>
          <button type="button" role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>Everyone{list ? ` · ${people.size}` : ""}</button>
        </div>
        {error && !list && <div className="ph-empty"><strong>Couldn't load Network</strong><span>{error}</span><button type="button" className="ph-btn" onClick={() => void reload()}>Try again</button></div>}
        {!list && !error && <p className="ph-triage-count">Loading…</p>}

        {tab === "due" && list && <>
          <div className="ph-people-head">
            <p className="ph-triage-count">{`${list.length} ${list.length === 1 ? "person needs" : "need"} you`}</p>
            <Link className="ph-link" to="/network?all=1">All of Network</Link>
          </div>
          {!list.length && <div className="ph-empty"><strong>Nobody is waiting on you</strong><span>Follow-ups and check-ins show up here when they're due.</span></div>}
          <ul className="ph-people">
            {list.map((r) => {
              const p = r.personId ? people.get(r.personId) : undefined;
              const ways = contacts(p);
              return (
                <li key={r.key} className={`ph-person is-${r.kind}`}>
                  <div className="ph-person-top">
                    {p ? <button type="button" className="ph-person-name ph-open" onClick={() => openPerson(p.id)}><b>{r.title}</b><small>{[[p.role, p.company].filter(Boolean).join(" · "), r.detail].filter(Boolean).join(" — ")}</small></button>
                      : <span className="ph-person-name"><b>{r.title}</b><small>{r.detail}</small></span>}
                  </div>
                  <div className="ph-ways">
                    {ways.map(([ch, label, href]) => (
                      <a key={ch} className="ph-btn" href={href} target={ch === "linkedin" ? "_blank" : undefined} rel="noreferrer" onClick={() => setAsk({ personId: p!.id, r, channel: ch })}>{label}</a>
                    ))}
                    {r.kind === "outreach" || (p && !ways.length) ? <button type="button" className="ph-btn" onClick={() => setAsk({ personId: p?.id ?? null, r, channel: null })}>{r.kind === "outreach" ? "Did they respond?" : "I reached out"}</button> : null}
                    {!p && <Link className="ph-btn" to={r.workId ? `/network?work=${r.workId}` : "/network?view=due"}>Open in Network</Link>}
                  </div>
                </li>
              );
            })}
          </ul>
        </>}

        {tab === "all" && list && <>
          <label className="ph-search"><span className="ph-sr">Search people</span>
            <input type="search" placeholder="Name, company, city, where you met…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {!people.size && <div className="ph-empty"><strong>No one here yet</strong><span>Add people on the laptop's Network map, or from LinkedIn with the extension.</span></div>}
          {people.size > 0 && !shownCount && <div className="ph-empty"><strong>No one matches “{query.trim()}”</strong><span>Try a first name, a company or a city.</span></div>}
          {everyone.map((g) => (
            <section key={g.id ?? "none"} className="ph-day" aria-label={g.name}>
              <h2>{g.name} · {g.people.length}</h2>
              <ul className="ph-roster">
                {g.people.map((p) => {
                  const f = followUp(p.nextFollowUp);
                  return (
                    <li key={p.id}>
                      <button type="button" className="ph-row" onClick={() => openPerson(p.id)}>
                        <Avatar person={p} size={40} />
                        <span className="ph-person-name"><b>{p.name}</b><small>{[p.role, p.company].filter(Boolean).join(" · ") || p.city || " "}</small></span>
                        {f && <span className={`ph-due${f.due ? " is-due" : ""}`}>{f.due ? (f.text === "today" ? "Today" : "Late") : f.text}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>}
        <p className="ph-note" role="status">{note}</p>
      </main>

      {open && <PhonePerson person={open} people={people} sources={sources} onClose={closePerson}
        onReach={(channel) => setAsk({ personId: open.id, r: list?.find((r) => r.personId === open.id && r.kind !== "outreach") ?? null, channel })}
        onChange={(p, text) => { replace(p); setNote(text); }} />}

      {ask && (
        <div className="ph-sheet-wrap" onClick={() => setAsk(null)}>
          <div className="ph-sheet ph-posting" role="dialog" aria-modal="true" aria-label={outreach ? "Did they respond?" : "Did you reach them?"} onClick={(e) => e.stopPropagation()}>
            <i className="ph-grab" aria-hidden="true" />
            <h2>{outreach ? `Did ${nameOf(ask.personId)} respond?` : `Did you reach ${nameOf(ask.personId)}?`}</h2>
            {ask.r && <p className="ph-meta">{ask.r.title}</p>}
            {outreach && ask.r ? (
              <div className="ph-marks">
                <button type="button" className="ph-btn is-primary" onClick={() => void checkIn(ask.r!, "replied")}>They replied</button>
                <button type="button" className="ph-btn" onClick={() => void checkIn(ask.r!, "accepted")}>Accepted</button>
                <button type="button" className="ph-btn" onClick={() => void checkIn(ask.r!, "no")}>No reply yet</button>
                <button type="button" className="ph-btn" onClick={() => setAsk(null)}>Not now</button>
              </div>
            ) : (
              <div className="ph-marks">
                {ask.personId && <button type="button" className="ph-btn is-primary ph-wide" onClick={() => void logged(ask.personId!, ask.r, ask.channel)}>Yes, I {ask.channel ? VIA[ask.channel] : "reached out to"} them</button>}
                {ask.r && <button type="button" className="ph-btn" onClick={() => void snooze(ask.r!, 2)}>Snooze 2 days</button>}
                <button type="button" className="ph-btn" onClick={() => setAsk(null)}>Not now</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
