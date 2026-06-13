/**
 * Send a top-20 jobs digest email via Resend for the latest session in this hour.
 *
 * Usage:  npx tsx scripts/send-top-jobs.ts
 *
 * Preview locally (no send):
 *   PREVIEW=1 npx tsx scripts/send-top-jobs.ts
 *
 * Preview with screenshot-matched mock data (no MongoDB):
 *   MOCK=1 PREVIEW=1 npx tsx scripts/send-top-jobs.ts
 *
 * Required env vars (set in .env or environment):
 *   MONGO_URI        — MongoDB Atlas connection string
 *   RESEND_API_KEY   — Resend API key (re_xxxxxxxx)
 *
 * Optional env vars:
 *   NOTIFY_EMAIL     — recipient address  (default: katishay@gmail.com)
 *   RESEND_FROM      — sender address     (default: Atriveo Jobs <jobs@atriveo.com>)
 */
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import type { Db } from "mongodb";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── config ───────────────────────────────────────────────────────────────────

const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL ?? "katishay@gmail.com";
const RESEND_FROM  = process.env.RESEND_FROM  ?? "Atriveo Jobs <jobs@atriveo.com>";
const DASHBOARD_URL = "https://atriveo-app.pages.dev";
const NY_TZ = "America/New_York";
const RANKED_ROLES_VISIBLE = 5;

// 250 is the max possible raw score from the scoring rubric.
const MAX_SCORE = 250;

// ─── types ────────────────────────────────────────────────────────────────────

interface Job {
  title: string;
  company: string;
  location: string;
  level: string;
  keyword_score?: number;
  score_pct?: number;
  ats_score?: number;
  job_url: string;
}

interface HourBucket {
  hour: Date;
  jobs: number;
}

interface Insights {
  thisHour: number;
  lastHour: number | null;
  todayTotal: number;
  yesterdaySameHour: number | null;
  yesterdayTotal: number | null;
  last12h: HourBucket[];
  avgMatchThisHour: number;
  highMatchCount: number;
  midMatchCount: number;
  lowMatchCount: number;
  levelMix: { name: string; count: number }[];
  topCompanies: { name: string; count: number }[];
  topLocations: { name: string; count: number }[];
  hotTitles: { title: string; count: number }[];
  bestMatch: Job | null;
  targetMarkets: { name: string; count: number; topJobs: Job[] }[];
}

interface Trend {
  arrow: string;
  pct: number;
  color: string;
  sign: string;
  hasPrev: boolean;
}

interface MarketPulse {
  ny: number;
  nc: number;
  sea: number;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(s: string | undefined | null): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(url: string | undefined | null): string {
  if (!url) return "#";
  const u = String(url).trim();
  if (/^https?:\/\//i.test(u)) return escapeHtml(u);
  return "#";
}

function fmtNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function computePct(job: Job): number {
  const pctFromScorePct = Number(job.score_pct);
  if (Number.isFinite(pctFromScorePct)) {
    return Math.max(0, Math.min(100, Math.round(pctFromScorePct)));
  }
  const pctFromAts = Number(job.ats_score);
  if (Number.isFinite(pctFromAts)) {
    return Math.max(0, Math.min(100, Math.round(pctFromAts)));
  }
  const rawKeyword = Number(job.keyword_score);
  if (Number.isFinite(rawKeyword) && rawKeyword >= 0) {
    return Math.min(100, Math.round((rawKeyword / MAX_SCORE) * 100));
  }
  return 0;
}

function matchColor(pct: number): string {
  if (pct >= 70) return "#10b981";
  if (pct >= 50) return "#f59e0b";
  return "#94a3b8";
}

function companyInitials(company: string): string {
  const clean = company.trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    if (words[0].length <= 3) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  const caps = clean.match(/[A-Z]/g);
  if (caps && caps.length >= 2) return caps.slice(0, 2).join("");
  return clean.slice(0, 2).toUpperCase();
}

function marketShortCode(name: string): string {
  if (/new york/i.test(name)) return "NYC";
  if (/seattle/i.test(name)) return "SEA";
  if (/north carolina/i.test(name)) return "NC";
  return name.slice(0, 3).toUpperCase();
}

function marketPreview(job: Job): string {
  const title = truncate(job.title, 28);
  const company = truncate(job.company, 18);
  return `${title} — ${company}`;
}

function trendArrow(curr: number, prev: number | null): Trend {
  if (prev == null || prev === 0) {
    return { arrow: "·", pct: 0, color: "#94a3b8", sign: "", hasPrev: false };
  }
  const delta = ((curr - prev) / prev) * 100;
  const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "—";
  const color = delta > 0 ? "#15803d" : delta < 0 ? "#b91c1c" : "#64748b";
  const sign  = delta > 0 ? "+" : "";
  return { arrow, pct: Math.round(delta), color, sign, hasPrev: true };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

function getMarketPulse(insights: Insights): MarketPulse {
  const read = (matcher: (name: string) => boolean) =>
    insights.targetMarkets.find((m) => matcher(m.name))?.count ?? 0;

  return {
    ny: read((name) => /new york/i.test(name)),
    nc: read((name) => /north carolina/i.test(name)),
    sea: read((name) => /seattle/i.test(name)),
  };
}

// ─── data loaders ─────────────────────────────────────────────────────────────

async function loadInsights(
  db: Db,
  hourStart: Date,
  hourEnd: Date,
  jobsAll: Job[],
): Promise<Insights> {
  const sessionsCol = db.collection("sessions");

  const lastHourStart        = new Date(hourStart.getTime() - 60 * 60 * 1000);
  const todayStart           = new Date(hourStart);
  todayStart.setUTCHours(0, 0, 0, 0);
  const yesterdayStart       = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const yesterdaySameHourStart = new Date(hourStart.getTime() - 24 * 60 * 60 * 1000);
  const yesterdaySameHourEnd   = new Date(yesterdaySameHourStart.getTime() + 60 * 60 * 1000);
  const twelveHoursAgo       = new Date(hourStart.getTime() - 11 * 60 * 60 * 1000);

  // run_at is stored as a BSON Date (datetime in Python) — pass Date objects, not ISO strings.
  const sumJobs = async (gte: Date, lt: Date): Promise<number> => {
    const docs = await sessionsCol
      .find({ run_at: { $gte: gte, $lt: lt } }, { projection: { job_count: 1 } })
      .toArray();
    return docs.reduce((s, d) => s + (Number(d.job_count) || 0), 0);
  };

  const [thisHour, lastHour, todayTotal, yesterdaySameHour, yesterdayTotal] = await Promise.all([
    sumJobs(hourStart, hourEnd),
    sumJobs(lastHourStart, hourStart),
    sumJobs(todayStart, hourEnd),
    sumJobs(yesterdaySameHourStart, yesterdaySameHourEnd),
    sumJobs(yesterdayStart, todayStart),
  ]);

  // Last 12 hours bucketed: pull all sessions in the window, then bin by hour.
  const recentSessions = await sessionsCol
    .find(
      { run_at: { $gte: twelveHoursAgo, $lt: hourEnd } },
      { projection: { run_at: 1, job_count: 1 } },
    )
    .toArray();

  const last12h: HourBucket[] = [];
  for (let i = 11; i >= 0; i--) {
    const bucketStart = new Date(hourStart.getTime() - i * 60 * 60 * 1000);
    const bucketEnd   = new Date(bucketStart.getTime() + 60 * 60 * 1000);
    const total = recentSessions
      .filter((s) => {
        const t = s.run_at instanceof Date ? s.run_at : new Date(s.run_at as string);
        return t >= bucketStart && t < bucketEnd;
      })
      .reduce((sum, s) => sum + (Number(s.job_count) || 0), 0);
    last12h.push({ hour: bucketStart, jobs: total });
  }

  // Per-job aggregates across the current session.
  const pcts = jobsAll.map(computePct);
  const avgMatchThisHour = pcts.length
    ? Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length)
    : 0;
  const highMatchCount = pcts.filter((p) => p >= 70).length;
  const midMatchCount  = pcts.filter((p) => p >= 50 && p < 70).length;
  const lowMatchCount  = pcts.filter((p) => p < 50).length;

  const levelOrder = ["New Grad", "Entry", "Mid", "Other"];
  const levelCounts: Record<string, number> = {};
  for (const j of jobsAll) {
    const k = j.level || "Other";
    levelCounts[k] = (levelCounts[k] || 0) + 1;
  }
  const levelMix = Object.entries(levelCounts)
    .sort(([a], [b]) => {
      const ia = levelOrder.indexOf(a);
      const ib = levelOrder.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map(([name, count]) => ({ name, count }));

  const tally = (key: keyof Job): { name: string; count: number }[] => {
    const counts: Record<string, number> = {};
    for (const j of jobsAll) {
      const v = (j[key] as string | undefined)?.trim();
      if (!v) continue;
      counts[v] = (counts[v] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
  };

  const topCompanies  = tally("company");
  const topLocations  = tally("location");
  const hotTitles = tally("title")
    .filter((t) => t.count >= 2)
    .map((t) => ({ title: t.name, count: t.count }));

  const bestMatch = jobsAll.length
    ? [...jobsAll].sort((a, b) => computePct(b) - computePct(a))[0]
    : null;

  const targetMarketRules = [
    { name: "New York, NY", regex: /\b(new york|ny)\b/i },
    { name: "Seattle, WA", regex: /\b(seattle|wa)\b/i },
    { name: "North Carolina", regex: /\b(north carolina|nc|raleigh|charlotte)\b/i }
  ];
  const targetMarketsJobs: Job[][] = [[], [], []];
  for (const j of jobsAll) {
    const loc = j.location || "";
    if (targetMarketRules[0].regex.test(loc)) targetMarketsJobs[0].push(j);
    if (targetMarketRules[1].regex.test(loc)) targetMarketsJobs[1].push(j);
    if (targetMarketRules[2].regex.test(loc)) targetMarketsJobs[2].push(j);
  }
  const targetMarkets = targetMarketRules.map((rule, idx) => {
    const jobsForMarket = targetMarketsJobs[idx].sort((a, b) => computePct(b) - computePct(a));
    return {
      name: rule.name,
      count: jobsForMarket.length,
      topJobs: jobsForMarket.slice(0, 3)
    };
  });

  return {
    thisHour, lastHour: lastHour || null, todayTotal,
    yesterdaySameHour: yesterdaySameHour || null,
    yesterdayTotal: yesterdayTotal || null,
    last12h,
    avgMatchThisHour,
    highMatchCount, midMatchCount, lowMatchCount,
    levelMix, topCompanies, topLocations, hotTitles,
    bestMatch, targetMarkets,
  };
}

// ─── render: building blocks ──────────────────────────────────────────────────

function sectionHeader(title: string): string {
  const label = title.toUpperCase();
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
      <tr>
        <td style="white-space:nowrap; padding-right:12px; vertical-align:middle;">
          <span style="font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.12em;">
            ${escapeHtml(label)}
          </span>
        </td>
        <td style="vertical-align:middle; width:100%;">
          <div style="height:1px; background:#e2e8f0; line-height:0; font-size:0;">&nbsp;</div>
        </td>
      </tr>
    </table>`;
}

function renderHeader(sessionTime: string): string {
  return `
    <tr>
      <td style="padding:28px 32px 0;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align:middle;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="
                    width:36px; height:36px;
                    background:#0f172a;
                    border-radius:10px;
                    text-align:center; vertical-align:middle;">
                    <table width="36" height="36" cellpadding="0" cellspacing="0">
                      <tr><td align="center" valign="middle">
                        <span style="
                          display:inline-block; width:14px; height:14px;
                          background:#10b981; border-radius:50;"></span>
                      </td></tr>
                    </table>
                  </td>
                  <td style="padding-left:12px; vertical-align:middle;">
                    <div style="color:#0f172a; font-size:15px; font-weight:800; letter-spacing:.04em;">ATRIVEO</div>
                    <div style="color:#94a3b8; font-size:10px; font-weight:600; letter-spacing:.14em; margin-top:2px;">HOURLY INTELLIGENCE</div>
                  </td>
                </tr>
              </table>
            </td>
            <td align="right" style="vertical-align:middle;">
              <span style="
                display:inline-block; background:#fff;
                border:1px solid #e2e8f0; border-radius:999px;
                padding:6px 12px; font-size:11px; font-weight:600; color:#334155;">
                <span style="
                  display:inline-block; width:7px; height:7px;
                  background:#22c55e; border-radius:50%;
                  margin-right:6px; vertical-align:middle;"></span>
                LIVE
                <span style="color:#cbd5e1; margin:0 6px;">|</span>
                ${escapeHtml(sessionTime)}
              </span>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderTitleBlock(jobsCount: number, avgMatch: number): string {
  return `
    <tr>
      <td style="padding:24px 32px 0;">
        <div style="color:#0f172a; font-size:28px; font-weight:800; letter-spacing:-0.03em; line-height:1.15;">
          Top ${jobsCount} jobs this hour
        </div>
        <div style="color:#64748b; font-size:13px; margin-top:8px;">
          Ranked by match score · avg fit ${avgMatch}% · scored against your resume
        </div>
      </td>
    </tr>`;
}

function renderBestMatch(best: Job | null): string {
  if (!best) return "";
  const pct = computePct(best);
  return `
    <tr>
      <td style="padding:20px 32px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" style="
          background-color:#059669;
          background-image:linear-gradient(135deg,#10b981 0%,#059669 55%,#047857 100%);
          border-radius:14px;">
          <tr>
            <td style="padding:22px 24px 24px; vertical-align:top;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:top;">
                    <span style="
                      display:inline-block;
                      background:rgba(255,255,255,0.18);
                      color:#fff;
                      border-radius:999px;
                      padding:5px 12px;
                      font-size:10px; font-weight:700;
                      letter-spacing:.1em; text-transform:uppercase;">
                      ★ BEST MATCH THIS HOUR
                    </span>
                  </td>
                  <td align="right" style="vertical-align:top; white-space:nowrap;">
                    <div style="font-size:42px; font-weight:800; color:#fff; letter-spacing:-0.04em; line-height:1;">
                      ${pct}%
                    </div>
                    <div style="font-size:10px; font-weight:700; color:rgba(255,255,255,0.75); letter-spacing:.12em; margin-top:2px;">MATCH</div>
                  </td>
                </tr>
              </table>
              <a href="${safeUrl(best.job_url)}" style="
                display:block; color:#fff; font-size:20px; font-weight:700;
                letter-spacing:-0.02em; text-decoration:none; margin-top:16px; line-height:1.35;">
                ${escapeHtml(best.title)}
              </a>
              <div style="color:rgba(255,255,255,0.88); font-size:13px; font-weight:500; margin-top:8px;">
                ${escapeHtml(best.company)}${best.location ? " · " + escapeHtml(best.location) : ""}${best.level ? " · " + escapeHtml(best.level) : ""}
              </div>
              <a href="${safeUrl(best.job_url)}" style="
                display:inline-block; background:#fff; color:#047857;
                text-decoration:none; border-radius:10px;
                padding:10px 18px; font-size:13px; font-weight:700; margin-top:18px;">
                Apply now →
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderStatsCards(insights: Insights): string {
  const tHour  = trendArrow(insights.thisHour, insights.lastHour);
  const tToday = trendArrow(insights.todayTotal, insights.yesterdayTotal);

  const trendText = (t: Trend) => t.hasPrev
    ? `<span style="color:${t.color}; font-weight:700; font-size:12px;">${t.sign}${t.pct}%</span>`
    : `<span style="color:#94a3b8; font-size:12px;">—</span>`;

  const card = (label: string, value: string, sub: string) => `
    <td width="25%" style="padding:0 5px; vertical-align:top;">
      <table width="100%" cellpadding="0" cellspacing="0" style="
        background:#fff; border:1px solid #e2e8f0; border-radius:12px;">
        <tr>
          <td style="padding:16px 14px;">
            <div style="font-size:10px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:.12em;">${escapeHtml(label)}</div>
            <div style="font-size:30px; font-weight:800; color:#0f172a; letter-spacing:-0.03em; line-height:1.05; margin-top:10px;">${value}</div>
            <div style="margin-top:8px; line-height:1.4;">${sub}</div>
          </td>
        </tr>
      </table>
    </td>`;

  const yestValue = insights.yesterdayTotal != null ? fmtNumber(insights.yesterdayTotal) : "—";
  const yestSub = insights.yesterdayTotal != null
    ? `${trendText(tToday)} <span style="color:#94a3b8; font-size:12px;">vs y'day</span>`
    : `<span style="color:#94a3b8; font-size:12px;">no data yet</span>`;

  return `
    <tr>
      <td style="padding:20px 27px 0;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            ${card("This hour", fmtNumber(insights.thisHour), trendText(tHour))}
            ${card("Today", fmtNumber(insights.todayTotal), `<span style="color:#94a3b8; font-size:12px;">total</span>`)}
            ${card("Yesterday", yestValue, yestSub)}
            ${card(
              "Avg match",
              `${insights.avgMatchThisHour}%`,
              `<span style="color:#10b981; font-weight:700; font-size:12px;">${insights.highMatchCount} ≥70%</span>`,
            )}
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderTargetMarkets(insights: Insights): string {
  const cards = insights.targetMarkets.map((m) => {
    const preview = m.topJobs[0] ? marketPreview(m.topJobs[0]) : "No roles this hour";
    const code = marketShortCode(m.name);
    return `
      <td width="33.33%" style="padding:0 5px; vertical-align:top;">
        <table width="100%" cellpadding="0" cellspacing="0" style="
          background:#fff; border:1px solid #e2e8f0; border-radius:12px;">
          <tr>
            <td style="padding:14px 14px 16px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:14px; font-weight:800; color:#0f172a;">${escapeHtml(code)}</td>
                  <td align="right">
                    <span style="
                      display:inline-block; min-width:22px; text-align:center;
                      background:#ecfdf5; color:#059669;
                      border-radius:999px; padding:2px 8px;
                      font-size:11px; font-weight:700;">${m.count}</span>
                  </td>
                </tr>
              </table>
              <div style="font-size:11px; color:#64748b; margin-top:10px; line-height:1.45;">
                ${escapeHtml(preview)}
              </div>
            </td>
          </tr>
        </table>
      </td>`;
  }).join("");

  return `
    <tr>
      <td style="padding:24px 27px 0;">
        ${sectionHeader("Target markets")}
        <table width="100%" cellpadding="0" cellspacing="0"><tr>${cards}</tr></table>
      </td>
    </tr>`;
}

function renderRankedRoleCard(j: Job): string {
  const pct = computePct(j);
  const color = matchColor(pct);
  const initials = companyInitials(j.company);
  const meta = [
    j.company,
    j.location || null,
    j.level || null,
  ].filter(Boolean).map((s) => escapeHtml(String(s))).join(" · ");

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="
      background:#fff; border:1px solid #e2e8f0; border-radius:12px; margin-bottom:10px;">
      <tr>
        <td style="padding:14px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="44" style="vertical-align:middle; padding-right:12px;">
                <span style="
                  display:inline-block; width:38px; height:38px; line-height:38px;
                  border-radius:50%; background:#f1f5f9; color:#64748b;
                  font-size:12px; font-weight:700; text-align:center;">
                  ${escapeHtml(initials)}
                </span>
              </td>
              <td style="vertical-align:middle;">
                <a href="${safeUrl(j.job_url)}" style="
                  display:block; font-size:14px; font-weight:700; color:#0f172a;
                  text-decoration:none; line-height:1.35;">
                  ${escapeHtml(j.title)}
                </a>
                <div style="font-size:12px; color:#64748b; margin-top:3px;">${meta}</div>
              </td>
              <td width="72" align="center" style="vertical-align:middle; padding:0 12px;">
                <div style="font-size:15px; font-weight:800; color:${color};">${pct}%</div>
                <table width="56" cellpadding="0" cellspacing="0" align="center" style="margin-top:6px; background:#e2e8f0; border-radius:999px;">
                  <tr>
                    <td width="${Math.max(1, Math.round(56 * pct / 100))}" style="background:${color}; height:4px; line-height:0; font-size:0; border-radius:999px 0 0 999px;">&nbsp;</td>
                    <td style="height:4px; line-height:0; font-size:0;">&nbsp;</td>
                  </tr>
                </table>
              </td>
              <td width="84" align="right" style="vertical-align:middle;">
                <a href="${safeUrl(j.job_url)}" style="
                  display:inline-block; background:#fff; color:#0f172a;
                  border:1px solid #e2e8f0; text-decoration:none;
                  border-radius:10px; padding:8px 14px;
                  font-size:11px; font-weight:800; letter-spacing:.06em;">
                  APPLY
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}

function renderTopRankedRoles(jobs: Job[]): string {
  const visible = jobs.slice(0, RANKED_ROLES_VISIBLE);
  const remaining = jobs.length - visible.length;
  const cards = visible.map((j) => renderRankedRoleCard(j)).join("");
  const seeMore = remaining > 0
    ? `
      <div style="text-align:center; margin-top:6px; margin-bottom:4px;">
        <a href="${DASHBOARD_URL}" style="
          color:#64748b; font-size:11px; font-weight:700;
          letter-spacing:.08em; text-transform:uppercase; text-decoration:none;">
          See remaining ${remaining} →
        </a>
      </div>`
    : "";

  return `
    <tr>
      <td style="padding:24px 27px 0;">
        ${sectionHeader("Top ranked roles")}
        ${cards}
        ${seeMore}
      </td>
    </tr>`;
}

function renderScrapeVolume(insights: Insights, opts: { first?: boolean } = {}): string {
  const padTop = opts.first ? "20px" : "24px";
  const max = Math.max(...insights.last12h.map((b) => b.jobs), 1);
  const chartH = 56;
  const total12h = insights.last12h.reduce((s, b) => s + b.jobs, 0);

  const bars = insights.last12h.map((b, i) => {
    const isCurrent = i === insights.last12h.length - 1;
    const h = b.jobs > 0 ? Math.max(4, Math.round((b.jobs / max) * chartH)) : 2;
    const fill = isCurrent ? "#34d399" : "#10b981";
    return `
      <td style="vertical-align:bottom; padding:0 2px; height:${chartH}px;">
        <div style="height:${h}px; background:${fill}; border-radius:3px 3px 0 0; opacity:${isCurrent ? "1" : "0.55"};"></div>
      </td>`;
  }).join("");

  const companyRows = insights.topCompanies.slice(0, 5).map((c) => `
    <tr>
      <td style="padding:4px 0; font-size:12px; color:#e2e8f0; font-weight:500;">
        ${escapeHtml(truncate(c.name, 24))}
        <span style="color:#64748b; font-weight:600;"> ×${c.count}</span>
      </td>
    </tr>`).join("");

  const repeatedRows = insights.hotTitles.slice(0, 5).map((t) => `
    <tr>
      <td style="padding:4px 0; font-size:12px; color:#e2e8f0; font-weight:500;">
        ${escapeHtml(truncate(t.title, 28))}
        <span style="color:#64748b; font-weight:600;"> ×${t.count}</span>
      </td>
    </tr>`).join("");

  const repeatedFallback = repeatedRows || `
    <tr><td style="padding:4px 0; font-size:12px; color:#64748b;">No repeated postings</td></tr>`;

  return `
    <tr>
      <td style="padding:${padTop} 27px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" style="
          background:#0f172a; border-radius:14px;">
          <tr>
            <td style="padding:22px 22px 18px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:top;">
                    <div style="font-size:10px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.12em;">
                      Scrape volume · last 12h
                    </div>
                    <div style="font-size:34px; font-weight:800; color:#fff; letter-spacing:-0.03em; margin-top:8px;">
                      ${fmtNumber(total12h)}
                    </div>
                  </td>
                  <td width="55%" style="vertical-align:bottom; padding-left:16px;">
                    <table width="100%" cellpadding="0" cellspacing="0"><tr>${bars}</tr></table>
                  </td>
                </tr>
              </table>
              <div style="height:1px; background:#1e293b; margin:18px 0 16px;"></div>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="50%" style="vertical-align:top; padding-right:12px;">
                    <div style="font-size:10px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.12em; margin-bottom:8px;">
                      Top companies
                    </div>
                    <table width="100%" cellpadding="0" cellspacing="0">${companyRows || `<tr><td style="color:#64748b; font-size:12px;">No data</td></tr>`}</table>
                  </td>
                  <td width="50%" style="vertical-align:top; padding-left:12px;">
                    <div style="font-size:10px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.12em; margin-bottom:8px;">
                      Repeated postings
                    </div>
                    <table width="100%" cellpadding="0" cellspacing="0">${repeatedFallback}</table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderFooter(): string {
  return `
    <tr>
      <td style="padding:24px 32px 32px; text-align:center;">
        <a href="${DASHBOARD_URL}" style="
          display:inline-block; background:#0f172a; color:#fff;
          text-decoration:none; border-radius:12px;
          padding:14px 28px; font-size:14px; font-weight:700;">
          Open dashboard →
        </a>
        <div style="color:#94a3b8; font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; margin-top:22px;">
          ATRIVEO · SENT AUTOMATICALLY EVERY HOUR
        </div>
        <div style="margin-top:10px; font-size:11px; line-height:1.8;">
          <a href="${DASHBOARD_URL}" style="color:#64748b; text-decoration:underline;">atriveo-app.pages.dev</a>
          &nbsp;·&nbsp;
          <a href="${DASHBOARD_URL}/settings" style="color:#64748b; text-decoration:underline;">manage alerts</a>
          &nbsp;·&nbsp;
          <a href="${DASHBOARD_URL}/settings" style="color:#64748b; text-decoration:underline;">unsubscribe</a>
        </div>
      </td>
    </tr>`;
}

// ─── render: full email ───────────────────────────────────────────────────────

function renderEmail(insights: Insights, jobs: Job[], sessionTime: string): string {
  const marketPulse = getMarketPulse(insights);
  const total12h = insights.last12h.reduce((s, b) => s + b.jobs, 0);
  const preheader = `${fmtNumber(total12h)} scraped in 12h · ${fmtNumber(insights.thisHour)} this hour · NY ${marketPulse.ny} · NC ${marketPulse.nc} · SEA ${marketPulse.sea}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Atriveo · Top ${jobs.length} jobs</title>
</head>
<body style="margin:0;padding:0;background:#eef1f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; visibility:hidden; opacity:0; color:transparent; height:0; width:0;">
    ${escapeHtml(preheader)}
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6; padding:24px 12px;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="
        max-width:640px; width:100%;
        background:#fff; border:1px solid #e2e8f0;
        border-radius:16px; box-shadow:0 8px 24px rgba(15,23,42,0.06);">
        ${renderHeader(sessionTime)}
        ${renderScrapeVolume(insights, { first: true })}
        ${renderTitleBlock(jobs.length, insights.avgMatchThisHour)}
        ${renderBestMatch(insights.bestMatch)}
        ${renderStatsCards(insights)}
        ${renderTargetMarkets(insights)}
        ${renderTopRankedRoles(jobs)}
        ${renderFooter()}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── render: plain-text alternative ───────────────────────────────────────────

function renderText(insights: Insights, jobs: Job[], sessionTime: string): string {
  const tHour  = trendArrow(insights.thisHour, insights.lastHour);
  const tToday = trendArrow(insights.todayTotal, insights.yesterdayTotal);
  const marketPulse = getMarketPulse(insights);
  const lines: string[] = [];

  const total12h = insights.last12h.reduce((s, b) => s + b.jobs, 0);
  lines.push(`ATRIVEO · Top ${jobs.length} jobs · ${sessionTime}`);
  lines.push("");
  lines.push(`SCRAPE VOLUME · LAST 12H: ${fmtNumber(total12h)}`);
  if (insights.topCompanies.length) {
    lines.push("TOP COMPANIES");
    for (const c of insights.topCompanies.slice(0, 5)) lines.push(`  ${c.name} ×${c.count}`);
  }
  if (insights.hotTitles.length) {
    lines.push("REPEATED POSTINGS");
    for (const t of insights.hotTitles.slice(0, 5)) lines.push(`  ${t.title} ×${t.count}`);
  }
  lines.push("");
  lines.push("VOLUME");
  lines.push(`  This hour: ${fmtNumber(insights.thisHour)}${tHour.hasPrev ? `  (${tHour.arrow} ${tHour.sign}${tHour.pct}% vs last hour)` : ""}`);
  lines.push(`  Today:     ${fmtNumber(insights.todayTotal)}${tToday.hasPrev ? `  (${tToday.arrow} ${tToday.sign}${tToday.pct}% vs yesterday)` : ""}`);
  if (insights.yesterdayTotal != null) {
    lines.push(`  Yesterday: ${fmtNumber(insights.yesterdayTotal)} full-day total`);
  }
  lines.push(`  Avg match: ${insights.avgMatchThisHour}%  ·  ${insights.highMatchCount} high-match (≥70%)`);
  lines.push(`  Location pulse: NY ${marketPulse.ny} · NC ${marketPulse.nc} · SEA ${marketPulse.sea}`);
  lines.push("");

  if (insights.bestMatch) {
    const pct = computePct(insights.bestMatch);
    lines.push(`★ BEST MATCH (${pct}%)`);
    lines.push(`  ${insights.bestMatch.title}`);
    lines.push(`  ${insights.bestMatch.company}${insights.bestMatch.location ? " · " + insights.bestMatch.location : ""}`);
    lines.push(`  ${insights.bestMatch.job_url}`);
    lines.push("");
  }

  lines.push("TARGET MARKETS");
  for (const tm of insights.targetMarkets) {
    lines.push(`  ${tm.name}: ${tm.count} jobs`);
    for (const j of tm.topJobs) {
      lines.push(`    - [${computePct(j)}%] ${j.title} @ ${j.company}`);
      lines.push(`      ${j.job_url}`);
    }
  }
  lines.push("");

  if (insights.topCompanies.length) {
    lines.push("TOP COMPANIES");
    for (const c of insights.topCompanies) lines.push(`  ${c.name} ×${c.count}`);
    lines.push("");
  }

  lines.push(`TOP ${jobs.length} ROLES`);
  jobs.forEach((j, i) => {
    lines.push(`  ${(i + 1).toString().padStart(2, " ")}. [${computePct(j)}%] ${j.title} — ${j.company}${j.location ? " · " + j.location : ""}`);
    lines.push(`      ${j.job_url}`);
  });
  lines.push("");
  lines.push(`Open dashboard: ${DASHBOARD_URL}`);

  return lines.join("\n");
}

// ─── mock data (MOCK=1 preview) ───────────────────────────────────────────────

function mockJobs(): Job[] {
  const mk = (title: string, company: string, location: string, level: string, pct: number): Job => ({
    title, company, location, level, score_pct: pct,
    job_url: "https://example.com/apply",
  });

  return [
    mk("Artificial Intelligence & Machine Learning Engineer, Associate", "BlackRock", "New York, NY", "Entry", 99),
    mk("Software Engineer, Analytics Platform", "Outreach", "Seattle, WA", "Entry", 80),
    mk("Data Scientist", "Comcast", "New York, NY", "Entry", 69),
    mk("Software Engineer II — ML, Marketplace", "Uber", "Seattle, WA", "Mid", 67),
    mk("Machine Learning Engineer", "Lenovo", "North Carolina", "Entry", 65),
    mk("Software Engineer", "IXL Learning", "Raleigh, NC", "Entry", 64),
    mk("Full Stack Software Engineer", "Illumio", "San Jose, CA", "Entry", 59),
    mk("AI Engineer III — Agentic AI", "American Express", "Phoenix, AZ", "Entry", 52),
    mk("Data Scientist", "IBM", "Houston, TX", "Entry", 39),
    mk("Associate AI Engineer", "Morningstar", "Chicago, IL", "Entry", 37),
    mk("Java Software Engineer", "BeaconFire Inc.", "New York, NY", "Entry", 35),
    mk("Backend Engineer", "Acme Corp", "Seattle, WA", "Mid", 33),
    mk("Platform Engineer", "Stripe", "New York, NY", "Mid", 31),
    mk("ML Engineer", "Meta", "Seattle, WA", "Mid", 29),
    mk("Applied Scientist", "Amazon", "Seattle, WA", "Mid", 28),
    mk("Research Engineer", "OpenAI", "San Francisco, CA", "Mid", 27),
    mk("Data Engineer", "Snowflake", "Seattle, WA", "Mid", 26),
    mk("Software Engineer", "Google", "New York, NY", "Mid", 25),
    mk("AI Engineer", "Anthropic", "San Francisco, CA", "Entry", 24),
    mk("Backend Developer", "Shopify", "Remote", "Mid", 23),
  ];
}

function mockInsights(): Insights {
  const now = new Date();
  const last12h: HourBucket[] = [];
  const counts = [210, 225, 198, 242, 218, 255, 231, 268, 252, 275, 261, 122];
  for (let i = 11; i >= 0; i--) {
    last12h.push({
      hour: new Date(now.getTime() - i * 60 * 60 * 1000),
      jobs: counts[11 - i] ?? 100,
    });
  }

  const jobs = mockJobs();

  return {
    thisHour: 100,
    lastHour: 233,
    todayTotal: 3577,
    yesterdaySameHour: 120,
    yesterdayTotal: 4455,
    last12h,
    avgMatchThisHour: 18,
    highMatchCount: 2,
    midMatchCount: 6,
    lowMatchCount: 92,
    levelMix: [],
    topCompanies: [
      { name: "BeaconFire Inc.", count: 20 },
      { name: "Pragmatike", count: 14 },
      { name: "Amazon Science", count: 12 },
      { name: "Google", count: 11 },
      { name: "Recruiting from Scratch", count: 9 },
    ],
    topLocations: [],
    hotTitles: [
      { title: "Java Software Engineer", count: 11 },
      { title: "Software Engineer", count: 9 },
      { title: "Java Software Developer", count: 7 },
      { title: "Backend Software Engineer", count: 6 },
      { title: "Data Scientist", count: 5 },
    ],
    bestMatch: jobs[0],
    targetMarkets: [
      { name: "New York, NY", count: 13, topJobs: [jobs[0]] },
      { name: "Seattle, WA", count: 4, topJobs: [jobs[1]] },
      { name: "North Carolina", count: 4, topJobs: [jobs[4]] },
    ],
  };
}

async function main() {
  const dotenv = await import("dotenv");
  dotenv.config({ path: resolve(__dirname, "../.env") });

  if (process.env.MOCK === "1") {
    const insights = mockInsights();
    const jobs = mockJobs();
    const sessionTime = "Jun 12, 6:14 PM";
    const html = renderEmail(insights, jobs, sessionTime);
    const fs = await import("fs/promises");
    const previewPath = resolve(__dirname, "preview.html");
    await fs.writeFile(previewPath, html, "utf8");
    console.log(`✓ Mock preview written: ${previewPath}`);
    return;
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) throw new Error("RESEND_API_KEY not set");

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error("MONGO_URI not set");

  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(mongoUri, { appName: "AtriveoMailer" });
  await client.connect();

  const db = client.db("job_pipeline");

  // Hour window for the latest run.
  const now = new Date();
  const hourStart = new Date(now);
  hourStart.setMinutes(0, 0, 0);
  const hourEnd = new Date(hourStart);
  hourEnd.setHours(hourEnd.getHours() + 1);

  // 1. Latest non-archived session in the current hour, falling back to most recent.
  let latestSession = await db.collection("sessions").findOne(
    { archived: false, run_at: { $gte: hourStart, $lt: hourEnd } },
    { sort: { run_at: -1 } },
  );
  if (!latestSession) {
    latestSession = await db
      .collection("sessions")
      .findOne({ archived: false }, { sort: { run_at: -1 } });
  }
  if (!latestSession) {
    console.log("No active sessions found — nothing to send.");
    await client.close();
    return;
  }

  const sessionId = latestSession.session_id as string;
  const runAtRaw = latestSession.run_at;
  const runAt = runAtRaw instanceof Date ? runAtRaw : new Date(runAtRaw as string);
  const sessionTime = runAt.toLocaleString("en-US", {
    timeZone: NY_TZ,
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });

  // 2. Fetch all jobs for this session — used both for the table and aggregates.
  const jobsAll = (await db
    .collection("jobs")
    .find({ session_id: sessionId })
    .project({
      _id: 0,
      title: 1, company: 1, location: 1, level: 1,
      keyword_score: 1, score_pct: 1, ats_score: 1, job_url: 1,
    })
    .toArray()) as unknown as Job[];

  if (jobsAll.length === 0) {
    console.log(`Session ${sessionId} has no jobs — skipping.`);
    await client.close();
    return;
  }

  // 3. Insights queries (volume trends, last 12h, etc.)
  // Use the exact latest-session jobs length for "this hour" so subject/header
  // never drift from the actual digest dataset.
  const rawInsights = await loadInsights(db, hourStart, hourEnd, jobsAll);
  const insights: Insights = { ...rawInsights, thisHour: jobsAll.length };

  await client.close();

  const jobs = jobsAll
    .sort((a, b) => computePct(b) - computePct(a))
    .slice(0, 20);

  // 4. Render and send (or preview locally with PREVIEW=1)
  const marketPulse = getMarketPulse(insights);
  const subject = `Atriveo · ${insights.thisHour} jobs · NY ${marketPulse.ny} · NC ${marketPulse.nc} · SEA ${marketPulse.sea}`;
  const html    = renderEmail(insights, jobs, sessionTime);
  const text    = renderText(insights, jobs, sessionTime);

  if (process.env.PREVIEW === "1") {
    const fs = await import("fs/promises");
    const previewPath = resolve(__dirname, "preview.html");
    await fs.writeFile(previewPath, html, "utf8");
    console.log(`✓ Preview written: ${previewPath} (session: ${sessionId} · jobs: ${jobs.length})`);
    console.log(`  Subject would be: ${subject}`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [NOTIFY_EMAIL],
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body}`);
  }

  const data = await res.json() as { id: string };
  console.log(`✓ Email sent (id: ${data.id}) · session: ${sessionId} · jobs: ${jobs.length}`);
}

main().catch(console.error);
