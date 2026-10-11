import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getTailorServerBase } from '../utils/tailorServer';
import { outreachApi, outreachLabel, type OutreachDetail, type OutreachDraft, type OutreachTarget } from './outreach';
import './outreach.css';

export default function OutreachPanel({ target, onClose, onChanged }: { target: OutreachTarget; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<OutreachDetail | null>(null);
  const [draft, setDraft] = useState<OutreachDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [schedule, setSchedule] = useState('');
  const [closing, setClosing] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const accept = (result: OutreachDetail) => { setDetail(result); setDraft(result.draft); setDirty(false); onChanged(); };
  const key = JSON.stringify(target);
  useEffect(() => {
    let live = true;
    const input = JSON.parse(key) as OutreachTarget;
    const request = input.id ? outreachApi<OutreachDetail>(`detail?id=${encodeURIComponent(input.id)}`) : outreachApi<OutreachDetail>('create', input);
    request.then(result => { if (live) { setDetail(result); setDraft(result.draft); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [key]);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; prior?.focus(); };
  }, []);
  useEffect(() => {
    if (!draft || dirty || busy) return;
    let active = true;
    const timer = setInterval(() => {
      void outreachApi<OutreachDetail>(`detail?id=${encodeURIComponent(draft.id)}`).then(r => { if (active) { setDetail(r); setDraft(r.draft); } }).catch(() => {});
    }, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [draft?.id, dirty, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = (patch: Partial<OutreachDraft>) => { setDraft(d => d ? { ...d, ...patch } : d); setDirty(true); setNotice(''); };
  const contact = (field: string, value: string) => { if (draft) edit({ contact: { ...draft.contact, [field]: value }, identityConfirmed: false }); };
  async function save() {
    if (!draft) throw new Error('Draft not loaded');
    if (!dirty) return draft;
    const result = await outreachApi<OutreachDetail>('draft', draft, 'PUT'); accept(result); return result.draft;
  }
  async function run(action: string, extra: object = {}) {
    setBusy(action); setError(''); setNotice('');
    try {
      const current = await save();
      const result = await outreachApi<OutreachDetail>('action', { id: current.id, revision: current.revision, action, ...extra });
      accept(result); setNotice(action === 'approve' ? 'Queued. You can cancel before delivery.' : 'Updated.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  }
  const close = () => { if (dirty) setClosing(true); else onClose(); };
  const readOnly = !!draft && ['sent', 'sending', 'uncertain', 'blocked'].includes(draft.status);
  const field = (label: string, value: string, update: (value: string) => void, type = 'text') => <label className="outreach-field"><span>{label}</span><input type={type} value={value} onChange={e => update(e.target.value)} /></label>;
  return <div className="outreach-overlay" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
    <section ref={panel} tabIndex={-1} className="outreach-panel" role="dialog" aria-modal="true" aria-labelledby="outreach-title" onKeyDown={e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Tab') {
        const elements = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]');
        if (elements?.length) { const first = elements[0], last = elements[elements.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
      }
    }}>
      <header className="outreach-panel-head"><div><span className="outreach-eyebrow">JOB OUTREACH</span><h2 id="outreach-title">{draft?.company || 'Prepare outreach'}</h2><p>{draft?.title || 'Loading job details…'}</p></div><button className="apps-btn" onClick={close} aria-label="Close outreach">×</button></header>
      <div className="outreach-panel-body">
        {error && <div className="outreach-error" role="alert">{error}<button className="apps-link" onClick={() => { if (draft) void outreachApi<OutreachDetail>(`detail?id=${draft.id}`).then(accept).catch(e => setError(e.message)); }}>Reload saved draft</button></div>}
        {notice && <p className="outreach-notice" role="status">{notice}</p>}
        {closing && <div className="outreach-warning"><p>You have unsaved changes.</p><button className="apps-btn" onClick={() => setClosing(false)}>Keep editing</button> <button className="apps-btn" onClick={onClose}>Discard edits and close</button></div>}
        {draft && <>
          <div className="outreach-status-row"><span className={`outreach-badge is-${draft.status}`}>{outreachLabel(draft.status)}</span><Link to="/outreach" onClick={e => { if (dirty) { e.preventDefault(); setClosing(true); } else onClose(); }}>All outreach & settings</Link></div>
          <p className="outreach-muted">{draft.appliedAt ? `Applied ${new Date(draft.appliedAt).toLocaleDateString()}` : 'Contact research is available now. Mark this job applied before sending.'}</p>
          {draft.scheduledAt && draft.status === 'queued' && <p className="outreach-notice">Scheduled for {new Date(draft.scheduledAt).toLocaleString()}. Cancel the send before editing.</p>}
          {draft.error && <p className="outreach-warning">{draft.error}</p>}
          <fieldset disabled={!!busy || readOnly || draft.status === 'queued'}>
            <h3>Company & contact</h3>
            <div className="outreach-two">{field('Company', draft.company, company => edit({ company, websiteConfirmed: false }))}{field('Job title', draft.title, title => edit({ title }))}</div>
            {field('Official company website', draft.website, website => edit({ website, websiteConfirmed: false }), 'url')}
            <label className="outreach-check"><input type="checkbox" checked={draft.websiteConfirmed} onChange={e => edit({ websiteConfirmed: e.target.checked })} />I checked that this is the correct company website.</label>
            <div className="outreach-actions"><button className="apps-btn" onClick={() => void run('posting')}>Read posting contacts</button><button className="apps-btn" disabled={!draft.websiteConfirmed || !draft.website} onClick={() => void run('discover')}>{busy === 'discover' ? 'Checking public pages…' : 'Find public emails'}</button><a target="_blank" rel="noreferrer" href={`https://www.google.com/search?q=${encodeURIComponent(`"${draft.company}" recruiter talent acquisition ${draft.title}`)}`}>Search for recruiters ↗</a></div>
            {(detail?.contacts.length || 0) > 0 && <label className="outreach-field"><span>Saved company contacts</span><select value="" onChange={e => { const c = detail?.contacts.find(c => c.email === e.target.value); if (c) edit({ contact: { ...c }, identityConfirmed: false }); }}><option value="">Choose a contact…</option>{detail?.contacts.map(c => <option key={c.email} value={c.email}>{c.email} · {c.type}</option>)}</select></label>}
            {draft.discovery && <div className="outreach-evidence"><p>{draft.discovery.contacts.length} public contact{draft.discovery.contacts.length === 1 ? '' : 's'} found across {draft.discovery.pages.length} pages.</p>{draft.discovery.portalOnly && <p className="outreach-warning">This website directs applications through its portal. Email sending is held.</p>}
              {draft.discovery.contacts.map(c => <div className="outreach-contact-result" key={c.email}><button className="apps-link" onClick={() => edit({ contact: { ...c }, identityConfirmed: false })}>{c.email}</button><span>{c.publishedHiring ? 'Published hiring inbox' : 'Review contact'}</span><a href={c.sourceUrl} target="_blank" rel="noreferrer">Source ↗</a><small>{c.evidence}</small></div>)}
              {!!draft.discovery.errors.length && <details><summary>Some pages could not be checked</summary>{draft.discovery.errors.map(e => <p key={e}>{e}</p>)}</details>}
            </div>}
            <div className="outreach-two">{field('First name', draft.contact.firstName, v => contact('firstName', v))}{field('Last name', draft.contact.lastName, v => contact('lastName', v))}</div>
            {field('Recruiter title / team', draft.contact.title, v => contact('title', v))}
            <div className="outreach-two">{field('Recipient email', draft.contact.email, v => contact('email', v), 'email')}<label className="outreach-field"><span>Contact type</span><select value={draft.contact.type} onChange={e => contact('type', e.target.value)}><option value="blocked">Excluded contact</option><option value="hiring">Hiring inbox</option><option value="general">General inbox</option><option value="recruiter">Named recruiter</option></select></label></div>
            {field('Profile link', draft.contact.profileUrl, v => contact('profileUrl', v), 'url')}
            {field('Source link', draft.contact.sourceUrl, v => contact('sourceUrl', v), 'url')}
            {field('Notes', draft.contact.notes || '', v => contact('notes', v))}
            {draft.contact.type === 'recruiter' && <label className="outreach-check"><input type="checkbox" checked={draft.identityConfirmed} onChange={e => edit({ identityConfirmed: e.target.checked })} />I checked this person’s company and recruiting role.</label>}
            <h3>Message</h3><button className="apps-link" onClick={() => void run('template')}>Replace draft with my template</button>
            {field('Subject', draft.subject, subject => edit({ subject }))}
            <label className="outreach-field"><span>Email body</span><textarea rows={11} value={draft.body} onChange={e => edit({ body: e.target.value })} /></label>
            <h3>Resume</h3>
            {draft.attachment ? <div className="outreach-attachment"><a href={`${getTailorServerBase()}/outreach/attachment?id=${draft.id}`} target="_blank" rel="noreferrer">{draft.attachment.name} ↗</a><span>{Math.ceil(draft.attachment.bytes / 1024)} KB</span><button className="apps-link" onClick={() => void run('remove_attachment')}>Remove</button></div> : <p className="outreach-muted">No resume attached.</p>}
            <div className="outreach-actions"><button className="apps-btn" onClick={() => void run('use_resume')}>Use application resume</button><label className="apps-btn outreach-upload">Upload PDF<input type="file" accept="application/pdf,.pdf" onChange={async e => {
              const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
              if (file.size > 5 * 1024 * 1024) { setError('Choose a PDF up to 5 MB'); return; }
              const reader = new FileReader(); reader.onload = () => void run('upload', { name: file.name, base64: String(reader.result).split(',')[1] }); reader.onerror = () => setError('Could not read this file'); reader.readAsDataURL(file);
            }} /></label></div>
            <h3>Delivery</h3>
            <label className="outreach-field"><span>Schedule (your local time; blank queues in 30 seconds)</span><input type="datetime-local" value={schedule} onChange={e => setSchedule(e.target.value)} /></label>
            <label className="outreach-check"><input type="checkbox" checked={draft.autoWhenApplied} onChange={e => edit({ autoWhenApplied: e.target.checked })} />Use my saved template automatically after applying, if a published hiring inbox is eligible.</label>
            {draft.autoWhenApplied && <p className="outreach-muted">Also requires automatic hiring outreach enabled in settings. Automatic preparation replaces the message with your current template; the selected resume stays attached.</p>}
          </fieldset>
          {!!detail?.previous.length && <div className="outreach-warning"><h3>Previous company / recipient outreach</h3>{detail.previous.map(p => <p key={p.id}>{p.title} · {p.contact.email} · {outreachLabel(p.status)}</p>)}<p>Another email is held until the company and recipient cooldown expires.</p></div>}
          {!!detail?.history.length && <details className="outreach-history"><summary>Sending history ({detail.history.length})</summary>{detail.history.map(h => <article key={h.id}><strong>{outreachLabel(h.status)} · {new Date(h.at).toLocaleString()}</strong>{h.error && <p>{h.error}</p>}</article>)}</details>}
        </>}
      </div>
      {draft && <footer className="outreach-panel-foot">
        {readOnly ? <button className="apps-btn" disabled={!!busy} onClick={async () => { setBusy('create'); try { accept(await outreachApi<OutreachDetail>('create', { jobUrl: draft.jobUrl, applicationId: draft.applicationId, newDraft: true })); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); } }}>Create a new draft</button> : <>
          <button className="apps-btn" disabled={!!busy || !dirty} onClick={async () => { setBusy('save'); setError(''); try { await save(); setNotice('Draft saved.'); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); } }}>Save draft</button>
          <button className="apps-btn" disabled={!!busy} onClick={() => void run(draft.status === 'queued' ? 'cancel' : 'skip')}>{draft.status === 'queued' ? 'Cancel send' : 'Skip'}</button>
          <button className="rv-primary" disabled={!!busy || !draft.appliedAt || !draft.contact.email || draft.status === 'queued'} onClick={() => void run('approve', { scheduledAt: schedule ? new Date(schedule).toISOString() : undefined })}>{busy === 'approve' ? 'Queuing…' : 'Approve & queue email'}</button>
        </>}
      </footer>}
    </section>
  </div>;
}
