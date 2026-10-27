import test from 'node:test';import assert from 'node:assert/strict';
import {employerTools} from '../scripts/ac-skills.mjs';
import {loadBank} from '../scripts/ac-bank.mjs';

const bank=loadBank();
test('an employer line has at least five tools, the JD\'s first, and only tools used at that employer',()=>{
 const narrow='We need strong SQL and PostgreSQL experience. Forward deployed engineer working with customers.';
 for(const role of ['stony-brook','accolite','wake-forest']){
  const tools=employerTools(role,narrow,bank);
  assert.ok(tools.length>=5,`${role}: ${tools.join(', ')}`);
  assert.equal(new Set(tools.map(t=>t.toLowerCase())).size,tools.length,'no duplicates');
  assert.ok(tools.slice(0,2).every(t=>/sql/i.test(t)),`${role}: the JD's skills lead (${tools.join(', ')})`);
  assert.ok(tools.join(', ').length<=72,'fits the company row');
 }
});
test('a JD that names many of an employer\'s tools still prints at most six',()=>{
 const wide='Python Java AWS SQL PostgreSQL Docker Kubernetes React TypeScript Spring Boot Elasticsearch Kafka REST APIs GraphQL';
 assert.ok(employerTools('accolite',wide,bank).length<=6);
});
test('an employer with fewer than five tools stays short instead of inventing any',()=>{
 const tools=employerTools('shriffle','SQL Python',bank);
 assert.ok(tools.length<=5);
});
