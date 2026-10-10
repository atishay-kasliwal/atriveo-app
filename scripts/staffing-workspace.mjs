import crypto from 'node:crypto';
import fs from 'node:fs';
import { withMongo } from './mongo-client.mjs';
import { enqueueJob } from './resume-queue.mjs';
import { markJobApplied, resumeMatchOf, trackOf } from './applications-analytics.mjs';

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
async function workspaceRows(db) {
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
  return raw.map(j => {
    const key = keyOf(j.job_url), matched = jobMap.get(key), d = decisionMap.get(key);
    return { ...j, key, eligible: Boolean(matched), score: Number(matched?.score_pct || 0), resume: matched?.resume?.pdf_path || d?.resume_path || null, resume_status: matched?.resume?.pdf_path || d?.resume_path ? 'success' : matched?.resume?.status || null, builder_id: d?.builder_id || null, state: groupStates.get(j.fingerprint || key) || 'new', ...facts(j) };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || String(b.first_seen_at).localeCompare(String(a.first_seen_at)))
    .filter(j => { const group = j.fingerprint || j.key; if (seen.has(j.key) || seen.has(group)) return false; seen.add(j.key); seen.add(group); return true; });
}
export async function list(db, params) {
  // Skipped companies (Today's list, sent as skip=…): a company is skipped when its name contains one, as on Today.
  const skip = params.getAll('skip').map(s => s.trim().toLowerCase()).filter(Boolean);
  let rows = (await workspaceRows(db)).filter(j => !skip.some(s => String(j.company || '').toLowerCase().includes(s)));
  const counts = { recommended: rows.filter(j => j.eligible && j.state === 'new').length, saved: rows.filter(j => j.state === 'saved').length, applied: rows.filter(j => j.state === 'applied').length, browse: rows.filter(j => !['passed', 'applied'].includes(j.state)).length };
  const view = params.get('view') || 'recommended';
  rows = rows.filter(j => view === 'recommended' ? j.eligible && j.state === 'new' : view === 'browse' ? !['passed', 'applied'].includes(j.state) : j.state === view);
  const query = (params.get('q') || '').toLowerCase();
  const source = params.get('source');
  rows = rows.filter(j => (!query || `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(query)) && (!source || j.source_id === source));
  const total = rows.length;
  const offset = Math.max(0, Math.min(100000, Number(params.get('offset')) || 0));
  // The card's role track and resume match (ats-score.json beside the PDF), only for the page shown.
  return { ok: true, counts, total, jobs: rows.slice(offset, offset + 10).map(({ description, ...j }) => ({ ...j, track: trackOf(j.title), resume_match: resumeMatchOf(j.resume) })) };
}
// Staffing resumes are built by the resume worker, like every other job. A click goes to the fast lane (1001,
// beside the extension's Tailor); the background sweep queues Recommended jobs just below it.
export const PRIORITY_CLICKED = 1001;
export const PRIORITY_STAFFING = 950;
async function queueResume(db, j, priority, existing) {
  const status = existing?.resume?.status;
  if (status === 'running') return { queued: true, resume_status: 'running' };
  if (status === 'queued') {
    if ((existing.resume.priority ?? 0) < priority) await db.collection('jobs').updateOne({ job_url: j.job_url, 'resume.status': 'queued' }, { $set: { 'resume.priority': priority, 'resume.source': 'staffing' } });
    return { queued: true, resume_status: 'queued' };
  }
  // A success whose PDF isn't on this server, or a failure, is rebuilt. Jobs outside Recommended (Browse, added by hand) have no jobs row yet; the worker needs one plus the description.
  if (!existing) await db.collection('jobs').updateOne({ job_url: j.job_url }, { $setOnInsert: { job_url: j.job_url, company: j.company, title: j.title, location: j.location, site: 'staffing' } }, { upsert: true });
  await db.collection('descriptions').updateOne({ job_url: j.job_url }, { $setOnInsert: { description: j.description } }, { upsert: true });
  const r = await enqueueJob(db, { job_url: j.job_url, company: j.company, title: j.title, location: j.location, source: 'staffing', priority }, { force: status === 'failed' || status === 'success' });
  if (r.pdf_path) return { resume: r.pdf_path };
  return { queued: true, resume_status: 'queued' };
}
/** Queues a resume for every Recommended job that has none, newest first. Skips work-authorization warnings and past failures. */
export async function queueRecommended(db) {
  const todo = (await workspaceRows(db)).filter(j => j.eligible && j.state === 'new' && !j.resume && !j.resume_status && !j.warning)
    .sort((a, b) => String(b.first_seen_at).localeCompare(String(a.first_seen_at)));
  for (const j of todo) await queueResume(db, j, PRIORITY_STAFFING, {});
  return todo.length;
}
/** STAFFING_AUTO_QUEUE=1 turns on the sweep: shortly after start, then every STAFFING_AUTO_QUEUE_MIN minutes (default 30). */
export function startStaffingAutoQueue(log = console.log) {
  if (process.env.STAFFING_AUTO_QUEUE !== '1') return null;
  const sweep = () => withMongo(db => queueRecommended(db), { appName: 'AtriveoStaffingAutoQueue' })
    .then(n => { if (n) log(`staffing auto-queue: ${n} resume(s) queued`); })
    .catch(e => log(`staffing auto-queue failed: ${e.message || e}`));
  setTimeout(sweep, 60000);
  return setInterval(sweep, Math.max(5, Number(process.env.STAFFING_AUTO_QUEUE_MIN) || 30) * 60000);
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
    const existing = await db.collection('jobs').findOne({ job_url: j.job_url }, { projection: { resume: 1 } });
    if (existing?.resume?.pdf_path && fs.existsSync(existing.resume.pdf_path)) return { ok: true, resume: existing.resume.pdf_path };
    const old = await decisions.findOne({ _id: key });
    if (old?.resume_path && fs.existsSync(old.resume_path)) return { ok: true, resume: old.resume_path, builder_id: old.builder_id };
    return { ok: true, ...await queueResume(db, j, PRIORITY_CLICKED, existing) };
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
