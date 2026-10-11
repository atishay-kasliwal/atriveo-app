import https from 'node:https';
import http from 'node:http';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { load } from 'cheerio';

export function publicAddress(ip) {
  if (isIP(ip) === 6) return /^2[0-9a-f]{3}:/i.test(ip) && !/^2001:(?:db8|0):/i.test(ip);
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
}

export function websiteUrl(value) {
  const u = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || (u.port && !['80', '443'].includes(u.port))) throw new Error('Enter a public company website');
  if (!u.hostname.includes('.') || isIP(u.hostname.replace(/[\[\]]/g, ''))) throw new Error('Enter a company domain, not a local address');
  u.hash = ''; return u;
}

/** Resolve and pin the connection; validate every redirect, cap bytes and total time. */
export async function publicHtml(value, redirects = 0) {
  const u = websiteUrl(value);
  const addresses = await lookup(u.hostname, { all: true });
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('Website resolves to a private or reserved address');
  const selected = addresses[0];
  const response = await new Promise((resolve, reject) => {
    const req = (u.protocol === 'https:' ? https : http).get(u, {
      headers: { 'User-Agent': 'AtriveoContactFinder/1.0', Accept: 'text/html,text/plain' },
      lookup: (_host, options, cb) => options.all ? cb(null, [selected]) : cb(null, selected.address, selected.family),
      signal: AbortSignal.timeout(8000),
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); resolve({ redirect: new URL(res.headers.location, u).href }); return; }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`Website returned ${res.statusCode}`)); return; }
      if (!/text\/(html|plain)|application\/xhtml/i.test(res.headers['content-type'] || '')) { res.resume(); reject(new Error('Page is not HTML')); return; }
      const chunks = []; let size = 0;
      res.on('data', b => { size += b.length; if (size > 1_000_000) req.destroy(new Error('Page too large')); else chunks.push(b); });
      res.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8'), url: u.href }));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
  if (response.redirect) {
    if (redirects >= 3) throw new Error('Too many website redirects');
    return publicHtml(response.redirect, redirects + 1);
  }
  return response;
}

const emailPattern = /[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const hiring = /\b(careers?|jobs?|recruit(?:ment|ing)?|talent|hiring|applications?)\b/i;
export function extractContacts(html, sourceUrl, companyHost) {
  const $ = load(html);
  $('script,style,noscript,svg').remove();
  const contacts = new Map();
  const record = (email, context) => {
    email = email.toLowerCase().replace(/[.,;]+$/, '');
    const [local, domain] = email.split('@');
    if (!domain || /\.(png|jpg|svg|webp|gif)$/i.test(domain)) return;
    const sameCompany = domain === companyHost || domain.endsWith(`.${companyHost}`);
    const explicit = sameCompany && /^(careers?|jobs?|recruiting|recruitment|hiring|talent|applications?)$/i.test(local) && hiring.test(context);
    const type = explicit ? 'hiring' : /^(info|hello|contact|office|enquiries|hr)$/i.test(local) ? 'general' : 'recruiter';
    if (!contacts.has(email) || explicit) contacts.set(email, { email, type, firstName: '', lastName: '', title: '', profileUrl: '', sourceUrl, evidence: context.replace(/\s+/g, ' ').slice(0, 350), publishedHiring: explicit, foundAt: new Date().toISOString() });
  };
  $('a[href^="mailto:"]').each((_i, a) => {
    let href = $(a).attr('href') || '';
    try { href = decodeURIComponent(href); } catch { /* malformed escape */ }
    for (const email of href.split('?')[0].match(emailPattern) || []) record(email, $(a).parent().text());
  });
  // Preserve block boundaries: adjacent paragraphs must not turn into one email address.
  $('p,div,li,section,article,br,h1,h2,h3,td').append('\n');
  const body = $('body').text();
  for (const match of body.matchAll(emailPattern)) record(match[0], body.slice(Math.max(0, match.index - 140), match.index + match[0].length + 140));
  const portalOnly = /(?:do not|don't|cannot|unable to)\s+(?:accept|send|submit|email)[^.\n]{0,90}(?:applications?|resum[eé]s?|CVs?)[^.\n]{0,50}(?:email|e-mail)|applications?\s+(?:must|should)\s+(?:only\s+)?be\s+submitted\s+(?:through|via|using)/i.test(body);
  const links = [];
  $('a[href]').each((_i, a) => {
    if (!/career|contact|recruit|hiring|about|team|jobs/i.test(`${$(a).attr('href')} ${$(a).text()}`)) return;
    try { const link = new URL($(a).attr('href'), sourceUrl); if (link.hostname.replace(/^www\./, '') === companyHost && ['https:', 'http:'].includes(link.protocol)) links.push(link.href); } catch { /* invalid href */ }
  });
  return { contacts: [...contacts.values()], links: [...new Set(links)], portalOnly };
}

export async function discover(website, postingUrl, fetchPage = publicHtml) {
  const home = websiteUrl(website);
  const host = home.hostname.replace(/^www\./, '');
  const queue = [home.href];
  if (postingUrl) { try { if (new URL(postingUrl).hostname.replace(/^www\./, '') === host) queue.push(postingUrl); } catch { /* no URL */ } }
  const visited = new Set(); const contacts = new Map(); const errors = []; let portalOnly = false;
  // Follow actual relevant links, rather than guessing dozens of endpoints.
  while (queue.length && visited.size < 6) {
    const url = queue.shift(); if (visited.has(url)) continue; visited.add(url);
    try {
      const page = await fetchPage(url);
      if (new URL(page.url).hostname.replace(/^www\./, '') !== host) { errors.push(`${url}: redirected to another company; confirm its website first`); continue; }
      const result = extractContacts(page.html, page.url, host);
      portalOnly ||= result.portalOnly;
      result.contacts.forEach(c => { if (!contacts.has(c.email) || c.publishedHiring) contacts.set(c.email, c); });
      queue.push(...result.links.filter(l => !visited.has(l)));
    } catch (e) { errors.push(`${url}: ${e.message}`); }
  }
  return { contacts: [...contacts.values()].slice(0, 40), pages: [...visited], errors, portalOnly, checkedAt: new Date().toISOString() };
}
