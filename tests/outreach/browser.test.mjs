import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { backendFixture } from './fixture.mjs';
import { createOutreachRoutes } from '../../scripts/outreach/routes.mjs';

const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { chromium } = requireEngine('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function fixture(t, viewport = { width: 1600, height: 900 }) {
  const f = await backendFixture(t); const { service, sent, job } = f; const errors = [];
  const handler = createOutreachRoutes(f.run, async () => ({ contacts: [{ email: 'careers@acme.com', sourceUrl: 'https://acme.com/careers', evidence: 'Send your job application to careers@acme.com.' }], pages: ['https://acme.com/careers'], errors: [], portalOnly: false, checkedAt: new Date().toISOString() }));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (await handler(req, res, url)) return;
    const requested = path.join(root, 'dist-apply', url.pathname);
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'dist-apply/index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/outreach/') && url.port === '8787') {
      const response = await route.fetch({ url: base + url.pathname + url.search }); return route.fulfill({ response });
    }
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 1, name: 'Test Applicant', email: 'applicant@example.org' } } });
    if (url.pathname === '/api/prefs') return route.fulfill({ json: { prefs: {} } });
    if (url.pathname === '/applications/review-queue') return route.fulfill({ json: { ok: true, generatedAt: new Date().toISOString(), counts: { unanswered: 0, ready: 0 }, unanswered: [], cards: [], ready: [], manual: [], approved: [], linkedin: job.appliedAt ? [] : [{ id: job.jobUrl, url: job.jobUrl, company: job.company, title: job.title, location: 'New York, NY', score: 84, updatedAt: new Date().toISOString() }] } });
    if (url.pathname === '/applications/job-applied') { await f.applied(); return route.fulfill({ json: { ok: true } }); }
    if (url.pathname === '/applications/analytics') return route.fulfill({ json: { ok: true, range: { applied: 0, linkedinApplied: 0 }, daily: [] } });
    if (url.pathname === '/applications/action') return route.fulfill({ json: { ok: true } });
    if (url.origin === base) return route.continue();
    return route.abort(); // No production APIs, discovery sites, mailboxes or other external traffic.
  });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  return { page, base, service, sent, errors, job };
}

test('website configures mailbox, prepares card outreach, edits recruiter/resume, approves and cancels', async t => {
  const f = await fixture(t); const { page } = f;
  await page.goto(`${f.base}/outreach`);
  await page.getByRole('button', { name: 'Mailbox & settings' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Test Applicant');
  await page.getByLabel('Sender email', { exact: true }).fill('applicant@example.org');
  await page.getByLabel('Pause all outreach sending').uncheck();
  await page.getByRole('button', { name: /Save & send test/ }).click();
  await page.getByText('Test email accepted by your mailbox provider. Check your inbox.').waitFor();
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].to, 'applicant@example.org');
  await page.getByRole('link', { name: /^Today/ }).click();
  await page.getByRole('button', { name: 'Outreach', exact: true }).waitFor();
  const cardBounds = await page.locator('.td-card').boundingBox();
  const outreachBounds = await page.locator('.td-card-tools').boundingBox();
  assert.ok(outreachBounds.y + outreachBounds.height <= cardBounds.y + cardBounds.height, 'outreach controls fit inside the job card');
  await page.getByRole('button', { name: 'Outreach', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Example Robotics' }); await dialog.waitFor();
  await page.getByLabel('Official company website').fill('https://acme.com');
  await page.getByLabel('I checked that this is the correct company website.').check();
  await page.getByRole('button', { name: 'Find public emails' }).click();
  await page.getByRole('button', { name: 'careers@acme.com', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Approve & queue email' }).isDisabled(), true);
  await page.getByLabel('First name', { exact: true }).fill('Jane');
  await page.getByLabel('Last name', { exact: true }).fill('Recruiter');
  await page.getByLabel('Recipient email').fill('jane@acme.com');
  await page.getByLabel('Contact type').selectOption('recruiter');
  await page.getByLabel('I checked this person’s company and recruiting role.').check();
  await page.getByLabel('Subject', { exact: true }).fill('Application for Forward Deployed Engineer');
  await page.getByLabel('Email body').fill('Hi Jane,\n\nI applied for the Forward Deployed Engineer role. I would welcome a conversation.\n\nTest Applicant');
  await page.locator('input[type=file]').setInputFiles({ name: 'Tailored resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nfixture') });
  await page.getByRole('link', { name: 'Tailored resume.pdf ↗' }).waitFor();
  await page.screenshot({ path: '/tmp/atriveo-outreach-desktop.png' });
  await page.getByRole('button', { name: 'Close outreach' }).click();
  await page.getByRole('button', { name: 'Mark applied', exact: true }).click();
  await page.getByRole('link', { name: 'Outreach', exact: true }).click();
  await page.getByRole('button', { name: /Example Robotics.*Forward Deployed Engineer/ }).click();
  await page.getByRole('button', { name: 'Approve & queue email' }).click();
  await page.getByText('Queued. You can cancel before delivery.').waitFor();
  assert.equal(await page.getByLabel('Email body').isDisabled(), true);
  await page.getByRole('button', { name: 'Cancel send' }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Approve & queue email' }).waitFor();
  assert.equal((await f.service.list())[0].status, 'needs_review');
  assert.equal(f.sent.length, 1, 'Only the explicitly requested test message was sent');
  assert.deepEqual(f.errors, []);
});

test('mobile drawer fits, protects unsaved edits, and keeps its footer reachable', async t => {
  const f = await fixture(t, { width: 390, height: 844 }); const { page } = f;
  await page.goto(`${f.base}/`);
  await page.getByRole('button', { name: 'Outreach', exact: true }).click();
  await page.getByRole('dialog', { name: 'Example Robotics' }).waitFor();
  await page.getByLabel('Subject', { exact: true }).fill('Unsaved mobile edit');
  await page.getByRole('button', { name: 'Close outreach' }).click();
  await page.getByText('You have unsaved changes.').waitFor();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  assert.equal(await page.getByLabel('Subject', { exact: true }).inputValue(), 'Unsaved mobile edit');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const footer = await page.locator('.outreach-panel-foot').boundingBox(); assert.ok(footer.y + footer.height <= 845);
  await page.screenshot({ path: '/tmp/atriveo-outreach-mobile.png' });
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByText('Draft saved.').waitFor();
  await page.getByRole('button', { name: 'Close outreach' }).click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.deepEqual(f.errors, []);
});
