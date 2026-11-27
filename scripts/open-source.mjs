// The open source page (/open-source, docs/open-source-page.md): your pull requests in other people's repositories, synced
// from GitHub into Mongo `oss_prs`, next to the bank bullets that cite them.
//   gh.*    what GitHub says; every sync replaces it
//   mine.*  what you set on the page (rating, draft bullet, fits, skip, deleted); a sync never touches it
// A draft is a note until you approve it (approveDraft): it then goes into the bank overlay (Mongo `bank_overlay`, merged over
// the git bank by loadBank) with today's approval date and the bullet it prints with, and prints from the next build.
// `npm run bank:export` moves approved bullets into git (docs/open-source-rules.md section 1).

import { loadBank } from "./ac-bank.mjs";
import { classifyTrack, loadTracks } from "./ac-tracks.mjs";
import { lintBullet, resumeRoles } from "./ac-bullet-rules.mjs";
import { COMPANIES, measure, rate, ratingOf, SCORE_OF } from "./open-source-rating.mjs";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { OVERLAY_COLLECTION, syncOverlay } from "./ac-bank-overlay.mjs";
import { nyParts } from "./phone-summary.mjs";

export const PRS = "oss_prs";
export const STATE = "oss_state";
export class OpenSourceError extends Error {}

export const TRACK_CODE = { "software-engineer": "SWE", "ai-engineer": "AI", "data-science": "DS", "data-analytics": "DA", "forward-deployed": "FDE" };
const FITS = new Set(Object.values(TRACK_CODE));
const AREA_CODE = { backend: "BE", "full-stack": "FS", frontend: "FE", platform: "PL" };
const RATINGS = new Set(["impressive", "good", "average"]);
const PR_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/;

/** "https://github.com/owner/repo/pull/12" -> "owner/repo#12", the page's key for a pull request. */
export const prId = (url) => { const m = PR_URL.exec(String(url || "").trim()); return m ? `${m[1]}/${m[2]}#${m[3]}` : null; };

/** The GitHub account to sync (data/ac-bank/PROJECTS.yaml github_user). */
export function githubUser(bankDir = loadBank().bank_dir) {
  const login = yaml.load(fs.readFileSync(path.join(bankDir, "PROJECTS.yaml"), "utf8"))?.github_user;
  if (!/^[A-Za-z0-9-]{1,39}$/.test(login || "")) throw new OpenSourceError("data/ac-bank/PROJECTS.yaml has no github_user.");
  return login;
}

// ---- GitHub -------------------------------------------------------------------------------------------------------

const GRAPHQL = `query($q:String!,$c:String){search(query:$q,type:ISSUE,first:25,after:$c){pageInfo{hasNextPage endCursor} nodes{... on PullRequest{
  url number title state isDraft createdAt mergedAt closedAt additions deletions changedFiles reviewDecision body
  repository{nameWithOwner stargazerCount primaryLanguage{name} owner{login __typename}}
  files(first:100){nodes{path additions}}
  commits(first:60){nodes{commit{parents{totalCount} authors(first:1){nodes{user{login}}}}}}}}}}`;

async function githubJson(fetchImpl, url, init = {}) {
  const res = await fetchImpl(url, { ...init, headers: { Accept: "application/vnd.github+json", "User-Agent": "open-source-page", ...init.headers }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new OpenSourceError(res.status === 401 ? "GitHub refused the token (OSS_GITHUB_TOKEN)." : res.status === 403 || res.status === 429 ? "GitHub's rate limit is used up; try again in a few minutes." : `GitHub answered ${res.status}.`);
  const body = await res.json();
  if (body.errors?.length) throw new OpenSourceError(`GitHub: ${body.errors[0].message}`);
  return body;
}

/** Your share of a pull request's commits (merge commits aside); shared when under 60% are yours. */
function sharedWork(commits, login) {
  const own = commits.filter((c) => c.commit.parents.totalCount <= 1);
  if (!own.length) return false;
  const mine = own.filter((c) => c.commit.authors.nodes[0]?.user?.login?.toLowerCase() === login.toLowerCase()).length;
  return mine / own.length < 0.6;
}

/** One GraphQL pull request -> the fields the page keeps (never its description). */
export function fromGraphql(p, login) {
  const [owner] = p.repository.nameWithOwner.split("/");
  return {
    url: p.url, repo: p.repository.nameWithOwner, owner, n: p.number, title: p.title, state: p.state, draft: p.isDraft, review: p.reviewDecision || null,
    openedAt: p.createdAt, endedAt: p.mergedAt || p.closedAt || null, add: p.additions, del: p.deletions,
    stars: p.repository.stargazerCount, lang: p.repository.primaryLanguage?.name || null, personal: p.repository.owner.__typename === "User",
    shared: sharedWork(p.commits.nodes, login), ...measure({ files: p.files.nodes, body: p.body || "" }), files: p.changedFiles,
  };
}

/** One REST search result: status and dates only (no size, stars or language), used when there is no token. */
export function fromRest(i) {
  const repo = i.repository_url.split("/repos/")[1];
  return {
    url: i.html_url, repo, owner: repo.split("/")[0], n: i.number, title: i.title, draft: !!i.draft,
    state: i.pull_request?.merged_at ? "MERGED" : i.state === "open" ? "OPEN" : "CLOSED",
    openedAt: i.created_at, endedAt: i.pull_request?.merged_at || i.closed_at || null,
  };
}

/** Every pull request by `login` outside their own repositories. With a token: full facts. Without: status and dates. */
export async function fetchPullRequests({ login, token = process.env.OSS_GITHUB_TOKEN?.trim() || "", fetchImpl = fetch }) {
  const q = `author:${login} is:pr -user:${login}`;
  const out = [];
  if (token) {
    let cursor = null;
    for (let page = 0; page < 40; page += 1) {
      const body = await githubJson(fetchImpl, "https://api.github.com/graphql", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: GRAPHQL, variables: { q, c: cursor } }) });
      const s = body.data.search;
      out.push(...s.nodes.filter((x) => x?.url).map((x) => fromGraphql(x, login)));
      if (!s.pageInfo.hasNextPage) break;
      cursor = s.pageInfo.endCursor;
    }
    return { prs: out, full: true };
  }
  for (let page = 1; page <= 10; page += 1) {
    const body = await githubJson(fetchImpl, `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=100&page=${page}`);
    out.push(...body.items.map(fromRest));
    if (body.items.length < 100) break;
  }
  return { prs: out, full: false };
}

// ---- Sync ---------------------------------------------------------------------------------------------------------

let running = null;
/** Sync once; a second call while one runs waits for the same one. ifOlderMin: skip when the last good sync is newer. */
export function syncOpenSource(db, opts = {}) {
  running ??= runSync(db, opts).finally(() => { running = null; });
  return running;
}

export const syncing = () => running !== null;

/** Start a sync without waiting for it (a full one takes most of a minute); a failure is kept for the page to show. */
export function startSync(db, opts = {}) {
  syncOpenSource(db, opts).then(() => db.collection(STATE).updateOne({ _id: "sync" }, { $unset: { error: "" } }),
    (e) => db.collection(STATE).updateOne({ _id: "sync" }, { $set: { error: String(e.message || e) } }, { upsert: true })).catch(() => {});
  return { ok: true, syncing: true };
}

async function runSync(db, { ifOlderMin = 0, now = new Date(), login = githubUser(), ...opts } = {}) {
  const state = await db.collection(STATE).findOne({ _id: "sync" });
  if (ifOlderMin && state?.at && now - new Date(state.at) < ifOlderMin * 60_000) return { ok: true, skipped: true, at: state.at };
  const { prs, full } = await fetchPullRequests({ login, ...opts });
  const col = db.collection(PRS);
  const before = new Map((await col.find({}, { projection: { "gh.state": 1 } }).toArray()).map((d) => [d._id, d.gh?.state]));
  const added = [], changed = [];
  const ops = prs.map((gh) => {
    const _id = `${gh.repo}#${gh.n}`;
    if (!before.has(_id)) added.push(_id);
    else if (before.get(_id) && before.get(_id) !== gh.state) changed.push({ id: _id, from: before.get(_id), to: gh.state });
    // Field by field, so a sync without a token keeps the sizes and stars an earlier full one stored.
    const set = Object.fromEntries(Object.entries(gh).map(([k, v]) => [`gh.${k}`, v]));
    return { updateOne: { filter: { _id }, update: { $set: { ...set, syncedAt: now }, $setOnInsert: { createdAt: now } }, upsert: true } };
  });
  if (ops.length) await col.bulkWrite(ops, { ordered: false });
  const result = { at: now.toISOString(), login, full, count: prs.length, added, changed };
  await db.collection(STATE).updateOne({ _id: "sync" }, { $set: result }, { upsert: true });
  await refreshDemand(db, { now }).catch(() => {});
  await storeAudit(db, { now }).catch(() => {});
  return { ok: true, ...result };
}

// ---- What postings ask for ----------------------------------------------------------------------------------------

const SKILL = {
  Python: "python", Java: "java(?!script)", TypeScript: "typescript", JavaScript: "javascript", React: "react(?:\\.js|js)?", "Node.js": "node\\.?js",
  Go: "golang|go(?=\\s*[,/;)]|\\s+(?:and|or|programming|services))", Rust: "rust", "C++": "c\\+\\+", SQL: "sql|postgresql|mysql", Kubernetes: "kubernetes|k8s",
  Docker: "docker", AWS: "aws|amazon web services", Azure: "azure", GCP: "gcp|google cloud", Terraform: "terraform",
  "CI/CD": "ci/cd|continuous integration|github actions|gitlab ci|jenkins", Linux: "linux", LLMs: "llms?|large language models?", "AI agents": "agents?|agentic",
  RAG: "rag|retrieval.augmented", MCP: "mcp|model context protocol", PyTorch: "pytorch", TensorFlow: "tensorflow|keras", LangGraph: "langgraph|langchain",
  Kafka: "kafka|pulsar|jetstream", Microservices: "microservices?", GraphQL: "graphql", "REST APIs": "rest(?:ful)?(?: apis?)?",
  Observability: "observability|prometheus|grafana|datadog|telemetry", Testing: "unit tests?|unit testing|automated testing|test automation|pytest|playwright|integration tests?",
  Statistics: "statistics|statistical", Forecasting: "forecasting|time series", "A/B testing": "a/b test\\w*|experimentation", Accessibility: "accessibility|wcag|a11y", Security: "security",
};
const SKILL_RE = Object.fromEntries(Object.entries(SKILL).map(([k, v]) => [k, new RegExp(`(?<![a-z0-9+#])(?:${v})(?![a-z0-9+#])`, "i")]));
export const skillsIn = (text) => Object.keys(SKILL_RE).filter((k) => SKILL_RE[k].test(text));
const AREA_TITLE = { FS: /full.?stack/i, FE: /front.?end|\bui\b|react/i, BE: /back.?end/i, PL: /platform|devops|cloud|infrastructure|\bsre\b|reliability|kubernetes/i };

/** Share of recent postings naming each skill, per resume: { SWE: { n, skills: [[name, percent], ...] } }. Pure. */
export function demandOf(postings, doc = loadTracks()) {
  const groups = {};
  for (const { title, description } of postings) {
    const t = classifyTrack(title, doc);
    const track = t?.track ?? t?.id ?? t;
    const codes = [TRACK_CODE[track]].filter(Boolean);
    if (codes[0] === "SWE" || codes[0] === "FDE") for (const [k, re] of Object.entries(AREA_TITLE)) if (re.test(title)) codes.push(k);
    for (const c of codes) (groups[c] ??= []).push(new Set(skillsIn(description)));
  }
  return Object.fromEntries(Object.entries(groups).map(([k, L]) => [k, {
    n: L.length,
    skills: Object.keys(SKILL).map((s) => [s, Math.round((100 * L.filter((x) => x.has(s)).length) / L.length)]).filter((x) => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 14),
  }]));
}

/** Recount at most once a day, from the last 7 days of jobs that have a description. */
async function refreshDemand(db, { now = new Date(), days = 7, limit = 1500 } = {}) {
  const old = await db.collection(STATE).findOne({ _id: "demand" }, { projection: { at: 1 } });
  if (old?.at && now - new Date(old.at) < 86_400_000) return;
  const jobs = await db.collection("jobs").aggregate([
    { $match: { run_at: { $gte: new Date(now - days * 86_400_000).toISOString() } } }, { $sort: { run_at: -1 } },
    { $group: { _id: "$job_url", title: { $first: "$title" } } }, { $limit: limit },
  ]).toArray();
  const text = new Map((await db.collection("descriptions").find({ job_url: { $in: jobs.map((j) => j._id) } }, { projection: { _id: 0, job_url: 1, description: 1 } }).toArray()).map((d) => [d.job_url, d.description]));
  const postings = jobs.filter((j) => j.title && String(text.get(j._id) || "").length > 500).map((j) => ({ title: j.title, description: text.get(j._id) }));
  if (!postings.length) return;
  await db.collection(STATE).updateOne({ _id: "demand" }, { $set: { at: now.toISOString(), days, postings: postings.length, roles: demandOf(postings) } }, { upsert: true });
}

// ---- The page -----------------------------------------------------------------------------------------------------

const isRetired = (x) => Array.isArray(x?.tracks) && x.tracks.includes("retired");

/** The bank's live open source bullets. */
function bankBullets(bank) {
  return bank.acs.filter((a) => a.role === "open-source" && a.oss && !isRetired(a) && a.variants?.[0]?.text).map((a) => ({
    id: a.id, source: "bank", org: a.oss.org || "", project: a.oss.project, text: String(a.variants[0].text).trim(),
    fits: (a.fits || []).map((t) => TRACK_CODE[t]).filter(Boolean), areas: (a.areas || []).map((x) => AREA_CODE[x]).filter(Boolean),
    tech: a.signature_technologies || [], prs: (a.oss.prs || []).map(prId).filter(Boolean), shared: a.oss.shared === true,
    // Approved on this page and not yet exported to git (AC-U ids live in the overlay).
    pending: /^AC-U\d+$/.test(a.id) && a.oss.approved != null, company: companyOf(a)?.id ?? null, pair: a.oss.package?.partner ?? null,
  }));
}

// Company projects (OPEN-SOURCE.yaml company_projects): several bullets from one company print as one project.
let companiesCache = null;
function companies(bankDir) {
  if (companiesCache?.dir === bankDir) return companiesCache.list;
  let list = [];
  try { list = yaml.load(fs.readFileSync(path.join(bankDir, "OPEN-SOURCE.yaml"), "utf8"))?.company_projects || []; } catch { list = []; }
  companiesCache = { dir: bankDir, list };
  return list;
}
function companyOf(a, bankDir = loadBank().bank_dir) {
  const o = a?.oss;
  return o ? companies(bankDir).find((c) => (c.match?.org ? c.match.org === o.org : c.match?.project === o.project)) || null : null;
}

/** Everything the page shows. `docs`: oss_prs; `state`: { sync, demand }. Pure apart from reading the bank files. */
export function openSourceView(docs, state = {}, { bank = loadBank(), doc = loadTracks() } = {}) {
  const bullets = bankBullets(bank);
  const citedBy = new Map();
  for (const b of bullets) for (const id of b.prs) citedBy.set(id, [...(citedBy.get(id) || []), b]);
  const prs = docs.filter((d) => d.gh?.repo).map((d) => {
    const gh = d.gh, mine = d.mine || {}, cited = citedBy.get(d._id) || [];
    const auto = rate(gh);
    const rating = gh.state === "CLOSED" ? "closed" : RATINGS.has(mine.rating) ? mine.rating : auto?.rating ?? null;
    const coverage = mine.deleted ? "deleted" : gh.state === "CLOSED" ? "closed" : mine.skip ? "skipped" : cited.length ? "covered" : mine.text ? "draft" : "todo";
    return {
      id: d._id, url: gh.url, repo: gh.repo, owner: gh.owner, n: gh.n, title: gh.title, state: gh.state, review: gh.review ?? null, draft: !!gh.draft,
      openedAt: gh.openedAt ?? null, endedAt: gh.endedAt ?? null, add: gh.add ?? null, stars: gh.stars ?? null, lang: gh.lang ?? null, company: COMPANIES[gh.owner] || null,
      personal: gh.personal ?? null, shared: !!gh.shared, score: RATINGS.has(mine.rating) ? SCORE_OF[mine.rating] : auto?.score ?? null, parts: auto?.parts ?? null,
      rating, autoRating: auto?.rating ?? null, ratedByYou: RATINGS.has(mine.rating), coverage, bullets: cited.map((b) => b.id),
      text: mine.text || cited[0]?.text || "", fits: mine.fits || cited[0]?.fits || [], manual: !!d.manual, deleted: !!mine.deleted,
      why: mine.why || "",
    };
  });
  const byId = new Map(prs.map((p) => [p.id, p]));
  const drafts = prs.filter((p) => p.coverage === "draft").map((p) => ({ id: `draft:${p.id}`, source: "draft", org: p.company || "", project: p.repo.split("/")[1], text: p.text, fits: p.fits, areas: [], tech: skillsIn(p.text).slice(0, 3), prs: [p.id], shared: p.shared }));
  const rated = [...bullets, ...drafts].map((b) => {
    const own = b.prs.map((id) => byId.get(id)).filter(Boolean);
    const scores = own.map((p) => p.score).filter((s) => s != null);
    const score = scores.length ? Math.max(...scores) : null;
    const merged = own.length === b.prs.length && own.length > 0 && own.every((p) => p.state === "MERGED");
    // Ready for a resume: rated Good or better and his own work. Open pull requests count fully (2026-11-26, Atishay).
    return { ...b, score, rating: score == null ? null : ratingOf(score), merged, stars: Math.max(0, ...own.map((p) => p.stars || 0)), ready: own.length > 0 && score != null && score >= 6 && !b.shared };
  });
  const masters = Object.fromEntries(Object.entries(doc.tracks || {}).map(([t, x]) => [TRACK_CODE[t], (x.general_pinned?.projects?.["open-source"] || []).map((r) => String(r).split(":")[0])]).filter(([k]) => k));
  return {
    ok: true, sync: state.sync ?? null, demand: state.demand ?? null, audit: state.audit ?? null, bankVersion: String(bank.bank_version), prs, bullets: rated, masters,
    companies: companies(bank.bank_dir).map((c) => ({ id: c.id, heading: c.heading, skills: c.skills, description: c.description })),
    skills: Object.fromEntries(rated.map((b) => [b.id, skillsIn(`${b.text} ${b.tech.join(" ")}`)])),
  };
}

export async function loadOpenSource(db) {
  const [docs, sync, demand, audit] = await Promise.all([
    db.collection(PRS).find({}).toArray(),
    db.collection(STATE).findOne({ _id: "sync" }, { projection: { _id: 0 } }),
    db.collection(STATE).findOne({ _id: "demand" }, { projection: { _id: 0 } }),
    db.collection(STATE).findOne({ _id: "audit" }, { projection: { _id: 0 } }),
  ]);
  return { ...openSourceView(docs, { sync, demand, audit }), syncing: syncing() };
}

// ---- Your edits ---------------------------------------------------------------------------------------------------

/** The bank's bullet rules for an open source draft. Other open source bullets may share its verb (one set per resume). */
export function checkDraft(text, bank = loadBank()) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  const issues = [...lintBullet({ id: "new", role: "open-source", signature_technologies: [] }, t).issues];
  const verb = t.split(" ")[0].toLowerCase();
  const roles = resumeRoles(bank.bank_dir);
  const clash = bank.acs.find((a) => a.role !== "open-source" && roles.has(a.role) && !isRetired(a) && (a.variants || []).some((v) => String(v.text).trim().split(/\s+/)[0].toLowerCase() === verb));
  if (clash) issues.push(`"${t.split(" ")[0]}" already opens ${clash.id}`);
  return issues;
}

const need = async (db, id) => {
  const d = await db.collection(PRS).findOne({ _id: String(id || "") });
  if (!d) throw new OpenSourceError("That pull request isn't on the page.");
  return d;
};

/** Save what you set for one pull request. A field left out is unchanged; rating null goes back to the computed one. */
export async function savePr(db, { id, rating, text, fits, skip, why } = {}) {
  const d = await need(db, id);
  const set = {}, unset = {};
  if (rating !== undefined) {
    if (rating === null) unset["mine.rating"] = ""; else if (RATINGS.has(rating)) set["mine.rating"] = rating; else throw new OpenSourceError("Rating is impressive, good or average.");
  }
  if (text !== undefined) {
    const t = String(text).replace(/\s+/g, " ").trim();
    if (t.length > 600) throw new OpenSourceError("Keep the bullet under 600 characters.");
    const cited = bankBullets(loadBank()).find((b) => b.prs.includes(d._id));
    // The bank's own wording is never copied into a draft.
    if (!t || t === cited?.text) unset["mine.text"] = ""; else set["mine.text"] = t;
  }
  if (fits !== undefined) {
    if (!Array.isArray(fits) || fits.some((f) => !FITS.has(f))) throw new OpenSourceError("Unknown resume in Fits.");
    set["mine.fits"] = [...new Set(fits)];
  }
  // Skipping is the decision "no bullet"; its reason goes into data/ac-bank/OSS_DECISIONS.yaml with `npm run oss:export`.
  if (skip !== undefined) {
    if (skip) { set["mine.skip"] = true; const w = String(why ?? "").replace(/\s+/g, " ").trim().slice(0, 200); if (w) set["mine.why"] = w; }
    else { unset["mine.skip"] = ""; unset["mine.why"] = ""; }
  }
  if (Object.keys(set).length || Object.keys(unset).length) {
    await db.collection(PRS).updateOne({ _id: d._id }, { ...(Object.keys(set).length ? { $set: { ...set, "mine.at": new Date() } } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
  }
  return { ...(await loadOpenSource(db)), issues: checkDraft(text ?? d.mine?.text ?? "") };
}

/** Add one by its link (a pull request the sync can't find, e.g. from another account). */
export async function addPr(db, { url, title, state = "MERGED", date = null } = {}) {
  const id = prId(url);
  if (!id) throw new OpenSourceError("Paste a link like https://github.com/owner/repo/pull/123.");
  if (!["MERGED", "OPEN"].includes(state)) throw new OpenSourceError("Status is merged or open.");
  const t = String(title || "").trim().slice(0, 200);
  if (!t) throw new OpenSourceError("Give it a title.");
  if (date != null && date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new OpenSourceError("Use a date like 2026-11-25.");
  const old = await db.collection(PRS).findOne({ _id: id });
  if (old && !old.mine?.deleted) throw new OpenSourceError("That pull request is already on the page.");
  if (old) await db.collection(PRS).updateOne({ _id: id }, { $unset: { "mine.deleted": "" } });
  else {
    const [, owner, repo, n] = PR_URL.exec(String(url).trim());
    const at = date ? `${date}T12:00:00Z` : null;
    await db.collection(PRS).insertOne({ _id: id, manual: true, createdAt: new Date(), gh: { url: `https://github.com/${owner}/${repo}/pull/${n}`, repo: `${owner}/${repo}`, owner, n: Number(n), title: t, state, openedAt: state === "OPEN" ? at : null, endedAt: state === "MERGED" ? at : null } });
  }
  return { ...(await loadOpenSource(db)), id };
}

/** Take one off the page (kept in Mongo, so the next sync doesn't bring it back); restore undoes it. */
export async function deletePr(db, { id, restore = false } = {}) {
  const d = await need(db, id);
  await db.collection(PRS).updateOne({ _id: d._id }, restore ? { $unset: { "mine.deleted": "" } } : { $set: { "mine.deleted": true, "mine.at": new Date() } });
  return loadOpenSource(db);
}

// ---- Approving a bullet (docs/open-source-rules.md: only Atishay approves) --------------------------------------------

const TRACK_OF = Object.fromEntries(Object.entries(TRACK_CODE).map(([k, v]) => [v, k]));
const firstWord = (t) => String(t || "").trim().split(/\s+/)[0].toLowerCase();

/** The overlay entry for an approved draft. Pure: everything it needs is passed in. */
export function approvedEntry({ id, gh, text, fits, partner, bank, day }) {
  // Org and project as the bank already writes them for this repository, else the company and the repository's name.
  const same = bank.acs.find((a) => a.role === "open-source" && a.oss && (a.oss.prs || []).some((u) => prId(u)?.startsWith(`${gh.repo}#`)));
  const org = same?.oss.org ?? COMPANIES[gh.owner] ?? "";
  const project = same?.oss.project ?? gh.repo.split("/")[1];
  // Signature technologies must appear in the text (bank lint), so only names written in it count.
  const tech = skillsIn(text).filter((k) => text.toLowerCase().includes(k.toLowerCase()));
  const theme = `oss-page-${id.toLowerCase()}`;
  const tracks = fits.map((f) => TRACK_OF[f]);
  const signals = [...new Set([...tech.map((k) => k.toLowerCase()), project.toLowerCase(), org.toLowerCase()].filter(Boolean))];
  return {
    id, role: "open-source", fits: tracks, tracks, tier: "A", slot_kind: "project", achievement_theme: theme, display_order: 900, wow_score: 0.85,
    metrics_claimed: [...new Set((text.match(/\d[\d,.]*/g) || []).map((n) => `n_${n.replace(/[,.]/g, "")}`))], concepts_claimed: ["open-source"],
    signature_technologies: tech,
    fact: `Open source contribution (${org ? `${org} | ` : ""}${project}), approved ${day} on the open source page. Never employment${org ? ` at ${org}` : ""}.`,
    oss: {
      org, project, status: gh.state === "MERGED" ? "merged" : "open", approved: day, prs: [gh.url], ...(gh.shared ? { shared: true } : {}),
      package: { name: `page-${id.toLowerCase()}`, partner: partner.id, jd_signals: signals, strong_signals: [project.toLowerCase()] },
    },
    capabilities: { backend: 80 }, strength: { recruiter: 9 }, ats_keywords: tech,
    facets: { [theme]: { phrase: `${project} open source contribution`, keywords: tech.map((k) => k.toLowerCase()) } },
    variants: [{ facet: theme, emphasis: theme, strength: 9, text }],
  };
}

/**
 * Approve a draft into the bank: its wording passes every bullet rule, it fits at least one resume (never data analytics),
 * and it names the bullet it prints with (a different opening verb). Prints from the next resume build.
 */
export async function approveDraft(db, { id, text, fits, pair, now = new Date() } = {}) {
  const d = await need(db, id);
  const gh = d.gh || {};
  if (gh.state === "CLOSED") throw new OpenSourceError("Closed without merging, so it can't go on a resume.");
  await syncOverlay(db);
  const bank = loadBank();
  if (bankBullets(bank).some((b) => b.prs.includes(d._id))) throw new OpenSourceError("This pull request already has a bullet.");
  const t = String(text ?? d.mine?.text ?? "").replace(/\s+/g, " ").trim();
  if (!t) throw new OpenSourceError("Write the bullet first.");
  const issues = checkDraft(t, bank);
  if (issues.length) throw new OpenSourceError(`Not approved: ${issues.join("; ")}`);
  const codes = [...new Set(Array.isArray(fits) ? fits : d.mine?.fits || [])];
  if (codes.some((f) => !FITS.has(f))) throw new OpenSourceError("Unknown resume in Fits.");
  if (codes.includes("DA")) throw new OpenSourceError("Data analytics resumes never print open source; untick DA.");
  if (!codes.length) throw new OpenSourceError("Pick at least one resume it fits.");
  const partner = bank.acs.find((a) => a.id === pair && a.role === "open-source" && a.oss && !isRetired(a));
  if (!partner) throw new OpenSourceError("Pick the bullet it prints with.");
  if (firstWord(partner.variants?.[0]?.text) === firstWord(t)) throw new OpenSourceError(`It starts with the same word as ${partner.id}; pick another or change the verb.`);
  const col = db.collection(OVERLAY_COLLECTION);
  let n = (await col.countDocuments({ type: "new" })) + 1, newId = `AC-U${String(n).padStart(3, "0")}`;
  while (bank.acs.some((a) => a.id === newId) || await col.findOne({ _id: newId })) newId = `AC-U${String(++n).padStart(3, "0")}`;
  const ac = approvedEntry({ id: newId, gh, text: t, fits: codes, partner, bank, day: nyParts(now).day });
  await col.insertOne({ _id: newId, type: "new", source: "open-source page", pr: d._id, ac, createdAt: now.toISOString() });
  await db.collection(PRS).updateOne({ _id: d._id }, { $set: { "mine.approved": { id: newId, at: now } }, $unset: { "mine.skip": "", "mine.why": "" } });
  await syncOverlay(db);
  return { ...(await loadOpenSource(db)), approved: newId };
}

/** Take back a bullet approved on this page that is not in git yet. */
export async function unapproveDraft(db, { id } = {}) {
  const d = await need(db, id);
  const newId = d.mine?.approved?.id;
  if (!newId) throw new OpenSourceError("Nothing approved here to take back.");
  const r = await db.collection(OVERLAY_COLLECTION).deleteOne({ _id: newId, source: "open-source page" });
  if (!r.deletedCount) throw new OpenSourceError(`${newId} is already in git; retire it on the Bank page instead.`);
  await db.collection(PRS).updateOne({ _id: d._id }, { $unset: { "mine.approved": "" } });
  await syncOverlay(db);
  return loadOpenSource(db);
}

// ---- The weekly check (scripts/oss-audit.mjs), kept with each sync, and one push a week --------------------------------

/** Decisions: the file's, plus pull requests skipped on this page (with their reason). */
export function decisionsWith(fileDecisions, docs) {
  const known = new Set((fileDecisions || []).map((d) => d.pr));
  const page = docs.filter((d) => d.mine?.skip && !known.has(d._id)).map((d) => ({ pr: d._id, decision: "no-bullet", why: d.mine.why || "skipped on the open source page", decided: String(d.mine.at?.toISOString?.() ?? d.mine.at ?? "").slice(0, 10), state: d.gh?.state, page: true }));
  return [...(fileDecisions || []), ...page];
}

async function storeAudit(db, { now = new Date() } = {}) {
  const { audit } = await import("./oss-audit.mjs");
  const bank = loadBank();
  let file = [];
  try { file = yaml.load(fs.readFileSync(path.join(bank.bank_dir, "OSS_DECISIONS.yaml"), "utf8"))?.decisions || []; } catch { file = []; }
  const docs = await db.collection(PRS).find({}).toArray();
  const r = audit(bank, decisionsWith(file, docs), docs.filter((d) => d.gh?.repo).map((d) => d.gh));
  const slim = (x) => ({ pr: x.pr, title: x.title, state: x.state, rating: x.rating, score: x.score });
  const out = { at: now.toISOString(), fix: r.fix, revive: r.revive, draft: r.draft.map(slim), decidedChanged: r.decidedChanged.map(slim), watch: r.watch.length, totals: r.totals };
  await db.collection(STATE).updateOne({ _id: "audit" }, { $set: out }, { upsert: true });
  return out;
}

/** What the week's check asks you to decide: [count, sentence]. */
export function weekSummary(a) {
  if (!a) return [0, ""];
  const parts = [[a.draft?.length, "merged without a bullet"], [a.fix?.length, "bullets to fix"], [a.revive?.length, "retired bullets that can come back"], [a.decidedChanged?.length, "decisions whose pull request changed"]]
    .filter(([n]) => n > 0).map(([n, l]) => `${n} ${l}`);
  const n = (a.draft?.length || 0) + (a.fix?.length || 0) + (a.revive?.length || 0) + (a.decidedChanged?.length || 0);
  return [n, parts.join(", ")];
}

/** Sundays from 10:00 (New York), once a week, when the check found something: "Open source: 3 to decide". */
export async function tickOpenSourceWeek(db, { now = new Date(), deliver } = {}) {
  const { weekday, hour, day } = nyParts(now);
  if (weekday !== "Sun" || hour < 10 || hour >= 22) return false;
  const a = await db.collection(STATE).findOne({ _id: "audit" });
  const [n, what] = weekSummary(a);
  if (!n) return false;
  await deliver(`oss-week:${day}`, { title: `Open source: ${n} to decide`, body: what.charAt(0).toUpperCase() + what.slice(1), type: "oss_week", url: "/open-source" });
  return true;
}
