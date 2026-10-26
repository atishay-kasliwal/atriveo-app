// A matching query combines time, sources, role and text before pagination or company counts.
export const MATCHING_SOURCES=['linkedin','staffing','greenhouse','lever','ashby','workday','smartrecruiters'];
export function matchingSource(doc){
 const site=String(doc.site||'').toLowerCase();if(MATCHING_SOURCES.includes(site))return site;
 try{const h=new URL(doc.job_url).hostname;return [[/(^|\.)linkedin\.com$/,'linkedin'],[/(^|\.)greenhouse\.(?:io|com)$/,'greenhouse'],[/(^|\.)lever\.co$/,'lever'],[/(^|\.)ashbyhq\.com$/,'ashby'],[/(^|\.)(?:myworkdayjobs|workday)\.com$/,'workday'],[/(^|\.)smartrecruiters\.com$/,'smartrecruiters']].find(([re])=>re.test(h))?.[1]||null;}catch{return null;}
}
export function matchingTimestamp(doc){const posted=Date.parse(doc.date_posted);return Number.isFinite(posted)?posted:(Date.parse(doc.run_at)||0);}
// One formatter per time zone: building one per job cost about a second on a full queue.
const dayFormats=new Map();
const dayIn=(date,timeZone)=>{let f=dayFormats.get(timeZone);if(!f){f=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});dayFormats.set(timeZone,f);}return f.format(date);};
// Atishay (2026-10-26) applies in the United States and India only. A location that names either stays; one that names
// only another country or city (Madrid, London, Toronto...) is dropped; no location or plain "Remote" stays.
const SERVED=/\b(?:united states|u\.?s\.?a?|america)\b|,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b|\b(?:india|bengaluru|bangalore|hyderabad|mumbai|pune|chennai|delhi|gurugram|gurgaon|noida|kolkata|ahmedabad)\b|\b(?:new york|san francisco|los angeles|seattle|austin|boston|chicago|atlanta|dallas|houston|denver|san jose|san diego|washington)\b/i;
const ELSEWHERE=/\b(?:madrid|barcelona|spain|london|united kingdom|uk|england|scotland|ireland|dublin|germany|berlin|munich|france|paris|netherlands|amsterdam|poland|warsaw|krakow|portugal|lisbon|italy|milan|rome|sweden|stockholm|norway|denmark|copenhagen|finland|helsinki|switzerland|zurich|austria|vienna|belgium|brussels|czech|prague|romania|bucharest|hungary|budapest|greece|athens|turkey|istanbul|israel|tel aviv|dubai|uae|emirates|saudi|qatar|egypt|nigeria|kenya|south africa|canada|toronto|vancouver|montreal|ottawa|calgary|mexico|brazil|sao paulo|argentina|colombia|chile|peru|australia|sydney|melbourne|new zealand|singapore|malaysia|philippines|manila|indonesia|jakarta|vietnam|thailand|bangkok|japan|tokyo|korea|seoul|china|beijing|shanghai|hong kong|taiwan|pakistan|bangladesh|sri lanka|emea|apac|latam|europe|asia)\b/i;
export function inServedCountries(location){
 const text=String(location||'');if(!text.trim())return true;
 return SERVED.test(text)||!ELSEWHERE.test(text);
}
export function filterMatchingJobs(docs,{period='7d',sources=[],role='',query='',timeZone='America/New_York',now=new Date()}={}){
 try{dayIn(now,timeZone);}catch{timeZone='America/New_York';}
 const today=dayIn(now,timeZone),dayOffset=n=>new Date(Date.parse(today+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
 const selected=new Set((Array.isArray(sources)?sources:String(sources).split(',')).filter(s=>MATCHING_SOURCES.includes(s)||s==='other'));
 const tokens=String(query).trim().toLowerCase().slice(0,200).split(/\s+/).filter(Boolean);
 return docs.filter(d=>{
  // A posting date without a time (LinkedIn's "2026-10-25") is that calendar day. Read as midnight UTC it fell on the
  // day before in New York, so "Today" showed no LinkedIn jobs.
  const posted=String(d.date_posted||''),timestamp=matchingTimestamp(d);
  const date=/^\d{4}-\d{2}-\d{2}$/.test(posted)?posted:timestamp?dayIn(new Date(timestamp),timeZone):null;
  if(period==='today'&&date!==today||period==='yesterday'&&date!==dayOffset(-1)||period==='7d'&&(!date||date<dayOffset(-6)||date>today))return false;
  if(selected.size&&!selected.has(matchingSource(d)||'other'))return false;
  if(!inServedCountries(d.location))return false;
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
