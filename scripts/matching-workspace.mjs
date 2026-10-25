// Deterministic relationships for the Matching workspace. Scores remain owned by Fit.
import crypto from 'node:crypto';
export const queueKey = url => crypto.createHash('sha256').update(String(url)).digest('hex').slice(0, 16);
export const companyKey = name => String(name || 'Unknown company').trim().toLowerCase().replace(/\s+/g, ' ');
const words = value => new Set(String(value || '').toLowerCase().match(/[a-z0-9+#]{2,}/g) || []);
const intersection = (a,b) => [...a].filter(x=>b.has(x)).length;
export function similarJobs(current, docs, limit=4) {
 const a=words(current.title);const skills=new Set(current.fit?.ledger?.skills?.flatMap(s=>s.alternatives.map(v=>v.toLowerCase())) || []);
 return docs.filter(d=>d.job_url!==current.job_url).map(d=>{
  const b=words(d.title);const other=new Set(d.fit?.ledger?.skills?.flatMap(s=>s.alternatives.map(v=>v.toLowerCase())) || []);
  const shared=intersection(skills,other);const overlap=intersection(a,b);
  return {d,relevance:overlap/Math.max(1,new Set([...a,...b]).size)+shared/Math.max(1,new Set([...skills,...other]).size)};
 }).filter(x=>x.relevance>=.12).sort((a,b)=>b.relevance-a.relevance||(b.d.fit?.score??-1)-(a.d.fit?.score??-1)).slice(0,limit).map(({d})=>({id:d.job_url,key:queueKey(d.job_url),company:d.company,title:d.title,location:d.location??null,score:d.fit?.score??null}));
}
// Where a job was pulled from (the pipeline's `site`): the rail colors each company by it (src/apply/platform.ts).
const SOURCES=new Set(['linkedin','staffing','greenhouse','lever','ashby','workday','smartrecruiters']);
const sourceOf=(d)=>{const s=String(d.site||'').toLowerCase();return SOURCES.has(s)?s:null;};
export function companySummary(docs,later,now=new Date()) {
 const groups=new Map();const today=now.toISOString().slice(0,10);
 for(const d of docs){const key=companyKey(d.company);const c=groups.get(key)||{key,name:d.company||'Unknown company',count:0,newToday:0,bestMatch:null,saved:0,bySource:{}};c.count++;if(String(d.run_at instanceof Date?d.run_at.toISOString():d.run_at).slice(0,10)===today)c.newToday++;if(later.has(d.job_url))c.saved++;if(typeof d.fit?.score==='number')c.bestMatch=Math.max(c.bestMatch??0,d.fit.score);const s=sourceOf(d);if(s)c.bySource[s]=(c.bySource[s]||0)+1;groups.set(key,c);}
 // source: where most of the company's jobs came from; sources: every one, most jobs first.
 return [...groups.values()].map(({bySource,...c})=>{const sources=Object.entries(bySource).sort((a,b)=>b[1]-a[1]).map(([s])=>s);return {...c,source:sources[0]??null,sources};})
  .sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
}
export function preferenceBoost(doc,events) {
 const decisions=events.filter(e=>['apply_opened','saved','not_apply'].includes(e.kind));
 if(new Set(decisions.map(e=>e.job_url)).size<5)return 0;
 let company=0,track=0;
 for(const e of decisions){const vote=e.kind==='not_apply'?-.5:e.kind==='saved'?.5:1;if(companyKey(e.company)===companyKey(doc.company))company+=vote;if(e.track&&e.track===doc.track)track+=vote;}
 return Math.max(-2,Math.min(2,.75*Math.tanh(company/6)+1.25*Math.tanh(track/8)));
}
const EVENTS=new Set(['viewed','returned','opened_company','opened_similar','apply_opened','saved','not_apply']);
let indexed=false;let eventCache={until:0,events:[]};
export async function matchingEvents(db){if(eventCache.until>Date.now())return eventCache.events;const events=await db.collection('matching_events').find({at:{$gte:new Date(Date.now()-60*86400000)}},{projection:{_id:0,kind:1,company:1,track:1,job_url:1}}).sort({at:-1}).limit(1000).toArray();eventCache={until:Date.now()+30000,events};return events;}
export async function recordMatchingEvent(db,{jobUrl,kind,now=new Date()}) {
 if(!EVENTS.has(kind)||!/^https:\/\//.test(String(jobUrl||'')))throw Error('Invalid matching event');
 const job=await db.collection('jobs').findOne({job_url:jobUrl},{projection:{company:1,title:1,fit:1}});if(!job)throw Error('Job not found');
 if(!indexed){await db.collection('matching_events').createIndex({at:1},{expireAfterSeconds:180*86400});indexed=true;}
 const {trackOf}=await import('./applications-analytics.mjs');
 await db.collection('matching_events').insertOne({job_url:jobUrl,kind,company:job.company||'',track:trackOf(job.title),at:now});if(['apply_opened','saved','not_apply'].includes(kind))eventCache.until=0;
 return {ok:true};
}

export async function forgetMatchingDecision(db,jobUrl){await db.collection('matching_events').deleteMany({job_url:jobUrl,kind:{$in:['apply_opened','saved','not_apply']}});eventCache.until=0;}
