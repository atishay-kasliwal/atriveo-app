// Is a job posting still open? Exact for Greenhouse, Ashby and Lever (their public APIs), "unknown" for everything else.
//   import { postingAlive } from "./posting-alive.mjs";   await postingAlive("https://job-boards.greenhouse.io/acme/jobs/123")
//   node scripts/posting-alive.mjs <file.json>            [{id, url, ...}] -> prints a summary and writes <file>.alive.json
import fs from "node:fs";

const get = async (url, fetchImpl) => { const r = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) }); return r; };
const ashbyBoards = new Map();

/** "open" | "closed" | "unknown" for one posting URL. */
export async function postingAlive(rawUrl, { fetchImpl = fetch } = {}) {
  let u; try { u = new URL(rawUrl); } catch { return { state: "unknown", why: "not a URL" }; }
  const host = u.hostname.replace(/^www\./, ""), parts = u.pathname.split("/").filter(Boolean);
  try {
    if (/(^|\.)greenhouse\.io$/.test(host) && parts[1] === "jobs" && /^\d+$/.test(parts[2] ?? "")) {
      const r = await get(`https://boards-api.greenhouse.io/v1/boards/${parts[0]}/jobs/${parts[2]}`, fetchImpl);
      return r.status === 200 ? { state: "open" } : r.status === 404 ? { state: "closed" } : { state: "unknown", why: `greenhouse ${r.status}` };
    }
    if (host === "jobs.lever.co" && parts.length >= 2) {
      const r = await get(`https://api.lever.co/v0/postings/${parts[0]}/${parts[1]}`, fetchImpl);
      return r.status === 200 ? { state: "open" } : r.status === 404 ? { state: "closed" } : { state: "unknown", why: `lever ${r.status}` };
    }
    if (host === "jobs.ashbyhq.com" && parts.length >= 2) {
      const org = parts[0], id = parts[1];
      if (!ashbyBoards.has(org)) {
        const r = await get(`https://api.ashbyhq.com/posting-api/job-board/${org}`, fetchImpl);
        ashbyBoards.set(org, r.status === 200 ? new Set((await r.json()).jobs?.map((j) => String(j.id)) ?? []) : r.status === 404 ? "gone" : null);
      }
      const set = ashbyBoards.get(org);
      if (set === "gone") return { state: "closed", why: "the company's job board no longer exists" };
      if (!set) return { state: "unknown", why: "ashby board unreadable" };
      return { state: set.has(id) ? "open" : "closed" };
    }
    return { state: "unknown", why: `not a board with a public API (${host})` };
  } catch (e) { return { state: "unknown", why: e.message.slice(0, 60) }; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  const out = [], counts = {};
  for (let i = 0; i < rows.length; i += 6) {
    const batch = await Promise.all(rows.slice(i, i + 6).map(async (r) => ({ ...r, ...(await postingAlive(r.url)) })));
    out.push(...batch); await new Promise((r) => setTimeout(r, 250));
  }
  for (const r of out) { const k = `${r.kind ?? ""} ${r.state}`.trim(); counts[k] = (counts[k] || 0) + 1; }
  fs.writeFileSync(file.replace(/\.json$/, ".alive.json"), JSON.stringify(out, null, 1));
  console.log(`${out.length} postings checked`); for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k.padEnd(22)} ${v}`);
}
