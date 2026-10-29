import { createHash } from 'node:crypto';
import { listReminders } from './network-reminders.mjs';
import { listAssessments, updateAssessment } from './assessments.mjs';
import { warmJobs, sameCompany, companyOf } from './network-jobs.mjs';
import { NetworkError, withFollowUps, saveFollowUp } from './network.mjs';
import { nyParts } from './phone-summary.mjs';

const DAY = 86400000;
const dayNumber = d => Date.parse(`${String(d).slice(0,10)}T12:00:00Z`) / DAY;
const compareItems = (a,b) => a.rank-b.rank || String(a.deadlineAt||'').localeCompare(String(b.deadlineAt||'')) || a.key.localeCompare(b.key);
const contact = new Set(['email','message','call','met']);
const fingerprint = jobs => createHash('sha256').update(jobs.map(j=>j.url).sort().join('\n')).digest('hex').slice(0,16);

/** Deterministic facts, never generated claims. An opportunity is a company overlap, not an uncomputed fit score. */
export function buildIntelligence({ people, sources, work = [], reminders = [], groups = [], assessments = [] }, { now = new Date() } = {}) {
 const today = nyParts(now).day, t = dayNumber(today);
 const active = withFollowUps(people.filter(p=>!p.archived),sources), byId = new Map(active.map(p=>[p.id,p]));
 const items = reminders.map(r=>({...r, ...(r.workId?{mapId:work.find(w=>w.id===r.workId)?.mapId||'main'}:{}), kind:r.kind==='due'?'follow_up':r.kind==='quiet'?'relationship':r.kind==='never'?'introduction':r.kind==='work'?'work':r.kind,
  stage:r.kind==='reply'||/late|past/.test(r.detail+' '+r.title)?'urgent':'actionable', next:r.detail, jobs:[], people:r.personId?[r.personId]:[], rank:r.kind==='reply'?0:10}));
 const covered = new Set(items.map(i=>i.personId).filter(Boolean));
 for (const p of active) {
  const history=[...(p.history||[])].sort((a,b)=>a.at.localeCompare(b.at)), last=history.at(-1);
  if (!covered.has(p.id) && last?.type==='reply') {
   items.push({key:`reply:${p.id}:${last.id}`,kind:'reply',title:`${p.name} replied`,detail:'A reply is waiting in your relationship history.',next:'Read their reply and decide your next step.',personId:p.id,people:[p.id],jobs:[],stage:'actionable',rank:2}); covered.add(p.id);
  }
  if (covered.has(p.id)||p.followUpPlan?.enabled===false) continue;
  const left=p.nextFollowUp?dayNumber(p.nextFollowUp)-t:Infinity;
  if (left>0 && left<=7) {
   const intro=Boolean(p.via)&&!p.lastContact;
   items.push({key:`due:${p.id}:${p.nextFollowUp}`,kind:intro?'introduction':'follow_up',title:intro?`Reach out to ${p.name}`:`Follow up with ${p.name}`,detail:`Planned for ${p.nextFollowUp}${p.followUpPlan?.regarding?` · ${p.followUpPlan.regarding}`:''}.`,next:p.followUpPlan?.nextNotes||'Prepare a short message before it is due.',personId:p.id,people:[p.id],jobs:[],stage:'discovered',rank:35+left});
  }
 }
 for (const w of work) {
  if (w.done||!w.start||dayNumber(w.start)<t||dayNumber(w.start)>t+7||items.some(i=>i.workId===w.id))continue;
  items.push({key:`upcoming:${w.id}:${w.start}`,kind:'upcoming',title:w.title,detail:`Starts ${w.start}.`,next:w.next||'Review the people and notes attached to this work.',workId:w.id,mapId:w.mapId||'main',people:w.people||[],jobs:[],stage:'discovered',rank:25+dayNumber(w.start)-t});
 }
 const sourceById = new Map(sources.map(s=>[s.id,s]));
 const deadlineFormat = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
 const timeFormat = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
 for (const assessment of assessments) {
  if (assessment.status && assessment.status !== 'open') continue;
  const deadline = assessment.deadlineAt ? Date.parse(assessment.deadlineAt) : NaN;
  const dated = Number.isFinite(deadline), overdue = dated && deadline <= +now;
  if (overdue && +now-deadline >= DAY) continue;
  const daysLeft = dated ? dayNumber(nyParts(new Date(deadline)).day)-t : null;
  const time = dated ? timeFormat.format(deadline) : null;
  const deadlineLabel = dated ? deadlineFormat.format(deadline) : null;
  const company = assessment.company || '';
  const members = active.filter(p=>company && sameCompany(companyOf(p,sourceById),company));
  const source = sources.find(s=>['company','staffing'].includes(s.type)&&sameCompany(s.name,company));
  const detail = !dated ? 'You received an assessment. No deadline has been recorded yet.'
   : overdue ? `Deadline passed: ${deadlineLabel}.`
   : daysLeft === 0 ? `Complete today before ${time}.`
   : daysLeft === 1 ? `1 day left. Complete tomorrow before ${time}.`
   : `${daysLeft} days left. Deadline: ${deadlineLabel}.`;
  items.push({key:`assessment:${assessment.id}:${dated?new Date(deadline).toISOString():'unknown'}`,kind:'assessment',
   title:`${company || 'New'} assessment`,detail,
   next:!dated?'Check the assessment email and record its exact deadline.':overdue?'Check whether the assessment is still available; contact the company if you need an extension.':`Complete and submit the assessment before ${deadlineLabel}.`,
   assessmentId:assessment.id,subject:assessment.subject||'',company,deadlineAt:dated?new Date(deadline).toISOString():null,deadlineLabel,daysLeft,
   personId:members[0]?.id,sourceId:source?.id,people:members.map(p=>p.id),jobs:[],
   stage:overdue||daysLeft!==null&&daysLeft<=2?'urgent':!dated||daysLeft<=4?'actionable':'discovered',
   rank:dated?(overdue?-30:daysLeft===0?-20:daysLeft<=2?-10:12+daysLeft):18});
 }
 for (const g of groups) {
  const members=g.people.map(p=>byId.get(p.id)).filter(Boolean).sort((a,b)=>Number(Boolean(a.via))-Number(Boolean(b.via))||String(b.lastContact||'').localeCompare(String(a.lastContact||''))||a.name.localeCompare(b.name));
  if(!members.length)continue;
  const p=members[0], companySource=sources.find(s=>['company','staffing'].includes(s.type)&&s.name.toLowerCase()===g.company.toLowerCase());
  const jobs=g.jobs.filter(j=>j.status==='new'||j.status==='ready');
  if(jobs.length)items.push({key:`opportunity:${fingerprint(jobs)}:${createHash('sha256').update(g.company.toLowerCase()).digest('hex').slice(0,12)}`,kind:jobs.every(j=>j.site==='staffing')?'staffing':'opportunity',title:g.company,detail:`${jobs.length} open ${jobs.length===1?'role':'roles'} on your board. ${p.name} works here.`,next:'Review the roles first. If one fits, ask your connection about it.',personId:p.id,sourceId:companySource?.id,people:members.map(p=>p.id),jobs,stage:'discovered',rank:20,relationship:p.via?'Introduced connection':'First connection',via:p.via||null});
  const applied=g.jobs.filter(j=>j.status==='applied'&&j.appliedAt&&Date.parse(j.appliedAt)<=+now&&+now-Date.parse(j.appliedAt)<=14*DAY);
  const uncontacted=applied.filter(j=>!members.some(m=>(m.history||[]).some(h=>contact.has(h.type)&&h.at>=j.appliedAt)));
  if(uncontacted.length)items.push({key:`application:${fingerprint(uncontacted)}:${p.id}`,kind:'application',title:`You applied at ${g.company}`,detail:`${uncontacted.length} recent ${uncontacted.length===1?'application':'applications'} and ${members.length} network ${members.length===1?'connection':'connections'}. No contact logged since applying.`,next:`Consider reaching out to ${p.name} about the role.`,personId:p.id,sourceId:companySource?.id,people:members.map(p=>p.id),jobs:uncontacted,stage:+now-Date.parse(uncontacted[0].appliedAt)>=DAY?'urgent':'actionable',rank:5});
 }
 return items.sort(compareItems);
}

export async function listIntelligence(db,{now=new Date()}={}) {
 const [rawPeople,rawSources,rawWork,{reminders},groups,assessments] = await Promise.all([
  db.collection('network_people').find({}).toArray(),db.collection('network_sources').find({}).toArray(),db.collection('network_board').find({kind:'work'}).toArray(),listReminders(db,{now}),warmJobs(db,{now}),listAssessments(db,{now:+now})]);
 const id=({_id,...r})=>({id:String(_id),...r});
 const items=buildIntelligence({people:rawPeople.map(id),sources:rawSources.map(id),work:rawWork.map(id),reminders,groups,assessments},{now});
 const state=db.collection('network_intelligence_state');
 const [states,prefs]=await Promise.all([state.find({}).toArray(),db.collection('app_settings').findOne({_id:'network_intelligence'})]);
 const byKey=new Map(states.map(s=>[s._id,s]));
 const fresh=items.filter(i=>!byKey.has(i.key));
 if(fresh.length)await state.bulkWrite(fresh.map(i=>({updateOne:{filter:{_id:i.key},update:{$setOnInsert:{firstSeen:now.toISOString()}},upsert:true}})),{ordered:false});
 const visible=items.filter(i=>{const s=byKey.get(i.key);return !s?.dismissed&&!(s?.snoozeDay>nyParts(now).day);}).map(i=>{
  const firstSeen=byKey.get(i.key)?.firstSeen||now.toISOString();
  return {...i,firstSeen,...(['opportunity','staffing'].includes(i.kind)&&+now-Date.parse(firstSeen)>=2*DAY&&!byKey.get(i.key)?.reviewedAt?{stage:'actionable',rank:15}:{} )};
 }).sort(compareItems);
 return {items:visible,expanded:Boolean(prefs?.expanded),generatedAt:now.toISOString()};
}

export async function intelligenceAction(db,input={},now=new Date()) {
 if(input.action==='preference') {
  if(typeof input.expanded!=='boolean')throw new NetworkError('Choose expanded or minimized');
  await db.collection('app_settings').updateOne({_id:'network_intelligence'},{$set:{expanded:input.expanded}},{upsert:true});return {ok:true};
 }
 const key=String(input.key||'');
 if(!key||key.length>300)throw new NetworkError('Choose an intelligence item');
 const state=await db.collection('network_intelligence_state').findOne({_id:key});
 if(!state)throw new NetworkError('Refresh the intelligence feed first');
 if(input.action==='review')await db.collection('network_intelligence_state').updateOne({_id:key},{$set:{reviewedAt:now.toISOString()}});
 else if(input.action==='dismiss')await db.collection('network_intelligence_state').updateOne({_id:key},{$set:{dismissed:true}});
 else if(input.action==='snooze') {
  const until=String(input.until||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(until)||!Number.isFinite(dayNumber(until))||new Date(`${until}T12:00:00Z`).toISOString().slice(0,10)!==until||until<=nyParts(now).day||dayNumber(until)-dayNumber(nyParts(now).day)>365)throw new NetworkError('Choose a date within the next year');
  if(key.startsWith('assessment:')) {
   const assessment = await db.collection('assessments').findOne({_id:key.split(':')[1]});
   const deadline = Date.parse(assessment?.deadlineAt);
   if(Number.isFinite(deadline)&&until>nyParts(new Date(deadline)).day)throw new NetworkError('Choose a reminder on or before the assessment deadline day');
  }
  await db.collection('network_intelligence_state').updateOne({_id:key},{$set:{until:until+'T00:00:00.000Z',snoozeDay:until}});
 } else if(input.action==='assessment_done') {
  if(!key.startsWith('assessment:'))throw new NetworkError('Choose an assessment');
  try { await updateAssessment(db,{id:key.split(':')[1],status:'done',now:+now}); }
  catch(e){throw new NetworkError(e.message);}
 } else if(input.action==='contacted') {
  if(state.dismissed)return {ok:true};
  const id=key.split(':')[1];
  if(!['due','reply','quiet'].includes(key.split(':')[0]))throw new NetworkError('Open this item to record its outcome');
  const cur=await db.collection('network_people').findOne({_id:id});
  if(!cur||cur.archived)throw new NetworkError('That person is no longer active');
  const plan={enabled:true,platform:'other',regarding:'Keep in touch',nextNotes:'',...cur.followUpPlan};
  const next=cur.nextFollowUp&&cur.nextFollowUp>nyParts(now).day?cur.nextFollowUp:new Date(Date.parse(nyParts(now).day+'T12:00:00Z')+7*DAY).toISOString().slice(0,10);
  const person=await saveFollowUp(db,{id,plan,nextFollowUp:next,outcome:{completed:true,notes:'Followed up · logged from Network Intelligence'}},now);
  await db.collection('network_intelligence_state').updateOne({_id:key},{$set:{dismissed:true}});
  return {person};
 } else throw new NetworkError('Choose a known action');
 return {ok:true};
}
