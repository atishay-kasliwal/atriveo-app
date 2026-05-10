/**
 * Send a top-20 jobs digest email via Resend for the latest session in this hour.
 *
 * Usage:  npx tsx scripts/send-top-jobs.ts
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

// Use rank-based colours so the digest always has meaningful visual hierarchy
// regardless of the absolute score range in a given session.
function scoreColor(rank: number): { bg: string; text: string } {
  if (rank <= 3)  return { bg: "#dcfce7", text: "#166534" }; // top 3  — green
  if (rank <= 7)  return { bg: "#fef9c3", text: "#854d0e" }; // mid 4  — amber
  return            { bg: "#f1f5f9",  text: "#64748b" };      // rest   — slate
}

function levelColor(level: string): { bg: string; text: string; border: string } {
  switch (level) {
    case "New Grad": return { bg: "#eef4ff", text: "#1d4ed8", border: "#c7d7fe" };
    case "Entry":    return { bg: "#ecfeff", text: "#0e7490", border: "#a5f3fc" };
    case "Mid":      return { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" };
    default:         return { bg: "#f1f5f9", text: "#475569", border: "#e2e8f0" };
  }
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

function fmtHourLabel(d: Date): string {
  return d
    .toLocaleString("en-US", { timeZone: NY_TZ, hour: "numeric", hour12: true })
    .replace(/\s/g, "")
    .toLowerCase();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
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

const COL = { rank: 44, level: 96, match: 76, apply: 88 };

function renderHeader(sessionTime: string, jobsCount: number, avgMatch: number): string {
  return `
    <tr>
      <td style="
        background-color:#0f172a;
        background-image:linear-gradient(135deg,#0f172a 0%,#1e3a5f 50%,#1e40af 100%);
        border-radius:14px 14px 0 0; padding:30px 36px 26px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="
                    width:38px; height:38px;
                    background-color:#2563eb;
                    background-image:linear-gradient(135deg,#2563eb,#0891b2);
                    border-radius:10px; text-align:center; vertical-align:middle;">
                    <span style="color:#fff; font-size:17px; font-weight:800; line-height:38px;">A</span>
                  </td>
                  <td style="padding-left:12px; vertical-align:middle;">
                    <div style="color:#fff; font-size:15px; font-weight:700; letter-spacing:-0.02em;">Atriveo</div>
                    <div style="color:#94a3b8; font-size:11px; margin-top:1px;">Hourly Intelligence</div>
                  </td>
                </tr>
              </table>
            </td>
            <td align="right" style="vertical-align:middle;">
              <span style="
                display:inline-block; border-radius:999px;
                border:1px solid rgba(34,197,94,.45);
                color:#bbf7d0; font-size:11px; font-weight:600;
                padding:5px 10px;">
                <span style="
                  display:inline-block; width:6px; height:6px; border-radius:50%;
                  background:#22c55e; margin-right:5px; vertical-align:middle;"></span>
                Live · ${escapeHtml(sessionTime)}
              </span>
            </td>
          </tr>
          <tr><td colspan="2" style="padding-top:22px;">
            <div style="color:#fff; font-size:26px; font-weight:800; letter-spacing:-0.03em; line-height:1.15;">
              Top ${jobsCount} jobs this hour
            </div>
            <div style="color:#94a3b8; font-size:13px; margin-top:6px;">
              Ranked by match score · avg fit ${avgMatch}% · scored against your resume
            </div>
          </td></tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="
        height:3px;
        background:#2563eb;
        background-image:linear-gradient(90deg,#2563eb,#0891b2,#22c55e);
        border-left:1px solid #e2e8f0; border-right:1px solid #e2e8f0;">
      </td>
    </tr>`;
}

function renderHeroStats(insights: Insights): string {
  const tHour  = trendArrow(insights.thisHour, insights.lastHour);
  const tToday = trendArrow(insights.todayTotal, insights.yesterdayTotal);
  const tSame  = trendArrow(insights.thisHour, insights.yesterdaySameHour);

  const trendInline = (t: Trend, label: string) => t.hasPrev
    ? `<span style="color:${t.color}; font-weight:700;">${t.arrow} ${t.sign}${t.pct}%</span> <span style="color:#94a3b8;">${escapeHtml(label)}</span>`
    : `<span style="color:#cbd5e1;">— ${escapeHtml(label)}</span>`;

  const cell = (
    label: string,
    value: string,
    sub: string,
    accent: string = "#0f172a",
  ) => `
    <td width="25%" style="padding:0 8px; vertical-align:top;">
      <div style="font-size:10.5px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:.1em;">${escapeHtml(label)}</div>
      <div style="font-size:34px; font-weight:800; color:${accent}; letter-spacing:-0.03em; line-height:1.05; margin-top:8px;">${value}</div>
      <div style="font-size:11.5px; color:#64748b; margin-top:6px; line-height:1.5;">${sub}</div>
    </td>`;

  const yestCell = insights.yesterdayTotal != null
    ? cell("Yesterday", fmtNumber(insights.yesterdayTotal), `full-day total · ${trendInline(tToday, "today vs yest")}`)
    : cell("Yesterday", "—", "no data yet");

  return `
    <tr>
      <td style="
        background:#fff; border-left:1px solid #e2e8f0; border-right:1px solid #e2e8f0;
        padding:24px 36px 22px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            ${cell(
              "This hour",
              fmtNumber(insights.thisHour),
              `${trendInline(tHour, "vs last hr")}<br>${trendInline(tSame, "vs yest same hr")}`,
              "#1e40af",
            )}
            ${cell(
              "Today",
              fmtNumber(insights.todayTotal),
              `total scraped today<br>${trendInline(tToday, "vs yesterday")}`,
            )}
            ${yestCell}
            ${cell(
              "Avg match",
              `${insights.avgMatchThisHour}%`,
              `<span style="color:#15803d; font-weight:700;">${insights.highMatchCount}</span> high-match (≥70%)<br><span style="color:#94a3b8;">this hour</span>`,
            )}
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderTwelveHourChart(insights: Insights): string {
  if (!insights.last12h.length) return "";
  const max = Math.max(...insights.last12h.map((b) => b.jobs), 1);
  const chartH = 72;

  const bars = insights.last12h.map((b, i) => {
    const isCurrent = i === insights.last12h.length - 1;
    const h = b.jobs > 0 ? Math.max(4, Math.round((b.jobs / max) * chartH)) : 1;
    const fillColor = isCurrent ? "#2563eb" : "#cbd5e1";
    const fillImg = isCurrent
      ? "linear-gradient(180deg,#2563eb,#0891b2)"
      : "none";
    return `
      <td width="8.33%" style="vertical-align:bottom; padding:0 3px; height:${chartH}px;">
        <div style="height:${h}px; background-color:${fillColor}; background-image:${fillImg}; border-radius:3px 3px 0 0;"></div>
      </td>`;
  }).join("");

  const labels = insights.last12h.map((b, i) => {
    const isCurrent = i === insights.last12h.length - 1;
    const color = isCurrent ? "#0f172a" : "#94a3b8";
    const weight = isCurrent ? "700" : "500";
    return `<td width="8.33%" style="text-align:center; padding:6px 0 0; font-size:10px; color:${color}; font-weight:${weight};">${escapeHtml(fmtHourLabel(b.hour))}</td>`;
  }).join("");

  const counts = insights.last12h.map((b, i) => {
    const isCurrent = i === insights.last12h.length - 1;
    const color = isCurrent ? "#0f172a" : "#94a3b8";
    const weight = isCurrent ? "700" : "500";
    return `<td width="8.33%" style="text-align:center; padding:0 0 6px; font-size:10.5px; color:${color}; font-weight:${weight}; height:16px;">${b.jobs > 0 ? b.jobs : ""}</td>`;
  }).join("");

  return `
    <tr>
      <td style="background:#fff; border-left:1px solid #e2e8f0; border-right:1px solid #e2e8f0; padding:0 36px 24px;">
        <div style="font-size:10.5px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:.1em; margin-bottom:12px;">
          Last 12 hours · jobs scraped per hour
        </div>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>${counts}</tr>
          <tr>${bars}</tr>
          <tr><td colspan="12" style="border-top:1px solid #e2e8f0; height:1px; padding:0; line-height:0; font-size:0;">&nbsp;</td></tr>
          <tr>${labels}</tr>
        </table>
      </td>
    </tr>`;
}

function renderBestMatch(best: Job | null): string {
  if (!best) return "";
  const pct = computePct(best);
  return `
    <tr>
      <td style="background:#fff; border-left:1px solid #e2e8f0; border-right:1px solid #e2e8f0; padding:0 36px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="
          background-color:#0f172a;
          background-image:linear-gradient(135deg,#0f172a 0%,#1e3a5f 60%,#1e40af 100%);
          border-radius:12px;">
          <tr>
            <td style="padding:22px 24px; vertical-align:middle;">
              <div style="font-size:10.5px; font-weight:700; color:#7dd3fc; text-transform:uppercase; letter-spacing:.12em;">
                ★ Best match this hour
              </div>
              <a href="${safeUrl(best.job_url)}" style="
                display:block; color:#fff; font-size:19px; font-weight:700;
                letter-spacing:-0.01em; text-decoration:none; margin-top:8px; line-height:1.3;">
                ${escapeHtml(best.title)}
              </a>
              <div style="color:#cbd5e1; font-size:13px; margin-top:6px;">
                ${escapeHtml(best.company)}${best.location ? " &middot; " + escapeHtml(best.location) : ""}${best.level ? " &middot; " + escapeHtml(best.level) : ""}
              </div>
            </td>
            <td width="180" align="right" style="padding:22px 24px; vertical-align:middle; white-space:nowrap;">
              <div style="font-size:36px; font-weight:800; color:#bbf7d0; letter-spacing:-0.03em; line-height:1;">
                ${pct}%
              </div>
              <div style="font-size:10.5px; color:#94a3b8; margin:6px 0 12px; text-transform:uppercase; letter-spacing:.1em;">match</div>
              <a href="${safeUrl(best.job_url)}" style="
                display:inline-block; background:#fff; color:#0f172a;
                text-decoration:none; border-radius:8px;
                padding:8px 18px; font-size:12.5px; font-weight:700;">
                Apply →
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderTargetMarkets(insights: Insights): string {
  const items = insights.targetMarkets;
  const columns = items.map(i => {
    const hasJobs = i.count > 0;
    const color = hasJobs ? "#10b981" : "#94a3b8";
    const bg = hasJobs ? "#ecfdf5" : "#f1f5f9";
    const border = hasJobs ? "#a7f3d0" : "#e2e8f0";
    const labelColor = hasJobs ? "#064e3b" : "#64748b";
    const textWeight = hasJobs ? "800" : "700";

    const jobsHtml = i.topJobs.map(j => `
      <div style="margin-top:10px; background:#fff; border:1px solid ${border}; border-radius:6px; padding:8px; text-align:left;">
        <a href="${safeUrl(j.job_url)}" style="display:block; font-size:11px; font-weight:700; color:#0f172a; text-decoration:none; line-height:1.3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(j.title)}">
          ${escapeHtml(j.title)}
        </a>
        <div style="font-size:10px; color:#64748b; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${escapeHtml(j.company)}
        </div>
        <div style="margin-top:6px;">
          <a href="${safeUrl(j.job_url)}" style="display:inline-block; font-size:10px; font-weight:700; color:#10b981; text-decoration:none;">Apply →</a>
          <span style="float:right; font-size:10px; font-weight:700; color:#0f172a; background:#e2e8f0; border-radius:3px; padding:1px 4px;">${computePct(j)}%</span>
        </div>
      </div>
    `).join("");

    return `
      <td width="33.33%" style="padding:16px 12px; background:${bg}; border:1px solid ${border}; border-radius:10px; text-align:center; vertical-align:top;">
        <div style="font-size:11.5px; font-weight:700; color:${labelColor}; letter-spacing:0.02em;">${escapeHtml(i.name)}</div>
        <div style="font-size:28px; font-weight:${textWeight}; color:${color}; line-height:1; margin-top:8px;">${i.count}</div>
        <div style="font-size:11px; font-weight:600; color:${labelColor}; margin-top:4px; opacity:0.8;">jobs</div>
        ${jobsHtml}
      </td>`;
  });

  return `
    <tr>
      <td style="background:#fff; border-left:1px solid #e2e8f0; border-right:1px solid #e2e8f0; padding:0 36px 24px;">
        <div style="font-size:10.5px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:.1em; margin-bottom:12px;">
          🎯 Target Markets This Hour
        </div>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            ${columns[0]}
            <td width="12" style="padding:0;"></td>
            ${columns[1]}
            <td width="12" style="padding:0;"></td>
            ${columns[2]}
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderHorizontalBar(label: string, count: number, max: number, color: string): string {
  const pct = max > 0 ? Math.max(2, Math.round((count / max) * 100)) : 0;
  return `
    <tr>
      <td width="78" style="padding:5px 0; font-size:11.5px; color:#475569; font-weight:600; vertical-align:middle;">${escapeHtml(label)}</td>
      <td style="padding:5px 8px; vertical-align:middle;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9; border-radius:4px;">
          <tr><td style="
            background:${color}; height:8px; width:${pct}%;
            border-radius:4px; line-height:0; font-size:0;">&nbsp;</td></tr>
        </table>
      </td>
      <td width="32" align="right" style="padding:5px 0; font-size:12px; color:#0f172a; font-weight:700;">${count}</td>
    </tr>`;
}

function renderModuleCard(title: string, body: string): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="
      background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px;">
      <tr>
        <td style="padding:16px 18px;">
          <div style="font-size:10.5px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.1em; margin-bottom:12px;">
            ${escapeHtml(title)}
          </div>
          ${body}
        </td>
      </tr>
    </table>`;
}

function renderLevelMixModule(insights: Insights): string {
  if (!insights.levelMix.length) return renderModuleCard("Level mix", `<div style="color:#94a3b8; font-size:12px;">No data</div>`);
  const max = Math.max(...insights.levelMix.map((l) => l.count));
  const colors: Record<string, string> = {
    "New Grad": "#3b82f6", "Entry": "#06b6d4", "Mid": "#22c55e", "Other": "#94a3b8",
  };
  const rows = insights.levelMix
    .map((l) => renderHorizontalBar(l.name, l.count, max, colors[l.name] ?? "#64748b"))
    .join("");
  return renderModuleCard(
    "Level mix",
    `<table width="100%" cellpadding="0" cellspacing="0">${rows}</table>`,
  );
}

function renderMatchDistModule(insights: Insights): string {
  const items = [
    { name: "≥70%",   count: insights.highMatchCount, color: "#22c55e" },
    { name: "50–70%", count: insights.midMatchCount,  color: "#eab308" },
    { name: "<50%",   count: insights.lowMatchCount,  color: "#cbd5e1" },
  ];
  const max = Math.max(...items.map((i) => i.count), 1);
  const rows = items.map((i) => renderHorizontalBar(i.name, i.count, max, i.color)).join("");
  return renderModuleCard(
    "Match distribution",
    `<table width="100%" cellpadding="0" cellspacing="0">${rows}</table>`,
  );
}

function renderListModule(title: string, items: { name: string; count: number }[]): string {
  if (!items.length) {
    return renderModuleCard(title, `<div style="color:#94a3b8; font-size:12px;">No data</div>`);
  }
  const max = Math.max(...items.map((i) => i.count));
  const rows = items.map((i) => `
    <tr>
      <td style="padding:5px 0; font-size:12.5px; color:#0f172a; font-weight:600; vertical-align:middle;">
        ${escapeHtml(truncate(i.name, 28))}
      </td>
      <td width="44" align="right" style="padding:5px 0 5px 8px; vertical-align:middle;">
        <span style="
          display:inline-block; background:#e0f2fe; color:#0369a1;
          border-radius:4px; padding:2px 8px; font-size:11px; font-weight:700;">
          ×${i.count}
        </span>
      </td>
    </tr>
    <tr><td colspan="2" style="padding:0;">
      <div style="height:2px; background:#e2e8f0; border-radius:2px; width:${Math.round((i.count / max) * 100)}%;"></div>
    </td></tr>`).join("");
  return renderModuleCard(
    title,
    `<table width="100%" cellpadding="0" cellspacing="0">${rows}</table>`,
  );
}

function renderTwoColModules(left: string, right: string): string {
  return `
    <tr>
      <td style="background:#fff; border-left:1px solid #e2e8f0; border-right:1px solid #e2e8f0; padding:0 36px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="50%" style="vertical-align:top; padding-right:8px;">${left}</td>
            <td width="50%" style="vertical-align:top; padding-left:8px;">${right}</td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderHotTitles(insights: Insights): string {
  if (!insights.hotTitles.length) return "";
  const items = insights.hotTitles.map((t) => `
    <tr>
      <td style="padding:8px 0; vertical-align:middle;">
        <span style="
          display:inline-block; background:#fef3c7; color:#854d0e;
          border-radius:4px; padding:2px 8px; font-size:11px; font-weight:700; margin-right:10px;">
          ×${t.count}
        </span>
        <span style="font-size:12.5px; color:#0f172a; font-weight:600;">${escapeHtml(truncate(t.title, 70))}</span>
      </td>
    </tr>`).join("");
  return `
    <tr>
      <td style="background:#fff; border-left:1px solid #e2e8f0; border-right:1px solid #e2e8f0; padding:0 36px 20px;">
        ${renderModuleCard(
          "Repeated postings · likely the same role across cities",
          `<table width="100%" cellpadding="0" cellspacing="0">${items}</table>`,
        )}
      </td>
    </tr>`;
}

function renderJobTableRow(j: Job, i: number): string {
  const rank = i + 1;
  const pct = computePct(j);
  const sc = scoreColor(rank);
  const lc = levelColor(j.level);
  const rankBg = rank <= 3 ? "#2563eb" : "#e2e8f0";
  const rankImg = rank <= 3 ? "linear-gradient(135deg,#2563eb,#0891b2)" : "none";
  const rankColor = rank <= 3 ? "#fff" : "#64748b";
  const rowBg = rank % 2 === 0 ? "#f8fafc" : "#ffffff";
  const barW = Math.max(6, Math.min(54, Math.round((pct / 100) * 54)));

  return `
    <tr style="background:${rowBg};">
      <td width="${COL.rank}" style="padding:14px 0 14px 20px; vertical-align:middle;">
        <span style="
          display:inline-block; width:26px; height:26px; line-height:26px;
          border-radius:50%; background-color:${rankBg}; background-image:${rankImg};
          color:${rankColor}; font-size:11px; font-weight:700; text-align:center;">
          ${rank}
        </span>
      </td>
      <td style="padding:14px 12px; vertical-align:middle;">
        <a href="${safeUrl(j.job_url)}" style="
          font-size:13.5px; font-weight:600; color:#0f172a;
          text-decoration:none; line-height:1.35; display:block;">
          ${escapeHtml(j.title)}
        </a>
        <span style="font-size:11.5px; color:#64748b; margin-top:2px; display:block;">
          ${escapeHtml(j.company)}${j.location ? " &middot; " + escapeHtml(j.location) : ""}
        </span>
      </td>
      <td width="${COL.level}" style="padding:14px 8px; vertical-align:middle; text-align:center;">
        <span style="
          display:inline-block;
          background:${lc.bg}; color:${lc.text};
          border:1px solid ${lc.border};
          border-radius:99px; padding:3px 10px;
          font-size:11px; font-weight:600; white-space:nowrap;">
          ${escapeHtml(j.level)}
        </span>
      </td>
      <td width="${COL.match}" style="padding:14px 8px; vertical-align:middle; text-align:center;">
        <span style="
          display:inline-block;
          background:${sc.bg}; color:${sc.text};
          border-radius:6px; padding:4px 10px;
          font-size:12px; font-weight:700; white-space:nowrap;">
          ${pct}%
        </span>
        <div style="
          width:54px; height:4px; border-radius:999px;
          background:#e2e8f0; margin:6px auto 0;">
          <div style="
            width:${barW}px;
            height:4px; border-radius:999px;
            background-color:#2563eb;
            background-image:linear-gradient(90deg,#2563eb,#0ea5e9);">
          </div>
        </div>
      </td>
      <td width="${COL.apply}" style="padding:14px 20px 14px 8px; vertical-align:middle; text-align:right;">
        <a href="${safeUrl(j.job_url)}" style="
          display:inline-block; background-color:#2563eb; color:#fff;
          text-decoration:none; border-radius:6px;
          padding:6px 14px; font-size:11px; font-weight:600; white-space:nowrap;">
          Apply →
        </a>
      </td>
    </tr>
    <tr><td colspan="5" style="padding:0; line-height:0; font-size:0;">
      <div style="height:1px; background:#e2e8f0;"></div>
    </td></tr>`;
}

function renderJobTable(jobs: Job[]): string {
  const rows = jobs.map((j, i) => renderJobTableRow(j, i)).join("");
  return `
    <tr>
      <td style="background:#fff; border-left:1px solid #e2e8f0; border-right:1px solid #e2e8f0; border-top:1px solid #e2e8f0; padding:0;">
        <div style="font-size:10.5px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:.1em; padding:18px 36px 12px;">
          Top ${jobs.length} ranked roles
        </div>
        <table width="100%" cellpadding="0" cellspacing="0">
          <colgroup>
            <col width="${COL.rank}">
            <col>
            <col width="${COL.level}">
            <col width="${COL.match}">
            <col width="${COL.apply}">
          </colgroup>
          <tr style="background:#f8fafc; border-bottom:2px solid #e2e8f0;">
            <td width="${COL.rank}" style="padding:10px 0 10px 20px;"></td>
            <td style="padding:10px 12px; font-size:10px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:.08em;">Role</td>
            <td width="${COL.level}" style="padding:10px 8px; font-size:10px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:.08em; text-align:center;">Level</td>
            <td width="${COL.match}" style="padding:10px 8px; font-size:10px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:.08em; text-align:center;">Match</td>
            <td width="${COL.apply}" style="padding:10px 20px 10px 8px;"></td>
          </tr>
          ${rows}
        </table>
      </td>
    </tr>`;
}

function renderFooter(): string {
  return `
    <tr>
      <td style="
        background:#fff;
        border:1px solid #e2e8f0; border-top:none;
        border-radius:0 0 14px 14px;
        padding:24px 36px 28px; text-align:center;">
        <a href="${DASHBOARD_URL}" style="
          display:inline-block;
          background-color:#2563eb;
          background-image:linear-gradient(135deg,#2563eb,#0891b2);
          color:#fff; text-decoration:none;
          border-radius:8px; padding:12px 32px;
          font-size:13.5px; font-weight:600;">
          Open dashboard →
        </a>
        <div style="color:#94a3b8; font-size:11px; margin-top:18px; line-height:1.6;">
          Atriveo &nbsp;&middot;&nbsp; sent automatically every hour<br>
          <a href="${DASHBOARD_URL}" style="color:#94a3b8;">atriveo-app.pages.dev</a>
        </div>
      </td>
    </tr>`;
}

// ─── render: full email ───────────────────────────────────────────────────────

function renderEmail(insights: Insights, jobs: Job[], sessionTime: string): string {
  const preheader = `${fmtNumber(insights.thisHour)} jobs this hour · ${insights.highMatchCount} high-match · avg ${insights.avgMatchThisHour}%`;

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
      <table width="880" cellpadding="0" cellspacing="0" style="max-width:880px; width:100%;">
        ${renderHeader(sessionTime, jobs.length, insights.avgMatchThisHour)}
        ${renderHeroStats(insights)}
        ${renderTwelveHourChart(insights)}
        ${renderBestMatch(insights.bestMatch)}
        ${renderTargetMarkets(insights)}
        ${renderTwoColModules(renderLevelMixModule(insights), renderMatchDistModule(insights))}
        ${renderTwoColModules(
          renderListModule("Top companies hiring", insights.topCompanies),
          renderListModule("Top locations", insights.topLocations),
        )}
        ${renderHotTitles(insights)}
        ${renderJobTable(jobs)}
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
  const lines: string[] = [];

  lines.push(`ATRIVEO · Top ${jobs.length} jobs · ${sessionTime}`);
  lines.push("");
  lines.push("VOLUME");
  lines.push(`  This hour: ${fmtNumber(insights.thisHour)}${tHour.hasPrev ? `  (${tHour.arrow} ${tHour.sign}${tHour.pct}% vs last hour)` : ""}`);
  lines.push(`  Today:     ${fmtNumber(insights.todayTotal)}${tToday.hasPrev ? `  (${tToday.arrow} ${tToday.sign}${tToday.pct}% vs yesterday)` : ""}`);
  if (insights.yesterdayTotal != null) {
    lines.push(`  Yesterday: ${fmtNumber(insights.yesterdayTotal)} full-day total`);
  }
  lines.push(`  Avg match: ${insights.avgMatchThisHour}%  ·  ${insights.highMatchCount} high-match (≥70%)`);
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

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const dotenv = await import("dotenv");
  dotenv.config({ path: resolve(__dirname, "../.env") });

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
  const insights = await loadInsights(db, hourStart, hourEnd, jobsAll);

  await client.close();

  const jobs = jobsAll
    .sort((a, b) => computePct(b) - computePct(a))
    .slice(0, 20);

  // 4. Render and send (or preview locally with PREVIEW=1)
  const subject = `Atriveo · ${insights.thisHour} jobs this hour · ${insights.highMatchCount} high-match`;
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
