// Named import so Vite can drop the (larger, unused) `vocabulary` key from the bundle.
import { skills } from "../../data/skill-inventory.json";

export type ApprovedSkill = { name: string; category: string; terms: string[]; merged: boolean; sources: string[] };

// Approved skills with open source PR evidence: merged first, open PRs at lower priority, closed never
// (scripts/sync-skill-inventory.mjs). `merged` marks the first priority.
export const approvedSkills: ApprovedSkill[] = skills;

export function matchesSkill(text: string, terms: string[]): boolean {
  return terms.some((term) => {
    // Ordinary "go to market" prose is not evidence of the programming language.
    const value = term.toLowerCase() === "go"
      ? text.replace(/\bgo[- ](?:to|live|ahead|beyond|on|through|back)\b/gi, "") : text;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(value);
  });
}

export function bankSkill(name: string): ApprovedSkill | undefined {
  return approvedSkills.find((skill) => skill.name.toLowerCase() === name.toLowerCase()
    || skill.terms.some((term) => term.toLowerCase() === name.toLowerCase()));
}

/**
 * The approved skill behind a display label from another skill list (e.g. "Bash/Shell", "HTML/CSS").
 * Exact name/term first, then a whole-word term inside the label. Never implies the resume has it.
 */
export function bankSkillForLabel(label: string): ApprovedSkill | undefined {
  return bankSkill(label) || approvedSkills.find((skill) => matchesSkill(label, skill.terms));
}

// This supports additions to Skills, never claims that the supplied resume already contains them.
export function skillsContextForJd(jd: string): string {
  const relevant = approvedSkills.filter((skill) => matchesSkill(jd, skill.terms)).sort((a, b) => Number(b.merged) - Number(a.merged));
  if (!relevant.length) return "";
  return "\n\n--- APPROVED SKILLS BANK (separate from the supplied resume) ---\n"
    + relevant.map((skill) => `${skill.name}: ${skill.sources.slice(0, 3).join(", ")}`).join("\n")
    + "\nThese support skills-section suggestions only. Do not attribute them to a past employer, invent project bullets, or count them in the current resume score. Merged PRs are listed first. Never state whether a PR is merged or open.";
}
