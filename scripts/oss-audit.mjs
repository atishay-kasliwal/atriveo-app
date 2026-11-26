// The weekly open source check (docs/open-source-rules.md). Reads GitHub and the bank; changes nothing.
//   npm run oss:audit                    report to stdout
//   npm run oss:audit -- --out <file>    also write it as Markdown
// GitHub: OSS_GITHUB_TOKEN, else `gh auth token`, else status and dates only (no ratings for new pull requests).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import yaml from "js-yaml";
import { loadBank } from "./ac-bank.mjs";
import { lintBullet } from "./ac-bullet-rules.mjs";
import { fetchPullRequests, githubUser, prId } from "./open-source.mjs";
import { rate } from "./open-source-rating.mjs";

const isRetired = (a) => (a.tracks || []).includes("retired");
const HYPHEN = /\b[A-Za-z]+-[A-Za-z]+\b/g;
// Product and project names that contain a hyphen are fine; any other hyphenated word is not (rules: wording).
const NAMES = new Set(["cloud-init", "PR-Agent", "ansible-lint", "yt-dlp", "math-mcp", "py-ml", "couch-tv", "git-koi", "rig-core", "k3d-cluster"]);
const starsIn = (text) => { const m = /\((\d+(?:\.\d+)?)K\+ GitHub stars\)/.exec(text); return m ? Number(m[1]) * 1000 : null; };

function token() {
  if (process.env.OSS_GITHUB_TOKEN?.trim()) return process.env.OSS_GITHUB_TOKEN.trim();
  try { return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; }
}

/** Pure: the findings, from the bank, the decisions file and what GitHub says now. */
export function audit(bank, decisions, prs) {
  const live = new Map(prs.map((p) => [`${p.repo}#${p.n}`, p]));
  const oss = bank.acs.filter((a) => a.role === "open-source" && a.oss);
  const cited = new Map();
  for (const a of oss) for (const u of a.oss.prs || []) cited.set(prId(u), [...(cited.get(prId(u)) || []), a]);
  const decided = new Map((decisions || []).map((d) => [d.pr, d]));
  const f = { fix: [], revive: [], draft: [], watch: [], decidedChanged: [] };

  for (const a of oss.filter((x) => !isRetired(x))) {
    const id = a.id, text = a.variants?.[0]?.text || "";
    const mine = (a.oss.prs || []).map((u) => live.get(prId(u)));
    if (mine.some((p) => !p)) f.fix.push({ id, issue: "cites a pull request GitHub no longer lists for this account" });
    if (mine.some((p) => p?.state === "CLOSED")) f.fix.push({ id, issue: "cites a pull request closed without merging: retire it" });
    const allMerged = mine.length && mine.every((p) => p?.state === "MERGED");
    if (a.oss.status === "open" && allMerged) f.fix.push({ id, issue: "every pull request has merged: set status merged and rescore (credibility goes up)" });
    if (a.oss.status === "merged" && !allMerged && !mine.some((p) => !p)) f.fix.push({ id, issue: "says merged, but a pull request is still open" });
    if (!a.oss.approved) f.fix.push({ id, issue: "no approval date: only Atishay approves a bullet (oss.approved)" });
    const score = Math.min(a.strength?.recruiter ?? 0, a.variants?.[0]?.strength ?? 0);
    if (score < 9) f.fix.push({ id, issue: `scores ${score}: reword with a real result or retire` });
    const lint = lintBullet(a, text);
    if (lint.issues.length) f.fix.push({ id, issue: `bullet rules: ${lint.issues.join("; ")}` });
    const hy = (text.match(HYPHEN) || []).filter((w) => !NAMES.has(w));
    if (hy.length) f.fix.push({ id, issue: `hyphenated words: ${hy.join(", ")}` });
    const claimed = starsIn(text), stars = Math.max(0, ...mine.map((p) => p?.stars ?? 0));
    if (claimed && stars && stars < claimed) f.fix.push({ id, issue: `claims ${claimed / 1000}K+ stars, the project has ${stars}` });
  }
  for (const a of oss.filter(isRetired)) {
    const mine = (a.oss.prs || []).map((u) => live.get(prId(u)));
    if (a.oss.status === "open" && mine.length && mine.every((p) => p?.state === "MERGED")) f.revive.push({ id: a.id, issue: "retired while open; every pull request has now merged: rescore it" });
  }
  for (const p of prs) {
    const k = `${p.repo}#${p.n}`;
    if (cited.has(k) || p.state === "CLOSED") continue;
    const d = decided.get(k), r = rate(p);
    const row = { pr: k, url: p.url, title: p.title, state: p.state, stars: p.stars ?? null, score: r?.score ?? null, rating: r?.rating ?? "not rated", shared: !!p.shared };
    if (d) { if (d.state && d.state !== p.state) f.decidedChanged.push({ ...row, was: d.state, why: d.why }); continue; }
    (p.state === "MERGED" ? f.draft : f.watch).push(row);
  }
  const by = (a, b) => (b.score ?? -1) - (a.score ?? -1);
  f.draft.sort(by); f.watch.sort(by);
  return { ...f, totals: { prs: prs.length, merged: prs.filter((p) => p.state === "MERGED").length, open: prs.filter((p) => p.state === "OPEN").length, live: oss.filter((x) => !isRetired(x)).length, retired: oss.filter(isRetired).length } };
}

export function report(r, { date = new Date().toISOString().slice(0, 10), full = true } = {}) {
  const L = [`# Open source audit, ${date}`, "", `${r.totals.prs} pull requests on GitHub (${r.totals.merged} merged, ${r.totals.open} open). Bank: ${r.totals.live} live bullets, ${r.totals.retired} retired.${full ? "" : " **Status-only run: no token, so new pull requests are not rated.**"}`, ""];
  const table = (rows) => ["| PR | State | Stars | Rating | Title |", "|---|---|---|---|---|", ...rows.map((x) => `| [${x.pr}](${x.url}) | ${x.state.toLowerCase()}${x.was ? ` (was ${x.was.toLowerCase()})` : ""} | ${x.stars ?? ""} | ${x.rating}${x.score != null ? ` ${x.score}` : ""}${x.shared ? ", shared" : ""} | ${String(x.title).replace(/\|/g, "/")} |`)];
  L.push(`## 1. Fix in the bank (${r.fix.length})`, "", ...(r.fix.length ? r.fix.map((x) => `- **${x.id}**: ${x.issue}`) : ["Nothing."]), "");
  L.push(`## 2. Retired bullets that can come back (${r.revive.length})`, "", ...(r.revive.length ? r.revive.map((x) => `- **${x.id}**: ${x.issue}`) : ["Nothing."]), "");
  L.push(`## 3. Merged, no bullet, no decision yet (${r.draft.length})`, "", "Draft a bullet only for those that can honestly reach 9; record the rest in OSS_DECISIONS.yaml.", "", ...(r.draft.length ? table(r.draft) : ["Nothing."]), "");
  L.push(`## 4. Decided earlier, status changed since (${r.decidedChanged.length})`, "", ...(r.decidedChanged.length ? table(r.decidedChanged) : ["Nothing."]), "");
  L.push(`## 5. Still open, no bullet (${r.watch.length})`, "", "An open pull request needs a measured result to reach 9. Most wait here until they merge.", "", ...(r.watch.length ? table(r.watch) : ["Nothing."]), "");
  return L.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const bank = loadBank();
  const decisions = yaml.load(fs.readFileSync(path.join(bank.bank_dir, "OSS_DECISIONS.yaml"), "utf8"))?.decisions || [];
  const { prs, full } = await fetchPullRequests({ login: githubUser(bank.bank_dir), token: token() });
  const text = report(audit(bank, decisions, prs), { full });
  console.log(text);
  const at = process.argv.indexOf("--out");
  if (at > 0 && process.argv[at + 1]) { fs.writeFileSync(process.argv[at + 1], `${text}\n`); console.error(`Written to ${process.argv[at + 1]}`); }
}
