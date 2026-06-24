/**
 * Engine bank loader for the resume tailor.
 *
 * Parses the resume engine's Memory/ files into structured data the tailor can
 * use for per-JD bullet SELECTION (not just rewording a fixed template):
 *   - experience.md        → 45 tagged bullets grouped by role/project
 *   - QUESTION_ANSWERS.md   → safe-to-claim tool/skill allowlist (truth guard)
 *   - REVIEWER_FEEDBACK_BANK.md → banned phrases
 *
 * Pure parsing, no side effects. Node built-ins only.
 */
import fs from "node:fs";

const ENGINE = "/Users/atishaykasliwal/atriveo-app/resume-engine/Memory";

// ─── Bullet bank (experience.md) ─────────────────────────────────────────────
// Lines look like:  `1. ` + "`[py,aws | DATA,FIN | ★]`" + " Architected a ..."
// grouped under "### Role Name (dates)" headers, in ## Experience / ## Projects.
export function loadBullets() {
  const text = fs.readFileSync(`${ENGINE}/experience.md`, "utf8");
  const roles = [];        // experience roles
  const projects = [];     // project entries
  let section = null;      // "experience" | "projects"
  let current = null;

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (/^##\s+Experience/i.test(line)) { section = "experience"; current = null; continue; }
    if (/^##\s+Projects/i.test(line))   { section = "projects";   current = null; continue; }
    if (/^##\s+Rules Compliance/i.test(line)) break;   // stop at the notes section

    const head = line.match(/^###\s+(.+?)\s*$/);
    if (head && (section === "experience" || section === "projects")) {
      current = { name: head[1].replace(/\s*\(.*?\)\s*$/, "").trim(), header: head[1].trim(), bullets: [] };
      (section === "experience" ? roles : projects).push(current);
      continue;
    }

    // a bullet line: optional number, then `[tags]` then text
    const b = line.match(/^\s*\d+\.\s*`\[([^\]]*)\]`\s*(.+?)\s*$/);
    if (b && current) {
      const [tech = "", theme = "", metric = ""] = b[1].split("|").map((s) => s.trim());
      let body = b[2].trim();
      const weak = /←\s*WEAK/i.test(body);
      body = body.replace(/\s*←.*$/, "").trim();   // strip the "← WEAK: ..." note
      current.bullets.push({
        tech: tech.split(",").map((s) => s.trim()).filter(Boolean),
        theme: theme.split(",").map((s) => s.trim()).filter(Boolean),
        metric, weak, text: body,
      });
    }
  }
  return { roles, projects };
}

// ─── Safe-claim allowlist (QUESTION_ANSWERS.md) ──────────────────────────────
// Build a set of tokens the candidate can truthfully claim, so the model cannot
// fabricate a skill (the "Ryu" bug). We harvest capitalized tool names and known
// terms from the stable-answers file plus every tech tag in the bullet bank.
export function loadSafeClaims(bank) {
  const text = fs.readFileSync(`${ENGINE}/QUESTION_ANSWERS.md`, "utf8");
  const claims = new Set();
  const add = (s) => { if (s) claims.add(s.trim().toLowerCase()); };

  // tech tags from every bullet (these are definitionally safe — they're on the resume)
  for (const group of [...bank.roles, ...bank.projects])
    for (const bl of group.bullets) bl.tech.forEach(add);

  // tool-ish tokens from the safe-answers prose: words with caps, dots, slashes, +, #
  const toolRe = /\b([A-Z][A-Za-z0-9.+#/]*(?:\s?[A-Z][A-Za-z0-9.+#/]*)?)\b/g;
  let m;
  while ((m = toolRe.exec(text))) {
    const t = m[1];
    if (t.length < 2) continue;
    if (/^(The|This|Safe|Use|Context|Required|Additions|Confirmed|Always|Never|Job|Per|JD|Reusable|Stable|Usage|Rule|Purpose|Check|Ask|Location|Sponsorship)$/.test(t)) continue;
    add(t);
    // also add a no-space variant so "Spring Boot" and "SpringBoot" both match
    if (/\s/.test(t)) {
      add(t.replace(/\s+/g, ""));
      // and each individual word, so "Netflix Eureka" also yields "Eureka",
      // "Apache Avro" -> "Avro", "MongoDB Atlas" -> "MongoDB". Skip common
      // vendor/filler prefixes that are not skills on their own.
      for (const w of t.split(/\s+/)) {
        if (w.length >= 3 && !/^(Apache|Netflix|Confluent|Spring|Amazon|Google|Microsoft|Atlas|Server|Cloud)$/.test(w)) add(w);
      }
    }
  }
  return claims;
}

// ─── Metric lock (rule 28) ───────────────────────────────────────────────────
// Every number that legitimately appears in the bank's bullet text. The model
// may re-use these but must not invent or round new ones. Returns a Set of
// normalized numeric tokens (digits + optional , . + % K M B suffixes).
const NUM_RE = /\d[\d,.]*\+?%?[KMB]?/g;
export function normalizeNum(tok) {
  return String(tok).toLowerCase().replace(/,/g, "").trim();
}
export function loadBankNumbers(bank) {
  const nums = new Set();
  for (const group of [...bank.roles, ...bank.projects])
    for (const bl of group.bullets)
      for (const t of (bl.text || "").match(NUM_RE) || []) nums.add(normalizeNum(t));
  return nums;
}
// Extract numeric tokens from a single rewritten bullet (for verification).
export function bulletNumbers(text) {
  return (String(text).match(NUM_RE) || []).map(normalizeNum);
}

// ─── Banned phrases (REVIEWER_FEEDBACK_BANK.md) ──────────────────────────────
export function loadBannedPhrases() {
  // Hard-banned set: rulebook + REVIEWER_FEEDBACK_BANK + the resume-relevant
  // AI-vocabulary words from blader/humanizer (SKILL.md). These read as AI-
  // generated or filler in resume bullets, so we strip/flag them in any rewrite.
  return [
    // rulebook / reviewer bank
    "leveraged", "leveraging", "spearheaded", "cutting-edge", "cutting edge",
    "utilized", "utilizing", "in order to", "responsible for", "world-class",
    "synergy", "synergies", "wheelhouse", "best-in-class",
    // humanizer AI-vocabulary (resume-relevant subset)
    "delve", "tapestry", "testament", "underscore", "underscores", "showcase",
    "showcasing", "foster", "fostering", "intricate", "intricacies", "pivotal",
    "vibrant", "garner", "interplay", "seamlessly", "robustly",
  ];
}

// Build a compact, model-readable catalogue of the bank for the prompt.
export function bankToPrompt(bank) {
  const lines = [];
  const fmt = (group, kind) => {
    lines.push(`\n${kind}: ${group.header}`);
    group.bullets.forEach((b, i) => {
      const tag = [b.metric, b.weak ? "WEAK" : ""].filter(Boolean).join(" ");
      lines.push(`  ${kind[0]}${group._idx}.${i} [${b.tech.join(",")}]${tag ? " " + tag : ""}: ${b.text}`);
    });
  };
  bank.roles.forEach((g, i) => { g._idx = i; });
  bank.projects.forEach((g, i) => { g._idx = i; });
  lines.push("EXPERIENCE ROLES (id format R<role>.<bullet>):");
  bank.roles.forEach((g) => fmt(g, "R"));
  lines.push("\nPROJECTS (id format P<proj>.<bullet>):");
  bank.projects.forEach((g) => fmt(g, "P"));
  return lines.join("\n");
}
