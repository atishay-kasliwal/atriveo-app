import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseProjects, dropRepeatedFigures } from '../../scripts/ac-page-fill.mjs';
import { loadBank } from '../../scripts/ac-bank.mjs';
import { allowedProjects, jdSelectedProjects, loadTracks } from '../../scripts/ac-tracks.mjs';
import { roleKindOf } from '../../scripts/ac-role-meta.mjs';
import { toolsFromBullets } from '../../scripts/ac-tex.mjs';

// Projects (2026-10-25): FOMC Market LLM is a project any track may print, chosen for the second slot only when the
// posting fits it better than the project already there; the first project is never replaced, and no figure a project
// prints is repeated under an employer. Real bank, no Mongo.
const bank = loadBank();
const byId = new Map(bank.acs.map((a) => [a.id, a]));
const printed = (id, facet) => { const ac = byId.get(id); const v = facet ? ac.variants.find((x) => x.facet === facet) : ac.variants[0]; return { ac_id: id, facet: v.facet, text: v.text }; };
const resume = (second) => ({
  experience: [{ role: 'stony-brook', bullets: [printed('AC-227'), printed('AC-199', 'ml')] }],
  projects: [{ role: 'atriveo', bullets: [printed('AC-228'), printed('AC-229')] }, second],
});
const insurance = { role: 'insurance-platform', bullets: [printed('AC-067'), printed('AC-063')] };
const NLP_JD = 'Research Engineer: build retrieval-augmented LLM systems. Embeddings, vector database (Pinecone), RAG, NLP, model evaluation, GPT-4o, Whisper, Python.';
const JAVA_JD = 'Backend engineer: Java, Spring Boot, Kafka, Elasticsearch, Docker microservices, REST APIs, PostgreSQL.';

test('FOMC Market LLM takes the second slot when the posting fits it better', () => {
  const { compact, changes } = chooseProjects(resume(insurance), bank, { jd: NLP_JD, track: 'software-engineer' });
  assert.deepEqual(compact.projects.map((p) => p.role), ['atriveo', 'fomc-market-llm']);
  assert.equal(compact.projects[1].bullets.length, 2);
  assert.match(changes[0], /chose project fomc-market-llm over insurance-platform/);
});

test('it is never forced: a posting that fits the current project keeps it', () => {
  const { compact, changes } = chooseProjects(resume(insurance), bank, { jd: JAVA_JD, track: 'software-engineer' });
  assert.deepEqual(compact.projects.map((p) => p.role), ['atriveo', 'insurance-platform']);
  assert.deepEqual(changes, []);
});

test('the first project is never replaced, and one project is left alone', () => {
  const one = { ...resume(insurance), projects: [{ role: 'atriveo', bullets: [printed('AC-228'), printed('AC-229')] }] };
  assert.deepEqual(chooseProjects(one, bank, { jd: NLP_JD }).compact.projects.map((p) => p.role), ['atriveo']);
  const { compact } = chooseProjects(resume(insurance), bank, { jd: NLP_JD });
  assert.equal(compact.projects[0].role, 'atriveo');
});

test('an employer bullet repeating a figure a project prints comes out', () => {
  const c = resume({ role: 'fomc-market-llm', bullets: [printed('AC-230'), printed('AC-252')] });
  c.experience[0].bullets.push(printed('AC-217', 'ds'));
  const { compact, changes } = dropRepeatedFigures(c);
  assert.ok(!compact.experience[0].bullets.some((b) => b.ac_id === 'AC-217'), 'AC-217 states 0.74 like AC-230');
  assert.equal(compact.experience[0].bullets.length, 2);
  assert.match(changes[0], /AC-217.*0\.74/);
});

test('the bank: FOMC Market LLM and Atriveo are projects by their own definitions; every Atriveo entry is project-slot', () => {
  assert.equal(roleKindOf('fomc-market-llm', bank.bank_dir), 'project');
  assert.equal(roleKindOf('atriveo', bank.bank_dir), 'project');
  assert.equal(roleKindOf('stony-brook', bank.bank_dir), 'experience');
  const fomc = bank.acs.filter((a) => a.role === 'fomc-market-llm' && !(a.tracks || []).includes('retired'));
  assert.deepEqual(fomc.map((a) => a.id).sort(), ['AC-230', 'AC-251', 'AC-252']);
  assert.ok(fomc.every((a) => a.slot_kind === 'project' && !a.tracks), 'project-slot and open to every track');
  assert.deepEqual(bank.acs.filter((a) => a.role === 'atriveo' && a.slot_kind !== 'project').map((a) => a.id), []);
});

test('every track may print FOMC Market LLM; no pinned set prints a project bullet under Stony Brook', () => {
  assert.deepEqual(jdSelectedProjects(), ['fomc-market-llm']);
  const doc = loadTracks();
  for (const track of Object.keys(doc.tracks)) assert.ok(allowedProjects(track).includes('fomc-market-llm'), track);
  const sets = Object.values(doc.tracks).flatMap((t) => (t.pinned ? [t.pinned, ...(t.pinned_variants || [])] : []));
  for (const s of sets) for (const ref of Object.values(s.experience || {}).flat()) assert.notEqual(byId.get(String(ref).split(':')[0])?.slot_kind, 'project', ref);
});

test('tools lines name tools as whole words: "market-reaction" is not React; FOMC prints its own stack', () => {
  const tools = toolsFromBullets([printed('AC-230'), printed('AC-252')], 'fomc-market-llm');
  assert.ok(!tools.includes('React'), tools.join(', '));
  assert.deepEqual(tools.filter((t) => ['Python', 'GPT-4o', 'Whisper', 'Pinecone'].includes(t)).sort(), ['GPT-4o', 'Pinecone', 'Python', 'Whisper']);
  assert.ok(!toolsFromBullets([{ text: 'Cut MRI preprocessing with LLMs and RAG for clinicians' }], 'x').some((t) => ['MRI', 'LLMs', 'RAG', 'ETL', 'Healthcare Data'].includes(t)), 'concepts are not tools');
});

test('a project bullet never restates a count printed elsewhere ("13 live sessions" under Stony Brook keeps AC-251 out)', () => {
  const c = resume(insurance);
  c.experience[0].bullets.push(printed('AC-025', 'ai-track'));
  const { compact } = chooseProjects(c, bank, { jd: NLP_JD + ' Model evaluation dashboards, MAE, MSE, backtesting.', track: 'ai-engineer' });
  const fomc = compact.projects.find((p) => p.role === 'fomc-market-llm');
  assert.ok(fomc, 'FOMC still fits this posting');
  assert.ok(!fomc.bullets.some((b) => b.ac_id === 'AC-251'), 'AC-251 says 13 live FOMC sessions, as AC-025 does');
});
