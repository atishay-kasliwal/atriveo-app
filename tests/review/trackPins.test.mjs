import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Role tracks (docs/resume-tracks/): a bullet tagged for one track exists only there, and a track with a pinned set
// (TRACKS.yaml, FDE first) gets exactly its tested bullets, whatever the pipeline chose.
process.env.AC_BANK_OVERLAY = '/nonexistent';
const { loadBank } = await import('../../scripts/ac-bank.mjs');
const { bankForTrack, classifyTrack, trackPins, employerTitle } = await import('../../scripts/ac-tracks.mjs');
const { generateResume } = await import('../../scripts/ac-pipeline.mjs');
const ROOT = path.join(import.meta.dirname, '..', '..');
const jd = (t) => fs.readFileSync(path.join(ROOT, 'data', 'baseline-jds', `${t}.txt`), 'utf8');
// "AC-001:fde" when the bullet is a later wording of its entry; a bare id when it's the entry's first wording.
const ids = (comp) => [...comp.experience, ...comp.projects].flatMap((s) => s.bullets.map(({ ac, face }) => (ac.variants[0] === face ? ac.id : `${ac.id}:${face.facet}`)));

test('a track sees its own bullets; others and untracked titles never do', () => {
  const bank = loadBank();
  // Bullets tagged for FDE but not for track t (an entry may serve several tracks, e.g. AC-203 FDE + SWE).
  const fdeNotFor = (b, t) => b.acs.filter((a) => [a, ...a.variants].some((x) => x.tracks?.includes('forward-deployed') && !x.tracks.includes(t)));
  assert.ok(fdeNotFor(bankForTrack(bank, 'forward-deployed'), 'forward-deployed').length === 0);
  assert.ok(bankForTrack(bank, 'forward-deployed').acs.filter((a) => a.tracks?.includes('forward-deployed')).length >= 11);
  for (const t of ['software-engineer', 'ai-engineer', 'data-science', 'data-analytics', null]) assert.equal(fdeNotFor(bankForTrack(bank, t), t).length, 0, String(t));
  assert.equal(classifyTrack('Forward Deployed Software Engineer - SF'), 'forward-deployed');
  assert.equal(employerTitle('stony-brook', 'Senior Forward Deployed Engineer'), 'AI Engineer');
  assert.equal(employerTitle('stony-brook', 'Forward-Deployed Engineer'), 'AI Engineer');
  // SWE-track titles print Software Engineer at Stony Brook; other tracks keep their own rule.
  for (const t of ['Backend Software Engineer', 'Data Engineer', 'Senior Full Stack Developer', 'Software Engineer II']) assert.equal(employerTitle('stony-brook', t), 'Software Engineer', t);
  // DS-track titles print Graduate Data Analyst at Stony Brook and the analytics intern title at Wake Forest.
  for (const t of ['Data Scientist', 'Senior Data Scientist II']) assert.equal(employerTitle('stony-brook', t), 'Graduate Data Analyst', t);
  assert.equal(employerTitle('wake-forest', 'Data Scientist'), 'AI and Data Analytics Intern');
  assert.equal(employerTitle('stony-brook', 'Machine Learning Engineer'), 'Machine Learning Engineer');
});

test('an FDE title gets exactly the pinned set; a SWE title gets no FDE-only bullet', { timeout: 120_000 }, () => {
  const pins = trackPins('forward-deployed');
  const expected = [...Object.values(pins.experience), ...Object.values(pins.projects)].flat();
  const fde = generateResume({ jd: jd('forward-deployed'), meta: { title: 'Forward Deployed Engineer', company: 'Test' } });
  assert.equal(fde.result.pinned_track, 'forward-deployed');
  assert.deepEqual(ids(fde.result.composition).sort(), expected.sort());
  assert.deepEqual(fde.result.composition.projects.find((p) => p.role === 'atriveo').stack, pins.project_stacks.atriveo);
  assert.ok(fde.result.composition.skills.length > 0, 'skills are rebuilt for the JD');
  // An infrastructure-heavy FDE posting gets the infrastructure set; the same title on a customer-facing JD does not.
  const infraJd = `${jd('forward-deployed')}\nYou will run Kubernetes, Terraform and Helm on bare metal GPU clusters, own observability with Prometheus and Grafana, act as SRE on incidents, and tune Linux networking for distributed systems.`;
  const infra = generateResume({ jd: infraJd, meta: { title: 'Forward Deployed Engineer, Infrastructure', company: 'Test' } });
  assert.equal(infra.result.pinned_set, 'infrastructure');
  assert.ok(ids(infra.result.composition).includes('AC-210') && ids(infra.result.composition).includes('AC-191'));
  assert.equal(fde.result.pinned_set, 'default');
  // A SWE title gets the SWE set: never an FDE-only bullet.
  const swe = generateResume({ jd: jd('software-engineer'), meta: { title: 'Software Engineer', company: 'Test' } });
  assert.equal(swe.result.pinned_track, 'software-engineer');
  const sweIds = ids(swe.result.composition);
  assert.ok(sweIds.includes('AC-211') && sweIds.includes('AC-213'));
  assert.equal(sweIds.filter((x) => /^AC-20[0-24-9]$|^AC-210$|:fde$/.test(x)).length, 0, 'no FDE-only bullet on a SWE resume');
  // An AI-track title has no pinned set yet: the pipeline's own choice, without FDE or SWE bullets.
  const ai = generateResume({ jd: jd('ai-engineer'), meta: { title: 'AI Engineer', company: 'Test' } });
  assert.equal(ai.result.pinned_track, undefined);
  assert.equal(ids(ai.result.composition).filter((x) => /^AC-2[01]\d$|:fde$|:swe$/.test(x)).length, 0);
});

test('a DS title gets the DS set; a BI-heavy DS posting gets the analytics set', { timeout: 120_000 }, () => {
  const ds = generateResume({ jd: jd('data-science'), meta: { title: 'Data Scientist', company: 'Test' } });
  assert.equal(ds.result.pinned_track, 'data-science');
  assert.equal(ds.result.pinned_set, 'default');
  const dsIds = ids(ds.result.composition);
  assert.ok(['AC-215', 'AC-218', 'AC-222', 'AC-225'].every((x) => dsIds.includes(x)));
  assert.equal(dsIds.filter((x) => /^AC-2(0\d|1[0-4])$|:fde$|:swe$/.test(x)).length, 0, 'no FDE or SWE bullet on a DS resume');
  const biJd = `${jd('data-science')}\nOwn operational reporting and KPIs: build Power BI and Tableau dashboards and visualizations, monitor data quality and trends, write SQL and present metrics to stakeholders.`;
  const bi = generateResume({ jd: biJd, meta: { title: 'Operations Data Scientist', company: 'Test' } });
  assert.equal(bi.result.pinned_set, 'analytics');
  assert.ok(ids(bi.result.composition).includes('AC-226') && ids(bi.result.composition).includes('AC-190'));
});
