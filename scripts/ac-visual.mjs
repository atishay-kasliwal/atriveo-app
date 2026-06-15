// Visual metrics from LaTeX — golden regression beyond numeric scores.

export function analyzeVisualLayout(tex) {
  const t = String(tex || "");
  const resumeItems = (t.match(/\\resumeItem\{/g) || []).length;
  const sections = (t.match(/\\section\{/g) || []).length;
  const vspaceNeg = (t.match(/\\vspace\{-/g) || []).length;
  const lineBreaks = (t.match(/\\\\/g) || []).length;
  const expBlocks = (t.match(/\\resumeSubheading\{/g) || []).length;
  const projBlocks = (t.match(/\\resumeProjectHeading\{/g) || []).length;

  const experienceBullets = [];
  const expSection = t.split("\\section{Experience}")[1]?.split("\\section{Projects}")[0] || "";
  const expItemCount = (expSection.match(/\\resumeItem\{/g) || []).length;
  const projSection = t.split("\\section{Projects}")[1]?.split("\\section{Technical Skills}")[0] || "";
  const projItemCount = (projSection.match(/\\resumeItem\{/g) || []).length;

  const bulletDistribution = {
    experience: expItemCount,
    projects: projItemCount,
    ratio: expItemCount && projItemCount ? Number((expItemCount / projItemCount).toFixed(2)) : null,
  };

  const verticalWhitespace = vspaceNeg + (t.match(/\\vspace\{/g) || []).length;
  const sectionBalance = sections > 0
    ? Number(((expItemCount + projItemCount) / sections).toFixed(2))
    : 0;

  return {
    page_count: 1,
    line_count: lineBreaks,
    resume_item_count: resumeItems,
    experience_blocks: expBlocks,
    project_blocks: projBlocks,
    vertical_whitespace_markers: verticalWhitespace,
    section_balance: sectionBalance,
    bullet_distribution: bulletDistribution,
  };
}

export function compareVisual(baseline, current, tolerance = {}) {
  const regressions = [];
  const checks = [
    ["page_count", 0],
    ["resume_item_count", tolerance.bullet_count ?? 2],
    ["line_count", tolerance.line_count ?? 8],
    ["vertical_whitespace_markers", tolerance.whitespace ?? 6],
  ];
  for (const [key, tol] of checks) {
    if (baseline[key] == null || current[key] == null) continue;
    if (Math.abs(current[key] - baseline[key]) > tol) {
      regressions.push({ metric: key, baseline: baseline[key], current: current[key] });
    }
  }
  const expDelta = Math.abs((current.bullet_distribution?.experience ?? 0) - (baseline.bullet_distribution?.experience ?? 0));
  if (expDelta > (tolerance.experience_bullets ?? 2)) {
    regressions.push({
      metric: "bullet_distribution.experience",
      baseline: baseline.bullet_distribution?.experience,
      current: current.bullet_distribution?.experience,
    });
  }
  return regressions;
}
