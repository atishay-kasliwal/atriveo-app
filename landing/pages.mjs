// Templates for the public landing pages. Static HTML, complete without JavaScript;
// motion.js only adds the route and thread drivers on top.
import { site, route, stages, ledger, resumeRules, faqs, examples } from './content.mjs';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const arrow = '<span class="arrow" aria-hidden="true">↗</span>';
const cta = (label = 'Open the workspace', cls = 'primary', href = site.workspace) =>
  `<a class="button ${cls}" href="${href}"><span>${label}</span>${arrow}</a>`;
const brand = '<span class="wordmark">atriveo<span>.</span></span>';
const n2 = (i) => String(i + 1).padStart(2, '0');

function picture({ name, width, height, alt, eager = false }) {
  return `<picture><source srcset="/landing/assets/${name}.webp" type="image/webp"><img src="/landing/assets/${name}.png" width="${width}" height="${height}" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></picture>`;
}

function layout({ title, description, canonical, body, kind = 'home', noindex = false }) {
  const og = `${site.url}assets/og.png`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'Atriveo',
    url: site.url,
    description: site.description,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web, Chrome',
  };
  const current = (k) => (kind === k ? ' aria-current="page"' : '');
  const nav = `<a href="/landing/#story">How it works</a><a href="/landing/workflow/"${current('workflow')}>The details</a><a href="/landing/#questions">Questions</a><a href="${site.login}">Sign in</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta name="theme-color" content="#f4f6f8">
${noindex ? '<meta name="robots" content="noindex,follow">' : '<meta name="robots" content="index,follow">'}
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Atriveo"><meta property="og:locale" content="en_US"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${og}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Atriveo: one job, one resume, carried through">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${og}">
<link rel="icon" type="image/svg+xml" href="/landing/assets/favicon.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/landing/assets/fonts/atriveo-sans-400_700-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/landing/styles.css">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<script type="module" src="/landing/assets/motion.js"></script></head>
<body data-page="${kind}"><a class="skip" href="#main">Skip to content</a>
<header class="site-header wrap"><a class="brand" href="/landing/" aria-label="Atriveo home">${brand}</a>
<details class="mobile-menu"><summary>Menu</summary><nav aria-label="Mobile">${nav}</nav></details>
<nav class="desktop-nav" aria-label="Main">${nav}</nav>
<a class="header-cta" href="${site.workspace}"><span>Open workspace</span> ${arrow}</a></header>
<main id="main" tabindex="-1">${body}</main>
<footer class="site-footer wrap"><a class="brand" href="/landing/" aria-label="Atriveo home">${brand}</a><p>One job, one resume, carried through. You submit.</p>
<nav aria-label="Footer"><a href="/landing/#story">How it works</a><a href="/landing/workflow/">The details</a><a href="${site.login}">Sign in</a><a href="${site.workspace}">Open workspace</a></nav><small>© 2026 Atriveo</small></footer>
</body></html>`;
}

const ROUTE_D = 'M80 60 H295 Q350 60 350 115 V135 Q350 190 295 190 H145 Q90 190 90 245 V265 Q90 320 145 320 H300 Q350 320 350 375 V390';

function routeFigure() {
  const stops = route
    .map(
      (s, i) =>
        `<button type="button" class="route-stop" style="left:${((s.x / 440) * 100).toFixed(2)}%;top:${((s.y / 440) * 100).toFixed(2)}%" data-stage="${i}" data-at="${s.at}" data-caption="${esc(s.caption)}" aria-pressed="${i === route.length - 1}"><span class="route-index" aria-hidden="true">${n2(i)}</span>${s.label}</button>`,
    )
    .join('');
  return `<figure class="route-figure"><div class="route-heading"><span>One application</span><span class="route-heading-note">Choose a stop</span></div>
<div class="route-drawing"><svg viewBox="0 0 440 440" fill="none" aria-hidden="true"><path class="route-track" d="${ROUTE_D}"/><path class="route-fill" pathLength="1" d="${ROUTE_D}"/><circle class="route-dot" cx="80" cy="60" r="7"/></svg>
<div class="route-stops" role="group" aria-label="Stages of one application">${stops}</div></div>
<figcaption aria-live="polite"><span class="route-caption">${esc(route.at(-1).caption)}</span><span class="route-caption-number">04 / 04</span></figcaption></figure>`;
}

function stageHead(s, i) {
  return `<p class="stage-label"><span class="stage-num">${n2(i)}</span>${s.label}</p><h3>${s.title}</h3><p class="stage-body">${s.body}</p><p class="stage-detail">${s.detail}</p>`;
}

function story() {
  const [find, evidence, resume, submit] = stages;
  return `<section class="story" id="story" aria-labelledby="story-title"><div class="wrap story-intro"><h2 id="story-title">Four stops.<br>One thread.</h2><p>From the posting to the submit button, the same job and the same resume stay attached. Here is what happens at each stop.</p></div>
<div class="wrap story-track"><div class="thread" aria-hidden="true"><span class="thread-line"></span><span class="thread-fill"></span></div>
<article class="stage stage-find" id="${find.id}" data-node><span class="node" aria-hidden="true"></span><div class="stage-text">${stageHead(find, 0)}</div>
<figure class="shot shot-wide">${picture({ name: 'workspace', width: 906, height: 826, alt: 'Atriveo Matching workspace for an example Software Engineer role: Bank fit 84, This resume 80 out of 100, three of five core skills, with Python, AWS and APIs marked strong and Kubernetes and Go listed as concerns' })}
<figcaption><span>The Matching workspace</span><span>${examples.label}</span></figcaption></figure>
<dl class="callouts"><div><dt>Bank fit</dt><dd>Your whole bank against the posting.</dd></div><div><dt>This resume</dt><dd>The tailored PDF, scored on its own.</dd></div><div><dt>Concerns</dt><dd>Gaps shown up front, not hidden.</dd></div></dl></article>
<article class="stage stage-evidence" id="${evidence.id}" data-node><span class="node" aria-hidden="true"></span><div class="stage-text">${stageHead(evidence, 1)}</div>
<figure class="ledger"><figcaption>How a requirement is labeled</figcaption><dl>${ledger.map(([k, v], i) => `<div class="ledger-row" style="--w:${100 - i * 20}%"><dt>${k}</dt><dd>${v}</dd><span class="ledger-bar" aria-hidden="true"></span></div>`).join('')}</dl></figure></article>
<article class="stage stage-resume" id="${resume.id}" data-node><span class="node" aria-hidden="true"></span><div class="stage-text">${stageHead(resume, 2)}</div>
<figure class="rules"><figcaption>What stays fixed on every resume</figcaption><ol>${resumeRules.map(([k, v]) => `<li><strong>${k}</strong><span>${v}</span></li>`).join('')}</ol></figure></article>
<article class="stage stage-submit" id="${submit.id}" data-node><span class="node" aria-hidden="true"></span><div class="stage-text">${stageHead(submit, 3)}
<p class="submit-line"><span class="submit-key">Submit</span> is always your click.</p></div>
<figure class="shot shot-tall">${picture({ name: 'companion', width: 420, height: 760, alt: 'Atriveo Chrome companion beside an example application: the selected resume Alex Morgan.pdf with Attach resume, Preview and Download, and copyable name, email and LinkedIn fields' })}
<figcaption>Chrome companion · illustrative profile</figcaption></figure></article></div></section>`;
}

export function home() {
  return layout({
    title: site.title,
    description: site.description,
    canonical: site.url,
    body: `<section class="hero wrap" aria-labelledby="hero-title"><div class="hero-copy"><p class="intro">Job applications, with the evidence attached</p>
<h1 id="hero-title">One job.<br>One resume.<br><span>Carried through.</span></h1>
<p class="hero-description">Atriveo shows how your own experience fits each role, builds the resume from that evidence and carries that exact PDF to the employer’s form. You review it. You submit it.</p>
<div class="hero-actions">${cta()}<a class="text-link" href="#story">See the four stops <span aria-hidden="true">↓</span></a></div>
<p class="access-note">For approved accounts. <a href="${site.login}">Sign in</a></p></div>${routeFigure()}</section>
${story()}
<section class="faq-section wrap" id="questions" aria-labelledby="faq-title"><h2 id="faq-title">Before you<br>sign in.</h2><div class="faq-list">${faqs.map(([q, a]) => `<details><summary>${q}<span aria-hidden="true">+</span></summary><p>${a}</p></details>`).join('')}</div></section>
<section class="closing" aria-labelledby="closing-title"><div class="wrap closing-inner"><h2 id="closing-title">Pick up the<br>thread<span>.</span></h2><div class="closing-actions">${cta('Open the workspace', 'paper')}<a class="closing-link" href="${site.login}">Sign in ${arrow}</a></div><p class="closing-note">The workspace needs an approved account. There is no open sign-up yet.</p>
<svg class="closing-thread" viewBox="0 0 600 150" fill="none" aria-hidden="true"><path d="M0 30h350q80 0 80 60t80 50h70"/><circle cx="580" cy="140" r="7"/></svg></div></section>`,
  });
}

const workflowDetail = [
  'Filter by source, date, role and track, or search. Newest first sorts by the posting date and falls back to the date the job was found. Similar roles are other ready jobs that share requirements and title terms with the one in front of you.',
  'A requirement your bank cannot speak to stays visible as a concern, and anything the parser could not read is listed for you to check by hand. Read the concerns next to the original posting before you decide.',
  'Highlights on the PDF only appear when the stored evidence matches the exact words on the page; bank evidence without a match on the page is labeled as such. The highlights never change the PDF itself.',
  'The companion offers Copy, Paste into the focused field and PDF Preview, Download and Attach. Attach may ask Chrome for access to the employer’s site. If the application page changes address, Attach is blocked for that tab, and custom upload widgets keep the download.',
];

export function workflow() {
  return layout({
    title: 'How Atriveo works | From the posting to your submit',
    description: 'Follow one job through fit, evidence, the tailored resume and the Chrome companion. See what stays connected, what is checked and what is always left to you.',
    canonical: `${site.url}workflow/`,
    kind: 'workflow',
    body: `<section class="guide-hero wrap"><a class="back-link" href="/landing/">← Atriveo</a><p class="intro">The details</p><h1>What happens<br>at each stop<span>.</span></h1><p>One job moves from the first look to the form you send. These are the checks along the way, and the choices that stay yours.</p></section>
<div class="guide-body wrap">${stages
      .map(
        (s, i) =>
          `<section class="guide-step" id="${s.id}"><span class="step-number">${n2(i)}</span><div><h2>${s.title}</h2><p>${s.body}</p><p>${workflowDetail[i]}</p></div></section>`,
      )
      .join('')}
<section class="setup-note"><h2>Setting up the Chrome companion</h2><p>The companion is distributed as an unpacked extension for approved users. Load the folder you were given in Chrome’s extensions page, then refresh Atriveo.</p><p>Choose Apply from Matching. If Chrome keeps the side panel closed, open Atriveo from the toolbar. You can choose how long the resume follows the application from page to page; after that it stays on the page where you left it.</p><p>Copy and PDF download stay available whenever a site needs a manual step.</p></section>
<section class="guide-access"><h2>Ready when you are.</h2><p>The workspace needs an approved account.</p><div class="guide-actions">${cta()}<a class="text-link" href="${site.login}">Sign in ${arrow}</a></div></section></div>`,
  });
}

export function missing() {
  return layout({
    title: 'Page not found | Atriveo',
    description: 'This part of the thread is missing. Head back to Atriveo.',
    canonical: site.url,
    noindex: true,
    kind: '404',
    body: `<section class="missing wrap"><p class="intro">404 · A loose end</p><h1>This thread<br>ends here<span>.</span></h1><p>The page you asked for has moved or never existed. The rest of the thread is one click away.</p>${cta('Back to Atriveo', 'primary', '/landing/')}<svg class="missing-thread" viewBox="0 0 600 200" fill="none" aria-hidden="true"><path d="M0 70h240q90 0 90 70t90 50h80"/><circle cx="500" cy="190" r="6"/></svg></section>`,
  });
}
