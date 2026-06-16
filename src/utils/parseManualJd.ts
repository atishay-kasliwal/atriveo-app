import type { ManualTailorSession } from "./manualJob";

export interface ParsedManualJd {
  company: string;
  title: string;
  jobUrl: string;
  description: string;
}

const JOB_URL_HINT = /linkedin\.com\/jobs|indeed\.com|greenhouse|lever\.co|ashbyhq|myworkdayjobs|jobs\.lever|boards\.greenhouse/i;

function cleanField(value: string): string {
  return value.replace(/\s+/g, " ").replace(/^[\s\-|,:]+|[\s\-|,:]+$/g, "").trim();
}

function stripUrlFromLine(line: string): string {
  return line.replace(/https?:\/\/\S+/g, "").trim();
}

export function nextManualSlot(sessions: ManualTailorSession[]): number {
  let max = 0;
  const re = /unknown(?:-role)?-?(\d+)/i;
  for (const session of sessions) {
    for (const val of [session.company, session.title]) {
      const match = val.match(re);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return max + 1;
}

function looksLikeRole(line: string): boolean {
  return /\b(engineer|manager|designer|analyst|developer|lead|director|specialist|intern|product|software|senior|staff|principal|architect|coordinator|associate|scientist|consultant)\b/i.test(line);
}

function looksLikeCompanyName(line: string): boolean {
  const plain = cleanField(line);
  if (!plain || plain.length > 48) return false;
  if (looksLikeRole(plain)) return false;
  const words = plain.split(/\s+/);
  return words.length <= 4 && /^[A-Z0-9]/.test(plain);
}

/** Apply optional user overrides; fall back to parsed or unknown slot. */
export function applyManualOverrides(
  parsed: ParsedManualJd,
  overrides: { company?: string; title?: string },
  slot: number,
): ParsedManualJd {
  const companyRaw = overrides.company?.trim() || parsed.company;
  const titleRaw = overrides.title?.trim() || parsed.title;
  let company = cleanField(companyRaw);
  let title = cleanField(titleRaw);
  if (!company || /^unknown\d*$/i.test(company)) company = `unknown${slot}`;
  if (!title || /^unknown-role-\d+$/i.test(title)) title = `unknown-role-${slot}`;
  return { ...parsed, company, title };
}

/** Pull company, role, and URL out of a pasted JD blob. */
export function parseManualJd(raw: string, slot: number): ParsedManualJd {
  const description = raw.trim();
  const lines = description.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const urlMatches = description.match(/https?:\/\/[^\s)>\]"']+/gi) ?? [];
  let jobUrl = "";
  for (const candidate of urlMatches) {
    const cleaned = candidate.replace(/[.,;]+$/, "");
    if (JOB_URL_HINT.test(cleaned)) {
      jobUrl = cleaned;
      break;
    }
  }
  if (!jobUrl && urlMatches[0]) {
    jobUrl = urlMatches[0].replace(/[.,;]+$/, "");
  }

  let title = "";
  let company = "";

  for (const line of lines.slice(0, 20)) {
    const plain = stripUrlFromLine(line);
    const titleMatch = plain.match(/^(?:job title|role|position|title)\s*[:|\-–]\s*(.+)$/i);
    if (titleMatch && !title) title = titleMatch[1];
    const companyMatch = plain.match(/^(?:company|employer|organization|hiring company)\s*[:|\-–]\s*(.+)$/i);
    if (companyMatch && !company) company = companyMatch[1];
  }

  // LinkedIn-style: Title on line 1, "Company · Location" on line 2
  if (lines.length >= 2) {
    const second = stripUrlFromLine(lines[1]);
    if (second.includes("·") && !company) {
      company = second.split("·")[0];
      if (!title) title = stripUrlFromLine(lines[0]);
    }
  }

  // Company on line 1, role on line 2 (e.g. "Heron" / "Platform Engineer")
  if (!company && !title && lines.length >= 2) {
    const first = cleanField(stripUrlFromLine(lines[0]));
    const second = cleanField(stripUrlFromLine(lines[1]));
    if (looksLikeCompanyName(first) && looksLikeRole(second)) {
      company = first;
      title = second;
    }
  }

  if (!title && lines[0]) {
    const first = stripUrlFromLine(lines[0]);
    if (
      first.length > 0
      && first.length <= 120
      && !/^https?:\/\//i.test(first)
      && !(looksLikeCompanyName(first) && lines.length >= 2 && looksLikeRole(cleanField(stripUrlFromLine(lines[1]))))
    ) {
      title = first;
    }
  }

  if (!company && lines[0] && looksLikeCompanyName(lines[0])) {
    company = cleanField(stripUrlFromLine(lines[0]));
    if (!title && lines.length >= 2) {
      const second = cleanField(stripUrlFromLine(lines[1]));
      if (second.length >= 5 && second.length <= 120) title = second;
    }
  }

  if (!company) {
    for (const line of lines.slice(0, 8)) {
      const plain = stripUrlFromLine(line);
      const atMatch = plain.match(/\bat\s+([A-Z0-9][A-Za-z0-9&.'\- ]{1,58})\s*$/);
      if (atMatch) {
        company = atMatch[1];
        break;
      }
    }
  }

  if (!company) {
    const hiringMatch = description.match(/^([A-Z0-9][A-Za-z0-9&.'\- ]{1,50})\s+is hiring/im);
    if (hiringMatch) company = hiringMatch[1];
  }

  title = cleanField(title);
  company = cleanField(company);

  // Company on line 1, title on line 2 (common paste format)
  if (company && !title && lines.length >= 2) {
    const first = cleanField(stripUrlFromLine(lines[0]));
    if (first.toLowerCase() === company.toLowerCase() || first.includes(company)) {
      const candidate = cleanField(stripUrlFromLine(lines[1]));
      if (candidate.length >= 5 && candidate.length <= 120 && !/^https?:\/\//i.test(candidate)) {
        title = candidate;
      }
    }
  }

  // Company known but title still missing — scan for role-like lines
  if (company && !title) {
    for (const line of lines.slice(0, 20)) {
      const plain = cleanField(stripUrlFromLine(line));
      if (!plain || plain === company || plain.toLowerCase() === company.toLowerCase()) continue;
      if (
        plain.length >= 8
        && plain.length <= 100
        && /\b(engineer|manager|designer|analyst|developer|lead|director|specialist|intern|product|software|senior|staff|principal|architect|coordinator|associate)\b/i.test(plain)
      ) {
        title = plain;
        break;
      }
    }
  }

  if (!company) company = `unknown${slot}`;
  if (!title) title = `unknown-role-${slot}`;
  if (!jobUrl) jobUrl = `manual://unknown-${slot}-${Date.now()}`;

  return { company, title, jobUrl, description };
}
