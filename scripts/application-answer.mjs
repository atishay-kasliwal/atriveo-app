import crypto from 'node:crypto';
import { queueInference } from './resume-ai-queue.mjs';
import { subscriptionGenerate, AI_PROVIDERS } from './resume-ai-provider.mjs';
import { buildEvidence, validateSchema } from './resume-ai-content.mjs';
import { loadResume, BuilderError } from './resume-builder.mjs';
import { loadBank } from './ac-bank.mjs';

// "Why do you want to join this company?" and its relatives: an answer written from this posting and your own evidence bank.
// Facts about the candidate come only from the evidence supplied (cited by id); facts about the company only from the posting.
export const ANSWER_KINDS = {
  'why-company': 'Why do you want to join {company}?',
  'why-hire': 'What makes you the right hire for this position?',
  custom: '',
};
export const ANSWER_LENGTHS = { short: { words: 70, max: 600 }, standard: { words: 120, max: 1000 }, long: { words: 200, max: 1600 } };
const str = (max) => ({ type: 'string', maxLength: max });
export const ANSWER_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['answer', 'evidence_source', 'company_points', 'note'],
  properties: {
    answer: str(2000),
    evidence_source: { type: 'array', items: str(200), maxItems: 12 },
    company_points: { type: 'array', items: str(300), maxItems: 6 },
    note: str(400),
  },
};
const STOP = new Set('this that with from your will have been into more than also such their they them what when where which while about over under using used work team role join build built help make well'.split(' '));
const words = (text) => String(text).toLowerCase().match(/[a-z][a-z+#.]{2,}/g)?.filter((w) => !STOP.has(w)) ?? [];
const NEVER = /atriveo/i; // never an example in an application answer (the user's own platform)

/** The evidence worth showing the model: this resume's bullets plus bank variants from any employer, those that share the most words with the posting first. */
export function pickEvidence(entries, jd, limit = 36) {
  const jdWords = new Set(words(jd));
  const scored = entries.filter((e) => e.text && !NEVER.test(e.text) && !NEVER.test(e.role || '')).map((e) => ({ e, score: words(e.text).filter((w) => jdWords.has(w)).length + (e.id.startsWith('current_resume:') ? 2 : 0) }));
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.e);
}

export function answerSystem(kind, length) {
  return [
    'You write one job-application answer for the candidate, in first person, from the posting and the evidence supplied. Return only the schema.',
    'Candidate facts (what they built, used, measured) come ONLY from the evidence entries; cite each entry you rely on by id in evidence_source. Company facts (what it does, its product, mission, customers, stage) come ONLY from the posting text; if the posting says little about the company, say so in "note" and keep the company part short and honest instead of guessing or flattering.',
    'Never invent numbers, employers, tools, outcomes or company facts. Keep each workstream\'s metrics separate; never merge numbers from different projects. Never mention Atriveo or the candidate\'s own job-search platform. Prefer the evidence entries that fit the posting best.',
    kind === 'why-company'
      ? 'Shape: why this company and this work (one or two specific things the posting says about it), then the one or two pieces of the candidate\'s experience that connect to it, then what they want to do there.'
      : kind === 'why-hire'
        ? 'Shape: the two or three requirements of the role that matter most, each met by one specific piece of evidence, then a short close.'
        : 'Answer the exact question asked, specifically and briefly, using the evidence that fits it.',
    `Length: about ${ANSWER_LENGTHS[length].words} words (never more than ${Math.round(ANSWER_LENGTHS[length].words * 1.25)}).`,
    'Voice: plain, direct, human. No em dashes or en dashes, no "passionate", "leverage", "delve", "excited to", "cutting-edge", "I am writing to". No bullet lists, no headings, no greeting or sign-off. Short sentences mixed with a longer one.',
    'company_points: the specific things from the posting that the answer leaned on (quote or closely paraphrase). note: anything the candidate should check before sending (thin company information, a requirement the evidence does not cover); empty string if nothing.',
  ].join('\n');
}

export async function answerApplication(db, body, { generate, load = loadResume, bank = loadBank() } = {}) {
  const provider = body.provider || process.env.RESUME_AI_PROVIDER || 'claude';
  if (!AI_PROVIDERS.includes(provider)) throw new BuilderError('Choose Claude, Codex, or Claude + Codex');
  const kind = Object.hasOwn(ANSWER_KINDS, body.kind) ? body.kind : null;
  if (!kind) throw new BuilderError('Choose which question to answer.');
  const length = Object.hasOwn(ANSWER_LENGTHS, body.length) ? body.length : 'standard';
  const jobUrl = typeof body.jobUrl === 'string' && /^https:\/\//.test(body.jobUrl) ? body.jobUrl : null;
  if (!jobUrl) throw new BuilderError('Open a job first.');
  const loaded = await load(db, { jobUrl });
  const company = loaded.source.company || 'this company', title = loaded.source.title || 'this role';
  const custom = typeof body.question === 'string' ? body.question.trim() : '';
  if (custom.length > 800) throw new BuilderError('Keep the question under 800 characters.');
  const question = kind === 'custom' ? custom : ANSWER_KINDS[kind].replace('{company}', company);
  if (!question) throw new BuilderError('Paste the question from the application form.');
  const jd = loaded.jd || '';
  if (jd.length < 200) throw new BuilderError('This job has no saved description to answer from. Paste it in the resume builder first.');
  const entries = buildEvidence(loaded.sections, loaded.skills, bank);
  // Evidence from every employer and project in the bank, not only the ones this resume prints.
  const roles = new Set(loaded.sections.map((s) => s.role));
  for (const a of bank.acs) {
    if (roles.has(a.role) || a.production_eligible === false || ['DRAFT', 'REJECTED'].includes(a.status)) continue;
    (a.variants || []).forEach((v, i) => { if (v.production_eligible === false || ['DRAFT', 'REJECTED'].includes(v.status) || !v.text) return; entries.push({ id: `story_bank:${a.id}:${i}`, role: a.role, text: v.text }); });
  }
  const evidence = pickEvidence(entries, `${title}\n${jd}`);
  const gen = generate || ((request) => process.env.RESUME_AI_REMOTE_WORKER === 'mac' ? queueInference(db, provider, request) : subscriptionGenerate(provider, request));
  const result = await gen({ purpose: 'optimize', system: answerSystem(kind, length), user: JSON.stringify({ question, company, role: title, posting: jd.slice(0, 12000), evidence: evidence.map((e) => ({ id: e.id, employer_or_project: e.role, text: e.text })) }), schema: ANSWER_SCHEMA, sessionId: typeof body.sessionId === 'string' ? body.sessionId.slice(0, 100) : '', parentJobId: body.parentJobId });
  validateSchema(ANSWER_SCHEMA, result);
  if (result.evidence_source.some((id) => !evidence.some((e) => e.id === id))) throw new BuilderError('AI cited unknown evidence. Retry.');
  if (/[—–]/.test(result.answer)) result.answer = result.answer.replace(/\s*[—–]\s*/g, ', ');
  if (NEVER.test(result.answer)) throw new BuilderError('The answer mentioned Atriveo. Retry.');
  const used = result.evidence_source.map((id) => { const e = evidence.find((x) => x.id === id); return { id, employer: e.role, text: e.text }; });
  return { ok: true, answer: { id: crypto.randomUUID(), provider, kind, question, company, role: title, length, text: result.answer.trim(), words: words(result.answer).length, used, companyPoints: result.company_points, note: result.note, at: new Date().toISOString() } };
}

/** Same job queue as the resume review: the page starts a job and polls it (ai-result). */
export async function enqueueAnswer(db, body) {
  const jobId = typeof body.requestId === 'string' && /^[a-f0-9-]{36}$/i.test(body.requestId) ? body.requestId : crypto.randomUUID();
  if (await db.collection('resume_ai_jobs').findOne({ _id: jobId })) return { ok: true, jobId };
  try { await db.collection('resume_ai_jobs').insertOne({ _id: jobId, status: 'running', stage: 'reading', provider: body.provider || 'claude', createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + 86400000) }); } catch (e) { if (e.code === 11000) return { ok: true, jobId }; throw e; }
  void answerApplication(db, { ...body, parentJobId: jobId })
    .then((r) => db.collection('resume_ai_jobs').updateOne({ _id: jobId }, { $set: { status: 'done', stage: 'ready', updatedAt: new Date(), analysis: r.answer } }))
    .catch((e) => db.collection('resume_ai_jobs').updateOne({ _id: jobId }, { $set: { status: 'failed', stage: 'failed', updatedAt: new Date(), error: e.message || String(e) } }));
  return { ok: true, jobId };
}
