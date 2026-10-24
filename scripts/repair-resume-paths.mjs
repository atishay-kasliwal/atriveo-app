// Repair applications whose resume file no longer exists, by pointing them at a resume that does.
//   node --env-file=.env scripts/repair-resume-paths.mjs                     report only (changes nothing)
//   node --env-file=.env scripts/repair-resume-paths.mjs --apply             repoint the ones that can be repaired; every change is logged
//   node --env-file=.env scripts/repair-resume-paths.mjs --undo <batch>      put a batch back exactly as it was
//   --rebuild-open     for the ones with no resume to repoint to: check their posting (Greenhouse, Ashby, Lever) and queue a resume
//                      rebuild for each posting that is still open. Once a rebuild finishes, a later --apply repoints the application.
//   --retire-closed    discard (the app's own Discard: marks them skipped, keeps history, protects anything active or attempted)
//                      the ones whose posting is closed. Needs TAILOR_TOKEN and the dashboard on 127.0.0.1:8787 (run it in that container).
//   options: --status NEEDS_REVIEW (default; comma list)  --exists-from <file>  --json <file>
//
// Run it where the resume files are (inside the dashboard container on Oracle: the same /Users/... paths are mounted there).
// --exists-from <file> instead reads "OK<TAB>path" lines, for running it somewhere else.
//
// A record is repaired only when there is a safe target, in this order:
//   1. a finished resume of the same job (jobs.resume.status = success) whose file exists, newest first
//   2. another PDF in the application's own resume folder (the folder survived, the file was renamed)
// Anything else is reported as "needs a rebuild" and left alone. Only these fields change: resume.path, fileName, sha256, bytes,
// verifiedAt (cleared so the engine verifies the new file before use) and updatedAt. The old values go to the repair_log collection.
import fs from "node:fs";
import path from "node:path";
import { withMongo } from "./mongo-client.mjs";
import { postingAlive } from "./posting-alive.mjs";
import { enqueueJob } from "./resume-queue.mjs";

const OPEN = ["NEEDS_REVIEW"];

/** Pure: decide what to do with each application. exists(p) and pdfsIn(dir) are injected so this is testable. */
export function planRepairs(apps, jobsByUrl, { exists, pdfsIn }) {
  const plan = { ok: [], repair: [], rebuild: [] };
  for (const a of apps) {
    const old = a.resume?.path;
    if (!old) { plan.rebuild.push({ app: a, reason: "no resume path recorded" }); continue; }
    if (exists(old)) { plan.ok.push(a); continue; }
    const urls = [...new Set([a.resume?.sourceJobUrl, ...(a.jobUrls || []), a.url].filter(Boolean))];
    const finished = urls.flatMap((u) => jobsByUrl.get(u) || [])
      .filter((j) => j.resume?.status === "success" && j.resume?.pdf_path && exists(j.resume.pdf_path))
      .sort((x, y) => String(y.resume.updated_at ?? "").localeCompare(String(x.resume.updated_at ?? "")));
    if (finished[0]) { plan.repair.push({ app: a, to: finished[0].resume.pdf_path, via: "the job's finished resume", jobUrl: finished[0].job_url }); continue; }
    const sibling = pdfsIn(path.dirname(old)).find((f) => !/cover.?letter/i.test(f));
    if (sibling) { plan.repair.push({ app: a, to: path.join(path.dirname(old), sibling), via: "another PDF in its own folder" }); continue; }
    plan.rebuild.push({ app: a, reason: urls.length ? "no finished resume for this job" : "no job link" });
  }
  return plan;
}

export async function applyRepairs(db, repairs, { now = new Date(), batch = now.toISOString().replace(/[:.]/g, "-") } = {}) {
  const apps = db.collection("applications"), log = db.collection("repair_log");
  for (const r of repairs) {
    const before = { path: r.app.resume.path, fileName: r.app.resume.fileName ?? null, sha256: r.app.resume.sha256 ?? null, bytes: r.app.resume.bytes ?? null, verifiedAt: r.app.resume.verifiedAt ?? null };
    await log.insertOne({ batch, at: now, applicationId: r.app._id, company: r.app.company, title: r.app.title, before, after: { path: r.to }, via: r.via });
    await apps.updateOne({ _id: r.app._id, "resume.path": before.path }, { $set: { "resume.path": r.to, "resume.fileName": path.basename(r.to), "resume.sha256": null, "resume.bytes": null, "resume.verifiedAt": null, updatedAt: now.toISOString() } });
  }
  return batch;
}

/** Sort the applications that need a rebuild by whether their posting is still open. alive(url) -> {state}. */
export async function classifyRebuilds(items, { alive = postingAlive } = {}) {
  const out = { open: [], closed: [], unknown: [] };
  for (let i = 0; i < items.length; i += 6) {
    await Promise.all(items.slice(i, i + 6).map(async (r) => {
      const a = r.app, url = a.applyUrl || a.finalUrl || a.url;
      const res = url ? await alive(url) : { state: "unknown", why: "no apply link" };
      out[res.state === "open" ? "open" : res.state === "closed" ? "closed" : "unknown"].push({ ...r, url, why: res.why ?? null });
    }));
    await new Promise((r) => setTimeout(r, 200));
  }
  return out;
}

/** Queue a resume rebuild for each of these applications' jobs. enqueue(db, job, opts) is the resume queue's own. */
export async function enqueueRebuilds(db, items, { enqueue = enqueueJob, priority = Number(process.env.REBUILD_PRIORITY ?? 500) } = {}) {
  const done = { queued: 0, skipped: 0, errors: [] };
  for (const r of items) {
    const a = r.app, job_url = a.resume?.sourceJobUrl || (a.jobUrls || [])[0] || a.url;
    try {
      const res = await enqueue(db, { job_url, company: a.company, title: a.title, priority, source: "repair" }, {});
      res.skipped ? done.skipped++ : done.queued++;
    } catch (e) { done.errors.push(`${a.company}: ${e.message}`); }
  }
  return done;
}

/** The app's own Discard, in two steps (preview what is eligible, then confirm exactly that). post(body) -> parsed JSON. */
export async function discardApplications(ids, { post, batch = 20 } = {}) {
  const out = { discarded: 0, protectedOrFailed: [] };
  for (let i = 0; i < ids.length; i += batch) {
    const chunk = ids.slice(i, i + batch);
    const preview = await post({ action: "discard_applications", operation: "preview", ids: chunk });
    const targets = (preview.targets || []).map(({ id, updatedAt }) => ({ id, updatedAt }));
    const ineligible = chunk.filter((id) => !targets.some((t) => t.id === id));
    out.protectedOrFailed.push(...ineligible);
    if (!targets.length) continue;
    const res = await post({ action: "discard_applications", operation: "confirm", targets });
    out.discarded += (res.discarded || []).length;
    for (const e of res.errors || []) out.protectedOrFailed.push(e.id ?? e.error ?? String(e));
  }
  return out;
}

export async function undoBatch(db, batch, { now = new Date() } = {}) {
  const rows = await db.collection("repair_log").find({ batch }).toArray();
  for (const r of rows) {
    await db.collection("applications").updateOne({ _id: r.applicationId }, { $set: { "resume.path": r.before.path, "resume.fileName": r.before.fileName, "resume.sha256": r.before.sha256, "resume.bytes": r.before.bytes, "resume.verifiedAt": r.before.verifiedAt, updatedAt: now.toISOString() } });
  }
  return rows.length;
}

async function main() {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const statuses = (arg("--status") || OPEN.join(",")).split(",");
  const existsFrom = arg("--exists-from");
  let exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  if (existsFrom) {
    const ok = new Set(fs.readFileSync(existsFrom, "utf8").split("\n").filter((l) => l.startsWith("OK\t")).map((l) => l.slice(3)));
    exists = (p) => ok.has(p.replace("/Users/atishaykasliwal/Documents/tailored-resumes/", ""));
  }
  const pdfsIn = (dir) => { try { return fs.readdirSync(dir).filter((f) => /\.pdf$/i.test(f)); } catch { return []; } };
  await withMongo(async (db) => {
    if (arg("--undo")) { console.log(`restored ${await undoBatch(db, arg("--undo"))} applications from batch ${arg("--undo")}`); return; }
    const apps = await db.collection("applications").find({ status: { $in: statuses } }, { projection: { status: 1, company: 1, title: 1, jobUrls: 1, url: 1, applyUrl: 1, finalUrl: 1, "resume.path": 1, "resume.fileName": 1, "resume.sha256": 1, "resume.bytes": 1, "resume.verifiedAt": 1, "resume.sourceJobUrl": 1 } }).toArray();
    const urls = [...new Set(apps.flatMap((a) => [a.resume?.sourceJobUrl, ...(a.jobUrls || []), a.url]).filter(Boolean))];
    const jobs = await db.collection("jobs").find({ job_url: { $in: urls } }, { projection: { job_url: 1, "resume.status": 1, "resume.pdf_path": 1, "resume.updated_at": 1 } }).toArray();
    const jobsByUrl = new Map(); for (const j of jobs) (jobsByUrl.get(j.job_url) || jobsByUrl.set(j.job_url, []).get(j.job_url)).push(j);
    const plan = planRepairs(apps, jobsByUrl, { exists, pdfsIn });
    console.log(`${apps.length} applications (${statuses.join(", ")}): ${plan.ok.length} have their resume, ${plan.repair.length} can be repointed, ${plan.rebuild.length} need a rebuild`);
    for (const r of plan.repair) console.log(`  repair  ${String(r.app.company).slice(0, 22).padEnd(22)} ${String(r.app.title).slice(0, 34).padEnd(34)} -> ${r.to.split("tailored-resumes/")[1] ?? r.to}  (${r.via})`);
    if (arg("--json")) fs.writeFileSync(arg("--json"), JSON.stringify({ repair: plan.repair.map((r) => ({ id: r.app._id, to: r.to, via: r.via })), rebuild: plan.rebuild.map((r) => ({ id: r.app._id, company: r.app.company, title: r.app.title, reason: r.reason })) }, null, 1));
    if (process.argv.includes("--rebuild-open") || process.argv.includes("--retire-closed")) {
      const apply = process.argv.includes("--apply");
      const sorted = await classifyRebuilds(plan.rebuild);
      console.log(`of the ${plan.rebuild.length} that need a rebuild: ${sorted.open.length} postings still open, ${sorted.closed.length} closed, ${sorted.unknown.length} could not be read`);
      if (process.argv.includes("--rebuild-open")) {
        if (!apply) console.log(`  would queue ${sorted.open.length} resume rebuilds (add --apply)`);
        else { const r = await enqueueRebuilds(db, sorted.open); console.log(`  queued ${r.queued} rebuilds, ${r.skipped} already queued or built, ${r.errors.length} errors${r.errors[0] ? `: ${r.errors[0]}` : ""}`); }
      }
      if (process.argv.includes("--retire-closed")) {
        if (!apply) console.log(`  would discard ${sorted.closed.length} applications with closed postings (add --apply)`);
        else {
          const token = process.env.TAILOR_TOKEN?.trim() || "", port = process.env.PORT || 8787;
          const post = async (body) => { const res = await fetch(`http://127.0.0.1:${port}/applications/action`, { method: "POST", headers: { "Content-Type": "application/json", ...(token && { "X-Tailor-Token": token }) }, body: JSON.stringify(body) }); const j = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` })); if (!j.ok) throw new Error(j.error || `HTTP ${res.status}`); return j; };
          const r = await discardApplications(sorted.closed.map((x) => String(x.app._id)), { post });
          console.log(`  discarded ${r.discarded}; protected or failed: ${r.protectedOrFailed.length}`);
        }
      }
    }
    if (process.argv.includes("--apply")) {
      if (!plan.repair.length) { console.log("nothing to repair"); return; }
      const batch = await applyRepairs(db, plan.repair);
      console.log(`repointed ${plan.repair.length} applications. Undo with: --undo ${batch}`);
    } else console.log("(report only: nothing was changed; add --apply to repoint)");
  }, { appName: "AtriveoRepairResumePaths" });
  process.exit(0);
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
