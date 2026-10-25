/** Where a job came from; each one tints the card's border (today.css). */
export type Platform = "linkedin" | "staffing" | "greenhouse" | "lever" | "ashby" | "workday" | "smartrecruiters";
export const PLATFORM_LABEL: Record<Platform, string> = { linkedin: "LinkedIn", staffing: "Staffing", greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday", smartrecruiters: "SmartRecruiters" };
const PLATFORM_HOST: [RegExp, Platform][] = [[/(^|\.)linkedin\.com$/, "linkedin"], [/(^|\.)greenhouse\.io$/, "greenhouse"], [/(^|\.)lever\.co$/, "lever"], [/(^|\.)ashbyhq\.com$/, "ashby"], [/(^|\.)(myworkdayjobs|workday)\.com$/, "workday"], [/(^|\.)smartrecruiters\.com$/, "smartrecruiters"]];
/** One platform per job from data it already carries: the ATS name, else the posting's host. Unknown stays neutral (null). */
export function platformOf(ats?: string | null, url?: string | null): Platform | null {
  const a = ats?.trim().toLowerCase();
  if (a && Object.hasOwn(PLATFORM_LABEL, a)) return a as Platform;
  let host = "";
  try { host = url ? new URL(url).hostname.toLowerCase() : ""; } catch { /* not a URL */ }
  return PLATFORM_HOST.find(([re]) => re.test(host))?.[1] ?? null;
}
