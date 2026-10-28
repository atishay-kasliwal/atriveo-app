import { useEffect, useState, type CSSProperties } from "react";
import NetworkSourceContext from "./NetworkSourceContext";
import {
  peopleForSource, organisationInitials, JOB_STATUS, LINK_KINDS, SOURCE_TYPES, ago, colorsFor, followUp, imageUrl, initials, loadMailSettings, loadNetwork, loadPersonJobs, loadSourceJobs, post, sourceLabel, throughFields, throughValue, uploadPhoto,
  type JobRow, type LinkKind, type MailSettings, type NetworkData, type Source, type SourceType, type You,
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
export function SourcePanel({ source: s, data, colors, onChange, onClose, onPerson, onSource, onAddPeople, onReferral, onLinks, onReload, say }: {
  source: Source; data: NetworkData; colors: ReturnType<typeof colorsFor>; onChange: (s: Source) => void; onClose: () => void; onPerson: (id: string) => void;
  onSource: (id: string) => void; onReload: () => Promise<void>;
  onAddPeople: (sourceId?: string) => void; onReferral: (personId: string, job: JobRow) => void; onLinks: (l: NetworkData["links"]) => void; say: Say;
}) {
  const [d, setD] = useState({ name: s.name, about: s.about ?? "", notes: s.notes ?? "", context: s.context ?? "", place: s.place ?? "", when: s.when ?? "", introYear: s.introYear ?? "" });
  const [through, setThrough] = useState(throughValue(s));
  const [tab, setTab] = useState<"people" | "jobs" | "links" | "intro" | "notes" | "details">("people");
  const [link, setLink] = useState<{ to: string; kind: LinkKind; label: string } | null>(null);
  const [page, setPage] = useState(0);
  const [jobs, setJobs] = useState<{ id: string; list: JobRow[] } | null>(null);
  const [asker, setAsker] = useState("");
  const [saving, setSaving] = useState("");
  const [seen, setSeen] = useState(s);
  if (seen !== s) { setSeen(s); setD({ name: s.name, about: s.about ?? "", notes: s.notes ?? "", context: s.context ?? "", place: s.place ?? "", when: s.when ?? "", introYear: s.introYear ?? "" }); setThrough(throughValue(s)); }
  const hiring = s.type === "company" || s.type === "staffing";
  useEffect(() => { if (!hiring || tab !== "jobs") return; let on = true; loadSourceJobs(s.id).then((r) => on && setJobs({ id: s.id, list: r.jobs })).catch(() => on && setJobs({ id: s.id, list: [] })); return () => { on = false; }; }, [s.id, hiring, tab]);
  async function save(fields: Record<string, unknown>) {
    setSaving("Saving…");
    try { const r = await post<{ source: Source }>("source", { id: s.id, ...fields }); onChange(r.source); setSaving("Saved"); window.setTimeout(() => setSaving(""), 1200); }
    catch (e) { setSaving(""); say({ text: String((e as Error).message) }); }
  }
  const color = colors.source.get(s.id) ?? "var(--nw-accent)";
  const members = peopleForSource(s, data).sort((a, b) => (b.lastContact ?? "").localeCompare(a.lastContact ?? "") || a.name.localeCompare(b.name));
  const per = typeof window !== "undefined" && window.innerHeight < 800 ? 5 : 7, pages = Math.max(1, Math.ceil(members.length / per)), pg = Math.min(page, pages - 1);
  const parent = s.parentSourceId ? data.sources.find((x) => x.id === s.parentSourceId) : null, introducer = s.viaPersonId ? data.people.find((p) => p.id === s.viaPersonId) : null;
  // Your own lines from this source to a person or another source (Randstad and the conference where you met them).
  const links = data.links.filter((l) => l.a === s.id || l.b === s.id).map((l) => {
    const id = l.a === s.id ? l.b : l.a, person = data.people.find((p) => p.id === id), other = data.sources.find((x) => x.id === id);
    return { l, id, name: person?.name ?? other?.name ?? "Someone archived", isPerson: Boolean(person), c: l.color ?? (person ? colors.person.get(id) : colors.source.get(id)) };
  });
  async function connect() {
    if (!link?.to) return;
    try { await post("link", { a: s.id, b: link.to, kind: link.kind, label: link.label }); onLinks((await loadNetwork()).links); setLink(null); }
    catch (e) { say({ text: String((e as Error).message) }); }
  }
  async function disconnect(id: string) {
    try { await post("link/remove", { id }); onLinks(data.links.filter((l) => l.id !== id)); } catch (e) { say({ text: String((e as Error).message) }); }
  }
  // LinkedIn holds a card per day of reach-outs (You, LinkedIn, the day, the people).
  const linkedin = s.name === "LinkedIn" && !s.parentSourceId && !s.viaPersonId;
  const sortable = members.filter((p) => !p.via).length;
  const children = data.sources.filter((x) => x.parentSourceId === s.id).sort((a, b) => String(b.when ?? b.createdAt).localeCompare(String(a.when ?? a.createdAt)));
  async function today() {
    try { const r = await post<{ source: Source }>("linkedin/today", {}); await onReload(); onAddPeople(r.source.id); } catch (e) { say({ text: String((e as Error).message) }); }
  }
  async function sortDays() {
    try { const r = await post<{ moved: number; days: number }>("linkedin/sort", {}); await onReload(); say({ text: `Sorted ${r.moved} ${r.moved === 1 ? "person" : "people"} into ${r.days} day ${r.days === 1 ? "card" : "cards"}.` }); }
    catch (e) { say({ text: String((e as Error).message) }); }
  }
  // Who or what else also brought it to you, with names for the trail and the Details list.
  const also = (s.alsoVia ?? []).map((v) => { const p = data.people.find((x) => x.id === v.id), o = data.sources.find((x) => x.id === v.id); return p || o ? { ...v, name: (p ?? o)!.name, person: Boolean(p) } : null; }).filter((v): v is { id: string; year: string; name: string; person: boolean } => Boolean(v));
  const [adding, setAdding] = useState({ id: "", year: "" });
  const askWho = asker || members[0]?.id || "";
  const openJobs = jobs?.id === s.id ? jobs.list.filter((j) => j.status === "new" || j.status === "ready") : null;
  return (
    <aside className="nw-panel pp" aria-label={s.name}>
      <header className="pp-head">
        <Picture square photo={s.photoId} label={organisationInitials(s.name)} color={color} onFile={(f) => { setSaving("Uploading…"); uploadPhoto(f).then((id) => save({ photoId: id })).catch((e: Error) => { setSaving(""); say({ text: e.message }); }); }} />
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
        {(parent || introducer) && <span className="pp-hop"><i aria-hidden="true">›</i>{introducer ? <button type="button" className="pp-step" style={{ "--c": colors.person.get(introducer.id) } as CSSProperties} onClick={() => onPerson(introducer.id)}>{introducer.name}{s.introYear && <small> {s.introYear}</small>}</button> : <span className="pp-step" style={{ "--c": colors.source.get(parent!.id) } as CSSProperties}>{parent!.name}{s.introYear && <small> {s.introYear}</small>}</span>}</span>}
        <span className="pp-hop"><i aria-hidden="true">›</i><span className="pp-step me" style={{ "--c": color } as CSSProperties}>{s.name}</span></span>
        {s.context && <span className="pp-ctx">{s.context}</span>}
        {also.length > 0 && <span className="pp-also">also {also.map((v, i) => <span key={v.id}>{i > 0 && ", "}{v.person
          ? <button type="button" className="pp-step" style={{ "--c": colors.person.get(v.id) } as CSSProperties} onClick={() => onPerson(v.id)}>{v.name}{v.year && <small> {v.year}</small>}</button>
          : <span className="pp-step" style={{ "--c": colors.source.get(v.id) } as CSSProperties}>{v.name}{v.year && <small> {v.year}</small>}</span>}</span>)}</span>}
      </nav>
      <div className="pp-actions">
        {linkedin
          ? <button type="button" className="nw-btn main" onClick={() => void today()}>Add today's reach-outs</button>
          : <button type="button" className="nw-btn main" onClick={() => onAddPeople()}>Add people</button>}
        {linkedin && sortable > 0 && <button type="button" className="pp-pill" onClick={() => void sortDays()}>Sort {sortable} into day cards</button>}
        {s.photoId && <button type="button" className="pp-pill" onClick={() => void save({ photoId: null })}>Remove picture</button>}
      </div>
      <div className="pp-tabs" role="tablist" aria-label={`About ${s.name}`}>
        {([["people", `People`], ...(hiring ? [["jobs", "Jobs"]] : []), ["links", "Connected"], ["intro", "Introduced"], ["notes", "Notes"], ["details", "Details"]] as [typeof tab, string][]).map(([t, l]) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{l}{t === "people" && <small>{members.length}</small>}{t === "links" && links.length > 0 && <small>{links.length}</small>}</button>)}
      </div>
      <div key={tab} className="pp-body" role="tabpanel">
        {tab === "people" && <>
          {/* Sources under this one (LinkedIn's days, a conference's companies), newest first, each with how many people it holds. */}
          {children.length > 0 && <div className="pp-days" aria-label="Under it">{children.map((c) => (
            <button key={c.id} type="button" className="pp-day" style={{ "--c": colors.source.get(c.id) } as CSSProperties} onClick={() => onSource(c.id)}>
              <span>{c.name}</span><small>{peopleForSource(c, data).length}</small></button>))}</div>}
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
        {tab === "links" && <section className="pp-sec">
          <div className="pp-sec-h"><span className="pp-h">Connected to</span><button type="button" className="pp-link pp-popbtn" onClick={() => setLink(link ? null : { to: "", kind: "other", label: "" })}>+ Connect</button></div>
          {link ? <div className="pp-pop inline" role="group" aria-label="Connect">
            <select id="nw-srclink-to" aria-label="Connect to" value={link.to} onChange={(e) => setLink({ ...link, to: e.target.value })}><option value="">Who or what…</option>
              <optgroup label="Sources">{data.sources.filter((x) => x.id !== s.id).map((x) => <option key={x.id} value={x.id}>{sourceLabel(x, data.sources, data.people)}</option>)}</optgroup>
              <optgroup label="People">{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup></select>
            <select id="nw-srclink-kind" aria-label="Kind of connection" value={link.kind} onChange={(e) => setLink({ ...link, kind: e.target.value as LinkKind })}>{LINK_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <input id="nw-srclink-label" aria-label="What is it" placeholder="Met their recruiters there…" value={link.label} onChange={(e) => setLink({ ...link, label: e.target.value })} />
            <button type="button" className="nw-btn" disabled={!link.to} onClick={() => void connect()}>Connect</button>
          </div> : <div className="pp-chips">
            {links.map(({ l, id, name, isPerson, c }) => (
              <span key={l.id} className="pp-chip" style={{ "--c": c } as CSSProperties}>
                {isPerson ? <button type="button" onClick={() => onPerson(id)}>{name}</button> : <span>{name}</span>}<small>{l.label || LINK_KINDS.find(([k]) => k === l.kind)?.[1]}</small>
                <button type="button" className="x" aria-label={`Remove the connection to ${name}`} onClick={() => void disconnect(l.id)}>×</button></span>
            ))}
            {!links.length && <span className="nw-muted">Not linked to anything else yet. Connect it to the event where you met them, or to a person.</span>}
          </div>}
        </section>}
        {tab === "notes" && <label className="pp-notes"><span className="pp-h">Notes</span><textarea id="nw-src-notes" value={d.notes} placeholder="Who hires there, how they like to be approached, what you learned." onChange={(e) => setD({ ...d, notes: e.target.value })} onBlur={() => { if (d.notes !== (s.notes ?? "")) void save({ notes: d.notes }); }} /></label>}
        {tab === "details" && <>
          <div className="nw-pair">
            <label className="nw-f"><span>Where</span><input id="nw-src-place" placeholder="Raleigh, NC or Global" value={d.place} onChange={(e) => setD({ ...d, place: e.target.value })} onBlur={() => { if (d.place !== (s.place ?? "")) void save({ place: d.place }); }} /></label>
            {s.type === "event" && <label className="nw-f"><span>When</span><input id="nw-src-when" placeholder="Oct 2024" value={d.when} onChange={(e) => setD({ ...d, when: e.target.value })} onBlur={() => { if (d.when !== (s.when ?? "")) void save({ when: d.when }); }} /></label>}
          </div>
          <label className="nw-f"><span>Kind</span><select id="nw-src-kind" value={s.type} onChange={(e) => void save({ type: e.target.value as SourceType })}>{SOURCE_TYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}</select></label>
          <p className="pp-hint">{sourceLabel(s, data.sources, data.people)}</p>
        </>}
        {tab === "intro" && <>
          {/* The context saves when you leave its field. */}
          <div className="pp-intro" onBlur={(e) => { if ((e.target as HTMLElement).id === "nw-srcp-context" && d.context !== (s.context ?? "")) void save({ context: d.context }); }}>
            <NetworkSourceContext sources={data.sources} people={data.people} parentSourceId={through} onParent={(v) => { setThrough(v); void save(throughFields(v)); }} context={d.context} onContext={(v) => setD({ ...d, context: v })} excludeId={s.id} prefix="nw-srcp" />
          </div>
          {through && <label className="pp-year"><span>Year it reached you that way</span><input id="nw-src-year" inputMode="numeric" maxLength={4} placeholder="2024" value={d.introYear} onChange={(e) => setD({ ...d, introYear: e.target.value.replace(/\D/g, "") })} onBlur={() => { if (d.introYear !== (s.introYear ?? "")) void save({ introYear: d.introYear }); }} /></label>}
          <div className="pp-sec-h"><span className="pp-h">Also introduced by</span></div>
          <div className="pp-chips">{also.map((v) => <span key={v.id} className="pp-chip" style={{ "--c": v.person ? colors.person.get(v.id) : colors.source.get(v.id) } as CSSProperties}><span>{v.name}</span>{v.year && <small>{v.year}</small>}
            <button type="button" className="x" aria-label={`${v.name} did not introduce it`} onClick={() => void save({ alsoVia: (s.alsoVia ?? []).filter((x) => x.id !== v.id) })}>×</button></span>)}
            {!also.length && <span className="nw-muted">Nobody else. Met them again another way? Add it here with the year.</span>}</div>
          <div className="pp-also-add">
            <select id="nw-src-also" aria-label="Also introduced by" value={adding.id} onChange={(e) => setAdding({ ...adding, id: e.target.value })}><option value="">Who or what…</option>
              <optgroup label="People">{data.people.filter((p) => p.id !== s.viaPersonId && !also.some((v) => v.id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
              <optgroup label="Sources">{data.sources.filter((x) => x.id !== s.id && x.id !== s.parentSourceId && !also.some((v) => v.id === x.id)).map((x) => <option key={x.id} value={x.id}>{sourceLabel(x, data.sources, data.people)}</option>)}</optgroup></select>
            <input id="nw-src-also-year" aria-label="Year" inputMode="numeric" maxLength={4} placeholder="Year" value={adding.year} onChange={(e) => setAdding({ ...adding, year: e.target.value.replace(/\D/g, "") })} />
            <button type="button" className="nw-btn" disabled={!adding.id} onClick={() => { void save({ alsoVia: [...(s.alsoVia ?? []), adding] }); setAdding({ id: "", year: "" }); }}>Add</button>
          </div>
        </>}
      </div>
    </aside>
  );
}

/**
 * A company nobody added, worked out from where your people work: who is there, its open jobs and who to ask, and "Keep as a source"
 * to make it a card of your own (logo, place, notes, links).
 */
export function AutoCompanyPanel({ company: s, position, positions, data, colors, onClose, onPerson, onReferral, onKeep, say }: {
  company: Source; position: { x: number; y: number } | null; positions: { id: string; x: number; y: number }[]; data: NetworkData; colors: ReturnType<typeof colorsFor>; onClose: () => void; onPerson: (id: string) => void;
  onReferral: (personId: string, job: JobRow) => void; onKeep: (s: Source) => void; say: Say;
}) {
  const members = data.people.filter((p) => s.auto?.includes(p.id));
  const [asker, setAsker] = useState("");
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const first = members[0]?.id ?? "";
  useEffect(() => { if (!first) return; let on = true; loadPersonJobs(first).then((r) => on && setJobs(r.jobs)).catch(() => on && setJobs([])); return () => { on = false; }; }, [first]);
  async function keep() {
    setBusy(true);
    try { const r = await post<{ source: Source }>("source", { name: s.name, type: "company", position, positions }); say({ text: `${s.name} saved near its people.` }); onKeep(r.source); }
    catch (e) { setBusy(false); say({ text: String((e as Error).message) }); }
  }
  const askWho = asker || first, open = (jobs ?? []).filter((j) => j.status === "new" || j.status === "ready");
  return (
    <aside className="nw-panel pp" aria-label={s.name}>
      <header className="pp-head">
        <span className="pp-pic sq" style={{ "--c": "var(--nw-muted)" } as CSSProperties}><span>{s.name[0]?.toUpperCase() ?? "?"}</span></span>
        <div className="pp-id">
          <h2 className="nw-name">{s.name}</h2>
          <p className="pp-where">Suggested company · {members.length} people in your network</p>
        </div>
        <button type="button" className="nw-x" aria-label="Close" onClick={onClose}>×</button>
      </header>
      <section className="pp-source-confirm" aria-label="Confirm source">
        <span className="pp-source-eyebrow">From your network</span>
        <h3>Keep {s.name} on your map?</h3>
        <p>Save this company as a source. Its card stays near {members.length === 1 ? members[0].name : "the people who work here"}, with their connections intact.</p>
        <div className="pp-source-faces" aria-label="Connected people">{members.slice(0, 3).map((p) => <span key={p.id}><i style={{ "--c": colors.person.get(p.id) } as CSSProperties}>{initials(p.name)}</i>{p.name}</span>)}{members.length > 3 && <span>+{members.length - 3} more</span>}</div>
        <div className="pp-source-buttons"><button type="button" className="nw-btn main" disabled={busy} onClick={() => void keep()}>{busy ? "Saving source…" : "Confirm source"}</button><button type="button" className="nw-btn ghost" disabled={busy} onClick={onClose}>Not now</button></div>
      </section>
      <div className="pp-body">
        <span className="pp-h">People there</span>
        <ul className="pp-people">{members.map((p) => (
          <li key={p.id}><button type="button" onClick={() => onPerson(p.id)}>
            <span className={`nw-av${p.photoId ? " ph" : ""}`} style={{ "--c": colors.person.get(p.id) } as CSSProperties} aria-hidden="true">{p.photoId ? <img src={imageUrl(p.photoId)} alt="" /> : initials(p.name)}</span>
            <span className="who"><b>{p.name}</b><small>{[p.role, p.sourceId ? `met through ${data.sources.find((x) => x.id === p.sourceId)?.name ?? "a source"}` : ""].filter(Boolean).join(" · ") || " "}</small></span>
            <span className="when">{ago(p.lastContact)}</span>
          </button></li>))}</ul>
        <span className="pp-h">Open jobs</span>
        {jobs === null ? <p className="nw-muted">Looking for jobs at {s.name}…</p> : <>
          {open.length > 0 && <label className="pp-ask">Ask <select value={askWho} onChange={(e) => setAsker(e.target.value)}>{members.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select> for a referral</label>}
          {open.length ? <ul className="nwj-list">{open.slice(0, 4).map((j) => (
            <li key={j.url} className={`nwj-job is-${j.status}`}><div className="nwj-what"><a href={j.applyUrl} target="_blank" rel="noreferrer">{j.title}</a><small>{[j.location, j.foundAt ? `found ${ago(j.foundAt)}` : ""].filter(Boolean).join(" · ")}</small></div>
              <span className={`nwj-st is-${j.status}`}>{JOB_STATUS[j.status]}</span><button type="button" className="nw-chip nwj-ask" onClick={() => onReferral(askWho, j)}>Ask</button></li>))}</ul>
            : <p className="nw-muted">No open jobs at {s.name} on your job board right now.</p>}
        </>}
      </div>
    </aside>
  );
}
