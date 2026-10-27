// One immutable application kit: the job and the exact PDF shown by Matching.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadResumeProfile } from './resume-profile.mjs';
import { storeFromEnv, resumeKey } from './resume-store.mjs';
import { generalResumes } from './no-text-jobs.mjs';
import { trackOf } from './applications-analytics.mjs';

export const MAX_KIT_PDF_BYTES = 5 * 1024 * 1024;
export class ApplicationKitError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function resumeRevision(resume) {
  if (/^[a-f0-9]{64}$/.test(resume?.object?.sha256 || '')) return resume.object.sha256;
  try { if (fs.statSync(resume.pdf_path).size > MAX_KIT_PDF_BYTES) return null; return hash(fs.readFileSync(resume.pdf_path)); } catch { return null; }
}
function webUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
/** The details you share on every application (name, email, phone, location, links), the same on all of them. */
export function profileFields(profile) {
  const name = String(profile.name || '').trim();
  return [ ['name', 'Full name', name], ['firstName', 'First name', name.split(/\s+/)[0]], ['lastName', 'Last name', name.split(/\s+/).slice(1).join(' ')], ['email', 'Email', profile.email], ['phone', 'Phone', profile.phone], ['location', 'Location', profile.location], ['linkedin', 'LinkedIn', profile.linkedin], ['github', 'GitHub', profile.github], ['portfolio', 'Website', profile.portfolio] ].map(([key, label, value]) => ({ key, label, value: String(value || '').slice(0, 500) }));
}
/** Where you are applying: the job's own location, or New York, NY when the job has none (or only a country, or just "Remote"). */
export const DEFAULT_APPLICATION_LOCATION = 'New York, NY';
export function applicationLocation(raw) {
  const first = String(raw ?? '').split(/\s*(?:;|\||\bor\b|\band\b\s+(?=[A-Z]))\s*/)[0];
  const place = first
    .replace(/\b(?:fully |hybrid|on-?site|remote|in[- ]office)\b[\s,:/()-]*/gi, '')
    .replace(/[\s,-]*\b(?:USA|U\.S\.A?\.?|United States(?: of America)?)\s*$/i, '')
    .replace(/^[\s,:/()-]+|[\s,:/()-]+$/g, '').replace(/\s+/g, ' ').slice(0, 120);
  const generic = /^(?:|us|usa|u\.s\.|united states|anywhere|worldwide|global|north america|multiple locations?|various|nationwide|americas?)$/i;
  return generic.test(place) ? DEFAULT_APPLICATION_LOCATION : place;
}
export const profileDetails = () => profileFields(loadResumeProfile());

export async function prepareApplicationKit(db, input, { profile = loadResumeProfile(), store = storeFromEnv(), outRoot = null, now = new Date() } = {}) {
  if (!input || typeof input.jobUrl !== 'string' || !/^[a-f0-9]{64}$/.test(input.resumeSha256 || '')) throw new ApplicationKitError('Refresh the job to load its resume version.', 400);
  const job = await db.collection('jobs').findOne({ job_url: input.jobUrl }, { projection: { job_url: 1, job_url_direct: 1, company: 1, title: 1, location: 1, resume: 1 } });
  if (!job || job.resume?.status !== 'success') throw new ApplicationKitError('This job does not have a ready resume.');
  const expected = input.resumeSha256;
  if (resumeRevision(job.resume) !== expected) throw new ApplicationKitError('The resume changed. Refresh the job before applying.');
  const applyUrl = webUrl(job.job_url_direct || job.job_url);
  if (!applyUrl) throw new ApplicationKitError('This job has no valid application link.', 400);
  if (job.resume.object?.bytes > MAX_KIT_PDF_BYTES) throw new ApplicationKitError('This PDF is too large for the companion. Use Download PDF.');
  let bytes;
  if (job.resume.object && store) bytes = await store.get(resumeKey(expected));
  else {
    const file = path.resolve(String(job.resume.pdf_path || ''));
    if (path.extname(file).toLowerCase() !== '.pdf' || (outRoot && !file.startsWith(path.resolve(outRoot) + path.sep))) throw new ApplicationKitError('The selected resume is unavailable.');
    try { if (fs.statSync(file).size > MAX_KIT_PDF_BYTES) throw new ApplicationKitError('This PDF is too large for the companion. Use Download PDF.'); bytes = fs.readFileSync(file); } catch (e) { if (e instanceof ApplicationKitError) throw e; throw new ApplicationKitError('The selected resume is unavailable.'); }
  }
  if (!bytes?.length || bytes.length > MAX_KIT_PDF_BYTES || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new ApplicationKitError('The selected file is not an available PDF.');
  if (hash(bytes) !== expected) throw new ApplicationKitError('The resume changed. Refresh the job before applying.');
  // Older PDFs may predate the editable profile. Reuse contact data only from
  // an assessment whose PDF checksum is this exact file; never from another job.
  profile = { ...profile };
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(path.dirname(job.resume.pdf_path), 'ats-score.json'), 'utf8'));
    if (saved.inputs?.pdf_sha256 === expected) {
      const contact = saved.readiness?.parsed?.contact || {};
      for (const field of ['name', 'email', 'phone', 'location']) if (!profile[field] && contact[field]) profile[field] = contact[field];
    }
  } catch { /* blank fields remain visibly unset; never invent personal information */ }
  const name = String(profile.name || '').trim();
  return {
    version: 1, id: crypto.randomUUID(), createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    job: { id: job.job_url, company: String(job.company || ''), title: String(job.title || ''), applyUrl },
    fields: profileFields({ ...profile, name, location: applicationLocation(job.location) }),
    resume: { sha256: expected, fileName: `${name || 'Resume'}.pdf`, bytes: bytes.length, mimeType: 'application/pdf', base64: bytes.toString('base64') },
  };
}

/**
 * A kit for a job that has no tailored resume (its posting text could not be read): your general resume for the job's role, from the
 * general resumes built per track. The job and profile are the same as any kit's; only the file is the general one.
 */
export async function prepareGeneralKit(db, input, { profile = loadResumeProfile(), outRoot = null, now = new Date() } = {}) {
  if (!input || typeof input.jobUrl !== 'string') throw new ApplicationKitError('Choose a job first.', 400);
  const job = await db.collection('jobs').findOne({ job_url: input.jobUrl }, { projection: { job_url: 1, job_url_direct: 1, company: 1, title: 1, location: 1 } });
  if (!job) throw new ApplicationKitError('That job was not found.', 404);
  const applyUrl = webUrl(job.job_url_direct || job.job_url);
  if (!applyUrl) throw new ApplicationKitError('This job has no valid application link.', 400);
  const track = trackOf(job.title);
  const general = track ? generalResumes(outRoot)[track] : null;
  if (!general) throw new ApplicationKitError(`No general resume is built for this role${track ? ` (${track})` : ''}.`);
  let bytes;
  try { if (fs.statSync(general.path).size > MAX_KIT_PDF_BYTES) throw new ApplicationKitError('The general resume is too large for the companion. Use Download PDF.'); bytes = fs.readFileSync(general.path); } catch (e) { if (e instanceof ApplicationKitError) throw e; throw new ApplicationKitError('The general resume is unavailable.'); }
  if (!bytes?.length || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new ApplicationKitError('The general resume is not an available PDF.');
  const name = String(profile.name || '').trim();
  return {
    version: 1, id: crypto.randomUUID(), createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    job: { id: job.job_url, company: String(job.company || ''), title: String(job.title || ''), applyUrl },
    fields: profileFields({ ...profile, name, location: applicationLocation(job.location) }),
    resume: { sha256: hash(bytes), fileName: `${name || 'Resume'}.pdf`, bytes: bytes.length, mimeType: 'application/pdf', base64: bytes.toString('base64') },
    general: { track, label: general.label },
  };
}
