import { useEffect, useState } from "react";
import { ago, followUpSummary, historyLabel, imageUrl, initials, introducersOf, JOB_STATUS, loadPersonJobs, plusDays, post, sourceLabel, type JobRow, type Person, type Source } from "./network";
import { contacts, type Channel } from "./peopleContacts";

// One person on a phone, the whole screen: how to reach them, where they came from, when to follow up, what happened, and the
// jobs open at their company. Every button writes what the Network panel on the laptop writes.

const FOLLOW: [string, number | null][] = [["In 3 days", 3], ["In a week", 7], ["In 2 weeks", 14], ["No date", null]];
const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });

export function Avatar({ person, size = 44 }: { person: Person; size?: number }) {
  return (
    <span className="ph-av" style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden="true">
      {person.photoId ? <img src={imageUrl(person.photoId)} alt="" loading="lazy" /> : initials(person.name)}
    </span>
  );
}

export default function PhonePerson({ person, people, sources, onClose, onReach, onChange }: {
  person: Person; people: Map<string, Person>; sources: Source[];
  onClose: () => void; onReach: (channel: Channel | null) => void; onChange: (p: Person, note: string) => void;
}) {
  const [jobs, setJobs] = useState<{ company: string; jobs: JobRow[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    loadPersonJobs(person.id).then((r) => { if (alive) setJobs({ company: r.company, jobs: r.jobs }); }, () => { if (alive) setJobs({ company: "", jobs: [] }); });
    return () => { alive = false; };
  }, [person.id]);

  const source = person.sourceId ? sources.find((s) => s.id === person.sourceId) : undefined;
  const introduced = introducersOf(person).map((id) => people.get(id)?.name).filter(Boolean);
  const follow = followUpSummary(person);
  const ways = contacts(person);
  const history = [...(person.history ?? [])].sort((a, b) => b.at.localeCompare(a.at));
  const open = (jobs?.jobs ?? []).filter((j) => j.status !== "passed");

  async function setFollowUp(days: number | null) {
    setBusy(true); setError("");
    try {
      const r = await post<{ person: Person }>("person", { id: person.id, nextFollowUp: days === null ? null : plusDays(days) });
      onChange(r.person, days === null ? `No follow-up date for ${person.name}.` : `Follow up with ${person.name} ${FOLLOW.find(([, d]) => d === days)![0].toLowerCase()}.`);
    } catch (e) { setError(`Not saved: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  }

  return (
    <div className="ph-screen" role="dialog" aria-modal="true" aria-label={person.name}>
      <header className="ph-screen-top">
        <button type="button" className="ph-back" onClick={onClose}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>People</button>
        <a className="ph-link" href={`/network?map=main&person=${encodeURIComponent(person.id)}`}>On the map</a>
      </header>
      <div className="ph-screen-body">
        <section className="ph-who">
          <Avatar person={person} size={64} />
          <div className="ph-person-name">
            <h1>{person.name}</h1>
            <small>{[person.role, person.company].filter(Boolean).join(" · ") || "No role yet"}</small>
            {person.city && <small>{person.city}</small>}
          </div>
        </section>

        <div className="ph-ways">
          {ways.map(([ch, label, href]) => <a key={ch} className="ph-btn" href={href} target={ch === "linkedin" ? "_blank" : undefined} rel="noreferrer" onClick={() => onReach(ch)}>{label}</a>)}
          <button type="button" className="ph-btn ph-log" onClick={() => onReach(null)}>{ways.length ? "Log it" : "I reached out"}</button>
        </div>

        <section className="ph-facts" aria-label="How you know them">
          <div><dt>Met through</dt><dd>{source ? sourceLabel(source, sources, [...people.values()]) : "No source"}</dd></div>
          {introduced.length > 0 && <div><dt>Introduced by</dt><dd>{introduced.join(", ")}</dd></div>}
          <div><dt>Last contact</dt><dd>{ago(person.lastContact)}</dd></div>
        </section>

        <section className={`ph-follow${follow.due ? " is-due" : ""}`} aria-label="Follow-up">
          <b>{follow.title}</b>
          <small>{follow.detail}</small>
          <div className="ph-chips" role="group" aria-label="Change the follow-up">
            {FOLLOW.map(([label, d]) => <button key={label} type="button" className="ph-chip" disabled={busy} onClick={() => void setFollowUp(d)}>{label}</button>)}
          </div>
          {error && <p className="ph-error" role="alert">{error}</p>}
        </section>

        {person.notes && <section className="ph-block"><h2>Notes</h2><p className="ph-notes">{person.notes}</p></section>}

        <section className="ph-block">
          <h2>{jobs?.company ? `Open at ${jobs.company}` : "Jobs at their company"}</h2>
          {!jobs && <p className="ph-meta">Loading…</p>}
          {jobs && !open.length && <p className="ph-meta">{jobs.company ? "Nothing open there right now." : "Add where they work to see jobs there."}</p>}
          <ul className="ph-jobs">
            {open.slice(0, 8).map((j) => (
              <li key={j.url}><a href={j.url} target="_blank" rel="noreferrer"><b>{j.title}</b><small>{[j.location, j.status !== "new" ? JOB_STATUS[j.status] : null].filter(Boolean).join(" · ")}</small></a></li>
            ))}
          </ul>
          {open.length > 8 && <p className="ph-meta">And {open.length - 8} more on the laptop.</p>}
        </section>

        <section className="ph-block">
          <h2>What happened</h2>
          {!history.length && <p className="ph-meta">Nothing logged yet.</p>}
          <ol className="ph-timeline">
            {history.map((h) => (
              <li key={h.id}><span><b>{historyLabel(h)}</b><time dateTime={h.at}>{date(h.at)}</time></span>{(h.text || h.followUp?.nextNotes) && <p>{h.text || h.followUp?.nextNotes}</p>}</li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
