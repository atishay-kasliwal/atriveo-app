import {confirmedApplicationCount} from './matching-filters.mjs';
export const PROGRESS_TIME_ZONE='America/New_York';
const dayKey=date=>new Date(date).toLocaleDateString('sv-SE',{timeZone:PROGRESS_TIME_ZONE});
/** Aggregate counts only: no addresses, subjects, Gmail bodies, resumes or account credentials. */
export function buildWidgetProgress(applications,swipes,events,{now=new Date(),reviewCount=0}={}){
 const day=dayKey(now);
 const today=events.filter(e=>e.state!=='dismissed'&&e.state!=='undone'&&e.receivedAt&&dayKey(e.receivedAt)===day);
 return {version:1,dayKey:day,timeZone:PROGRESS_TIME_ZONE,generatedAt:now.toISOString(),appliedToday:confirmedApplicationCount(applications,swipes,{now,timeZone:PROGRESS_TIME_ZONE}),interviewEmailsToday:today.filter(e=>e.kind==='interview').length,assessmentEmailsToday:today.filter(e=>e.kind==='assessment').length,responseEmailsToday:today.filter(e=>['rejected','assessment','interview','offer'].includes(e.kind)).length,reviewCount};
}
export async function widgetProgress(db,{now=new Date()}={}){
 const since=new Date(now.getTime()-48*3600000).toISOString();
 const [applications,swipes,events,reviewCount]=await Promise.all([
  db.collection('applications').find({status:'APPLIED'},{projection:{_id:1,jobUrls:1,'lifecycle.appliedAt':1}}).toArray(),
  db.collection('job_swipes').find({direction:'applied'},{projection:{_id:0,job_url:1,direction:1,applied_at:1,swiped_at:1}}).toArray(),
  db.collection('inbox_events').find({receivedAt:{$gte:since},kind:{$in:['interview','assessment','offer','rejected']}},{projection:{_id:0,receivedAt:1,kind:1,state:1}}).toArray(),
  db.collection('inbox_events').countDocuments({state:{$nin:['dismissed','undone','ignored']},kind:{$ne:'other'},$or:[{'tracker.state':'needs_confirm'},{state:{$in:['needs_confirm','unmatched']},tracker:null}]}),
 ]);
 return buildWidgetProgress(applications,swipes,events,{now,reviewCount});
}
