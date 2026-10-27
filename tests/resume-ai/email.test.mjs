import test from 'node:test';import assert from 'node:assert/strict';
import {setResumeEmail} from '../../scripts/resume-builder.mjs';
test('the resume email is validated before anything is read or rebuilt',async()=>{
 const db={collection(){throw new Error('the database must not be touched');}};
 await assert.rejects(()=>setResumeEmail(db,{jobUrl:'https://jobs.example.test/1',email:'not an email'}),/isn't an email address/);
 await assert.rejects(()=>setResumeEmail(db,{jobUrl:'https://jobs.example.test/1',email:''}),/isn't an email address/);
 await assert.rejects(()=>setResumeEmail(db,{jobUrl:'javascript:alert(1)',email:'a@b.co'}),/Open a job first/);
 await assert.rejects(()=>setResumeEmail(db,{email:'a@b.co'}),/Open a job first/);
});
