import {appliedItems,appliedCounts,dayKeyOf} from './applied-core.mjs';
export const PROGRESS_TIME_ZONE='America/New_York';
const dayKey=date=>new Date(date).toLocaleDateString('sv-SE',{timeZone:PROGRESS_TIME_ZONE});
/** Confirmed applications per New York day for the last `days` days, oldest first: the shared definition (scripts/applied-core.mjs). */
export function appliedByDay(applications,swipes,{now=new Date(),days=14}={}){return appliedCounts(appliedItems(applications,swipes),{now,timeZone:PROGRESS_TIME_ZONE,days}).days;}
/** Aggregate counts only: no addresses, subjects, Gmail bodies, resumes or account credentials. */
export function buildWidgetProgress(applications,swipes,events,{now=new Date(),reviewCount=0,fullHistory=false}={}){
 const day=dayKey(now);
 const history = new Map();
 if (fullHistory) for (const item of appliedItems(applications,swipes)) { const d = dayKeyOf(item.appliedAt); if (d && d <= day) history.set(d,(history.get(d)||0)+1); }
 const today=events.filter(e=>e.state!=='dismissed'&&e.state!=='undone'&&e.receivedAt&&dayKey(e.receivedAt)===day);
 return {version:1,dayKey:day,timeZone:PROGRESS_TIME_ZONE,generatedAt:now.toISOString(),appliedToday:appliedCounts(appliedItems(applications,swipes),{now,timeZone:PROGRESS_TIME_ZONE,days:1}).today,interviewEmailsToday:today.filter(e=>e.kind==='interview').length,assessmentEmailsToday:today.filter(e=>e.kind==='assessment').length,responseEmailsToday:today.filter(e=>['rejected','assessment','interview','offer'].includes(e.kind)).length,reviewCount,days:fullHistory ? [...history].sort(([a],[b])=>a.localeCompare(b)).map(([day,applied])=>({day,applied})) : appliedByDay(applications,swipes,{now})};
}
export async function widgetProgress(db,{now=new Date(),fullHistory=false}={}){
 const since=new Date(now.getTime()-48*3600000).toISOString();
 const [applications,swipes,events,reviewCount]=await Promise.all([
  db.collection('applications').find({status:'APPLIED'},{projection:{_id:1,jobUrls:1,'lifecycle.appliedAt':1,'submission.submittedAt':1}}).toArray(),
  db.collection('job_swipes').find({direction:'applied'},{projection:{_id:0,job_url:1,direction:1,applied_at:1,swiped_at:1}}).toArray(),
  db.collection('inbox_events').find({receivedAt:{$gte:since},kind:{$in:['interview','assessment','offer','rejected']}},{projection:{_id:0,receivedAt:1,kind:1,state:1}}).toArray(),
  db.collection('inbox_events').countDocuments({state:{$nin:['dismissed','undone','ignored']},kind:{$ne:'other'},$or:[{'tracker.state':'needs_confirm'},{state:{$in:['needs_confirm','unmatched']},tracker:null}]}),
 ]);
 return buildWidgetProgress(applications,swipes,events,{now,reviewCount,fullHistory});
}
