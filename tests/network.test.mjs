import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';
import {saveYou,addFromLinkedIn,sortLinkedInByDay,parseContacts,csvRows,previewContacts,savePositions,parseList,previewList,addPeople,savePerson,logHistory,removeHistory,archivePerson,saveSource,removeSource,saveLink,removeLink,networkView,NetworkError} from '../scripts/network.mjs';
import {handleNetwork} from '../scripts/network-routes.mjs';

// An in-memory stand-in for the three collections, with just the calls the store makes. Every name here is invented.
const fakeDb=()=>{const cols=new Map();const col=n=>{if(!cols.has(n))cols.set(n,new Map());const m=cols.get(n);const clone=d=>structuredClone(d);return{
 find:()=>({toArray:async()=>[...m.values()].map(clone)}),findOne:async q=>m.has(q._id)?clone(m.get(q._id)):null,
 insertOne:async d=>{m.set(d._id,clone(d))},insertMany:async ds=>{for(const d of ds)m.set(d._id,clone(d))},
 updateOne:async(q,u,o)=>{if(m.has(q._id))m.set(q._id,{...m.get(q._id),...clone(u.$set)});else if(o?.upsert)m.set(q._id,{_id:q._id,...clone(u.$set)})},deleteOne:async q=>({deletedCount:m.delete(q._id)?1:0})}};return{collection:col,cols}};
const T=new Date('2026-10-28T15:00:00Z');

test('a pasted list: bullets and numbers go, text after a dash is the city, repeats are marked, junk lines are skipped',()=>{
 const rows=parseList('Karyn Ellis\n• Shawn Park\n3. Rebeka Pine - Durham, North Carolina\n\n---\n12345\nshawn park\nMatt Ant\tAustin, TX\n'+'x'.repeat(260));
 assert.deepEqual(rows.map(r=>[r.name,r.city,r.repeat]),[['Karyn Ellis','',false],['Shawn Park','',false],['Rebeka Pine','Durham, North Carolina',false],['shawn park','',true],['Matt Ant','Austin, TX',false]]);
 assert.equal(parseList('a\n'.repeat(900)).length,500,'one paste holds at most 500 rows');});

test('bulk add puts new names in one source, creates the source once, and skips names already in your network',async()=>{
 const db=fakeDb();
 const first=await addPeople(db,{rows:parseList('Dana Whit\nMarco Lind - Durham, NC'),newSource:{name:'Northwind Staffing',type:'company'}},T);
 assert.equal(first.added.length,2);assert.equal(first.added[1].city,'Durham, NC');assert.ok(first.sourceId);
 assert.ok(first.added.every(p=>p.sourceId===first.sourceId&&p.lastContact===null&&p.archived===false));
 const again=await addPeople(db,{rows:parseList('dana whit\nPriya Oak\nPriya Oak'),newSource:{name:'northwind staffing'}},T);
 assert.deepEqual(again.skipped,['dana whit','Priya Oak'],'already there, and a repeat inside the list');
 assert.equal(again.sourceId,first.sourceId,'the same source name is the same source');
 const v=await networkView(db);assert.equal(v.people.length,3);assert.equal(v.sources.length,1);
 const prev=await previewList(db,'Dana Whit\nNew Person');assert.deepEqual(prev.map(r=>r.exists),[true,false]);
 await assert.rejects(()=>addPeople(db,{rows:[]}),NetworkError);
 await assert.rejects(()=>addPeople(db,{rows:[{name:'A B'}],sourceId:'gone'}),/no longer exists/);});

test('a person: create, change only what is sent, and reject bad emails, links, dates, colours and self-introductions',async()=>{
 const db=fakeDb();const src=await saveSource(db,{name:'Family',type:'family'},T);
 const raj=await savePerson(db,{name:'Uncle Ravi',sourceId:src.id,role:'Family friend'},T);
 const nisha=await savePerson(db,{name:'Nila Rao',via:raj.id,email:' Nila@Example.TEST ',linkedin:'linkedin.com/in/nila'},T);
 assert.equal(nisha.email,'nila@example.test');assert.equal(nisha.linkedin,'https://linkedin.com/in/nila');assert.equal(nisha.via,raj.id);
 const changed=await savePerson(db,{id:nisha.id,city:'Chicago, IL',nextFollowUp:'2026-11-04',color:'#FF0066',tags:['warm','warm','',' referral ']},T);
 assert.equal(changed.city,'Chicago, IL');assert.equal(changed.email,'nila@example.test','fields not sent stay');assert.equal(changed.color,'#ff0066');assert.deepEqual(changed.tags,['warm','referral']);
 await assert.rejects(()=>savePerson(db,{id:nisha.id,email:'nope'}),/not an email/);
 await assert.rejects(()=>savePerson(db,{id:nisha.id,nextFollowUp:'next week'}),/date like/);
 await assert.rejects(()=>savePerson(db,{id:nisha.id,color:'red'}),/colour/);
 await assert.rejects(()=>savePerson(db,{id:nisha.id,via:nisha.id}),/introduce themselves/);
 await assert.rejects(()=>savePerson(db,{id:nisha.id,linkedin:'javascript:alert(1)'}),/not a link/);
 await assert.rejects(()=>savePerson(db,{name:'  '}),/needs a name/);
 await assert.rejects(()=>savePerson(db,{id:'gone',city:'x'}),/no longer in your network/);});

test('history: contact moves last contact forward, a plain note does not, removing an entry recomputes it',async()=>{
 const db=fakeDb();const p=await savePerson(db,{name:'Ben Cart'},T);
 let r=await logHistory(db,{id:p.id,type:'note',text:'Prefers short emails'},T);assert.equal(r.lastContact,null);
 r=await logHistory(db,{id:p.id,type:'email',text:'Sent resume',at:'2026-10-20T10:00:00Z'},T);assert.equal(r.lastContact,'2026-10-20T10:00:00.000Z');
 r=await logHistory(db,{id:p.id,type:'call',at:'2026-10-25T10:00:00Z'},T);assert.equal(r.lastContact,'2026-10-25T10:00:00.000Z');
 r=await logHistory(db,{id:p.id,type:'message',at:'2026-10-01T10:00:00Z'},T);assert.equal(r.lastContact,'2026-10-25T10:00:00.000Z','an older entry does not move it back');
 assert.deepEqual(r.history.map(h=>h.type),['message','email','call','note'],'kept in date order');
 const call=r.history.find(h=>h.type==='call');r=await removeHistory(db,{id:p.id,entryId:call.id},T);assert.equal(r.lastContact,'2026-10-20T10:00:00.000Z');
 await assert.rejects(()=>logHistory(db,{id:p.id,type:'tweet'}),/Pick what happened/);
 await assert.rejects(()=>logHistory(db,{id:p.id,type:'note',text:' '}),/Write the note/);});

test('archive hides a person, restore brings them back; removing a source keeps its people',async()=>{
 const db=fakeDb();const s=await saveSource(db,{name:'Event Day',type:'event'},T);const p=await savePerson(db,{name:'Ivy Tan',sourceId:s.id},T);
 await archivePerson(db,{id:p.id});assert.equal((await networkView(db)).people.length,0);assert.equal((await networkView(db,{archived:true})).people.length,1);
 await archivePerson(db,{id:p.id,archived:false});assert.equal((await networkView(db)).people.length,1);
 await saveLink(db,{a:p.id,b:s.id,kind:'other',label:'spoke on stage'},T);
 assert.deepEqual(await removeSource(db,{id:s.id},T),{id:s.id,released:1});
 const v=await networkView(db);assert.equal(v.people[0].sourceId,null);assert.equal(v.sources.length,0);assert.equal(v.links.length,0,'links to the source go too');});

test('sources: unique names, a type from the list, renames cannot clash',async()=>{
 const db=fakeDb();const a=await saveSource(db,{name:'Randall Co',type:'company'},T);
 const again=await saveSource(db,{name:' randall co '},T);assert.equal(again.id,a.id);assert.equal(again.existed,true,'the page can say it already existed');
 assert.equal((await saveSource(db,{name:'Odd',type:'planet'},T)).type,'other');
 await assert.rejects(()=>saveSource(db,{id:a.id,name:'odd'}),/already have a source called Odd/);
 assert.equal((await saveSource(db,{id:a.id,about:'staffing',color:'#60A5FA'},T)).color,'#60a5fa');
 await assert.rejects(()=>saveSource(db,{name:''}),/Give the source a name/);});

test('links: one per pair in either direction, both ends must exist, no self links; remove works once',async()=>{
 const db=fakeDb();const a=await savePerson(db,{name:'Ann Lee'},T),b=await savePerson(db,{name:'Bo Kim'},T);
 const l=await saveLink(db,{a:a.id,b:b.id,kind:'intro',label:'introduced'},T);
 const same=await saveLink(db,{a:b.id,b:a.id,kind:'family',label:'cousins',color:'#123456'},T);
 assert.equal(same.id,l.id);assert.equal(same.kind,'family');assert.equal((await networkView(db)).links.length,1);
 assert.equal((await saveLink(db,{a:a.id,b:'zzz'}).catch(e=>e.message)),'One of them is no longer in your network. Reload the page.');
 await assert.rejects(()=>saveLink(db,{a:a.id,b:a.id}),/two different people/);
 assert.equal((await saveLink(db,{id:l.id,kind:'weird'},T)).kind,'other');
 await removeLink(db,{id:l.id});await assert.rejects(()=>removeLink(db,{id:l.id}),/no longer exists/);});

// The routes, with a request object like Node's: GET reads, POST writes, anything else is a 404, and store errors come back as 400.
const call=async(db,method,path,body)=>{const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);req.method=method;
 const res={code:0,body:'',writeHead(c){this.code=c},end(b){this.body=b}};const handled=await handleNetwork(req,res,new URL(path,'http://x'),{withDb:fn=>fn(db)});return{handled,code:res.code,json:res.body?JSON.parse(res.body):null}};
test('routes: read, preview, bulk add, a store error, unknown paths, and other prefixes left alone',async()=>{
 const db=fakeDb();
 assert.equal((await call(db,'GET','/networking')).handled,false);
 let r=await call(db,'POST','/network/preview',{text:'Ann Lee\nBo Kim - Austin'});assert.equal(r.code,200);assert.equal(r.json.rows[1].city,'Austin');
 r=await call(db,'POST','/network/people',{rows:r.json.rows,newSource:{name:'Meetup',type:'event'}});assert.equal(r.json.added.length,2);
 r=await call(db,'GET','/network');assert.equal(r.json.people.length,2);assert.equal(r.json.sources[0].name,'Meetup');
 r=await call(db,'POST','/network/person',{id:'gone',city:'x'});assert.equal(r.code,400);assert.match(r.json.error,/no longer in your network/);
 assert.equal((await call(db,'DELETE','/network')).code,404);assert.equal((await call(db,'POST','/network/everything',{})).code,404);
 const none=await (async()=>{const req=Readable.from([]);req.method='GET';const res={writeHead(c){this.code=c},end(b){this.body=b}};await handleNetwork(req,res,new URL('/network','http://x'),{withDb:null});return res})();
 assert.equal(none.code,400);assert.match(JSON.parse(none.body).error,/MONGO_URI/);});

test('positions: people, sources and "you" keep where you dragged them; unknown ids are skipped; bad numbers are refused',async()=>{
 const db=fakeDb();const s=await saveSource(db,{name:'Expo',type:'event'},T);const p=await savePerson(db,{name:'Cy Ro',sourceId:s.id},T);
 assert.deepEqual([(await networkView(db)).you.x,(await networkView(db)).you.y],[0,0]);
 assert.deepEqual(await savePositions(db,{items:[{id:p.id,x:120.04,y:-40},{id:s.id,x:300,y:5},{id:'you',x:-10,y:20},{id:'gone',x:1,y:1}]}),{saved:3});
 const v=await networkView(db);assert.deepEqual([v.people[0].x,v.people[0].y],[120,-40]);assert.deepEqual([v.sources[0].x,v.sources[0].y],[300,5]);assert.deepEqual([v.you.x,v.you.y],[-10,20]);
 await assert.rejects(()=>savePositions(db,{items:[{id:p.id,x:'left',y:0}]}),/must be a number/);
 await assert.rejects(()=>savePositions(db,{items:[]}),/Nothing to save/);
 await savePositions(db,{items:[{id:p.id,x:9e9,y:-9e9}]});const far=(await networkView(db)).people[0];assert.deepEqual([far.x,far.y],[100000,-100000]);});

test('photos and "works at": a photo must be uploaded first; replacing or removing one drops the old bytes',async()=>{
 const db=fakeDb();const p=await savePerson(db,{name:'Pia Lo',company:'  Northwind   Labs '},T);assert.equal(p.company,'Northwind Labs');assert.equal(p.photoId,null);assert.equal(p.watchJobs,false);
 await assert.rejects(()=>savePerson(db,{id:p.id,photoId:'nope'}),/Upload the photo first/);
 await db.collection('network_images').insertOne({_id:'img1'});await db.collection('network_images').insertOne({_id:'img2'});
 assert.equal((await savePerson(db,{id:p.id,photoId:'img1'},T)).photoId,'img1');
 await savePerson(db,{id:p.id,photoId:'img2'},T);assert.equal(await db.collection('network_images').findOne({_id:'img1'}),null,'old photo removed');
 await savePerson(db,{id:p.id,photoId:null},T);assert.equal(await db.collection('network_images').findOne({_id:'img2'}),null);
 assert.equal((await savePerson(db,{id:p.id,watchJobs:1},T)).watchJobs,true);});

test('contacts files: LinkedIn connections (notes above the header) and Google exports, quotes and commas inside cells, duplicates',()=>{
 const li='Notes:\n"When exporting your connection data, you may notice..."\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nDana,Whit,https://www.linkedin.com/in/dana-w,,"Northwind, Inc.",Senior Recruiter,12 Oct 2026\nBo,Kim,https://www.linkedin.com/in/bo,bo@example.test,Acme,"Engineer, ""Platform""",01 Jan 2026\nDana,Whit,https://www.linkedin.com/in/dana-w,,"Northwind, Inc.",Senior Recruiter,12 Oct 2026\n';
 const a=parseContacts(li);assert.equal(a.format,'linkedin');
 assert.deepEqual(a.rows.map(r=>[r.name,r.company,r.role,r.email,r.linkedin]),[['Dana Whit','Northwind, Inc.','Senior Recruiter','','https://www.linkedin.com/in/dana-w'],['Bo Kim','Acme','Engineer, "Platform"','bo@example.test','https://www.linkedin.com/in/bo']]);
 const g='\uFEFFFirst Name,Middle Name,Last Name,E-mail 1 - Label,E-mail 1 - Value,Phone 1 - Value,Organization Name,Organization Title\r\nAnn,,Lee,* Home,ann@example.test,+1 555 0100,Expo Co,Organizer\r\n,,,,,,,\r\n';
 const b=parseContacts(g);assert.equal(b.format,'google');assert.deepEqual(b.rows,[{name:'Ann Lee',email:'ann@example.test',phone:'+1 555 0100',company:'Expo Co',role:'Organizer',city:'',linkedin:''}]);
 assert.deepEqual(csvRows('a,"b\nc",d'),[['a','b\nc','d']]);
 assert.throws(()=>parseContacts('foo,bar\n1,2'),/no name column/);});

test('importing contacts: details come along, people already here (by name or email) are skipped, a bad link is just left out',async()=>{
 const db=fakeDb();await savePerson(db,{name:'Bo Kim',email:'bo@example.test'},T);
 const prev=await previewContacts(db,'First Name,Last Name,Email Address,Company,Position,URL\nBo,K,bo@example.test,Acme,Engineer,\nAnn,Lee,ann@example.test,Expo Co,Organizer,javascript:alert(1)\n');
 assert.deepEqual(prev.rows.map(r=>r.exists),[true,false],'same email counts as already here');
 const r=await addPeople(db,{rows:prev.rows,newSource:{name:'LinkedIn connections',type:'other'}},T);
 assert.deepEqual(r.skipped,['Bo K']);const ann=r.added[0];assert.deepEqual([ann.email,ann.company,ann.role,ann.linkedin],['ann@example.test','Expo Co','Organizer','']);});

test('from a LinkedIn profile: added once, to that day card under LinkedIn; found again by profile link or name; gaps filled, nothing overwritten',async()=>{
 const db=fakeDb();
 const a=await addFromLinkedIn(db,{name:'Dana Whit',role:'Senior Recruiter',company:'Randstad',city:'Raleigh, NC',linkedin:'https://ca.linkedin.com/in/dana-whit/details/experience?x=1'},T);
 assert.equal(a.existed,false);assert.equal(a.person.linkedin,'https://www.linkedin.com/in/dana-whit/');assert.equal(a.person.company,'Randstad');assert.equal(a.person.history[0].text,'Added from LinkedIn');
 const v0=await networkView(db),root=v0.sources.find(x=>x.name==='LinkedIn'),day=v0.sources.find(x=>x.id===a.person.sourceId);
 assert.deepEqual([day.name,day.parentSourceId,day.when],['Oct 28, 2026',root.id,'2026-10-28'],'You, LinkedIn, the day, the person');
 const b=await addFromLinkedIn(db,{name:'Dana W.',role:'Lead Recruiter',linkedin:'https://www.linkedin.com/in/Dana-Whit'},T);assert.equal(b.existed,true);assert.equal(b.person.id,a.person.id);assert.equal(b.person.role,'Senior Recruiter','not overwritten');
 const c=await savePerson(db,{name:'Bo Kim'},T);const d=await addFromLinkedIn(db,{name:'bo kim',company:'Acme',linkedin:'https://www.linkedin.com/in/bokim'},T);
 assert.equal(d.person.id,c.id);assert.equal(d.person.company,'Acme','a gap is filled');assert.equal(d.person.linkedin,'https://www.linkedin.com/in/bokim/');
 await assert.rejects(()=>addFromLinkedIn(db,{name:'X Y',linkedin:'https://www.linkedin.com/company/acme'}),/not a LinkedIn profile/);
 await assert.rejects(()=>addFromLinkedIn(db,{name:'',linkedin:'https://www.linkedin.com/in/x'}),/No name/);
 assert.equal((await networkView(db)).people.length,2);});

test('same-name sources stay separate by origin/context; staffing and parent validation preserve people', async () => {
 const db=fakeDb();
 const event=await saveSource(db,{name:'Open Summit',type:'event'},T);
 const direct=await saveSource(db,{name:'Northwind Staffing',type:'staffing'},T);
 const introduced=await saveSource(db,{name:'Northwind Staffing',type:'staffing',parentSourceId:event.id},T);
 assert.notEqual(direct.id,introduced.id);assert.equal(introduced.parentSourceId,event.id);assert.equal(introduced.type,'staffing');
 const repeat=await saveSource(db,{name:' northwind staffing ',type:'staffing',parentSourceId:event.id},T);
 assert.equal(repeat.id,introduced.id);assert.equal(repeat.existed,true);
 const another=await saveSource(db,{name:'Northwind Staffing',type:'staffing',context:'Reached out last year'},T);
 assert.notEqual(another.id,direct.id);
 const first=await savePerson(db,{name:'Ari Vale',sourceId:direct.id},T);
 const second=await savePerson(db,{name:'Noa Reed',sourceId:introduced.id},T);
 await logHistory(db,{id:second.id,type:'met',text:'Met at Open Summit'},T);
 await assert.rejects(()=>saveSource(db,{id:event.id,parentSourceId:introduced.id}),/descendants/);
 await assert.rejects(()=>saveSource(db,{id:introduced.id,parentSourceId:introduced.id}),/itself/);
 await assert.rejects(()=>saveSource(db,{name:'Missing origin',parentSourceId:'missing'}),/no longer exists/);
 await assert.rejects(()=>saveSource(db,{id:introduced.id,parentSourceId:null}),/in that context/);
 let view=await networkView(db);assert.equal(view.people.find(p=>p.id===first.id).history.length,0);assert.equal(view.people.find(p=>p.id===second.id).history.length,1);
 await removeSource(db,{id:event.id},T);
 view=await networkView(db);const child=view.sources.find(s=>s.id===introduced.id);
 assert.equal(child.parentSourceId,null);assert.equal(child.context,'Via Open Summit');assert.equal(view.people.find(p=>p.id===second.id).sourceId,introduced.id);
 assert.ok(view.sources.some(s=>s.id===direct.id),'the independent same-name record remains');
});

test('a source introduced by a person: the person is kept, a source has one way in, loops are refused, the same name through someone else is a new record',async()=>{
 const db=fakeDb();const fam=await saveSource(db,{name:'Kasliwal',type:'family'},T);
 const chani=await savePerson(db,{name:'Chani Jain',sourceId:fam.id,company:'NKHS'},T);
 const nkhs=await saveSource(db,{name:'NKHS',type:'company',viaPersonId:chani.id},T);assert.equal(nkhs.viaPersonId,chani.id);assert.equal(nkhs.parentSourceId,null);
 const direct=await saveSource(db,{name:'NKHS',type:'company'},T);assert.notEqual(direct.id,nkhs.id,'found yourself is another record');assert.equal(direct.existed,undefined);
 assert.equal((await saveSource(db,{name:'nkhs',viaPersonId:chani.id},T)).existed,true,'same name through the same person is the same source');
 const a=await savePerson(db,{name:'Ann Lee',sourceId:nkhs.id},T);assert.equal(a.via,null,'belongs to the company, not through Chani');
 await assert.rejects(()=>savePerson(db,{id:chani.id,sourceId:nkhs.id}),/introduced NKHS, so they cannot belong to it/);
 const sub=await saveSource(db,{name:'NKHS Labs',parentSourceId:nkhs.id},T);
 await assert.rejects(()=>savePerson(db,{id:chani.id,sourceId:sub.id}),/introduced NKHS/,'nor to a source below it');
 await assert.rejects(()=>saveSource(db,{id:fam.id,viaPersonId:chani.id}),/belongs to Kasliwal, so they cannot be the one who introduced it/);
 const moved=await saveSource(db,{id:nkhs.id,parentSourceId:fam.id},T);assert.equal(moved.viaPersonId,null,'one way in: a parent source replaces the person');
 assert.equal((await saveSource(db,{id:nkhs.id,viaPersonId:chani.id},T)).parentSourceId,null,'and the other way round');
 await assert.rejects(()=>saveSource(db,{name:'X',viaPersonId:'gone'}),/not in your network/);});

test('introduced by more than one person: the first decides colour and place, the rest are kept; no repeats, no self, all must exist',async()=>{
 const db=fakeDb();const a=await savePerson(db,{name:'Pri K'},T),b=await savePerson(db,{name:'Ani K'},T),c=await savePerson(db,{name:'Raj K'},T);
 const p=await savePerson(db,{name:'Arp T',via:a.id},T);
 const two=await savePerson(db,{id:p.id,alsoVia:[b.id,b.id,a.id,c.id]},T);assert.equal(two.via,a.id);assert.deepEqual(two.alsoVia,[b.id,c.id],'the first is not repeated');
 const promoted=await savePerson(db,{id:p.id,via:null},T);assert.equal(promoted.via,b.id,'removing the first moves the next one up');assert.deepEqual(promoted.alsoVia,[c.id]);
 await assert.rejects(()=>savePerson(db,{id:p.id,alsoVia:[p.id]}),/introduce themselves/);
 await assert.rejects(()=>savePerson(db,{id:p.id,alsoVia:['gone']}),/not in your network/);});

test('"You" and sources: a name, a title, a note, a photo or logo; old pictures are removed when replaced',async()=>{
 const db=fakeDb();
 assert.deepEqual((await networkView(db)).you,{x:0,y:0,name:'',title:'',photoId:null,note:''});
 await db.collection('network_images').insertOne({_id:'me1'});await db.collection('network_images').insertOne({_id:'me2'});
 const y=await saveYou(db,{name:' Alex  Rivera ',title:'Data engineer, open to roles',note:'Finishing a master\'s in May.',photoId:'me1'});
 assert.deepEqual([y.name,y.title,y.photoId],['Alex Rivera','Data engineer, open to roles','me1']);
 await savePositions(db,{items:[{id:'you',x:5,y:6}]});const v=(await networkView(db)).you;assert.deepEqual([v.x,v.y,v.name],[5,6,'Alex Rivera'],'moving you keeps the rest');
 await saveYou(db,{photoId:'me2'});assert.equal(await db.collection('network_images').findOne({_id:'me1'}),null);
 await assert.rejects(()=>saveYou(db,{photoId:'nope'}),/Upload the photo/);
 const s=await saveSource(db,{name:'Randall Co',type:'company'},T);await db.collection('network_images').insertOne({_id:'logo1'});
 const s2=await saveSource(db,{id:s.id,photoId:'logo1',notes:'Their recruiters answer on Tuesdays.'},T);assert.deepEqual([s2.photoId,s2.notes],['logo1','Their recruiters answer on Tuesdays.']);
 await saveSource(db,{id:s.id,photoId:null},T);assert.equal(await db.collection('network_images').findOne({_id:'logo1'}),null);
 await assert.rejects(()=>saveSource(db,{id:s.id,photoId:'zzz'}),/Upload the picture/);});

test('a source can say where it is and, for an event, when',async()=>{
 const db=fakeDb();const s=await saveSource(db,{name:'Open Summit',type:'event',place:'  Raleigh,   NC ',when:'Oct 2024'},T);
 assert.deepEqual([s.place,s.when],['Raleigh, NC','Oct 2024']);assert.equal((await saveSource(db,{id:s.id,place:''},T)).place,'');});

test('a source reached you more than once: the main introducer with a year, and others (people or sources) with theirs',async()=>{
 const db=fakeDb();const uncle=await savePerson(db,{name:'Uncle Ravi'},T);const ato=await saveSource(db,{name:'All Things Open',type:'event'},T);
 const rh=await saveSource(db,{name:'Red Hat',type:'company',viaPersonId:uncle.id,introYear:'2024',alsoVia:[{id:ato.id,year:'2026'},{id:ato.id,year:'2027'},{id:uncle.id,year:'2024'}]},T);
 assert.deepEqual([rh.viaPersonId,rh.introYear,rh.alsoVia],[uncle.id,'2024',[{id:ato.id,year:'2026'}]],'no repeats, and the main introducer is not listed twice');
 await assert.rejects(()=>saveSource(db,{id:rh.id,introYear:'24'},T),/four digits/);
 await assert.rejects(()=>saveSource(db,{id:rh.id,alsoVia:[{id:rh.id}]},T),/introduce itself/);
 await assert.rejects(()=>saveSource(db,{id:rh.id,alsoVia:[{id:'gone'}]},T),/no longer in your network/);
 assert.deepEqual((await saveSource(db,{id:rh.id,alsoVia:[]},T)).alsoVia,[]);});

test('LinkedIn by day: one card per New York day under LinkedIn, reused all day; people already on LinkedIn are sorted into their days',async()=>{
 const db=fakeDb();
 const late=new Date('2026-10-29T03:30:00Z');// still Oct 28 in New York
 const a=await addFromLinkedIn(db,{name:'Ann Lee',linkedin:'https://www.linkedin.com/in/ann'},T);const b=await addFromLinkedIn(db,{name:'Ben Ode',linkedin:'https://www.linkedin.com/in/ben'},late);
 const c=await addFromLinkedIn(db,{name:'Cy Park',linkedin:'https://www.linkedin.com/in/cy'},new Date('2026-10-29T15:00:00Z'));
 assert.equal(a.person.sourceId,b.person.sourceId,'the same New York day is the same card');assert.notEqual(a.person.sourceId,c.person.sourceId);
 let v=await networkView(db);assert.deepEqual(v.sources.map(s=>s.name).sort(),['LinkedIn','Oct 28, 2026','Oct 29, 2026']);
 const root=v.sources.find(s=>s.name==='LinkedIn');
 const old=await savePerson(db,{name:'Old Contact',sourceId:root.id},new Date('2026-10-20T15:00:00Z'));
 const kid=await savePerson(db,{name:'Their Friend',sourceId:root.id,via:old.id},T);
 assert.deepEqual(await sortLinkedInByDay(db,T),{moved:1,days:1});
 v=await networkView(db);const oldDay=v.sources.find(s=>s.id===v.people.find(p=>p.id===old.id).sourceId);
 assert.deepEqual([oldDay.name,oldDay.parentSourceId],['Oct 20, 2026',root.id]);
 assert.equal(v.people.find(p=>p.id===kid.id).sourceId,root.id,'someone introduced by a person is left where they are');
 assert.deepEqual(await sortLinkedInByDay(db,T),{moved:0,days:0});});

test('confirming a company keeps its card and people in place; custom maps keep separate positions',async()=>{
 const db=fakeDb();const person=await savePerson(db,{name:'Mira Chen',company:'Orchid'},T);
 const body={name:'Orchid',type:'company',position:{x:920,y:180},positions:[{id:person.id,x:730,y:200}]};
 const created=await call(db,'POST','/network/source',body);assert.equal(created.code,200);
 const v=await networkView(db);assert.equal(v.sources[0].x,920);assert.equal(v.sources[0].y,180);assert.equal(v.people[0].x,730);
 const again=await call(db,'POST','/network/source',{...body,position:{x:0,y:0}});assert.equal(again.json.source.id,created.json.source.id);assert.equal((await networkView(db)).sources[0].x,920,'reusing a source preserves its saved position');
 await db.collection('network_maps').insertOne({_id:'map-a',name:'My map'});
 const custom=await call(db,'POST','/network/source',{...body,name:'Another company',mapId:'map-a',position:{x:1100,y:300}});assert.equal(custom.code,200);
 const card=await db.collection('network_map_cards').findOne({_id:`map-a:${custom.json.source.id}`});assert.deepEqual([card.x,card.y],[1100,300]);
 const global=await db.collection('network_sources').findOne({_id:custom.json.source.id});assert.equal(global.x,undefined,'custom map coordinates do not change main');
 assert.equal((await networkView(db)).people[0].x,730);
});
