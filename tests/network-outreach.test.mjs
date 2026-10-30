import test from 'node:test';import assert from 'node:assert/strict';
import {outreachSource,addOutreachPeople,dueCheckIn,outreachPrompts,outreachCounts,answerCheckIn,restoreOutreach} from '../scripts/network-outreach.mjs';
import {networkView,saveSource,NetworkError} from '../scripts/network.mjs';

// In-memory stand-in for the collections (invented names only).
const fakeDb=()=>{const cols=new Map();const col=n=>{if(!cols.has(n))cols.set(n,new Map());const m=cols.get(n);const c=d=>structuredClone(d);return{
 find:()=>({toArray:async()=>[...m.values()].map(c)}),findOne:async q=>m.has(q._id)?c(m.get(q._id)):null,
 insertOne:async d=>{m.set(d._id,c(d))},insertMany:async ds=>{for(const d of ds)m.set(d._id,c(d))},
 updateOne:async(q,u,o)=>{if(m.has(q._id))m.set(q._id,{...m.get(q._id),...c(u.$set)});else if(o?.upsert)m.set(q._id,{_id:q._id,...c(u.$set)})},deleteOne:async q=>({deletedCount:m.delete(q._id)?1:0})}};return{collection:col,cols}};
const T=new Date('2026-10-30T15:00:00Z'), after=h=>new Date(T.getTime()+h*3_600_000);
const setup=async()=>{const db=fakeDb();const src=await outreachSource(db,{},T);const r=await addOutreachPeople(db,{sourceId:src.id,rows:[{name:'Dana Whit',company:'Northwind'},{name:'Marco Lind'}]},T);return{db,src,people:r.added}};
const view=async db=>networkView(db,{archived:true});

test('an outreach source is its own type, dated today by default, and the same day gives the same source',async()=>{
 const db=fakeDb();const a=await outreachSource(db,{},T);
 assert.equal(a.type,'outreach');assert.equal(a.when,'2026-10-30');assert.deepEqual(a.checkHours,[24,48,72]);assert.match(a.name,/Oct 30, 2026/);
 assert.equal((await outreachSource(db,{},T)).id,a.id);
 const b=await outreachSource(db,{date:'2026-10-27'},T);assert.notEqual(b.id,a.id);assert.equal(b.when,'2026-10-27');
 await assert.rejects(()=>outreachSource(db,{date:'last week'},T),NetworkError);
 const own=await saveSource(db,{name:'LinkedIn',type:'linkedin'},T);assert.equal(own.type,'linkedin','the old LinkedIn type is untouched');});

test('people added start waiting with the clock at reach-out time; only outreach sources accept them',async()=>{
 const {db,src,people}=await setup();
 assert.ok(people.every(p=>p.sourceId===src.id&&p.outreach.status==='waiting'&&p.outreach.reachedAt===T.toISOString()));
 const old=await outreachSource(db,{date:'2026-10-27'},T);const r=await addOutreachPeople(db,{sourceId:old.id,rows:[{name:'Priya Oak'}]},T);
 assert.equal(r.added[0].outreach.reachedAt,'2026-10-27T12:00:00.000Z');
 const plain=await saveSource(db,{name:'Conf',type:'event'},T);
 await assert.rejects(()=>addOutreachPeople(db,{sourceId:plain.id,rows:[{name:'X Y'}]},T),/outreach source/);
 assert.equal((await view(db)).people.find(p=>p.name==='Dana Whit').followUpAuto,undefined,'no automatic weekly follow-up');});

test('a check-in is due at 24, 48 and 72 hours, earliest unanswered first',async()=>{
 const {src,people}=await setup();const p=people[0];
 assert.equal(dueCheckIn(p,src,after(23)),null);
 assert.equal(dueCheckIn(p,src,after(24)).hour,24);
 assert.equal(dueCheckIn(p,src,after(60)).hour,24,'still the 24h one until answered');
 const p2={...p,outreach:{...p.outreach,answers:[{hour:24}]}};
 assert.equal(dueCheckIn(p2,src,after(60)).hour,48);assert.equal(dueCheckIn(p2,src,after(80)).hour,48);
 assert.equal(dueCheckIn({...p2,outreach:{...p2.outreach,answers:[{hour:24},{hour:48}]}},src,after(80)).last,true);
 assert.equal(dueCheckIn({...p,archived:true},src,after(80)),null);});

test('prompts list who to ask about, and counts summarise the source',async()=>{
 const {db,src}=await setup();const v=await view(db);
 assert.equal(outreachPrompts(v,after(10)).length,0);
 const prompts=outreachPrompts(v,after(25));assert.equal(prompts.length,2);assert.equal(prompts[0].kind,'outreach');assert.match(prompts[0].title,/^Did .+ respond\?$/);assert.equal(prompts[0].hour,24);
 assert.deepEqual(outreachCounts(v.people,src.id),{total:2,waiting:2,accepted:0,replied:0,archived:0});});

test('yes stays: accepted keeps them, replied keeps them and is logged, and no more questions follow',async()=>{
 const {db,src,people}=await setup();
 const a=await answerCheckIn(db,{id:people[0].id,hour:24,accepted:true},after(25));
 assert.equal(a.status,'accepted');assert.equal(a.archived,false);
 const r=await answerCheckIn(db,{id:people[1].id,hour:24,replied:true},after(25));
 assert.equal(r.status,'replied');assert.equal(r.person.history.at(-1).type,'reply');
 const v=await view(db);assert.equal(outreachPrompts(v,after(100)).length,0);
 assert.deepEqual(outreachCounts(v.people,src.id),{total:2,waiting:0,accepted:1,replied:1,archived:0});
 const later=await answerCheckIn(db,{id:people[0].id,hour:48,replied:true},after(50));assert.equal(later.status,'replied','accepted can become replied');});

test('no at 24h and 48h says message again and keeps waiting; no at 72h archives; restore starts over',async()=>{
 const {db,people}=await setup();const id=people[0].id;
 const n1=await answerCheckIn(db,{id,hour:24,sent:true},after(25));
 assert.deepEqual([n1.status,n1.again,n1.archived],['waiting',true,false]);assert.equal(n1.person.history.at(-1).type,'message');assert.ok(n1.person.lastContact);
 const n2=await answerCheckIn(db,{id,hour:48},after(49));assert.deepEqual([n2.status,n2.again],['waiting',true]);
 const n3=await answerCheckIn(db,{id,hour:72},after(73));
 assert.deepEqual([n3.status,n3.again,n3.archived],['archived',false,true]);assert.equal(n3.person.archived,true);
 assert.equal((await networkView(db)).people.some(p=>p.id===id),false,'hidden from the map');
 await restoreOutreach(db,{id},after(80));
 const back=(await networkView(db)).people.find(p=>p.id===id);assert.equal(back.outreach.status,'waiting');assert.deepEqual(back.outreach.answers,[]);
 await assert.rejects(()=>answerCheckIn(db,{id,hour:30}),/not one of/);
 await assert.rejects(()=>answerCheckIn(db,{id:'nobody',hour:24}),NetworkError);});

test('check-in hours are settable per source and the last one decides archiving',async()=>{
 const db=fakeDb();const s=await outreachSource(db,{date:'2026-10-30',name:'Quick batch',checkHours:[12,12,36,'x',0]},T);
 assert.deepEqual(s.checkHours,[12,36]);
 const r=await addOutreachPeople(db,{sourceId:s.id,rows:[{name:'Rhea Pine'}]},T);
 assert.equal(dueCheckIn(r.added[0],s,after(13)).hour,12);
 await answerCheckIn(db,{id:r.added[0].id,hour:12},after(13));
 assert.equal((await answerCheckIn(db,{id:r.added[0].id,hour:36},after(37))).archived,true);});

test('adding through the normal paths to an outreach source starts the clock; the bell lists the questions',async()=>{
 const {addPeople,savePerson}=await import('../scripts/network.mjs');const {listReminders}=await import('../scripts/network-reminders.mjs');
 const db=fakeDb();const src=await outreachSource(db,{},T);
 const bulk=await addPeople(db,{rows:[{name:'Ivy Reed'}],sourceId:src.id},T);assert.equal(bulk.added[0].outreach.status,'waiting');
 const one=await savePerson(db,{name:'Omar Lee',sourceId:src.id,role:'Recruiter'},T);assert.equal(one.outreach.reachedAt,T.toISOString());
 const other=await saveSource(db,{name:'Conf',type:'event'},T);assert.equal((await savePerson(db,{name:'Zed Kim',sourceId:other.id},T)).outreach,undefined);
 assert.equal((await listReminders(db,{now:after(10)})).reminders.filter(r=>r.kind==='outreach').length,0);
 const r=(await listReminders(db,{now:after(25)})).reminders.filter(x=>x.kind==='outreach');
 assert.equal(r.length,2);assert.match(r[0].key,/^outreach:/);});

test('push: one "did they respond?" per person and hour, held overnight, retried when nothing got through, none after an answer',async()=>{
 const {runOutreachAlerts}=await import('../scripts/network-reminders.mjs');
 const env={NTFY_TOPIC:'t'};const db=fakeDb();
 const src=await outreachSource(db,{},T);const r=await addOutreachPeople(db,{sourceId:src.id,rows:[{name:'Dana Whit'},{name:'Marco Lind'}]},T);
 const sent=[];const publish=async m=>{sent.push(m);return true};
 // 24h after 11:00 New York = 11:00 next day; before 8:00 New York nothing goes out.
 assert.deepEqual(await runOutreachAlerts({db,now:after(10),publish,env}),[]);
 assert.deepEqual(await runOutreachAlerts({db,now:new Date('2026-10-31T11:30:00Z'),publish,env}),[],'7:30 New York: held');
 const first=await runOutreachAlerts({db,now:after(25),publish,env});assert.equal(first.length,2);assert.equal(sent.length,1);assert.match(sent[0].message,/^2 LinkedIn reach-outs/);
 assert.deepEqual(await runOutreachAlerts({db,now:after(26),publish,env}),[],'once per person and hour');
 // a failed send is undone and tried again
 const fails=async()=>false;assert.deepEqual(await runOutreachAlerts({db,now:after(49),publish:fails,env}),[]);
 await answerCheckIn(db,{id:r.added[0].id,hour:24,accepted:true},after(30));
 const again=await runOutreachAlerts({db,now:after(49),publish,env});assert.deepEqual(again.map(a=>[a.id,a.hour]),[[r.added[1].id,48]],'accepted people are never asked again');
 // web push names the person and says to message again from the second check on
 const web=[];const wp=async(d,m)=>{web.push(m);return{sent:1,failed:0}};
 const env2={VAPID_PUBLIC_KEY:'a',VAPID_PRIVATE_KEY:'b',VAPID_SUBJECT:'mailto:x@example.test',PUSH_EVENT_USER_ID:'u'};
 await runOutreachAlerts({db,now:after(73),webPush:wp,env:env2});
 assert.equal(web[0].title,'Did Marco Lind respond?');assert.match(web[0].body,/archived/);assert.match(web[0].url,/^\/network\?person=/);
 assert.deepEqual(await runOutreachAlerts({db,now:after(73),env:{}}),[],'off without a channel');});
