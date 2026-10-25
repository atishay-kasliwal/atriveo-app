// A matching query combines time, sources, role and text before pagination or company counts.
export const MATCHING_SOURCES=['linkedin','staffing','greenhouse','lever','ashby','workday','smartrecruiters'];
export function matchingSource(doc){
 const site=String(doc.site||'').toLowerCase();if(MATCHING_SOURCES.includes(site))return site;
 try{const h=new URL(doc.job_url).hostname;return [[/(^|\.)linkedin\.com$/,'linkedin'],[/(^|\.)greenhouse\.(?:io|com)$/,'greenhouse'],[/(^|\.)lever\.co$/,'lever'],[/(^|\.)ashbyhq\.com$/,'ashby'],[/(^|\.)(?:myworkdayjobs|workday)\.com$/,'workday'],[/(^|\.)smartrecruiters\.com$/,'smartrecruiters']].find(([re])=>re.test(h))?.[1]||null;}catch{return null;}
}
export function matchingTimestamp(doc){const posted=Date.parse(doc.date_posted);return Number.isFinite(posted)?posted:(Date.parse(doc.run_at)||0);}
const dayIn=(date,timeZone)=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export function filterMatchingJobs(docs,{period='7d',sources=[],role='',query='',timeZone='America/New_York',now=new Date()}={}){
 try{dayIn(now,timeZone);}catch{timeZone='America/New_York';}
 const today=dayIn(now,timeZone),dayOffset=n=>new Date(Date.parse(today+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
 const selected=new Set((Array.isArray(sources)?sources:String(sources).split(',')).filter(s=>MATCHING_SOURCES.includes(s)||s==='other'));
 const tokens=String(query).trim().toLowerCase().slice(0,200).split(/\s+/).filter(Boolean);
 return docs.filter(d=>{
  const timestamp=matchingTimestamp(d),date=timestamp?dayIn(new Date(timestamp),timeZone):null;
  if(period==='today'&&date!==today||period==='yesterday'&&date!==dayOffset(-1)||period==='7d'&&(!date||date<dayOffset(-6)||date>today))return false;
  if(selected.size&&!selected.has(matchingSource(d)||'other'))return false;
  if(role&&d.track!==role)return false;
  const text=[d.title,d.company,d.location].join(' ').toLowerCase();return tokens.every(token=>text.includes(token));
 });
}
export function confirmedApplicationCount(applications,swipes,{now,timeZone='America/New_York'}={}){
 try{dayIn(new Date(),timeZone);}catch{timeZone='America/New_York';}
 const today=now?dayIn(now,timeZone):null;
 const onDay=value=>{const date=new Date(value);return value&&Number.isFinite(date.getTime())&&dayIn(date,timeZone)===today;};
 const linked=new Set(applications.flatMap(a=>a.jobUrls||[]));
 return applications.filter(a=>!today||onDay(a.lifecycle?.appliedAt)).length+new Set(swipes.filter(s=>s.direction==='applied'&&!linked.has(s.job_url)&&(!today||onDay(s.applied_at||s.swiped_at))).map(s=>s.job_url)).size;
}
