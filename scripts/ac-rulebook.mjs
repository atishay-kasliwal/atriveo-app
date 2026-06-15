import {
  projectRecencyMs,
  resolveProjectMeta,
  resolveBankDir,
} from "./ac-role-meta.mjs";

export const RULEBOOK_EXPERIENCE_SLOTS = {
  "stony-brook": 4,
  "wake-forest": 3,
  accolite: 4,
};

export const RULEBOOK_PROJECT_BULLETS_EACH = 2;
export const RULEBOOK_PROJECT_COUNT = 2;

export const RULEBOOK_PROJECT_TARGETS = {
  default: 2,
  atriveo: 2,
  "insurance-platform": 2,
};

export function resolveVisualTargets(compositionOrCfg = {}) {
  const vt = compositionOrCfg.minimum_visual_targets
    || compositionOrCfg?.planner_runtime?.minimum_visual_targets
    || {};

  const experience = { ...RULEBOOK_EXPERIENCE_SLOTS };
  for (const [role, target] of Object.entries(vt.experience || {})) {
    experience[role] = target.preferred ?? target.minimum ?? experience[role];
  }

  const projects = { ...RULEBOOK_PROJECT_TARGETS };
  for (const [role, target] of Object.entries(vt.projects || {})) {
    if (role === "default") projects.default = target.preferred ?? target.minimum ?? projects.default;
    else projects[role] = target.preferred ?? target.minimum ?? projects[role];
  }

  const expTotal = (experience["stony-brook"] ?? 4)
    + (experience["wake-forest"] ?? 3)
    + (experience.accolite ?? 4);
  const projectTotal = (projects.atriveo ?? 2) + (projects["insurance-platform"] ?? 2);

  return { experience, projects, expected_total: expTotal + projectTotal };
}

export function countCompositionBullets(composition) {
  let experience = 0;
  let projects = 0;
  const perRole = {};
  const perProject = {};

  for (const role of composition.experience || []) {
    const n = (role.bullets || []).length;
    experience += n;
    perRole[role.role] = n;
  }
  for (const project of composition.projects || []) {
    const n = (project.bullets || []).length;
    projects += n;
    perProject[project.role] = n;
  }

  const targets = resolveVisualTargets(composition);

  return {
    experience,
    projects,
    total: experience + projects,
    perRole,
    perProject,
    expected_total: targets.expected_total,
  };
}

export function auditProjectRecencyOrder(composition, bankDir = resolveBankDir()) {
  const projects = composition.projects || [];
  for (let i = 1; i < projects.length; i += 1) {
    const prevMs = projectRecencyMs(resolveProjectMeta(projects[i - 1].role, bankDir).dates);
    const curMs = projectRecencyMs(resolveProjectMeta(projects[i].role, bankDir).dates);
    if (curMs > prevMs) {
      return {
        ok: false,
        message: `project order: ${projects[i].role} is newer than ${projects[i - 1].role} (latest project must be first)`,
      };
    }
  }
  return { ok: true };
}

export function auditRulebookCompleteness(composition) {
  const counts = countCompositionBullets(composition);
  const targets = resolveVisualTargets(composition);
  const gaps = [];

  for (const [role, expected] of Object.entries(targets.experience)) {
    const actual = counts.perRole[role] || 0;
    if (actual < expected) gaps.push(`${role}: ${actual}/${expected} bullets`);
  }

  const projCount = (composition.projects || []).length;
  if (projCount < RULEBOOK_PROJECT_COUNT) {
    gaps.push(`projects: ${projCount}/${RULEBOOK_PROJECT_COUNT} entries`);
  }
  for (const project of composition.projects || []) {
    const expected = targets.projects[project.role] ?? targets.projects.default ?? RULEBOOK_PROJECT_BULLETS_EACH;
    const actual = (project.bullets || []).length;
    if (actual < expected) gaps.push(`${project.role}: ${actual}/${expected} bullets`);
  }

  const orderAudit = auditProjectRecencyOrder(composition);
  if (!orderAudit.ok) gaps.push(orderAudit.message);

  return {
    complete: gaps.length === 0,
    gaps,
    counts,
    targets,
  };
}
