#!/usr/bin/env node
/**
 * Generate Atriveo random-5 JD batch: composition trace + review markdown.
 * Shows which 2-bullet Atriveo pair wins per real JD (dynamic anchors).
 * Usage: node scripts/ac-atriveo-random-batch.mjs [--count 5] [--seed <text>] [--pdf]
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { generateResume, compactPipelineResult } from "./ac-pipeline.mjs";
import { loadBank } from "./ac-bank.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const JD_DIR = path.join(ROOT, "public/job_descriptions");

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((v) => v.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  return fallback;
}

function slugify(text) {
  return String(text || "role").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function seededRandom(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += h << 13;
    h ^= h >>> 7;
    h += h << 3;
    h ^= h >>> 17;
    h += h << 5;
    return (h >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function loadAllJds() {
  const rows = [];
  for (const file of fs.readdirSync(JD_DIR)) {
    if (!file.endsWith(".json") || file === "manifest.json") continue;
    const bucket = JSON.parse(fs.readFileSync(path.join(JD_DIR, file), "utf8"));
    for (const [url, text] of Object.entries(bucket)) {
      const jd = String(text || "").trim();
      if (jd.length >= 800) rows.push({ url, jd, bucket: file });
    }
  }
  return rows;
}

const TITLE_BLOCKLIST = /^(salary|summary|description|job#|benefits|location|duration|requirements|company|about|who we are|the team|role)$/i;
const COMPANY_BLOCKLIST = /^(summary|salary|place|the team|our team|this role|your work|job description|our commitment|who we are)$/i;

function cleanField(text) {
  return String(text || "").replace(/\\-/g, "-").replace(/\s+/g, " ").trim();
}

function extractCompany(jd, url) {
  const head = jd.slice(0, 1200);
  if (/Amazon/i.test(head)) return "Amazon";
  if (/OpenAI/i.test(head)) return "OpenAI";
  if (/Anthropic/i.test(head)) return "Anthropic";
  if (/Netflix/i.test(head)) return "Netflix";

  const patterns = [
    /Join the ([A-Z][A-Za-z0-9&.'\-\s]{2,40}?) team\b/i,
    /\*\*Who We Are\*\*\s*\n?\s*([A-Z][A-Za-z0-9&.'\-\s]{2,30}?)(?:'s mission|'s|\s+is\b)/i,
    /\*\*About ([^*\n]{2,50})\*\*/i,
    /\*\*Company(?: Description)?\*\*\s*\n?\s*([^\n*]{2,60})/i,
    /At ([A-Z][A-Za-z0-9&.'\-\s]{2,30}?),\s+you\b/,
    /\*\*([A-Z][A-Za-z0-9&.'\-\s]{2,40})\*\*\s+is (?:a|the|an)\b/,
    /(?:join|at)\s+([A-Z][A-Za-z0-9&.'\-\s]{2,40}?)(?:\s+as|\s+to|\s+and|\s+where|\s+—|\s+-|\s+in\b)/,
  ];
  for (const re of patterns) {
    const m = jd.match(re);
    if (m?.[1]) {
      const name = cleanField(m[1]).replace(/^[-–—]\s*/, "");
      if (name.length >= 2 && name.length <= 50 && !COMPANY_BLOCKLIST.test(name.toLowerCase())) return name;
    }
  }
  const jobId = url.match(/\/(\d+)\/?$/)?.[1];
  return jobId || "company";
}

function extractTitle(jd) {
  const labeled = [
    /\*\*(?:Job Title|Role|Position|Title):\*\*\s*([^\n]+)/i,
    /\*\*Role:\*\*\s*([^\n]+)/i,
  ];
  for (const re of labeled) {
    const m = jd.match(re);
    if (m?.[1]) {
      const title = cleanField(m[1]);
      const head = title.split(/[:\#]/)[0].trim();
      if (!TITLE_BLOCKLIST.test(head)) return title;
    }
  }
  for (const line of jd.split("\n")) {
    const m = line.match(/\*\*([^*]{5,80})\*\*/);
    if (!m?.[1]) continue;
    const title = cleanField(m[1]);
    const head = title.split(/[:\#]/)[0].trim();
    if (TITLE_BLOCKLIST.test(head)) continue;
    if (/engineer|scientist|developer|analyst|architect|manager|designer|researcher/i.test(title)) return title;
  }
  return null;
}

function jdExcerpt(jd, max = 320) {
  const clean = jd.replace(/\\-/g, "-").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  return clean.slice(0, max) + (clean.length > max ? "…" : "");
}

function pdfPageCount(pdfPath) {
  try {
    if (!fs.existsSync(pdfPath)) return null;
    if (process.platform === "darwin") {
      for (let i = 0; i < 3; i += 1) {
        const r = spawnSync("mdls", ["-raw", "-name", "kMDItemNumberOfPages", pdfPath], { encoding: "utf8" });
        const n = Number(String(r.stdout || "").trim());
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
    const latin = fs.readFileSync(pdfPath).toString("latin1");
    const pages = (latin.match(/\/Type\s*\/Page(?![s])/g) || []).length;
    if (pages > 0) return pages;
    return 1;
  } catch {
    return null;
  }
}

function cleanBatchDir(batchDir) {
  if (!fs.existsSync(batchDir)) return;
  for (const name of fs.readdirSync(batchDir)) {
    const full = path.join(batchDir, name);
    if (fs.statSync(full).isDirectory()) fs.rmSync(full, { recursive: true, force: true });
  }
}

function compileTex(dir) {
  const r = spawnSync("tectonic", ["resume.tex"], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) return { ok: false, err: (r.stderr || r.stdout || "").trim().slice(-500) };
  const pdf = path.join(dir, "resume.pdf");
  const named = path.join(dir, "Atishay Kasliwal.pdf");
  if (fs.existsSync(pdf)) fs.copyFileSync(pdf, named);
  return { ok: true, pdf: fs.existsSync(named) ? named : pdf, pages: pdfPageCount(pdf) };
}

function getAtriveoBullets(composition) {
  const proj = composition.projects?.find((r) => r.role === "atriveo");
  return (proj?.bullets || []).map((b) => ({
    id: b.ac?.id || b.ac_id,
    theme: b.ac?.achievement_theme,
    text: String(b.ac?.variants?.[0]?.text || b.text || "").replace(/\s+/g, " ").trim(),
  }));
}

function getAtriveoStoryMeta(composition) {
  const selected = composition.selection_trace?.selected || [];
  const atriveoSel = selected.filter((s) => s.role === "atriveo");
  const pkgs = [...new Set(atriveoSel.map((s) => s.story_package).filter(Boolean))];
  const anchors = [...new Set(atriveoSel.map((s) => s.anchor).filter(Boolean))];
  const storyPackage = pkgs.length === 1 ? pkgs[0] : (pkgs.length > 1 ? "custom" : "unknown");
  const anchor = anchors.length === 1 ? anchors[0] : (anchors[0] || null);

  const ids = getAtriveoBullets(composition).map((b) => b.id).filter(Boolean);
  if (storyPackage === "unknown" && ids.length) {
    const planner = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/planner/v2.json"), "utf8"));
    for (const pkg of planner.canonical_pools.atriveo.story_packages) {
      if (pkg.ids.every((id) => ids.includes(id)) && ids.length === pkg.ids.length) {
        return { storyPackage: pkg.name, anchor: pkg.anchor };
      }
    }
    return { storyPackage: "custom", anchor: ids[0] || null };
  }
  return { storyPackage, anchor };
}

const PACKAGE_RATIONALE = {
  fullstack: "Full-stack package — platform headline + dashboard for React/TypeScript JDs.",
  backend: "Backend package — FastAPI/PostgreSQL + Cloudflare deployment for API/infra JDs.",
  "ai-product": "AI package — resume compiler + LangChain RAG for LLM/ML JDs (AC-042 anchors, not AC-050).",
  infra: "Infra package — Cloudflare/Docker uptime + PDF regression for DevOps JDs.",
  data: "Data package — JD indexing + tailoring pipeline for ETL/ingestion JDs.",
  product: "Product package — platform + Chrome extension for growth/open-source JDs.",
  custom: "Custom pair — best-scoring combo when no single package dominated JD signals.",
};

function packageRationale(pkg, bullets, anchor) {
  const ids = bullets.map((b) => b.id).join(" + ");
  const base = PACKAGE_RATIONALE[pkg] || PACKAGE_RATIONALE.custom;
  return anchor ? `${base} Anchor: **${anchor}**. Pair: ${ids}.` : `${base} Pair: ${ids}.`;
}

function buildMarkdown(entries, bankVersion) {
  const lines = [
    "# Atriveo Bullet Selection — Random 5 JDs",
    "",
    `**Bank v${bankVersion}** · Fixed layout: SBU 4 · Wake 3 · Accolite 4 · **Atriveo 2** · Insurance 2`,
    "**Selection:** Dynamic anchors by JD (`dynamic_anchors: true` in planner v2) — no AC-050 pin",
    "**Guide:** `data/ac-bank/ATRIVEO.yaml` · Lint: `npm run ac:bullet-lint -- --role atriveo`",
    "",
    "| JD type | Anchor | Typical pair |",
    "|---------|--------|--------------|",
    "| Full Stack | AC-050 | AC-050 + AC-052 |",
    "| AI / LLM | AC-042 | AC-042 + AC-054 |",
    "| Backend | AC-053 | AC-053 + AC-057 |",
    "| Product | AC-050 | AC-050 + AC-051 |",
    "| Infrastructure | AC-057 | AC-057 + AC-062 |",
    "| Data | AC-059 | AC-059 + AC-056 |",
    "",
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "---",
    "",
  ];

  for (const [i, e] of entries.entries()) {
    lines.push(`## ${i + 1}. ${e.company}${e.title ? ` — ${e.title}` : ""}`);
    lines.push("");
    lines.push(`**Story package:** \`${e.storyPackage}\` · **Anchor:** \`${e.anchor || "—"}\``);
    lines.push(`**JD source:** [LinkedIn ${e.jobId}](${e.url})`);
    lines.push(`**Folder:** \`${e.id}/\`${e.pages != null ? ` · PDF: ${e.pages} page${e.pages === 1 ? " ✓" : ""}` : ""}`);
    lines.push("");
    lines.push("### JD excerpt");
    lines.push("");
    lines.push(`> ${e.jdPreview}`);
    lines.push("");
    lines.push("### Atriveo bullets selected");
    lines.push("");
    e.atriveoBullets.forEach((b, n) => {
      const pin = b.id === e.anchor ? " *(anchor)*" : "";
      lines.push(`${n + 1}. **${b.id} · ${b.theme}**${pin}  `);
      lines.push(`   ${b.text}`);
      lines.push("");
    });
    lines.push(`**Why this pair:** ${e.rationale}`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  lines.push("## Summary");
  lines.push("");
  lines.push("| # | Company | Role focus | Package | Anchor | Atriveo bullets |");
  lines.push("|---|---------|------------|---------|--------|-----------------|");
  for (const [i, e] of entries.entries()) {
    const ids = e.atriveoBullets.map((b) => b.id.replace("AC-", "")).join(", ");
    lines.push(`| ${i + 1} | ${e.company} | ${e.title || "—"} | ${e.storyPackage} | ${e.anchor || "—"} | ${ids} |`);
  }
  lines.push("");

  const pkgCounts = {};
  const anchorCounts = {};
  for (const e of entries) {
    pkgCounts[e.storyPackage] = (pkgCounts[e.storyPackage] || 0) + 1;
    if (e.anchor) anchorCounts[e.anchor] = (anchorCounts[e.anchor] || 0) + 1;
  }
  lines.push("**Package distribution:** " + Object.entries(pkgCounts).map(([k, v]) => `${k} (${v})`).join(" · "));
  lines.push("");
  lines.push("**Anchor distribution:** " + Object.entries(anchorCounts).map(([k, v]) => `${k} (${v})`).join(" · "));
  lines.push("");
  lines.push("Full JDs: `*/jd.txt` · Compositions: `*/composition.json`");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const count = Number(arg("count", "5"));
  const seed = arg("seed", new Date().toISOString().slice(0, 10));
  const excludePath = arg("exclude-manifest");
  const clean = process.argv.includes("--clean");
  const withPdf = process.argv.includes("--pdf");
  const date = new Date().toISOString().slice(0, 10);
  const batchDir = path.join(ROOT, "output/ac-resumes", date, "atriveo-random-5");

  let excludeUrls = new Set();
  if (excludePath && fs.existsSync(excludePath)) {
    for (const row of JSON.parse(fs.readFileSync(excludePath, "utf8"))) excludeUrls.add(row.url);
  }

  const all = loadAllJds().filter((j) => !excludeUrls.has(j.url));
  const rand = seededRandom(`${seed}-atriveo`);
  const picked = shuffle(all, rand).slice(0, count);

  if (picked.length < count) {
    console.error(`Only ${picked.length} JDs available (wanted ${count})`);
    process.exit(1);
  }

  if (clean) cleanBatchDir(batchDir);
  fs.mkdirSync(batchDir, { recursive: true });
  const bank = loadBank();
  const entries = [];

  for (const [idx, job] of picked.entries()) {
    const company = extractCompany(job.jd, job.url);
    const title = extractTitle(job.jd);
    const jobId = job.url.match(/\/(\d+)\/?$/)?.[1] || slugify(company);
    const folderId = `${String(idx + 1).padStart(2, "0")}-${slugify(company) || jobId}`;
    const dir = path.join(batchDir, folderId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "jd.txt"), job.jd);

    const pipeline = generateResume({
      jd: job.jd,
      planner: "v2",
      meta: { company, title: title || undefined },
    });
    const { composition, tex, resume_confidence_score, gate } = pipeline.result;
    fs.writeFileSync(path.join(dir, "composition.json"), `${JSON.stringify(compactPipelineResult(pipeline), null, 2)}\n`);

    let pages = null;
    if (withPdf) {
      fs.writeFileSync(path.join(dir, "resume.tex"), tex);
      const compiled = compileTex(dir);
      if (!compiled.ok) {
        console.error(`Tectonic failed for ${folderId}: ${compiled.err}`);
        process.exit(1);
      }
      pages = compiled.pages;
    }

    const atriveoBullets = getAtriveoBullets(composition);
    const { storyPackage, anchor } = getAtriveoStoryMeta(composition);
    const entry = {
      id: folderId,
      company,
      title,
      slug: slugify(company),
      url: job.url,
      jobId,
      jdPreview: jdExcerpt(job.jd, 280),
      jdLength: job.jd.length,
      storyPackage,
      anchor,
      atriveoBullets,
      rationale: packageRationale(storyPackage, atriveoBullets, anchor),
      dir: path.relative(ROOT, dir),
      pages,
      rcs: resume_confidence_score,
      one_page: pages === 1,
      pdf_gate: gate?.passed,
    };
    entries.push(entry);
    console.log(`✓ ${folderId} · ${company} · ${storyPackage} · anchor ${anchor || "?"} · ${atriveoBullets.map((b) => b.id).join("+")} · RCS ${resume_confidence_score}`);
  }

  fs.writeFileSync(path.join(batchDir, "manifest.json"), `${JSON.stringify(entries, null, 2)}\n`);
  fs.writeFileSync(path.join(batchDir, "ATRIVEO-BATCH.md"), `${buildMarkdown(entries, bank.bank_version)}\n`);
  console.log(`\nBatch: ${batchDir}`);
  console.log(`Manifest + ATRIVEO-BATCH.md written (${entries.length} compositions)`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
