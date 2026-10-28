import { useEffect, useState } from "react";
import { JOB_STATUS, ago, loadPersonJobs, loadWarmJobs, type CompanyGroup, type JobRow, type Person } from "./network";

const open = (j: JobRow) => j.status === "new" || j.status === "ready";

function JobLine({ job, ask, askLabel }: { job: JobRow; ask?: () => void; askLabel?: string }) {
  return (
    <li className={`nwj-job is-${job.status}`}>
      <div className="nwj-what">
        <a href={job.applyUrl} target="_blank" rel="noreferrer">{job.title}</a>
        <small>{[job.location, job.site === "staffing" ? "staffing" : "", job.status === "applied" ? (job.appliedAt ? `applied ${ago(job.appliedAt)}` : "applied") : job.foundAt ? `found ${ago(job.foundAt)}` : ""].filter(Boolean).join(" · ")}</small>
      </div>
      <span className={`nwj-st is-${job.status}`}>{JOB_STATUS[job.status]}</span>
      {ask && open(job) && <button type="button" className="nw-chip nwj-ask" onClick={ask}>{askLabel ?? "Ask for a referral"}</button>}
    </li>
  );
}

/** In a person's panel: the open jobs at their company (with a referral button each) and your applications there. */
export function PersonJobs({ person, company, onReferral, watching, onWatch }: { person: Person; company: string; onReferral: (j: JobRow) => void; watching: boolean; onWatch: (on: boolean) => void }) {
  const [state, setState] = useState<{ key: string; jobs: JobRow[] | null; error: string }>({ key: "", jobs: null, error: "" });
  const key = `${person.id}|${company}`;
  useEffect(() => {
    if (!company) return;
    let on = true;
    loadPersonJobs(person.id).then((r) => on && setState({ key, jobs: r.jobs, error: "" })).catch((e) => on && setState({ key, jobs: [], error: String(e.message || e) }));
    return () => { on = false; };
  }, [person.id, company, key]);
  if (!company) return <p className="nw-muted">Add where {person.name.split(" ")[0]} works to see that company's jobs here.</p>;
  const jobs = state.key === key ? state.jobs : null;
  const openJobs = (jobs ?? []).filter(open), mine = (jobs ?? []).filter((j) => j.status === "applied");
  return (
    <div className="nwj-person">
      <label className="nwj-watch"><input type="checkbox" checked={watching} onChange={(e) => onWatch(e.target.checked)} /><span>Tell me about new jobs at {company}</span></label>
      {jobs === null ? <p className="nw-muted">Looking for jobs at {company}…</p> : state.error ? <p className="nw-error">{state.error}</p> : <>
        {openJobs.length ? <ul className="nwj-list">{openJobs.slice(0, 12).map((j) => <JobLine key={j.url} job={j} ask={() => onReferral(j)} />)}</ul>
          : <p className="nw-muted">No open jobs at {company} on your job board right now.{watching ? " You will hear when one shows up." : ""}</p>}
        {openJobs.length > 12 && <p className="nw-muted">And {openJobs.length - 12} more in the Jobs tab.</p>}
        {mine.length > 0 && <><div className="nw-lab">Your applications there</div><ul className="nwj-list">{mine.slice(0, 8).map((j) => <JobLine key={j.url} job={j} />)}</ul></>}
      </>}
    </div>
  );
}

/** The Jobs tab: every company where you know someone, its open jobs, and who to ask. */
export function WarmJobs({ onPerson, onReferral, onWatch, colors }: { onPerson: (id: string) => void; onReferral: (personId: string, j: JobRow) => void; onWatch: (personId: string, on: boolean) => void; colors: Map<string, string> }) {
  const [groups, setGroups] = useState<CompanyGroup[] | null>(null);
  const [error, setError] = useState("");
  const [asker, setAsker] = useState<Record<string, string>>({});
  useEffect(() => { let on = true; loadWarmJobs().then((g) => on && setGroups(g)).catch((e) => on && setError(String(e.message || e))); return () => { on = false; }; }, []);
  if (error) return <p className="nw-error nwj-pad">{error}</p>;
  if (!groups) return <p className="nw-muted nwj-pad">Matching your people's companies with the job board…</p>;
  if (!groups.length) return <div className="nw-empty"><h3>No companies yet</h3><p>Add where people work (the "Works at" field in their panel, or a company source) and the jobs there show up here.</p></div>;
  const total = groups.reduce((n, g) => n + g.jobs.filter(open).length, 0);
  return (
    <div className="nwj-tab">
      <p className="nwj-sum"><b>{total}</b> open {total === 1 ? "job" : "jobs"} at <b>{groups.filter((g) => g.jobs.some(open)).length}</b> of {groups.length} companies where you know someone.</p>
      {groups.map((g) => {
        const who = asker[g.company] ?? g.people[0].id, person = g.people.find((p) => p.id === who) ?? g.people[0];
        const openJobs = g.jobs.filter(open), mine = g.jobs.filter((j) => j.status === "applied");
        return (
          <section key={g.company} className="nwj-co">
            <header>
              <h3>{g.company}</h3>
              <span className="nwj-count">{openJobs.length} open{mine.length ? ` · ${mine.length} applied` : ""}</span>
              <div className="nwj-people">{g.people.map((p) => <button key={p.id} type="button" className="nwj-pp" onClick={() => onPerson(p.id)}><i style={{ background: colors.get(p.id) }} />{p.name}</button>)}</div>
            </header>
            <div className="nwj-co-bar">
              {g.people.length > 1 && <label>Ask <select value={who} onChange={(e) => setAsker({ ...asker, [g.company]: e.target.value })}>{g.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
              <label className="nwj-watch"><input type="checkbox" checked={person.watchJobs} onChange={(e) => { onWatch(person.id, e.target.checked); setGroups(groups.map((x) => (x.company === g.company ? { ...x, people: x.people.map((p) => (p.id === person.id ? { ...p, watchJobs: e.target.checked } : p)) } : x))); }} /><span>Tell me about new jobs here</span></label>
            </div>
            {openJobs.length ? <ul className="nwj-list">{openJobs.slice(0, 8).map((j) => <JobLine key={j.url} job={j} ask={() => onReferral(person.id, j)} askLabel={`Ask ${person.name.split(" ")[0]} for a referral`} />)}</ul> : <p className="nw-muted">Nothing open right now.</p>}
            {openJobs.length > 8 && <p className="nw-muted">And {openJobs.length - 8} more.</p>}
          </section>
        );
      })}
    </div>
  );
}
