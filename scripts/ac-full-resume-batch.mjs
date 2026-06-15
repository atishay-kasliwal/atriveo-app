#!/usr/bin/env node
/**
 * Full 15-bullet resume batch — 10 real JDs with detailed review markdown.
 * Layout: SBU 4 · Wake 3 · Accolite 4 (AC-198 scope + 3 evidence) · Atriveo 2 · Insurance 2
 * Usage: node scripts/ac-full-resume-batch.mjs [--count 10] [--seed full-10] [--pdf]
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { generateResume, compactPipelineResult } from "./ac-pipeline.mjs";
import { loadBank } from "./ac-bank.mjs";
import { auditAtsMatrix, formatAtsMatrixMarkdown } from "./ac-ats-matrix.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const JD_DIR = path.join(ROOT, "public/job_descriptions");
const PLANNER_PATH = path.join(ROOT, "scripts/planner/v2.json");

const ROLE_LABELS = {
  "stony-brook": "Stony Brook University — Software Engineer",
  "wake-forest": "Wake Forest – CAIR — Software Engineer",
  accolite: "Accolite Digital — Senior Software Engineer",
  atriveo: "Atriveo — Founder / Full Stack Engineer",
  "insurance-platform": "Insurance Microservices Platform — Project",
};

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
  if (/Google/i.test(head)) return "Google";
  if (/Stripe/i.test(head)) return "Stripe";
  if (/Databricks/i.test(head)) return "Databricks";

  const patterns = [
    /Join the ([A-Z][A-Za-z0-9&.'\-\s]{2,40}?) team\b/i,
    /\*\*Who We Are\*\*\s*\n?\s*([A-Z][A-Za-z0-9&.'\-\s]{2,30}?)(?:'s mission|'s|\s+is\b)/i,
    /\*\*About ([^*\n]{2,50})\*\*/i,
    /At ([A-Z][A-Za-z0-9&.'\-\s]{2,30}?),\s+you\b/,
  ];
  for (const re of patterns) {
    const m = jd.match(re);
    if (m?.[1]) {
      const name = cleanField(m[1]).replace(/^[-–—]\s*/, "");
      if (name.length >= 2 && name.length <= 50 && !COMPANY_BLOCKLIST.test(name.toLowerCase())) return name;
    }
  }
  return url.match(/\/(\d+)\/?$/)?.[1] || "company";
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

function cleanBatchDir(batchDir) {
  if (!fs.existsSync(batchDir)) return;
  for (const name of fs.readdirSync(batchDir)) {
    const full = path.join(batchDir, name);
    if (fs.statSync(full).isDirectory()) fs.rmSync(full, { recursive: true, force: true });
  }
}

function getRoleBlock(composition, role) {
  const exp = composition.experience?.find((r) => r.role === role);
  if (exp) return exp;
  return composition.projects?.find((r) => r.role === role);
}

function bulletRows(block) {
  return (block?.bullets || []).map((b) => ({
    id: b.ac_id || b.ac?.id,
    theme: b.facet || b.ac?.achievement_theme,
    text: String(b.text || b.ac?.variants?.[0]?.text || "").replace(/\s+/g, " ").trim(),
    pinned: b.pinned || false,
  }));
}

function getStoryMeta(composition, role) {
  const selected = composition.selection_trace?.selected || [];
  const roleSel = selected.filter((s) => s.role === role);
  const pkgs = [...new Set(roleSel.map((s) => s.story_package).filter(Boolean))];
  const anchors = [...new Set(roleSel.map((s) => s.anchor).filter(Boolean))];
  const ids = bulletRows(getRoleBlock(composition, role)).map((b) => b.id).filter(Boolean);

  let storyPackage = pkgs.length === 1 ? pkgs[0] : (pkgs.length > 1 ? "mixed" : "narrative");
  let anchor = anchors.length === 1 ? anchors[0] : (anchors[0] || null);

  if (storyPackage === "narrative" && ids.length) {
    const planner = JSON.parse(fs.readFileSync(PLANNER_PATH, "utf8"));
    const packages = planner.canonical_pools[role]?.story_packages || [];
    for (const pkg of packages) {
      const pkgIds = role === "accolite"
        ? ["AC-198", ...pkg.ids.filter((id) => id !== "AC-198")]
        : role === "stony-brook"
          ? ["AC-026", ...pkg.ids.filter((id) => id !== "AC-026")]
          : pkg.ids;
      if (pkgIds.every((id) => ids.includes(id)) && ids.length === pkgIds.length) {
        return { storyPackage: pkg.name, anchor: pkg.anchor || null, evidenceIds: pkg.ids };
      }
    }
    if (role === "wake-forest") {
      for (const pkg of packages) {
        if (pkg.ids.every((id) => ids.includes(id))) {
          return { storyPackage: pkg.name, anchor: null, evidenceIds: pkg.ids };
        }
      }
    }
    storyPackage = "custom";
  }

  return { storyPackage, anchor, evidenceIds: ids.filter((id) => id !== "AC-198" && id !== "AC-031") };
}

function formatJdForMarkdown(jd) {
  return jd.replace(/\\-/g, "-").trim();
}

function renderBulletList(bullets, { pinnedId = null } = {}) {
  const lines = [];
  bullets.forEach((b, n) => {
    const pin = b.id === pinnedId || b.id === "AC-198" || b.id === "AC-031" ? " *(pinned)*" : "";
    lines.push(`${n + 1}. **${b.id}** · \`${b.theme || "default"}\`${pin}`);
    lines.push(`   ${b.text}`);
    lines.push("");
  });
  return lines.join("\n");
}

function buildMarkdown(entries, bankVersion) {
  const lines = [
    "# Full Resume Composition — 10 JD Test Batch",
    "",
    `**Bank v${bankVersion}** · **Fixed layout (15 bullets):** SBU 4 · Wake 3 · Accolite 4 · Atriveo 2 · Insurance 2`,
    "",
    "| Section | Bullets | Selection |",
    "|---------|---------|-----------|",
    "| Stony Brook University | 4 | AC-026 scope + story package |",
    "| Wake Forest – CAIR | 3 | Story package (AC-031 pinned) |",
    "| Accolite Digital | 4 | AC-198 scope + 3 JD evidence (story package) |",
    "| Atriveo (project) | 2 | Dynamic anchor by JD |",
    "| Insurance Platform (project) | 2 | Dynamic anchor by JD |",
    "",
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "## Table of contents",
    "",
  ];

  for (const [i, e] of entries.entries()) {
    lines.push(`${i + 1}. [${e.company}${e.title ? ` — ${e.title}` : ""}](#${i + 1}-${e.slug})`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const [i, e] of entries.entries()) {
    lines.push(`## ${i + 1}. ${e.company}${e.title ? ` — ${e.title}` : ""}`);
    lines.push("");
    lines.push(`**RCS:** ${e.rcs} · **Header title:** ${e.headerTitle || "—"} · **Thesis:** ${e.thesis || "—"}`);
    lines.push(`**JD source:** [LinkedIn ${e.jobId}](${e.url}) · **Folder:** \`${e.id}/\``);
    lines.push(`**Hiring manager:** ${e.wouldInterview ? "Would interview ✓" : "—"} (composite ${e.hmComposite ?? "—"}/10)`);
    lines.push("");
    lines.push("### 1. Job description (full text)");
    lines.push("");
    lines.push("```text");
    lines.push(e.fullJd);
    lines.push("```");
    lines.push("");
    lines.push("### 2. Resume composition (15 bullets)");
    lines.push("");
    lines.push(`**Proof template:** \`${e.proofTemplate || "—"}\` · **Selected ACs:** ${e.selectedAcs?.join(", ") || "—"}`);
    lines.push("");

    for (const section of e.sections) {
      lines.push(`#### ${section.label} (${section.bullets.length} bullets)`);
      if (section.storyPackage) {
        lines.push(`**Story package:** \`${section.storyPackage}\`${section.anchor ? ` · **Anchor:** \`${section.anchor}\`` : ""}`);
        if (section.note) lines.push(`**Note:** ${section.note}`);
      }
      lines.push("");
      lines.push(renderBulletList(section.bullets, { pinnedId: section.pinnedId }));
    }

    lines.push("#### Skills (evidence-only from selected bullets)");
    lines.push("");
    for (const skill of e.skills || []) lines.push(`- ${skill}`);
    lines.push("");

    if (e.topJdTerms?.length) {
      lines.push("#### Top JD keyword routes (planner)");
      lines.push("");
      lines.push(e.topJdTerms.map((t) => `\`${t.term}\` → ${t.ac_id} (${t.confidence})`).join(" · "));
      lines.push("");
    }

    if (e.atsMatrix) {
      lines.push("#### ATS coverage matrix (15 bullets + skills)");
      lines.push("");
      lines.push(e.atsMatrix);
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  lines.push("## Summary");
  lines.push("");
  lines.push("| # | Company | Title | RCS | Accolite pkg | Atriveo pkg | Insurance pkg | Wake pkg |");
  lines.push("|---|---------|-------|-----|--------------|-------------|-----------------|----------|");
  for (const [i, e] of entries.entries()) {
    lines.push(
      `| ${i + 1} | ${e.company} | ${e.title || "—"} | ${e.rcs} | ${e.accolitePackage} | ${e.atriveoPackage} | ${e.insurancePackage} | ${e.wakePackage} |`,
    );
  }
  lines.push("");
  lines.push("Artifacts per run: `jd.txt` (full JD) · `composition.json` · optional `resume.tex` / PDF");
  lines.push("");
  return lines.join("\n");
}

function topJdRoutes(compact, limit = 12) {
  const routes = compact?.plan?.routes || {};
  return Object.entries(routes)
    .slice(0, limit)
    .map(([term, r]) => ({ term, ac_id: r.ac_id, confidence: r.confidence }));
}

async function main() {
  const count = Number(arg("count", "10"));
  const seed = arg("seed", `${new Date().toISOString().slice(0, 10)}-full-${count}`);
  const clean = process.argv.includes("--clean");
  const withPdf = process.argv.includes("--pdf");
  const date = new Date().toISOString().slice(0, 10);
  const batchDir = path.join(ROOT, "output/ac-resumes", date, `full-resume-${count}`);

  const all = loadAllJds();
  const rand = seededRandom(seed);
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

    if (pipeline.unsupported_jd) {
      const skipPayload = {
        unsupported_jd: true,
        jd_gate: pipeline.jd_gate,
        jd_relevance: pipeline.jd_relevance,
        company,
        title,
        jobId,
      };
      fs.writeFileSync(path.join(dir, "composition.json"), `${JSON.stringify(skipPayload, null, 2)}\n`);
      const conf = pipeline.jd_gate?.relevance?.confidence ?? pipeline.jd_relevance?.confidence;
      console.log(`⊘ ${folderId} · ${company} · UNSUPPORTED JD (confidence ${conf})`);
      entries.push({
        id: folderId,
        company,
        title,
        unsupportedJd: true,
        jdGate: pipeline.jd_gate,
        jdRelevance: pipeline.jd_relevance,
        sections: [],
      });
      continue;
    }

    const compact = compactPipelineResult(pipeline);
    const { composition, tex, resume_confidence_score } = pipeline.result;
    fs.writeFileSync(path.join(dir, "composition.json"), `${JSON.stringify(compact, null, 2)}\n`);

    if (withPdf && tex) {
      fs.writeFileSync(path.join(dir, "resume.tex"), tex);
      spawnSync("tectonic", ["resume.tex"], { cwd: dir, encoding: "utf8" });
    }

    const c = compact.composition;
    const sbu = bulletRows(getRoleBlock(c, "stony-brook"));
    const wake = bulletRows(getRoleBlock(c, "wake-forest"));
    const accolite = bulletRows(getRoleBlock(c, "accolite"));
    const atriveo = bulletRows(getRoleBlock(c, "atriveo"));
    const insurance = bulletRows(getRoleBlock(c, "insurance-platform"));

    const wakeMeta = getStoryMeta(c, "wake-forest");
    const sbuMeta = getStoryMeta(c, "stony-brook");
    const accoliteMeta = getStoryMeta(c, "accolite");
    const atriveoMeta = getStoryMeta(c, "atriveo");
    const insuranceMeta = getStoryMeta(c, "insurance-platform");

    const entry = {
      id: folderId,
      slug: slugify(`${company}-${title || jobId}`),
      company,
      title,
      url: job.url,
      jobId,
      fullJd: formatJdForMarkdown(job.jd),
      rcs: resume_confidence_score,
      headerTitle: compact.header_title,
      thesis: compact.thesis,
      proofTemplate: compact.proof_template,
      selectedAcs: compact.selected_acs,
      skills: compact.skills,
      topJdTerms: topJdRoutes(c),
      atsMatrix: formatAtsMatrixMarkdown(auditAtsMatrix(c, compact.skills)),
      wouldInterview: compact.hiring_manager_test?.would_interview,
      hmComposite: compact.hiring_manager_test?.composite,
      accolitePackage: accoliteMeta.storyPackage,
      atriveoPackage: atriveoMeta.storyPackage,
      insurancePackage: insuranceMeta.storyPackage,
      wakePackage: wakeMeta.storyPackage,
      sbuPackage: sbuMeta.storyPackage,
      sections: [
        {
          label: ROLE_LABELS["stony-brook"],
          bullets: sbu,
          storyPackage: sbuMeta.storyPackage,
          pinnedId: "AC-026",
          note: "AC-026 scope thesis always first · 3 JD evidence bullets from story package",
        },
        {
          label: ROLE_LABELS["wake-forest"],
          bullets: wake,
          storyPackage: wakeMeta.storyPackage,
          pinnedId: "AC-031",
          note: "AC-031 always first — clinical platform headline",
        },
        {
          label: ROLE_LABELS.accolite,
          bullets: accolite,
          storyPackage: accoliteMeta.storyPackage,
          pinnedId: "AC-198",
          note: "AC-198 scope thesis always first · 3 JD-matched evidence bullets (v47 capability-centric bank)",
        },
        {
          label: ROLE_LABELS.atriveo,
          bullets: atriveo,
          storyPackage: atriveoMeta.storyPackage,
          anchor: atriveoMeta.anchor,
          note: "Project slot 1 — dynamic anchor pair from planner v2",
        },
        {
          label: ROLE_LABELS["insurance-platform"],
          bullets: insurance,
          storyPackage: insuranceMeta.storyPackage,
          anchor: insuranceMeta.anchor,
          note: "Project slot 2 — Java/Kafka microservices bank (not retired AC-017/018)",
        },
      ],
    };
    entries.push(entry);

    const acIds = accolite.map((b) => b.id).join("+");
    console.log(
      `✓ ${folderId} · ${company} · RCS ${resume_confidence_score} · Accolite:${accoliteMeta.storyPackage}[${acIds}] · Atriveo:${atriveoMeta.storyPackage} · Ins:${insuranceMeta.storyPackage}`,
    );
  }

  fs.writeFileSync(path.join(batchDir, "manifest.json"), `${JSON.stringify(entries.map((e) => ({
    id: e.id,
    company: e.company,
    title: e.title,
    url: e.url,
    rcs: e.rcs,
    accolitePackage: e.accolitePackage,
    atriveoPackage: e.atriveoPackage,
    insurancePackage: e.insurancePackage,
    wakePackage: e.wakePackage,
    selectedAcs: e.selectedAcs,
  })), null, 2)}\n`);

  fs.writeFileSync(
    path.join(batchDir, "FULL-RESUME-BATCH.md"),
    `${buildMarkdown(entries, bank.bank_version)}\n`,
  );

  console.log(`\nBatch: ${batchDir}`);
  console.log(`FULL-RESUME-BATCH.md + manifest.json (${entries.length} compositions)`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
