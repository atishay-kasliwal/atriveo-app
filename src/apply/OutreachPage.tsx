import { useEffect, useState } from 'react';
import OutreachPanel from './OutreachPanel';
import { outreachApi, outreachLabel, useOutreachList, type OutreachDetail, type OutreachSettingsData, type OutreachTarget } from './outreach';
import './outreach.css';

/** The few things between you and the first email: shown until each is done, and the last one is the pause that keeps everything from sending. */
function GetStarted({ settings, onOpen }: { settings: OutreachSettingsData | null; onOpen: () => void }) {
  if (!settings) return null;
  const steps: [string, boolean][] = [['Connect Gmail', settings.connected], ['Your name and sender email', Boolean(settings.senderName.trim() && settings.senderEmail.trim())], ['Write your pitch', Boolean(settings.pitch.trim())], ['Unpause sending', !settings.paused]];
  if (steps.every(([, done]) => done)) return null;
  const next = steps.findIndex(([, done]) => !done);
  return <section className="outreach-start" aria-label="Get started"><ol>{steps.map(([name, done], i) => <li key={name} className={done ? 'is-done' : i === next ? 'is-next' : ''}><i aria-hidden="true">{done ? '✓' : i + 1}</i><span>{name}</span></li>)}</ol><button type="button" className="apps-btn" onClick={onOpen}>{next === 3 ? 'Review and unpause' : 'Finish setup'}</button></section>;
}

export default function OutreachPage({ header }: { header?: React.ReactNode }) {
  const { drafts, replies, error: listError, refresh } = useOutreachList();
  const [target, setTarget] = useState<OutreachTarget | null>(null);
  const [settings, setSettings] = useState<OutreachSettingsData | null>(null);
  const [tab, setTab] = useState<'messages' | 'settings'>('messages');
  const [jobUrl, setJobUrl] = useState('');
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { void outreachApi<{ settings: OutreachSettingsData }>('settings').then(r => setSettings(r.settings)).catch(e => setError(e.message)); }, []);
  const edit = (patch: Partial<OutreachSettingsData>) => setSettings(s => s ? { ...s, ...patch } : s);
  async function save(test = false) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await outreachApi<{ settings: OutreachSettingsData }>('settings', settings, 'PUT');
      setSettings(result.settings);
      if (test) { const result = await outreachApi<{ settings: OutreachSettingsData }>('test', {}); setSettings(result.settings); }
      setNotice(test ? 'Test email accepted by your mailbox provider. Check your inbox.' : 'Outreach settings saved.'); void refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const filtered = drafts.filter(d => (!filter || (filter === 'replied' ? Boolean(replies[d.id]) : d.status === filter)) && `${d.company} ${d.title} ${d.contact.email}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="rv-page outreach-page">{header}<main className="outreach-main">
    <div className="outreach-page-head"><div><span className="outreach-eyebrow">YOUR APPLICATIONS, FOLLOWED THROUGH</span><h1>Outreach</h1><p>Research contacts, review each message, and keep every follow-up with its job.</p></div><span className={`outreach-badge ${settings?.paused ? '' : 'is-sent'}`}>{settings ? settings.paused ? 'Sending paused' : 'Sending enabled' : 'Connecting…'}</span></div>
    <nav className="outreach-tabs" aria-label="Outreach views"><button className={`apps-btn ${tab === 'messages' ? 'is-active' : ''}`} onClick={() => setTab('messages')}>Messages · {drafts.length}</button><button className={`apps-btn ${tab === 'settings' ? 'is-active' : ''}`} onClick={() => setTab('settings')}>Mailbox & settings</button></nav>
    {tab === 'messages' && <GetStarted settings={settings} onOpen={() => setTab('settings')} />}
    {(error || listError) && <p className="outreach-error" role="alert">{error || listError}</p>}{notice && <p className="outreach-notice" role="status">{notice}</p>}
    {tab === 'messages' ? <>
      <form className="outreach-toolbar" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { const result = await outreachApi<OutreachDetail>('create', { jobUrl }); setTarget({ id: result.draft.id }); setJobUrl(''); void refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}><input type="url" aria-label="Saved job URL" placeholder="Paste a saved job URL to prepare outreach" value={jobUrl} onChange={e => setJobUrl(e.target.value)} required /><button className="apps-btn" disabled={busy}>Prepare outreach</button></form>
      <div className="outreach-toolbar"><input type="search" aria-label="Search outreach" placeholder="Search company, role, or email" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="Filter outreach status" value={filter} onChange={e => setFilter(e.target.value)}><option value="">All statuses</option><option value="replied">Replied</option>{['draft', 'needs_review', 'queued', 'sent', 'no_contact', 'failed', 'uncertain', 'skipped', 'blocked'].map(s => <option key={s} value={s}>{outreachLabel(s)}</option>)}</select><button className="apps-btn" onClick={() => void refresh()}>Refresh</button><button className="apps-btn" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await outreachApi('scan', {}); await refresh(); setNotice('Applied jobs scanned. Review the discovered contacts below.'); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>Scan applied jobs</button></div>
      <div className="outreach-scroll"><div className="outreach-list">{filtered.map(d => <button className="outreach-list-row" key={d.id} onClick={() => setTarget({ id: d.id })}><span><strong>{d.company}</strong><span>{d.title}</span><small>{d.contact.email || 'Find or add a contact'}</small></span><span className="outreach-badges">{replies[d.id] && <span className="outreach-badge is-replied" title={replies[d.id]!.subject}>Replied · {new Date(replies[d.id]!.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}<span className={`outreach-badge is-${d.status}`}>{outreachLabel(d.status)}</span></span></button>)}</div>
      {!filtered.length && <div className="outreach-empty"><h2>{drafts.length ? 'No matching messages' : 'Your next step after applying'}</h2><p>Use “Prepare outreach” on a job card, or paste an existing job URL above. Drafts stay here after jobs leave Today.</p></div>}</div>
    </> : settings && <form className="outreach-settings" onSubmit={e => { e.preventDefault(); void save(); }}>
      <fieldset disabled={busy}><div className="outreach-cols"><div className="outreach-col"><h2>Gmail</h2><p className="outreach-muted">Connect your existing Gmail with send-only access. Open this website on the computer running the local service to complete sign-in.</p>
        <p>{settings.connected ? 'Gmail connected' : 'Gmail not connected'}</p>
        <button type="button" className="apps-btn" onClick={async () => { setBusy(true); setError(''); try { const r = await outreachApi<{ url: string }>('auth', {}); window.location.assign(r.url); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>Connect Gmail</button>
        <div className="outreach-two"><label className="outreach-field"><span>Your name</span><input value={settings.senderName} onChange={e => edit({ senderName: e.target.value })} /></label><label className="outreach-field"><span>Sender email</span><input type="email" value={settings.senderEmail} onChange={e => edit({ senderEmail: e.target.value })} /></label></div>
        <button type="button" className="apps-btn" disabled={!settings.connected || !settings.senderEmail} onClick={() => void save(true)}>Save & send test to {settings.senderEmail || 'my inbox'}</button>
        </div><div className="outreach-col"><h2>Sending preferences</h2><label className="outreach-check"><input type="checkbox" checked={settings.paused} onChange={e => edit({ paused: e.target.checked })} />Pause all outreach sending</label><label className="outreach-check"><input type="checkbox" checked={settings.autoHiring} onChange={e => edit({ autoHiring: e.target.checked })} />Allow automatic sending to published hiring inboxes, including those found by Scan applied jobs</label>
        <p className="outreach-muted">General inboxes and recruiters always need approval. Scheduled work runs while this computer’s service is on. Missed schedules return for review.</p>
        <div className="outreach-two"><label className="outreach-field"><span>Daily limit (rolling 24 hours)</span><input type="number" min={1} max={100} value={settings.dailyLimit} onChange={e => edit({ dailyLimit: Number(e.target.value) })} /></label><label className="outreach-field"><span>Company / recipient cooldown (days)</span><input type="number" min={1} max={365} value={settings.companyCooldownDays} onChange={e => edit({ companyCooldownDays: Number(e.target.value) })} /></label></div>
        <h2>Default email</h2><label className="outreach-field"><span>Your pitch</span><textarea rows={3} maxLength={600} value={settings.pitch} onChange={e => edit({ pitch: e.target.value })} /></label><label className="outreach-field"><span>Signature</span><textarea rows={3} value={settings.signature} onChange={e => edit({ signature: e.target.value })} /></label></div><div className="outreach-col"><label className="outreach-field"><span>Subject template</span><input value={settings.subjectTemplate} onChange={e => edit({ subjectTemplate: e.target.value })} /></label><label className="outreach-field"><span>Body template</span><textarea rows={10} value={settings.bodyTemplate} onChange={e => edit({ bodyTemplate: e.target.value })} /></label>
        <p className="outreach-muted outreach-fields-note">Available fields: {'{{greeting}}, {{company}}, {{title}}, {{full_name}}, {{applied_date}}, {{pitch_line}}, {{job_line}}, {{signature}}'}. Templates change new drafts; use “Replace draft with my template” to update an existing draft.</p>
      </div></div><div className="outreach-save"><button type="submit" className="rv-primary">{busy ? 'Saving…' : 'Save settings'}</button></div></fieldset>
    </form>}
    </main>
    {target && <OutreachPanel key={JSON.stringify(target)} target={target} onClose={() => setTarget(null)} onChanged={() => void refresh()} />}
  </div>;
}
