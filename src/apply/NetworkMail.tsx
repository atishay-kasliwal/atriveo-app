import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import { initials, loadDraft, loadMailSettings, post, starter, type JobRow, type MailSettings, type Person } from "./network";

type Saved = { to: string; subject: string; body: string; intent: string; tone: string };
const KEY = (id: string) => `nw-draft-${id}`;
const readSaved = (id: string): Saved | null => { try { const v = localStorage.getItem(KEY(id)); return v ? (JSON.parse(v) as Saved) : null; } catch { return null; } };
const FOLLOW: [string, string][] = [["3d", "3 days"], ["1w", "1 week"], ["2w", "2 weeks"]];

/**
 * A full mail window for one person: subject, message, an optional resume, and "remind me to follow up". Draft with AI writes from their
 * record and your notes; nothing is sent until you press Send. An unsent draft is kept in this browser until you send or discard it.
 */
export default function NetworkMail({ person, job, color, onClose, onSent, say }: { person: Person; job?: JobRow; color: string; onClose: () => void; onSent: (p: Person) => void; say: (t: { text: string } | null) => void }) {
  const draftKey = job ? `${person.id}:${job.url}` : person.id;
  const saved = useRef(readSaved(draftKey)).current;
  const [settings, setSettings] = useState<MailSettings | null>(null);
  const [loadError, setLoadError] = useState("");
  const [to, setTo] = useState(saved?.to ?? person.email);
  const [editTo, setEditTo] = useState(!person.email);
  const [subject, setSubject] = useState(saved?.subject ?? (job ? `Referral for ${job.title} at ${job.company}?` : ""));
  const [body, setBody] = useState(saved?.body ?? "");
  const [intent, setIntent] = useState(saved?.intent ?? (job ? `ask whether they would refer me for the ${job.title} role` : ""));
  const [tone, setTone] = useState(saved?.tone ?? "friendly");
  const [attach, setAttach] = useState<string>(job?.resumeReady ? "job" : "");
  const [upload, setUpload] = useState<{ name: string; base64: string } | null>(null);
  const [follow, setFollow] = useState(true);
  const [followIn, setFollowIn] = useState("1w");
  const [writing, setWriting] = useState(false);
  const [aiError, setAiError] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [showSender, setShowSender] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    loadMailSettings().then((s) => { if (!alive.current) return; setSettings(s); if (s.resumes.length) setAttach((a) => a || s.resumes[0].track); }).catch((e) => alive.current && setLoadError(String(e.message || e)));
    return () => { alive.current = false; };
  }, []);
  useEffect(() => { try { localStorage.setItem(KEY(draftKey), JSON.stringify({ to, subject, body, intent, tone })); } catch { /* not kept; the window still works */ } }, [draftKey, to, subject, body, intent, tone]);
  useEffect(() => { (editTo ? document.getElementById("nwm-to") : bodyRef.current)?.focus(); }, [editTo]);

  const validTo = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to.trim());
  const canSend = Boolean(settings?.connected && validTo && subject.trim() && body.trim() && !sending && !writing);
  const dirty = Boolean(body.trim() || subject.trim());
  const close = () => { if (dirty && !confirm) { setConfirm(true); return; } onClose(); };
  const discard = () => { try { localStorage.removeItem(KEY(draftKey)); } catch { /* nothing kept */ } onClose(); };

  async function draft() {
    setAiError(""); setWriting(true);
    try {
      const { id } = await post<{ id: string }>("mail/draft", { personId: person.id, tone, intent, ...(job ? { job: { title: job.title, company: job.company, location: job.location, url: job.applyUrl } } : {}) });
      for (const started = Date.now(); Date.now() - started < 240_000;) {
        await new Promise((r) => setTimeout(r, 1500));
        if (!alive.current) return;
        const d = await loadDraft(id);
        if (d.status === "done") { setSubject(d.subject); setBody(d.body); return; }
        if (d.status === "failed") throw new Error(d.error || "The draft could not be written");
      }
      throw new Error("The AI worker took too long. Try again, or start from a plain draft.");
    } catch (e) { if (alive.current) setAiError(String((e as Error).message)); }
    finally { if (alive.current) setWriting(false); }
  }
  function useStarter() { const s = starter(person, tone, intent, settings?.signature ?? ""); setSubject(subject || s.subject); setBody(s.body); setAiError(""); }
  function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) { setError("Only PDF files can be attached."); return; }
    if (f.size > 5_000_000) { setError("Attach a PDF under 5 MB."); return; }
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); setUpload({ name: f.name, base64: s.slice(s.indexOf(",") + 1) }); setAttach("upload"); setError(""); };
    r.readAsDataURL(f);
  }
  async function send() {
    if (!canSend) return;
    setSending(true); setError("");
    try {
      const r = await post<{ state: "sent" | "uncertain"; person: Person; warning?: string }>("mail/send", {
        personId: person.id, to: to.trim(), subject, body, followUp: follow ? followIn : null,
        ...(attach === "upload" && upload ? { upload } : attach === "job" && job ? { jobResume: job.url } : attach && attach !== "upload" ? { resume: attach } : {}),
        ...(job ? { referral: { title: job.title, company: job.company, url: job.applyUrl } } : {}),
      });
      try { localStorage.removeItem(KEY(draftKey)); } catch { /* nothing kept */ }
      onSent(r.person);
      say({ text: r.state === "sent" ? `Sent to ${person.name}.${follow ? ` Follow-up set for ${FOLLOW.find(([k]) => k === followIn)?.[1]} from now.` : ""}` : `Gmail did not confirm it. Check your Sent folder before sending again.` });
      onClose();
    } catch (e) { setError(String((e as Error).message)); setSending(false); }
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); if (showSender) setShowSender(false); else close(); }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void send(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  return (
    <div className="nw-dim nwm-dim" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="nwm" role="dialog" aria-modal="true" aria-label={`Email ${person.name}`}>
        <div className="nwm-h"><b>New message</b><span>{writing ? "Writing a draft…" : dirty ? "Draft kept in this browser" : ""}</span><button type="button" className="nw-x" aria-label="Close" onClick={close}>×</button></div>
        {confirm && <div className="nwm-confirm" role="alert">Discard this draft? <button type="button" className="nw-btn danger" onClick={discard}>Discard</button><button type="button" className="nw-btn" onClick={() => setConfirm(false)}>Keep writing</button><button type="button" className="nw-btn ghost" onClick={onClose}>Close, keep the draft</button></div>}
        {settings && !settings.connected && <p className="nwm-warn">Gmail is not connected yet, so this cannot be sent. Connect it once in <a href="/outreach">Outreach</a> (Mailbox and settings). Your draft stays here meanwhile.</p>}
        {loadError && <p className="nwm-warn">{loadError}</p>}
        <div className="nwm-row"><label htmlFor="nwm-to">To</label>
          {editTo ? <input id="nwm-to" type="email" value={to} placeholder={`${person.name.split(" ")[0]}'s email`} onChange={(e) => setTo(e.target.value)} onBlur={() => { if (validTo) setEditTo(false); }} />
            : <button type="button" className="nwm-chip" style={{ "--c": color } as CSSProperties} onClick={() => setEditTo(true)} title="Change the address"><i>{initials(person.name)}</i><span>{person.name} &lt;{to}&gt;</span></button>}
        </div>
        {job && <div className="nwm-job"><span>Referral for</span><a href={job.applyUrl} target="_blank" rel="noreferrer">{job.title}</a><small>{job.company}{job.location ? ` · ${job.location}` : ""}</small></div>}
        <div className="nwm-row"><label htmlFor="nwm-subject">Subject</label><input id="nwm-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What it's about" /></div>
        <div className="nwm-ai">
          <input id="nwm-intent" aria-label="What is this email for" value={intent} onChange={(e) => setIntent(e.target.value)} placeholder="What is it for? Ask for a referral, thank them, catch up…" />
          <select id="nwm-tone" aria-label="Tone" value={tone} onChange={(e) => setTone(e.target.value)}><option value="friendly">Friendly</option><option value="short">Short</option><option value="formal">Formal</option></select>
          <button type="button" className="nw-btn" disabled={writing} onClick={() => void draft()}>{writing ? "Writing…" : "Draft with AI"}</button>
        </div>
        {aiError && <p className="nwm-aierr" role="alert">{aiError} <button type="button" onClick={useStarter}>Start from a plain draft</button></p>}
        <textarea ref={bodyRef} id="nwm-body" aria-label="Message" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your message, or let AI draft it from their record." />
        <div className="nwm-att">
          <label htmlFor="nwm-attach">Attach</label>
          <select id="nwm-attach" value={attach} onChange={(e) => { if (e.target.value === "pick") file.current?.click(); else setAttach(e.target.value); }}>
            <option value="">Nothing</option>
            {job?.resumeReady && <option value="job">The resume built for this job</option>}
            {settings?.resumes.map((r) => <option key={r.track} value={r.track}>General resume: {r.label}</option>)}
            {upload && <option value="upload">{upload.name}</option>}
            <option value="pick">Upload a PDF…</option>
          </select>
          <input ref={file} type="file" accept="application/pdf,.pdf" hidden onChange={pick} />
          {settings && !settings.resumes.length && <small>No general resume is on the server; upload one if you want to attach it.</small>}
        </div>
        {error && <p className="nw-error nwm-err" role="alert">{error}</p>}
        <div className="nwm-f">
          <button type="button" className="nw-btn main" disabled={!canSend} onClick={() => void send()}>{sending ? "Sending…" : "Send"}</button>
          <label className="nwm-fu"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /><span>Remind me to follow up in</span></label>
          <select id="nwm-follow" aria-label="Follow-up time" value={followIn} disabled={!follow} onChange={(e) => setFollowIn(e.target.value)}>{FOLLOW.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <span className="grow" />
          {settings && <button type="button" className="nwm-from" onClick={() => setShowSender(true)} title="Sender settings">From {settings.fromName || settings.fromEmail || "you"}</button>}
          <button type="button" className="nwm-bin" aria-label="Discard draft" title="Discard" onClick={() => (dirty ? setConfirm(true) : discard())}><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13M10 11v6M14 11v6" /></svg></button>
        </div>
        {showSender && settings && <SenderSettings settings={settings} onClose={() => setShowSender(false)} onSaved={(s) => { setSettings(s); setShowSender(false); }} />}
      </div>
    </div>
  );
}

function SenderSettings({ settings, onClose, onSaved }: { settings: MailSettings; onClose: () => void; onSaved: (s: MailSettings) => void }) {
  const [v, setV] = useState({ fromName: settings.fromName, fromEmail: settings.fromEmail, about: settings.about, signature: settings.signature });
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function save() { setBusy(true); setError(""); try { await post("mail/settings", v); onSaved({ ...settings, ...v }); } catch (e) { setError(String((e as Error).message)); setBusy(false); } }
  return (
    <div className="nwm-sender" role="dialog" aria-label="Sender settings">
      <div className="nwm-h"><b>Sender</b><span>Used for every email from Network</span><button type="button" className="nw-x" aria-label="Close" onClick={onClose}>×</button></div>
      <div className="nw-form">
        <div className="nw-pair">
          <label className="nw-f"><span>Your name</span><input id="nwm-from-name" value={v.fromName} onChange={(e) => setV({ ...v, fromName: e.target.value })} /></label>
          <label className="nw-f"><span>Send from</span><input id="nwm-from-email" type="email" value={v.fromEmail} onChange={(e) => setV({ ...v, fromEmail: e.target.value })} /></label>
        </div>
        <p className="nw-muted">Gmail sends from the account you connected in Outreach. Use that address here.</p>
        <label className="nw-f"><span>About you, for AI drafts</span><textarea id="nwm-about" className="nw-notes" value={v.about} onChange={(e) => setV({ ...v, about: e.target.value })} placeholder="Two or three lines: what you do, what you're looking for, when you can start." /></label>
        <label className="nw-f"><span>Signature</span><textarea id="nwm-signature" className="nw-notes" style={{ minHeight: 56 }} value={v.signature} onChange={(e) => setV({ ...v, signature: e.target.value })} /></label>
      </div>
      {error && <p className="nw-error" role="alert">{error}</p>}
      <div className="nw-df"><button type="button" className="nw-btn" onClick={onClose}>Cancel</button><button type="button" className="nw-btn main" disabled={busy} onClick={() => void save()}>Save sender</button></div>
    </div>
  );
}

/**
 * One note for several people: write it once with {first} where their first name goes, then send it to each person with their own
 * Send button (nothing goes out in one click). Each send is logged in that person's history like any other email.
 */
export function BulkMail({ people, onClose, onSent, say }: { people: Person[]; onClose: () => void; onSent: (p: Person) => void; say: (t: { text: string } | null) => void }) {
  const [settings, setSettings] = useState<MailSettings | null>(null);
  const [subject, setSubject] = useState("Quick hello");
  const [body, setBody] = useState("Hi {first},\n\n\n\nThanks,\n");
  const [attach, setAttach] = useState("");
  const [followIn, setFollowIn] = useState("1w");
  const [state, setState] = useState<Record<string, "sending" | "sent" | string>>({});
  useEffect(() => { let on = true; loadMailSettings().then((s) => { if (!on) return; setSettings(s); setBody((b) => (b.endsWith("Thanks,\n") ? b + (s.signature || s.fromName) : b)); }).catch((e) => say({ text: String(e.message || e) })); return () => { on = false; }; }, [say]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const fill = (p: Person) => body.replace(/\{first\}/g, p.name.split(/\s+/)[0] || p.name).replace(/\{name\}/g, p.name);
  async function send(p: Person) {
    setState((s) => ({ ...s, [p.id]: "sending" }));
    try {
      const r = await post<{ state: string; person: Person }>("mail/send", { personId: p.id, to: p.email, subject: subject.replace(/\{first\}/g, p.name.split(/\s+/)[0]), body: fill(p), followUp: followIn || null, ...(attach ? { resume: attach } : {}) });
      onSent(r.person); setState((s) => ({ ...s, [p.id]: r.state === "sent" ? "sent" : "Gmail did not confirm it; check Sent" }));
    } catch (e) { setState((s) => ({ ...s, [p.id]: String((e as Error).message) })); }
  }
  const ready = Boolean(settings?.connected && subject.trim() && body.trim());
  const sent = Object.values(state).filter((v) => v === "sent").length;
  return (
    <div className="nw-dim nwm-dim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="nwm nwm-bulk" role="dialog" aria-modal="true" aria-label={`One note for ${people.length} people`}>
        <div className="nwm-h"><b>One note for {people.length} {people.length === 1 ? "person" : "people"}</b><span>{sent ? `${sent} sent` : "Each one sends on its own button"}</span><button type="button" className="nw-x" aria-label="Close" onClick={onClose}>×</button></div>
        {settings && !settings.connected && <p className="nwm-warn">Gmail is not connected yet. Connect it once in <a href="/outreach">Outreach</a> (Mailbox and settings).</p>}
        <div className="nwm-bulk-cols">
          <div className="nwm-bulk-l">
            <div className="nwm-row"><label htmlFor="nwmb-subject">Subject</label><input id="nwmb-subject" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
            <textarea id="nwmb-body" aria-label="Message; {first} becomes their first name" value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="nwm-att"><span>{"{first}"} becomes each first name.</span>
              <label htmlFor="nwmb-attach">Attach</label><select id="nwmb-attach" value={attach} onChange={(e) => setAttach(e.target.value)}><option value="">Nothing</option>{settings?.resumes.map((r) => <option key={r.track} value={r.track}>General resume: {r.label}</option>)}</select>
              <label htmlFor="nwmb-follow">Follow up</label><select id="nwmb-follow" value={followIn} onChange={(e) => setFollowIn(e.target.value)}><option value="">Not set</option>{FOLLOW.map(([k, l]) => <option key={k} value={k}>in {l}</option>)}</select>
            </div>
          </div>
          <ul className="nwm-bulk-r" aria-label="Recipients">
            {people.map((p) => { const st = state[p.id]; return (
              <li key={p.id} className={st === "sent" ? "done" : ""}>
                <div><b>{p.name}</b><small>{p.email || "No email yet. Add one in their panel."}</small><em>{fill(p).split("\n")[0]}</em>{st && st !== "sent" && st !== "sending" && <span className="nw-error">{st}</span>}</div>
                <button type="button" className="nw-btn" disabled={!ready || !p.email || st === "sending" || st === "sent"} onClick={() => void send(p)}>{st === "sent" ? "Sent" : st === "sending" ? "Sending…" : "Send"}</button>
              </li>); })}
          </ul>
        </div>
      </div>
    </div>
  );
}
