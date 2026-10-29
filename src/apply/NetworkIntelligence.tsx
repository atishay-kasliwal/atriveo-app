import { Link } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadIntelligence, post, type IntelligenceFeed, type IntelligenceItem, type NetworkData, type Person } from './network';
import './network-intelligence.css';

const labels: Record<string,string> = {event:'Event',assessment:'Assessment',opportunity:'Opportunity',staffing:'Staffing',application:'Application',follow_up:'Follow up',reply:'Reply',relationship:'Relationship',introduction:'Introduction',work:'Work',upcoming:'Upcoming'};
function Spark() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/></svg>; }
const tomorrow = () => { const d=new Date();d.setDate(d.getDate()+1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

export default function NetworkIntelligence({data,onFocus,onPerson,onSource,onWork,onDraft,onChange,global=false,initialKey,workIds=[]}: {
 workIds?: string[]; initialKey?: string; data:NetworkData; global?:boolean; onFocus:(item:IntelligenceItem|null)=>void; onPerson:(id:string)=>void; onSource:(id:string)=>void; onWork:(id:string,mapId?:string)=>void;
 onDraft:(id:string)=>void; onChange:(person:Person)=>void;
}) {
 const [feed,setFeed]=useState<IntelligenceFeed|null>(null),[expanded,setExpanded]=useState(Boolean(initialKey)),[selected,setSelected]=useState<string|null>(initialKey||null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[all,setAll]=useState(false),[snoozing,setSnoozing]=useState<string|null>(null),[date,setDate]=useState(tomorrow);
 const hydrated=useRef(false),preferenceVersion=useRef(0), preferenceQueue=useRef<Promise<unknown>>(Promise.resolve()),toggle=useRef<HTMLButtonElement>(null);
 const refresh=useCallback(async()=>{
  try {const version=preferenceVersion.current;const next=await loadIntelligence();setFeed(next);setError('');if(!hydrated.current&&version===preferenceVersion.current){setExpanded(initialKey?true:next.expanded);hydrated.current=true;}}
  catch{setError('Intelligence could not refresh. Try again.');}
 },[initialKey]);
 useEffect(()=>{void refresh();const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh();},60000);const focus=()=>void refresh();window.addEventListener('focus',focus);return()=>{window.clearInterval(timer);window.removeEventListener('focus',focus);};},[refresh,data]);
 const chooseExpanded=(next:boolean)=>{preferenceVersion.current++;hydrated.current=true;setExpanded(next);if(!next){onFocus(null);toggle.current?.focus();}preferenceQueue.current=preferenceQueue.current.catch(()=>{}).then(()=>post('intelligence/action',{action:'preference',expanded:next})).catch(()=>setError('Your dock preference could not be saved.'));};
 const items=(feed?.items||[]).filter(i=>global||i.kind==='assessment'||i.kind==='event'||(i.workId?workIds.includes(i.workId):!data.onMap||i.people.some(id=>data.people.some(p=>p.id===id))||Boolean(i.sourceId&&data.onMap.includes(i.sourceId))));
 const current=items.find(i=>i.key===selected);
 useEffect(()=>{if(selected&&feed&&!current){setSelected(null);onFocus(null);}},[selected,feed,current,onFocus]);
 const select=(item:IntelligenceItem)=>{void post('intelligence/action',{action:'review',key:item.key}).catch(()=>setError('Your review could not be saved.'));setSelected(item.key);setSnoozing(null);onFocus(item);};
 async function act(item:IntelligenceItem,action:'dismiss'|'snooze'|'contacted'|'assessment_done'|'event_done') {
  setBusy(true);setError('');
  try{const r=await post<{person?:Person}>('intelligence/action',{key:item.key,action,...(action==='snooze'?{until:date}:{})});if(r.person)onChange(r.person);setFeed(f=>f?{...f,items:f.items.filter(i=>i.key!==item.key)}:f);if(selected===item.key){setSelected(null);onFocus(null);}setSnoozing(null);void refresh();}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 function controls(item:IntelligenceItem) {return <div className="ni-secondary">
  {item.kind!=='event'&&!(item.kind==='assessment'&&item.daysLeft!=null&&item.daysLeft<=0)&&<button type="button" disabled={busy} onClick={()=>{setSnoozing(snoozing===item.key?null:item.key);setDate(tomorrow());}}>Remind me…</button>}
  <button type="button" disabled={busy} onClick={()=>void act(item,'dismiss')}>Don’t show again</button>
  {snoozing===item.key&&<form onSubmit={e=>{e.preventDefault();void act(item,'snooze');}}><label>Remind me on<input type="date" required min={tomorrow()} max={item.deadlineAt?new Date(item.deadlineAt).toLocaleDateString('en-CA',{timeZone:'America/New_York'}):undefined} value={date} onChange={e=>setDate(e.target.value)}/></label><button type="submit" disabled={busy}>Save</button></form>}
 </div>;}
 return <section className={`ni-dock${expanded?' is-expanded':''}`} aria-label="Network Intelligence">
  {expanded&&<div className="ni-panel" id="network-intelligence-feed">
   <header><div><span className="ni-eyebrow">Your network, in motion</span><h2>{current?current.title:'Worth your attention'}</h2><p>{current?labels[current.kind]:feed?`${items.length} actionable ${items.length===1?'thing':'things'} across your network`:'Finding what matters…'}</p></div><button type="button" className="ni-icon" aria-label="Minimize Network Intelligence" onClick={()=>chooseExpanded(false)}>−</button></header>
   {error&&<div className="ni-error" role="status">{error}<button type="button" onClick={()=>void refresh()}>Retry</button></div>}
   <div className="ni-scroll">
   {current?<div className="ni-context">
    <button type="button" className="ni-back" onClick={()=>{setSelected(null);onFocus(null);}}>← All intelligence</button>
    <span className={`ni-stage is-${current.stage}`}>{current.stage}</span>
    <p className="ni-detail">{current.detail}</p>
    {(current.kind==='assessment'||current.kind==='event')&&<div className="ni-assessment-deadline"><span>{current.kind==='event'?'Event time · New York time':'Assessment deadline · New York time'}</span><strong>{current.deadlineLabel||'Deadline not recorded'}</strong>{current.subject&&<small>{current.subject}</small>}</div>}
    {current.personId&&data.people.some(p=>p.id===current.personId)&&<div className="ni-connection"><span>Network connection</span><button type="button" onClick={()=>onPerson(current.personId!)}>{data.people.find(p=>p.id===current.personId)?.name||'View person'} <span>↗</span></button>{current.relationship&&<small>{current.relationship}</small>}</div>}
    <div className="ni-next"><span>Recommended next step</span><p>{current.next}</p></div>
    {!!current.jobs.length&&<><h3>{current.jobs.length} {current.kind==='application'?'recent applications':'open roles'}</h3><ul className="ni-jobs">{current.jobs.map(j=><li key={j.url}><a href={j.applyUrl} target="_blank" rel="noreferrer">{j.title}<span aria-hidden="true">↗</span></a><small>{j.location||j.company} · {j.status==='ready'?'Resume ready':j.status==='applied'?'Applied':'Open'}</small></li>)}</ul></>}
    <div className="ni-actions">
     {current.eventId&&<button type="button" disabled={busy} onClick={()=>void act(current,'event_done')}>✓ Mark done</button>}
     {current.assessmentId&&<><Link className="ni-primary" to={`/assessments#as-${encodeURIComponent(current.assessmentId)}`}>Open assessment</Link><button type="button" disabled={busy} onClick={()=>void act(current,'assessment_done')}>✓ Mark completed</button></>}
     {current.personId&&data.people.some(p=>p.id===current.personId)&&<button type="button" className="ni-primary" onClick={()=>onDraft(current.personId!)}>Draft message</button>}
     {current.workId&&<button type="button" className="ni-primary" onClick={()=>onWork(current.workId!,current.mapId)}>Prepare / view work</button>}
     {current.sourceId&&!current.personId&&<button type="button" className="ni-primary" onClick={()=>onSource(current.sourceId!)}>View source</button>}
     {/^(due|reply|quiet):/.test(current.key)&&<button type="button" disabled={busy} onClick={()=>void act(current,'contacted')}>✓ I followed up</button>}
    </div>{controls(current)}
   </div>:<>
    {!feed&&!error&&<p className="ni-empty" role="status">Connecting your people, follow-ups and company openings…</p>}
    {feed&&!items.length&&<div className="ni-empty"><Spark/><h3>You’re caught up</h3><p>Assessments, open roles, upcoming follow-ups and replies will appear here as your network changes.</p></div>}
    {(all?items:items.slice(0,3)).map(item=><article className="ni-card" key={item.key}>
     <div className="ni-card-meta"><span><i className={`is-${item.kind}`}/>{labels[item.kind]||item.kind}</span><span className={`ni-stage is-${item.stage}`}>{item.stage}</span></div>
     <button type="button" className="ni-card-title" onClick={()=>select(item)}>{item.title}<span aria-hidden="true">↗</span></button>
     <p>{item.detail}</p>
     <div className="ni-actions"><button type="button" className="ni-primary" onClick={()=>select(item)}>{item.kind==='event'?'View event':item.kind==='assessment'?'View assessment':item.jobs.length?`See ${item.jobs.length} ${item.kind==='application'?'applications':'jobs'}`:'View context'}</button>{item.assessmentId&&<button type="button" disabled={busy} onClick={()=>void act(item,'assessment_done')}>✓ Mark completed</button>}{item.eventId&&<button type="button" disabled={busy} onClick={()=>void act(item,'event_done')}>✓ Mark done</button>}{item.personId&&data.people.some(p=>p.id===item.personId)&&<button type="button" onClick={()=>onDraft(item.personId!)}>Draft message</button>}</div>
     {controls(item)}
    </article>)}
    {items.length>3&&<button type="button" className="ni-view-all" onClick={()=>setAll(!all)}>{all?'Show top 3':`View all ${items.length}`} <span aria-hidden="true">→</span></button>}
   </>}
   </div>
   <footer>Facts from your network. Updated as you work.</footer>
  </div>}
  <button ref={toggle} type="button" className="ni-tab" aria-expanded={expanded} aria-controls={expanded?'network-intelligence-feed':undefined} onClick={()=>chooseExpanded(!expanded)}><Spark/><span>Network Intelligence</span><b aria-label={feed?`${items.length} actionable things`:'Loading intelligence'}>{feed?items.length:'…'}</b><svg className={expanded?'ni-chevron down':'ni-chevron'} viewBox="0 0 16 16" aria-hidden="true"><path d="m4 10 4-4 4 4"/></svg></button>
 </section>;
}
