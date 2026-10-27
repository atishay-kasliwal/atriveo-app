import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {PROFILE_DEFAULTS,PROFILE_FIELDS,sanitizeProfile} from '../scripts/resume-profile.mjs';
import {profileFields} from '../scripts/application-kit.mjs';

test('the website is part of the profile: a default, a saved override, and a Website field for the companion',()=>{
 assert.equal(PROFILE_DEFAULTS.portfolio,'https://atishaykasliwal.com');assert.ok(PROFILE_FIELDS.includes('portfolio'));
 assert.deepEqual(sanitizeProfile({portfolio:' https://example.test/me ',unknown:'x'}),{portfolio:'https://example.test/me'});
 const field=profileFields({...PROFILE_DEFAULTS,name:'Pat Example'}).find(f=>f.key==='portfolio');
 assert.deepEqual(field,{key:'portfolio',label:'Website',value:'https://atishaykasliwal.com'});
});
test('a profile file without a website still gets the default one',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'profile-'));const file=path.join(dir,'resume-profile.json');
 fs.writeFileSync(file,JSON.stringify({email:'me@example.test'}));process.env.RESUME_PROFILE_PATH=file;
 const {loadResumeProfile}=await import('../scripts/resume-profile.mjs?fresh='+Date.now());
 assert.equal(loadResumeProfile().portfolio,'https://atishaykasliwal.com');assert.equal(loadResumeProfile().email,'me@example.test');
 delete process.env.RESUME_PROFILE_PATH;fs.rmSync(dir,{recursive:true,force:true});
});
