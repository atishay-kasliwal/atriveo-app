import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';
import {addFromLinkedIn,parseContacts,csvRows,previewContacts,savePositions,parseList,previewList,addPeople,savePerson,logHistory,removeHistory,archivePerson,saveSource,removeSource,saveLink,removeLink,networkView,NetworkError} from '../scripts/network.mjs';
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
 assert.deepEqual((await networkView(db)).you,{x:0,y:0});
 assert.deepEqual(await savePositions(db,{items:[{id:p.id,x:120.04,y:-40},{id:s.id,x:300,y:5},{id:'you',x:-10,y:20},{id:'gone',x:1,y:1}]}),{saved:3});
 const v=await networkView(db);assert.deepEqual([v.people[0].x,v.people[0].y],[120,-40]);assert.deepEqual([v.sources[0].x,v.sources[0].y],[300,5]);assert.deepEqual(v.you,{x:-10,y:20});
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

test('from a LinkedIn profile: added once to a LinkedIn source; found again by profile link or name; gaps filled, nothing overwritten',async()=>{
 const db=fakeDb();
 const a=await addFromLinkedIn(db,{name:'Dana Whit',role:'Senior Recruiter',company:'Randstad',city:'Raleigh, NC',linkedin:'https://ca.linkedin.com/in/dana-whit/details/experience?x=1'},T);
 assert.equal(a.existed,false);assert.equal(a.person.linkedin,'https://www.linkedin.com/in/dana-whit/');assert.equal(a.person.company,'Randstad');assert.equal(a.person.history[0].text,'Added from LinkedIn');
 const src=(await networkView(db)).sources[0];assert.equal(src.name,'LinkedIn');assert.equal(a.person.sourceId,src.id);
 const b=await addFromLinkedIn(db,{name:'Dana W.',role:'Lead Recruiter',linkedin:'https://www.linkedin.com/in/Dana-Whit'},T);assert.equal(b.existed,true);assert.equal(b.person.id,a.person.id);assert.equal(b.person.role,'Senior Recruiter','not overwritten');
 const c=await savePerson(db,{name:'Bo Kim'},T);const d=await addFromLinkedIn(db,{name:'bo kim',company:'Acme',linkedin:'https://www.linkedin.com/in/bokim'},T);
 assert.equal(d.person.id,c.id);assert.equal(d.person.company,'Acme','a gap is filled');assert.equal(d.person.linkedin,'https://www.linkedin.com/in/bokim/');
 await assert.rejects(()=>addFromLinkedIn(db,{name:'X Y',linkedin:'https://www.linkedin.com/company/acme'}),/not a LinkedIn profile/);
 await assert.rejects(()=>addFromLinkedIn(db,{name:'',linkedin:'https://www.linkedin.com/in/x'}),/No name/);
 assert.equal((await networkView(db)).people.length,2);});
