import { useEffect, useState, type CSSProperties } from "react";
import NetworkSourceContext from "./NetworkSourceContext";
import {
  JOB_STATUS, SOURCE_TYPES, ago, colorsFor, followUp, imageUrl, initials, loadMailSettings, loadSourceJobs, post, sourceLabel, throughFields, throughValue, uploadPhoto,
  type JobRow, type MailSettings, type NetworkData, type Source, type SourceType, type You,
} from "./network";

type Say = (t: { text: string } | null) => void;
const field = (id: string, label: string, value: string, onChange: (v: string) => void, onCommit: () => void, placeholder = "", type = "text") => (
  <label className="nw-f"><span>{label}</span><input id={id} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onBlur={onCommit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></label>
);

/** A picture that is a photo when there is one and a lettered tile (or initials) when not; click to change it. */
function Picture({ photo, label, color, square, onFile }: { photo?: string | null; label: string; color: string; square?: boolean; onFile: (f: File) => void }) {
  return (
    <label className={`pp-pic${square ? " sq" : ""}`} style={{ "--c": color } as CSSProperties} title={photo ? "Change the picture" : "Add a picture"}>
      {photo ? <img src={imageUrl(photo)} alt="" /> : <span>{label}</span>}
      <em>{photo ? "Change" : "+ Photo"}</em>
      <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
    </label>
  );
}

/**
 * You, the centre of the map: your photo, name and a title people would recognise, a note to yourself, the "about you" every AI draft
 * starts from, and the sender details emails go out with. The numbers are your network today.
 */
export function YouPanel({ data, onChange, onClose, say }: { data: NetworkData; onChange: (y: You) => void; onClose: () => void; say: Say }) {
  const you = data.you ?? { x: 0, y: 0 };
  const [d, setD] = useState({ name: you.name ?? "", title: you.title ?? "", note: you.note ?? "" });
  const [tab, setTab] = useState<"you" | "sender">("you");
  const [mail, setMail] = useState<MailSettings | null>(null);
  const [m, setM] = useState({ about: "", fromName: "", fromEmail: "", signature: "" });
  const [saving, setSaving] = useState("");
  useEffect(() => { let on = true; loadMailSettings().then((s) => { if (!on) return; setMail(s); setM({ about: s.about, fromName: s.fromName, fromEmail: s.fromEmail, signature: s.signature }); }).catch(() => { /* sender details stay empty */ }); return () => { on = false; }; }, []);
  async function save(fields: Partial<You>) {
    setSaving("Saving…");
    try { const r = await post<{ you: You }>("you", fields); onChange(r.you); setSaving("Saved"); window.setTimeout(() => setSaving(""), 1200); }
    catch (e) { setSaving(""); say({ text: String((e as Error).message) }); }
  }
  async function saveMail(fields: Partial<typeof m>) {
    setSaving("Saving…");
    try { await post("mail/settings", fields); setSaving("Saved"); window.setTimeout(() => setSaving(""), 1200); }
    catch (e) { setSaving(""); say({ text: String((e as Error).message) }); }
  }
  const due = data.people.filter((p) => followUp(p.nextFollowUp)?.due).length, never = data.people.filter((p) => !p.lastContact).length;
  const name = d.name || mail?.fromName || "You";
  return (
    <aside className="nw-panel pp" aria-label="You">
      <header className="pp-head">
        <Picture photo={you.photoId} label={initials(name)} color="var(--nw-accent)" onFile={(f) => { setSaving("Uploading…"); uploadPhoto(f).then((id) => save({ photoId: id })).catch((e: Error) => { setSaving(""); say({ text: e.message }); }); }} />
        <div className="pp-id">
          <input className="nw-name" aria-label="Your name" placeholder={mail?.fromName || "Your name"} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} onBlur={() => { if (d.name !== (you.name ?? "")) void save({ name: d.name }); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          <input className="nw-role" aria-label="Your title" placeholder="A line about you, like Data engineer, open to roles in NYC" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} onBlur={() => { if (d.title !== (you.title ?? "")) void save({ title: d.title }); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        </div>
        <span className="nw-saving" aria-live="polite">{saving}</span>
        <button type="button" className="nw-x" aria-label="Close" onClick={onClose}>×</button>
      </header>
      <dl className="pp-nums">
        <div><dt>People</dt><dd>{data.people.length}</dd></div>
        <div><dt>Sources</dt><dd>{data.sources.length}</dd></div>
        <div className={due ? "due" : ""}><dt>Follow-ups due</dt><dd>{due}</dd></div>
        <div><dt>Never contacted</dt><dd>{never}</dd></div>
      </dl>
      <div className="pp-tabs" role="tablist" aria-label="About you">
        {([["you", "You"], ["sender", "Sender"]] as const).map(([t, l]) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{l}</button>)}
      </div>
      <div key={tab} className="pp-body" role="tabpanel">
        {tab === "you" ? <>
          <label className="pp-notes"><span className="pp-h">About you</span><small className="pp-hint">Every AI draft starts from this: what you do, what you want, when you can start.</small>
            <textarea id="nw-you-about" value={m.about} placeholder="Data engineer finishing a master's in May. Looking for data and ML roles in New York or remote." onChange={(e) => setM({ ...m, about: e.target.value })} onBlur={() => { if (mail && m.about !== mail.about) void saveMail({ about: m.about }); }} /></label>
          <label className="pp-notes"><span className="pp-h">A note to yourself</span>
            <textarea id="nw-you-note" value={d.note} placeholder="This month: three referrals at companies you already know." onChange={(e) => setD({ ...d, note: e.target.value })} onBlur={() => { if (d.note !== (you.note ?? "")) void save({ note: d.note }); }} /></label>
        </> : <>
          <div className="pp-grid">
            {field("nw-you-from", "Your name on emails", m.fromName, (v) => setM({ ...m, fromName: v }), () => { if (mail && m.fromName !== mail.fromName) void saveMail({ fromName: m.fromName }); })}
            {field("nw-you-email", "Send from", m.fromEmail, (v) => setM({ ...m, fromEmail: v }), () => { if (mail && m.fromEmail !== mail.fromEmail) void saveMail({ fromEmail: m.fromEmail }); }, "", "email")}
          </div>
          <label className="pp-notes"><span className="pp-h">Signature</span><textarea id="nw-you-sig" value={m.signature} onChange={(e) => setM({ ...m, signature: e.target.value })} onBlur={() => { if (mail && m.signature !== mail.signature) void saveMail({ signature: m.signature }); }} /></label>
          <p className={`pp-hint ${mail?.connected ? "ok" : "warn"}`}>{mail ? (mail.connected ? "Gmail is connected: emails go out from your account when you press Send." : "Gmail is not connected yet. Connect it once in Outreach, then Send works here.") : "Loading…"}</p>
        </>}
      </div>
    </aside>
  );
}

/**
 * A source (a company, an event, family): its picture or logo, what it is, how it came to you, its people, its jobs when it is a company,
 * and your notes about it.
 */
export function SourcePanel({ source: s, data, colors, onChange, onClose, onPerson, onAddPeople, onReferral, say }: {
  source: Source; data: NetworkData; colors: ReturnType<typeof colorsFor>; onChange: (s: Source) => void; onClose: () => void; onPerson: (id: string) => void;
  onAddPeople: () => void; onReferral: (personId: string, job: JobRow) => void; say: Say;
}) {
  const [d, setD] = useState({ name: s.name, about: s.about ?? "", notes: s.notes ?? "", context: s.context ?? "", place: s.place ?? "", when: s.when ?? "" });
  const [through, setThrough] = useState(throughValue(s));
  const [tab, setTab] = useState<"people" | "jobs" | "notes" | "details">("people");
  const [page, setPage] = useState(0);
  const [jobs, setJobs] = useState<{ id: string; list: JobRow[] } | null>(null);
  const [asker, setAsker] = useState("");
  const [saving, setSaving] = useState("");
  const [seen, setSeen] = useState(s);
  if (seen !== s) { setSeen(s); setD({ name: s.name, about: s.about ?? "", notes: s.notes ?? "", context: s.context ?? "", place: s.place ?? "", when: s.when ?? "" }); setThrough(throughValue(s)); }
  const hiring = s.type === "company" || s.type === "staffing";
  useEffect(() => { if (!hiring || tab !== "jobs") return; let on = true; loadSourceJobs(s.id).then((r) => on && setJobs({ id: s.id, list: r.jobs })).catch(() => on && setJobs({ id: s.id, list: [] })); return () => { on = false; }; }, [s.id, hiring, tab]);
  async function save(fields: Record<string, unknown>) {
    setSaving("Saving…");
    try { const r = await post<{ source: Source }>("source", { id: s.id, ...fields }); onChange(r.source); setSaving("Saved"); window.setTimeout(() => setSaving(""), 1200); }
    catch (e) { setSaving(""); say({ text: String((e as Error).message) }); }
  }
  const color = colors.source.get(s.id) ?? "var(--nw-accent)";
  const members = data.people.filter((p) => p.sourceId === s.id).sort((a, b) => (b.lastContact ?? "").localeCompare(a.lastContact ?? "") || a.name.localeCompare(b.name));
  const per = typeof window !== "undefined" && window.innerHeight < 800 ? 5 : 7, pages = Math.max(1, Math.ceil(members.length / per)), pg = Math.min(page, pages - 1);
  const parent = s.parentSourceId ? data.sources.find((x) => x.id === s.parentSourceId) : null, introducer = s.viaPersonId ? data.people.find((p) => p.id === s.viaPersonId) : null;
  const askWho = asker || members[0]?.id || "";
  const openJobs = jobs?.id === s.id ? jobs.list.filter((j) => j.status === "new" || j.status === "ready") : null;
  return (
    <aside className="nw-panel pp" aria-label={s.name}>
      <header className="pp-head">
        <Picture square photo={s.photoId} label={s.name[0]?.toUpperCase() ?? "?"} color={color} onFile={(f) => { setSaving("Uploading…"); uploadPhoto(f).then((id) => save({ photoId: id })).catch((e: Error) => { setSaving(""); say({ text: e.message }); }); }} />
        <div className="pp-id">
          <input className="nw-name" aria-label="Name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} onBlur={() => { if (d.name.trim() && d.name !== s.name) void save({ name: d.name }); else setD({ ...d, name: s.name }); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          <input className="nw-role" aria-label="About" placeholder="What it is, like Staffing agency in Raleigh" value={d.about} onChange={(e) => setD({ ...d, about: e.target.value })} onBlur={() => { if (d.about !== (s.about ?? "")) void save({ about: d.about }); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          <p className="pp-where">{SOURCE_TYPES.find(([t]) => t === s.type)?.[1]} · {members.length} {members.length === 1 ? "person" : "people"}</p>
        </div>
        <span className="nw-saving" aria-live="polite">{saving}</span>
        <button type="button" className="nw-x" aria-label="Close" onClick={onClose}>×</button>
      </header>
      <nav className="pp-trail" aria-label="How it reached you">
        <span className="pp-step you">You</span>
        {(parent || introducer) && <span className="pp-hop"><i aria-hidden="true">›</i>{introducer ? <button type="button" className="pp-step" style={{ "--c": colors.person.get(introducer.id) } as CSSProperties} onClick={() => onPerson(introducer.id)}>{introducer.name}</button> : <span className="pp-step" style={{ "--c": colors.source.get(parent!.id) } as CSSProperties}>{parent!.name}</span>}</span>}
        <span className="pp-hop"><i aria-hidden="true">›</i><span className="pp-step me" style={{ "--c": color } as CSSProperties}>{s.name}</span></span>
        {s.context && <span className="pp-ctx">{s.context}</span>}
      </nav>
      <div className="pp-actions">
        <button type="button" className="nw-btn main" onClick={onAddPeople}>Add people</button>
        {s.photoId && <button type="button" className="pp-pill" onClick={() => void save({ photoId: null })}>Remove picture</button>}
      </div>
      <div className="pp-tabs" role="tablist" aria-label={`About ${s.name}`}>
        {([["people", `People`], ...(hiring ? [["jobs", "Jobs"]] : []), ["notes", "Notes"], ["details", "Details"]] as [typeof tab, string][]).map(([t, l]) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{l}{t === "people" && <small>{members.length}</small>}</button>)}
      </div>
      <div key={tab} className="pp-body" role="tabpanel">
        {tab === "people" && <>
          <ul className="pp-people">{members.slice(pg * per, pg * per + per).map((p) => { const f = followUp(p.nextFollowUp); return (
            <li key={p.id}><button type="button" onClick={() => onPerson(p.id)}>
              <span className={`nw-av${p.photoId ? " ph" : ""}`} style={{ "--c": colors.person.get(p.id) } as CSSProperties} aria-hidden="true">{p.photoId ? <img src={imageUrl(p.photoId)} alt="" /> : initials(p.name)}</span>
              <span className="who"><b>{p.name}</b><small>{p.role || (p.city ? p.city : " ")}</small></span>
              <span className={`when${f?.due ? " due" : ""}`}>{f?.due ? `follow up ${f.text}` : ago(p.lastContact)}</span>
            </button></li>); })}
            {!members.length && <li className="nw-muted">Nobody here yet. Add a list of names, or import a file.</li>}</ul>
          {pages > 1 && <div className="pp-pager"><button type="button" className="nw-chip" disabled={pg === 0} onClick={() => setPage(pg - 1)}>Previous</button><span>{pg + 1} of {pages}</span><button type="button" className="nw-chip" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>Next</button></div>}
        </>}
        {tab === "jobs" && (openJobs === null ? <p className="nw-muted">Looking for jobs at {s.name}…</p> : <>
          {members.length > 0 && <label className="pp-ask">Ask <select value={askWho} onChange={(e) => setAsker(e.target.value)}>{members.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select> for a referral</label>}
          {openJobs.length ? <ul className="nwj-list">{openJobs.slice(0, 5).map((j) => (
            <li key={j.url} className={`nwj-job is-${j.status}`}><div className="nwj-what"><a href={j.applyUrl} target="_blank" rel="noreferrer">{j.title}</a><small>{[j.location, j.foundAt ? `found ${ago(j.foundAt)}` : ""].filter(Boolean).join(" · ")}</small></div>
              <span className={`nwj-st is-${j.status}`}>{JOB_STATUS[j.status]}</span>{askWho && <button type="button" className="nw-chip nwj-ask" onClick={() => onReferral(askWho, j)}>Ask</button>}</li>))}</ul>
            : <p className="nw-muted">No open jobs at {s.name} on your job board right now.</p>}
          {openJobs.length > 5 && <p className="nw-muted">And {openJobs.length - 5} more in the Jobs tab of Network.</p>}
        </>)}
        {tab === "notes" && <label className="pp-notes"><span className="pp-h">Notes</span><textarea id="nw-src-notes" value={d.notes} placeholder="Who hires there, how they like to be approached, what you learned." onChange={(e) => setD({ ...d, notes: e.target.value })} onBlur={() => { if (d.notes !== (s.notes ?? "")) void save({ notes: d.notes }); }} /></label>}
        {tab === "details" && <>
          <div className="nw-pair">
            <label className="nw-f"><span>Where</span><input id="nw-src-place" placeholder="Raleigh, NC or Global" value={d.place} onChange={(e) => setD({ ...d, place: e.target.value })} onBlur={() => { if (d.place !== (s.place ?? "")) void save({ place: d.place }); }} /></label>
            {s.type === "event" && <label className="nw-f"><span>When</span><input id="nw-src-when" placeholder="Oct 2024" value={d.when} onChange={(e) => setD({ ...d, when: e.target.value })} onBlur={() => { if (d.when !== (s.when ?? "")) void save({ when: d.when }); }} /></label>}
          </div>
          <label className="nw-f"><span>Kind</span><select id="nw-src-kind" value={s.type} onChange={(e) => void save({ type: e.target.value as SourceType })}>{SOURCE_TYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}</select></label>
          <NetworkSourceContext sources={data.sources} people={data.people} parentSourceId={through} onParent={(v) => { setThrough(v); void save(throughFields(v)); }} context={d.context} onContext={(v) => setD({ ...d, context: v })} excludeId={s.id} prefix="nw-srcp" />
          <button type="button" className="pp-link" onClick={() => { if (d.context !== (s.context ?? "")) void save({ context: d.context }); }}>Save the context</button>
          <p className="pp-hint">{sourceLabel(s, data.sources, data.people)}</p>
        </>}
      </div>
    </aside>
  );
}
