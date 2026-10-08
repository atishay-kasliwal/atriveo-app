import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { withMongo } from './mongo-client.mjs';
import { startPasted, OUT_ROOT } from './resume-builder.mjs';
import { markJobApplied } from './applications-analytics.mjs';

export function postingUrl(value) {
  const u = new URL(String(value));
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Use a public job link');
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|source$|ref$|tracking)/i.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  return u.href.replace(/\/$/, '');
}
export const postingKey = value => crypto.createHash('sha256').update(postingUrl(value)).digest('hex');
const skills = ['Python', 'React', 'TypeScript', 'Java', 'FastAPI', 'SQL', 'AWS', 'Docker', 'LangChain', 'PyTorch'];
export function facts(j) {
  const text = `${j.title} ${j.description || ''}`;
  const tools = skills.filter(s => new RegExp(`\\b${s}\\b`, 'i').test(text));
  return { reasons: tools.slice(0, 3), warning: /no sponsorship|without sponsorship|not.*sponsor|US citizen|security clearance|now and.*future/i.test(text) ? 'Check work authorization requirements' : null };
}
export async function list(db, params) {
  const [raw, eligible, decisions, swipes, applied] = await Promise.all([
    db.collection('staffing_jobs').find({ expired: false }).toArray(),
    db.collection('jobs').find({ site: 'staffing' }, { projection: { job_url: 1, score_pct: 1, score: 1, resume: 1 } }).toArray(),
    db.collection('staffing_decisions').find().toArray(),
    db.collection('job_swipes').find({ direction: { $in: ['applied', 'left'] } }, { projection: { job_url: 1, direction: 1 } }).toArray(),
    db.collection('applications').find({ status: 'APPLIED' }, { projection: { url: 1, jobUrls: 1 } }).toArray(),
  ]);
  const keyOf = u => { try { return postingKey(u); } catch { return ''; } };
  const jobMap = new Map(eligible.map(j => [keyOf(j.job_url), j]));
  const decisionMap = new Map(decisions.map(d => [d._id, d]));
  const appliedKeys = new Set([...swipes.filter(s => s.direction === 'applied').map(s => keyOf(s.job_url)), ...applied.flatMap(a => [a.url, ...(a.jobUrls || [])].map(keyOf))]);
  const passedKeys = new Set(swipes.filter(s => s.direction === 'left').map(s => keyOf(s.job_url)));
  const seen = new Set();
  const groupStates = new Map();
  for (const j of raw) { const k = keyOf(j.job_url), group = j.fingerprint || k; const state = appliedKeys.has(k) ? 'applied' : decisionMap.get(k)?.state || (passedKeys.has(k) ? 'passed' : 'new'); const priority = { new: 0, saved: 1, passed: 2, applied: 3 }; if ((priority[state] || 0) >= (priority[groupStates.get(group)] || 0)) groupStates.set(group, state); }
  let rows = raw.map(j => {
    const key = keyOf(j.job_url), matched = jobMap.get(key), d = decisionMap.get(key);
    return { ...j, key, eligible: Boolean(matched), score: Number(matched?.score_pct || 0), resume: matched?.resume?.pdf_path || d?.resume_path || null, builder_id: d?.builder_id || null, state: groupStates.get(j.fingerprint || key) || 'new', ...facts(j) };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || String(b.first_seen_at).localeCompare(String(a.first_seen_at)))
    .filter(j => { const group = j.fingerprint || j.key; if (seen.has(j.key) || seen.has(group)) return false; seen.add(j.key); seen.add(group); return true; });
  const counts = { recommended: rows.filter(j => j.eligible && j.state === 'new').length, saved: rows.filter(j => j.state === 'saved').length, applied: rows.filter(j => j.state === 'applied').length, browse: rows.filter(j => !['passed', 'applied'].includes(j.state)).length };
  const view = params.get('view') || 'recommended';
  rows = rows.filter(j => view === 'recommended' ? j.eligible && j.state === 'new' : view === 'browse' ? !['passed', 'applied'].includes(j.state) : j.state === view);
  const query = (params.get('q') || '').toLowerCase();
  const source = params.get('source');
  rows = rows.filter(j => (!query || `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(query)) && (!source || j.source_id === source));
  const total = rows.length;
  const offset = Math.max(0, Math.min(100000, Number(params.get('offset')) || 0));
  return { ok: true, counts, total, jobs: rows.slice(offset, offset + 5).map(({ description, ...j }) => j) };
}
export async function mutate(db, op, body) {
  if (op === 'add') {
    const url = postingUrl(body.url), description = String(body.description || '').trim().slice(0, 30000);
    if (!body.title?.trim() || description.length < 300) throw new Error('Add a role title and at least 300 characters of the job description');
    const existing = await db.collection('staffing_jobs').findOne({ job_url: url });
    if (existing) return { ok: true, id: existing._id };
    const key = postingKey(url), now = new Date();
    await db.collection('staffing_jobs').updateOne({ _id: key }, { $setOnInsert: { job_url: url, title: String(body.title).slice(0, 150), company: String(body.company || 'Manual job').slice(0, 100), location: String(body.location || '').slice(0, 150), description, summary: description.slice(0, 500), source_id: 'manual', first_seen_at: now, observed_at: now, duplicate_of: null, expired: false } }, { upsert: true });
    await db.collection('staffing_decisions').updateOne({ _id: key }, { $set: { state: 'saved', updated_at: now } }, { upsert: true });
    return { ok: true, id: key };
  }
  const j = await db.collection('staffing_jobs').findOne({ _id: String(body.id || '') });
  if (!j) throw new Error('Job not found');
  const key = postingKey(j.job_url), decisions = db.collection('staffing_decisions');
  if (op === 'decision') {
    if (!['new', 'saved', 'passed', 'applied'].includes(body.state)) throw new Error('Unknown decision');
    if (body.state === 'applied') await markJobApplied(db, j.job_url);
    await decisions.updateOne({ _id: key }, { $set: { state: body.state, job_url: j.job_url, updated_at: new Date() } }, { upsert: true });
    return { ok: true };
  }
  if (op === 'detail') return { ok: true, job: j };
  if (op === 'prepare') {
    const existing = await db.collection('jobs').findOne({ job_url: j.job_url, 'resume.pdf_path': { $exists: true } });
    if (existing?.resume?.pdf_path && fs.existsSync(existing.resume.pdf_path)) return { ok: true, resume: existing.resume.pdf_path };
    const old = await decisions.findOne({ _id: key });
    if (old?.resume_path && fs.existsSync(old.resume_path)) return { ok: true, resume: old.resume_path, builder_id: old.builder_id };
    // Atomic lease prevents double clicks or two tabs creating the same resume twice.
    const lease = await decisions.updateOne({ _id: key, $or: [{ preparing_until: { $exists: false } }, { preparing_until: { $lt: new Date() } }] }, { $set: { preparing_until: new Date(Date.now() + 10 * 60000) } });
    if (!lease.matchedCount) {
      if (old) throw new Error('This resume is already being prepared. Try again shortly.');
      try { await decisions.insertOne({ _id: key, preparing_until: new Date(Date.now() + 10 * 60000) }); } catch { throw new Error('This resume is already being prepared.'); }
    }
    try {
      const result = await startPasted(db, { jd: j.description, title: j.title, company: j.company, location: j.location });
      const resume = path.join(OUT_ROOT, 'pasted', result.source.pasted, 'Atishay Kasliwal.pdf');
      await decisions.updateOne({ _id: key }, { $set: { resume_path: resume, builder_id: result.source.pasted, updated_at: new Date() } });
      await db.collection('jobs').updateOne({ job_url: j.job_url }, { $set: { company: j.company, title: j.title, location: j.location, site: 'staffing', 'resume.status': 'success', 'resume.pdf_path': resume } }, { upsert: true });
      await db.collection('descriptions').updateOne({ job_url: j.job_url }, { $set: { description: j.description } }, { upsert: true });
      await db.collection('applications').updateMany({ $or: [{ url: j.job_url }, { jobUrls: j.job_url }] }, { $set: { 'resume.path': resume, 'resume.fileName': 'Atishay Kasliwal.pdf' } });
      return { ok: true, resume, builder_id: result.source.pasted };
    } finally { await decisions.updateOne({ _id: key }, { $unset: { preparing_until: '' } }); }
  }
  throw new Error('Unknown action');
}
export async function handleWorkspace(req, res, url) {
  const op = url.pathname.replace('/staffing/', '');
  if (!['workspace', 'decision', 'detail', 'prepare', 'add'].includes(op)) return false;
  const reply = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  if ((op === 'workspace' && req.method !== 'GET') || (op !== 'workspace' && req.method !== 'POST')) { reply(405, { ok: false, error: 'Method not allowed' }); return true; }
  try {
    let body = {};
    if (req.method === 'POST') { let size = 0; const chunks = []; for await (const c of req) { size += c.length; if (size > 40000) throw new Error('Request too large'); chunks.push(c); } body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
    reply(200, await withMongo(db => op === 'workspace' ? list(db, url.searchParams) : mutate(db, op, body), { appName: 'AtriveoStaffingWorkspace' }));
  } catch (e) { reply(400, { ok: false, error: e.message || 'Could not update this job' }); }
  return true;
}
