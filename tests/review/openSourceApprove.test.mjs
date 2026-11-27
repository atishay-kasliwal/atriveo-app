// Approving open source bullets on the page (2026-11-27, Atishay: "approve in the page"), the weekly check kept with each
// sync, its Sunday push, and the export of page decisions and packages to git. docs/open-source-rules.md section 1.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The overlay's local copy is read from AC_BANK_OVERLAY, fixed when ac-bank-overlay.mjs loads: set it first.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oss-approve-"));
process.env.AC_BANK_OVERLAY = path.join(tmp, "overlay.json");

const { loadBank } = await import("../../scripts/ac-bank.mjs");
const { overlayOssPackages, withOverlayOssPackages } = await import("../../scripts/ac-bank-overlay.mjs");
const { loadPlannerConfig } = await import("../../scripts/ac-planner.mjs");
const { ossHeading } = await import("../../scripts/ac-tex.mjs");
const { lintBullet } = await import("../../scripts/ac-bullet-rules.mjs");
const { approveDraft, approvedEntry, decisionsWith, tickOpenSourceWeek, unapproveDraft, weekSummary } = await import("../../scripts/open-source.mjs");
const { decisionLines } = await import("../../scripts/oss-export-decisions.mjs");
const { exportOssPackages } = await import("../../scripts/export-bank-overlay.mjs");

const TEXT = "Simplified the NVKE GPU Kubernetes engine in Go so a stale node recovers in 1 step instead of 3, covered by 12 test cases.";
const GH = { url: "https://github.com/dsx-ai-factory/nvke/pull/9999", repo: "dsx-ai-factory/nvke", owner: "dsx-ai-factory", n: 9999, title: "fix(node): one step recovery", state: "MERGED", stars: 40 };
const writeOverlay = (entries) => fs.writeFileSync(process.env.AC_BANK_OVERLAY, JSON.stringify({ entries }));

// A small stand-in for the Mongo collections the page uses.
function fakeDb(seed = {}) {
  const cols = new Map(Object.entries(seed).map(([k, v]) => [k, v.map((d) => structuredClone(d))]));
  const col = (name) => { if (!cols.has(name)) cols.set(name, []); return cols.get(name); };
  const match = (d, q) => Object.entries(q || {}).every(([k, v]) => {
    const val = k.split(".").reduce((o, x) => o?.[x], d);
    return v && typeof v === "object" && "$exists" in v ? (val !== undefined) === v.$exists : val === v;
  });
  const setPath = (d, k, v) => { const ks = k.split("."); let o = d; for (const x of ks.slice(0, -1)) o = o[x] ??= {}; o[ks.at(-1)] = v; };
  const unsetPath = (d, k) => { const ks = k.split("."); let o = d; for (const x of ks.slice(0, -1)) { o = o?.[x]; if (!o) return; } delete o[ks.at(-1)]; };
  return {
    cols,
    collection: (name) => ({
      find: (q) => ({ sort: () => ({ toArray: async () => col(name).filter((d) => match(d, q)) }), toArray: async () => col(name).filter((d) => match(d, q)) }),
      findOne: async (q) => col(name).find((d) => match(d, q)) ?? null,
      countDocuments: async (q) => col(name).filter((d) => match(d, q)).length,
      insertOne: async (d) => { col(name).push(structuredClone(d)); },
      deleteOne: async (q) => { const i = col(name).findIndex((d) => match(d, q)); if (i >= 0) col(name).splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; },
      updateOne: async (q, u, o = {}) => {
        let d = col(name).find((x) => match(x, q));
        if (!d && o.upsert) { d = { ...q }; col(name).push(d); }
        if (!d) return { modifiedCount: 0 };
        for (const [k, v] of Object.entries(u.$set || {})) setPath(d, k, v);
        for (const k of Object.keys(u.$unset || {})) unsetPath(d, k);
        return { modifiedCount: 1 };
      },
    }),
  };
}

test("an approved draft becomes a full bank entry: approved today, tier A, its package, and it passes the bank lint", () => {
  writeOverlay([]);
  const bank = loadBank();
  const partner = bank.acs.find((a) => a.id === "AC-321");
  const ac = approvedEntry({ id: "AC-U901", gh: GH, text: TEXT, fits: ["SWE", "FDE"], partner, bank, day: "2026-11-27" });
  assert.equal(ac.role, "open-source");
  assert.deepEqual(ac.tracks, ["software-engineer", "forward-deployed"]);
  assert.equal(ac.tier, "A");
  assert.equal(ac.oss.approved, "2026-11-27");
  assert.equal(ac.oss.status, "merged");
  // The bank already writes this repository as NVIDIA's NVKE, so the new entry does too: it joins the NVIDIA project.
  assert.equal(ac.oss.org, "NVIDIA");
  assert.equal(ac.oss.project, "NVKE");
  assert.deepEqual(ac.oss.package.partner, "AC-321");
  assert.ok(ac.signature_technologies.every((t) => TEXT.toLowerCase().includes(t.toLowerCase())));
  assert.deepEqual(lintBullet(ac, TEXT).issues, []);
});

test("an approved bullet prints: its package joins the open source pool, and it heads the company project", () => {
  const bank = loadBank();
  const ac = approvedEntry({ id: "AC-U901", gh: GH, text: TEXT, fits: ["SWE"], partner: bank.acs.find((a) => a.id === "AC-321"), bank, day: "2026-11-27" });
  writeOverlay([{ _id: "AC-U901", type: "new", ac }]);
  assert.deepEqual(overlayOssPackages().map((p) => p.ids), [["AC-U901", "AC-321"]]);
  const pool = loadPlannerConfig("v2").canonical_pools["open-source"];
  assert.ok(pool.ac_ids.includes("AC-U901"));
  assert.ok(pool.story_packages.some((p) => p.ids.join() === "AC-U901,AC-321"));
  // Once in git (the same pair already in the planner), it isn't added twice.
  const twice = withOverlayOssPackages(loadPlannerConfig("v2"));
  assert.equal(twice.canonical_pools["open-source"].story_packages.filter((p) => p.ids.join() === "AC-U901,AC-321").length, 1);
  const live = loadBank();
  assert.equal(live.tiers["AC-U901"], "A");
  assert.ok(live.acs.some((a) => a.id === "AC-U901"));
  const h = ossHeading([{ ac_id: "AC-U901" }, { ac_id: "AC-321" }]);
  assert.equal(h.text, "NVIDIA (Open Source)");
  // A retired overlay bullet, or one without a partner, adds nothing.
  writeOverlay([{ _id: "AC-U902", type: "new", ac: { ...ac, id: "AC-U902", tracks: ["retired"] } }, { _id: "AC-U903", type: "new", ac: { ...ac, id: "AC-U903", oss: { ...ac.oss, package: null } } }]);
  assert.deepEqual(overlayOssPackages(), []);
  writeOverlay([]);
});

test("approving on the page: rules first, then the overlay; taking it back removes it", async () => {
  writeOverlay([]);
  const db = fakeDb({ oss_prs: [{ _id: "dsx-ai-factory/nvke#9999", gh: GH, mine: { text: TEXT, fits: ["SWE"] } }], oss_state: [], bank_overlay: [] });
  const id = "dsx-ai-factory/nvke#9999";
  await assert.rejects(approveDraft(db, { id, text: TEXT, fits: ["SWE"], pair: "AC-999" }), /prints with/);
  await assert.rejects(approveDraft(db, { id, text: TEXT, fits: ["DA"], pair: "AC-321" }), /Data analytics/);
  await assert.rejects(approveDraft(db, { id, text: TEXT, fits: [], pair: "AC-321" }), /at least one resume/);
  await assert.rejects(approveDraft(db, { id, text: "Repaired it, adding 1 test.", fits: ["SWE"], pair: "AC-321" }), /same word|Not approved/);
  await assert.rejects(approveDraft(db, { id, text: "Hardened the engine with 2 tests.", fits: ["SWE"], pair: "AC-321" }), /Not approved/);
  const view = await approveDraft(db, { id, text: TEXT, fits: ["SWE", "FDE"], pair: "AC-321", now: new Date("2026-11-27T15:00:00Z") });
  assert.match(view.approved, /^AC-U\d{3}$/);
  const entry = db.cols.get("bank_overlay")[0];
  assert.equal(entry.source, "open-source page");
  assert.equal(entry.ac.oss.approved, "2026-11-27");
  assert.equal(db.cols.get("oss_prs")[0].mine.approved.id, view.approved);
  // The page now shows it covered, as a pending bank bullet.
  assert.equal(view.prs.find((p) => p.id === id).coverage, "covered");
  assert.equal(view.bullets.find((b) => b.id === view.approved).pending, true);
  await assert.rejects(approveDraft(db, { id, text: TEXT, fits: ["SWE"], pair: "AC-321" }), /already has a bullet/);
  const back = await unapproveDraft(db, { id });
  assert.equal(db.cols.get("bank_overlay").length, 0);
  assert.equal(back.prs.find((p) => p.id === id).coverage, "draft");
  writeOverlay([]);
});

test("page skips count as decisions, export to OSS_DECISIONS.yaml once, and the week's summary counts what to decide", () => {
  const docs = [
    { _id: "a/b#1", gh: { state: "MERGED" }, mine: { skip: true, why: "docs only", at: new Date("2026-11-27T10:00:00Z") } },
    { _id: "a/b#2", gh: { state: "OPEN" }, mine: { skip: true } },
    { _id: "a/b#3", gh: { state: "MERGED" }, mine: {} },
  ];
  const file = [{ pr: "a/b#2", decision: "no-bullet", why: "listed", decided: "2026-11-25" }];
  const all = decisionsWith(file, docs);
  assert.deepEqual(all.map((d) => d.pr), ["a/b#2", "a/b#1"]);
  assert.equal(all[1].why, "docs only");
  assert.deepEqual(decisionLines(file, docs), ["  - pr: a/b#1", "    state: MERGED", "    decision: no-bullet", '    why: "docs only"', '    decided: "2026-11-27"']);
  assert.deepEqual(weekSummary(null), [0, ""]);
  assert.deepEqual(weekSummary({ draft: [{}, {}], fix: [{}], revive: [], decidedChanged: [] }), [3, "2 merged without a bullet, 1 bullets to fix"]);
});

test("the Sunday push: once, from 10:00 New York, only when there is something to decide", async () => {
  const sent = [];
  const deliver = async (id, n) => { sent.push([id, n]); };
  const db = fakeDb({ oss_state: [{ _id: "audit", draft: [{ pr: "x/y#1" }], fix: [], revive: [], decidedChanged: [] }] });
  assert.equal(await tickOpenSourceWeek(db, { now: new Date("2026-11-28T16:00:00Z"), deliver }), false); // Saturday
  assert.equal(await tickOpenSourceWeek(db, { now: new Date("2026-11-29T13:00:00Z"), deliver }), false); // Sunday 08:00
  assert.equal(await tickOpenSourceWeek(db, { now: new Date("2026-11-29T16:00:00Z"), deliver }), true); // Sunday 11:00
  assert.deepEqual(sent.map(([id]) => id), ["oss-week:2026-11-29"]);
  assert.equal(sent[0][1].url, "/open-source");
  assert.equal(sent[0][1].title, "Open source: 1 to decide");
  const clear = fakeDb({ oss_state: [{ _id: "audit", draft: [], fix: [], revive: [], decidedChanged: [] }] });
  assert.equal(await tickOpenSourceWeek(clear, { now: new Date("2026-11-29T16:00:00Z"), deliver }), false);
});

test("bank:export writes a page-approved bullet's package into the planner and the bullet into tier A", () => {
  const bank = loadBank();
  const ac = approvedEntry({ id: "AC-U901", gh: GH, text: TEXT, fits: ["SWE"], partner: bank.acs.find((a) => a.id === "AC-321"), bank, day: "2026-11-27" });
  const dir = fs.mkdtempSync(path.join(tmp, "bank-"));
  fs.copyFileSync(path.join(bank.bank_dir, "TIERS.yaml"), path.join(dir, "TIERS.yaml"));
  const planner = path.join(dir, "v2.json");
  fs.copyFileSync(path.join(bank.bank_dir, "..", "..", "scripts", "planner", "v2.json"), planner);
  const lines = exportOssPackages([{ _id: "AC-U901", type: "new", ac }], dir, planner);
  assert.equal(lines.length, 2, lines.join("\n"));
  const pool = JSON.parse(fs.readFileSync(planner, "utf8")).canonical_pools["open-source"];
  assert.ok(pool.ac_ids.includes("AC-U901"));
  assert.ok(pool.story_packages.some((p) => p.ids.join() === "AC-U901,AC-321"));
  assert.match(fs.readFileSync(path.join(dir, "TIERS.yaml"), "utf8"), /  - AC-U901\n/);
  // Running it again changes nothing.
  assert.deepEqual(exportOssPackages([{ _id: "AC-U901", type: "new", ac }], dir, planner), []);
});

// The server imports from open-source.mjs and bank-draft.mjs, which both export approveDraft. A clash only shows when the
// server file is parsed, so parse it here rather than at ship time (the Nov 27 ship stopped on exactly this).
test("the tailor server parses with the open source routes", async () => {
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, ["--check", path.join(import.meta.dirname, "../../scripts/tailor-server.mjs")]);
});
