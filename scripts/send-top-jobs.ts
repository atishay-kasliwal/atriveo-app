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
 *   JOBS_BASE_URL    — site origin        (default: https://atriveo-app.pages.dev)
 *   JWT_SECRET       — sign a short-lived session for /api/jobs (live feed parity)
 *   MAILER_EMAIL     — email claim for that token (default: NOTIFY_EMAIL)
 *   MAILER_PASSWORD  — alternative: login instead of JWT_SECRET
 */
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import type { Db } from "mongodb";
import { careerOpsRating } from "../src/utils/jobPresentation.ts";
import type { Job as DashboardJob } from "../src/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── config ───────────────────────────────────────────────────────────────────

const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL ?? "katishay@gmail.com";
const RESEND_FROM  = process.env.RESEND_FROM  ?? "Atriveo Jobs <jobs@atriveo.com>";
const DASHBOARD_URL = "https://atriveo-app.pages.dev";
const NY_TZ = "America/New_York";
const RANKED_ROLES_VISIBLE = 5;

// The Today page reads these published JSON assets (same files /api/jobs serves),
// NOT MongoDB. They carry score/ats_score/fit_score — the CareerOps inputs — so
// the email must read them too to match the dashboard. Prefer the deployed URL
// (what the live site serves) and fall back to the local public/ build.
const JOBS_BASE_URL = process.env.JOBS_BASE_URL ?? DASHBOARD_URL;

// ─── types ────────────────────────────────────────────────────────────────────

interface Job extends DashboardJob {
  keyword_score?: number;
  score_pct?: number;
}

interface HourBucket {
  hour: Date;
  jobs: number;
}

interface Insights {
  thisHour: number;
  todayTotal: number;
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

/** Warm palette aligned with the Atriveo board UI */
const EMAIL = {
  bg: "#f5f3ee",
  card: "#ffffff",
  ink: "#1a1814",
  sub: "#4a463d",
  muted: "#8a8478",
  line: "#e8e4dc",
  accent: "#c45c4a",
  accentDark: "#a84838",
  accentSoft: "#fdeee9",
  accentGrad: "linear-gradient(135deg,#d46b58 0%,#c45c4a 55%,#a84838 100%)",
  dark: "#1a1814",
  darkGrad: "linear-gradient(135deg,#2a2720 0%,#1a1814 100%)",
  success: "#15803d",
  successSoft: "#e7f6ec",
} as const;

function motivationalCopy(insights: Insights, jobsCount: number): { headline: string; sub: string; kicker: string } {
  const strong = insights.highMatchCount;
  const bestPct = insights.bestMatch ? computePct(insights.bestMatch) : 0;

  if (strong >= 3) {
    return {
      kicker: "Strong matches on the board",
      headline: `${strong} roles worth your time this hour`,
      sub: `We ranked ${fmtNumber(insights.thisHour)} fresh postings down to your top ${jobsCount}. Avg match ${insights.avgMatchThisHour} — pick one and send it today.`,
    };
  }
  if (bestPct >= 80 && insights.bestMatch) {
    return {
      kicker: "Top pick locked in",
      headline: `${bestPct}% match at ${insights.bestMatch.company}`,
      sub: `${truncate(insights.bestMatch.title, 52)} looks like a real fit. Open it before the listing gets buried.`,
    };
  }
  if (insights.thisHour >= 40) {
    return {
      kicker: "Active hour in the pipeline",
      headline: `${fmtNumber(insights.thisHour)} new roles — your shortlist is ready`,
      sub: `Don't scroll the whole feed. Start with these ${jobsCount} ranked matches and apply with intention.`,
    };
  }
  return {
    kicker: "Your hourly briefing",
    headline: `${jobsCount} curated matches, ranked for you`,
    sub: `One strong application beats ten rushed ones. Here's where to focus this hour.`,
  };
}

function emailSubject(insights: Insights, jobsCount: number, sessionTime: string): string {
  const strong = insights.highMatchCount;
  if (strong >= 1) {
    return `${strong} strong fit${strong === 1 ? "" : "s"} · ${insights.thisHour} new jobs · ${sessionTime}`;
  }
  if (insights.bestMatch) {
    return `Top match ${computePct(insights.bestMatch)}% · ${insights.bestMatch.company} · ${sessionTime}`;
  }
  return `Your top ${jobsCount} matches · ${sessionTime}`;
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

// A CareerOps score at/above this is a "Strong match" on the Today page.
const STRONG_FIT_THRESHOLD = 75;
const MAX_RAW_SCORE = 250;

/** Email % = dashboard CareerOps score (single source of truth). */
function computePct(job: Job): number {
  return careerOpsRating(job).score;
}

// Tier colors mirror the Today page CareerOps tiers (75 / 50 / 25 cutoffs).
function matchColor(pct: number): string {
  if (pct >= STRONG_FIT_THRESHOLD) return "#10b981"; // strong
  if (pct >= 50) return "#f59e0b";                    // good
  return "#94a3b8";                                   // review / low
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

function parseJobFeed(data: unknown): Job[] {
  const arr = Array.isArray(data) ? data : (data as { jobs?: unknown })?.jobs ?? [];
  return Array.isArray(arr) ? (arr as Job[]) : [];
}

/** Auth cookie so the mailer can hit /api/jobs (static JSON redirects to login). */
async function getMailerAuthCookie(): Promise<string | null> {
  const email = process.env.MAILER_EMAIL ?? NOTIFY_EMAIL;
  const jwtSecret = process.env.JWT_SECRET;

  if (jwtSecret) {
    const { SignJWT } = await import("jose");
    const token = await new SignJWT({ email, name: "Mailer" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(jwtSecret));
    return `atriveo_token=${token}`;
  }

  const password = process.env.MAILER_PASSWORD;
  if (!password) return null;

  try {
    const res = await fetch(`${JOBS_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return null;
    const setCookie = res.headers.get("set-cookie") ?? "";
    const match = setCookie.match(/atriveo_token=([^;]+)/);
    return match ? `atriveo_token=${match[1]}` : null;
  } catch {
    return null;
  }
}

let mailerAuthCookiePromise: Promise<string | null> | undefined;

async function mailerCookie(): Promise<string | null> {
  if (!mailerAuthCookiePromise) {
    mailerAuthCookiePromise = getMailerAuthCookie().then((cookie) => {
      if (!cookie) {
        console.warn(
          "No JWT_SECRET or MAILER_PASSWORD — using local public/ feeds. " +
          "Set JWT_SECRET in .env for live dashboard parity.",
        );
      }
      return cookie;
    });
  }
  return mailerAuthCookiePromise;
}

/**
 * Load the published jobs feed the Today page reads. Prefers the authenticated
 * /api/jobs endpoint (same JSON the dashboard fetches), then local public/.
 */
async function loadFeedJobs(type: "hour" | "today" | "yesterday"): Promise<Job[]> {
  const file = type === "today"
    ? "today_jobs.json"
    : type === "yesterday"
      ? "yesterday_jobs.json"
      : "jobs.json";

  const cookie = await mailerCookie();
  if (cookie) {
    try {
      const res = await fetch(`${JOBS_BASE_URL}/api/jobs?type=${type}`, {
        headers: { Cookie: cookie },
      });
      const contentType = res.headers.get("content-type") ?? "";
      if (res.ok && contentType.includes("application/json")) {
        const jobs = parseJobFeed(await res.json());
        if (jobs.length) {
          console.log(`Feed · api/${type}: ${jobs.length} jobs`);
          return jobs;
        }
      }
    } catch {
      /* fall through to local file */
    }
  }

  // Local public/ build (updated by deploy / chore commits).
  try {
    const fs = await import("fs/promises");
    const localPath = resolve(__dirname, "../public", file);
    const raw = await fs.readFile(localPath, "utf8");
    const jobs = parseJobFeed(JSON.parse(raw));
    if (jobs.length) {
      console.log(`Feed · local/${file}: ${jobs.length} jobs`);
      return jobs;
    }
  } catch {
    /* no local file either */
  }

  return [];
}

async function loadInsights(
  db: Db | null,
  hourStart: Date,
  hourEnd: Date,
  jobsHour: Job[],
  feedCounts: { today: number; yesterday: number | null },
): Promise<Insights> {
  const sessionsCol = db?.collection("sessions") ?? null;
  const twelveHoursAgo = new Date(hourStart.getTime() - 11 * 60 * 60 * 1000);

  // Mongo is used ONLY for the 12h scrape pipeline chart — not for job counts
  // shown next to dashboard metrics (those come from the published JSON feeds).
  const recentSessions = sessionsCol
    ? await sessionsCol
        .find(
          { run_at: { $gte: twelveHoursAgo, $lt: hourEnd } },
          { projection: { run_at: 1, job_count: 1 } },
        )
        .toArray()
    : [];

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

  const jobsAll = jobsHour;
  const thisHour = jobsAll.length;
  const todayTotal = feedCounts.today;
  const yesterdayTotal = feedCounts.yesterday;
  const pcts = jobsAll.map(computePct);
  const avgMatchThisHour = pcts.length
    ? Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length)
    : 0;
  // Match the Today page tiers exactly: strong ≥75, good ≥50, else review/low.
  const highMatchCount = pcts.filter((p) => p >= STRONG_FIT_THRESHOLD).length;
  const midMatchCount  = pcts.filter((p) => p >= 50 && p < STRONG_FIT_THRESHOLD).length;
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
    thisHour,
    todayTotal,
    yesterdayTotal,
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
          <span style="font-size:11px; font-weight:700; color:${EMAIL.muted}; text-transform:uppercase; letter-spacing:.12em;">
            ${escapeHtml(label)}
          </span>
        </td>
        <td style="vertical-align:middle; width:100%;">
          <div style="height:1px; background:${EMAIL.line}; line-height:0; font-size:0;">&nbsp;</div>
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
                    width:40px; height:40px;
                    background:${EMAIL.darkGrad};
                    border-radius:12px;
                    text-align:center; vertical-align:middle;">
                    <span style="color:#fff; font-size:18px; font-weight:800; line-height:40px;">A</span>
                  </td>
                  <td style="padding-left:12px; vertical-align:middle;">
                    <div style="color:${EMAIL.ink}; font-size:16px; font-weight:800; letter-spacing:.02em;">Atriveo</div>
                    <div style="color:${EMAIL.muted}; font-size:10px; font-weight:600; letter-spacing:.12em; margin-top:2px;">YOUR JOB HUNT, ON AUTOPILOT</div>
                  </td>
                </tr>
              </table>
            </td>
            <td align="right" style="vertical-align:middle;">
              <span style="
                display:inline-block; background:${EMAIL.accentSoft};
                border:1px solid #f0d4cc; border-radius:999px;
                padding:6px 12px; font-size:11px; font-weight:700; color:${EMAIL.accentDark};">
                <span style="
                  display:inline-block; width:7px; height:7px;
                  background:${EMAIL.accent}; border-radius:50%;
                  margin-right:6px; vertical-align:middle;"></span>
                LIVE · ${escapeHtml(sessionTime)}
              </span>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderMotivationHero(insights: Insights, jobsCount: number): string {
  const copy = motivationalCopy(insights, jobsCount);
  const marketPulse = getMarketPulse(insights);
  const chip = (label: string, value: string) => `
    <td style="padding:0 4px 0 0; vertical-align:top;">
      <span style="
        display:inline-block; background:#fff; border:1px solid ${EMAIL.line};
        border-radius:999px; padding:6px 12px;
        font-size:11px; font-weight:700; color:${EMAIL.sub}; white-space:nowrap;">
        ${escapeHtml(label)} <span style="color:${EMAIL.accent};">${escapeHtml(value)}</span>
      </span>
    </td>`;

  return `
    <tr>
      <td style="padding:22px 32px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" style="
          background:${EMAIL.accentSoft};
          border:1px solid #f0d4cc;
          border-radius:16px;">
          <tr>
            <td style="padding:24px 24px 20px;">
              <div style="font-size:10px; font-weight:800; color:${EMAIL.accentDark}; text-transform:uppercase; letter-spacing:.14em;">
                ${escapeHtml(copy.kicker)}
              </div>
              <div style="color:${EMAIL.ink}; font-size:26px; font-weight:800; letter-spacing:-0.03em; line-height:1.2; margin-top:10px;">
                ${escapeHtml(copy.headline)}
              </div>
              <div style="color:${EMAIL.sub}; font-size:14px; line-height:1.55; margin-top:10px; max-width:520px;">
                ${escapeHtml(copy.sub)}
              </div>
              <table cellpadding="0" cellspacing="0" style="margin-top:16px;"><tr>
                ${chip("Strong fits", String(insights.highMatchCount))}
                ${chip("This hour", fmtNumber(insights.thisHour))}
                ${chip("NYC", String(marketPulse.ny))}
                ${chip("SEA", String(marketPulse.sea))}
              </tr></table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderTitleBlock(jobsCount: number, avgMatch: number): string {
  return `
    <tr>
      <td style="padding:22px 32px 0;">
        <div style="color:${EMAIL.ink}; font-size:18px; font-weight:800; letter-spacing:-0.02em;">
          Your top ${jobsCount} ranked roles
        </div>
        <div style="color:${EMAIL.muted}; font-size:13px; margin-top:6px;">
          CareerOps avg ${avgMatch} · same scoring as your dashboard
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
          background-color:${EMAIL.accentDark};
          background-image:${EMAIL.accentGrad};
          border-radius:16px;">
          <tr>
            <td style="padding:24px 24px 26px; vertical-align:top;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:top;">
                    <span style="
                      display:inline-block;
                      background:rgba(255,255,255,0.22);
                      color:#fff;
                      border-radius:999px;
                      padding:5px 12px;
                      font-size:10px; font-weight:800;
                      letter-spacing:.1em; text-transform:uppercase;">
                      ★ Start here — best match
                    </span>
                  </td>
                  <td align="right" style="vertical-align:top; white-space:nowrap;">
                    <div style="font-size:44px; font-weight:800; color:#fff; letter-spacing:-0.04em; line-height:1;">
                      ${pct}%
                    </div>
                    <div style="font-size:10px; font-weight:700; color:rgba(255,255,255,0.8); letter-spacing:.12em; margin-top:2px;">CAREEROPS MATCH</div>
                  </td>
                </tr>
              </table>
              <div style="color:rgba(255,255,255,0.92); font-size:13px; font-weight:600; margin-top:14px; line-height:1.45;">
                This is the role we'd apply to first if we were in your shoes.
              </div>
              <a href="${safeUrl(best.job_url)}" style="
                display:block; color:#fff; font-size:20px; font-weight:800;
                letter-spacing:-0.02em; text-decoration:none; margin-top:14px; line-height:1.35;">
                ${escapeHtml(best.title)}
              </a>
              <div style="color:rgba(255,255,255,0.9); font-size:13px; font-weight:500; margin-top:8px;">
                ${escapeHtml(best.company)}${best.location ? " · " + escapeHtml(best.location) : ""}${best.level ? " · " + escapeHtml(best.level) : ""}
              </div>
              <a href="${safeUrl(best.job_url)}" style="
                display:inline-block; background:#fff; color:${EMAIL.accentDark};
                text-decoration:none; border-radius:12px;
                padding:12px 22px; font-size:14px; font-weight:800; margin-top:18px;
                box-shadow:0 4px 14px rgba(0,0,0,0.12);">
                Apply to this one →
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderStatsCards(insights: Insights): string {
  const tToday = trendArrow(insights.todayTotal, insights.yesterdayTotal);

  const trendText = (t: Trend) => t.hasPrev
    ? `<span style="color:${t.color}; font-weight:700; font-size:12px;">${t.sign}${t.pct}%</span>`
    : `<span style="color:#94a3b8; font-size:12px;">—</span>`;

  const card = (label: string, value: string, sub: string) => `
    <td width="25%" style="padding:0 5px; vertical-align:top;">
      <table width="100%" cellpadding="0" cellspacing="0" style="
        background:#fff; border:1px solid ${EMAIL.line}; border-radius:14px;">
        <tr>
          <td style="padding:16px 14px;">
            <div style="font-size:10px; font-weight:700; color:${EMAIL.muted}; text-transform:uppercase; letter-spacing:.12em;">${escapeHtml(label)}</div>
            <div style="font-size:30px; font-weight:800; color:${EMAIL.ink}; letter-spacing:-0.03em; line-height:1.05; margin-top:10px;">${value}</div>
            <div style="margin-top:8px; line-height:1.4;">${sub}</div>
          </td>
        </tr>
      </table>
    </td>`;

  const yestValue = insights.yesterdayTotal != null ? fmtNumber(insights.yesterdayTotal) : "—";

  return `
    <tr>
      <td style="padding:20px 27px 0;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            ${card("This hour", fmtNumber(insights.thisHour), `<span style="color:${EMAIL.muted}; font-size:12px;">live feed</span>`)}
            ${card("Today", fmtNumber(insights.todayTotal), `${trendText(tToday)} <span style="color:${EMAIL.muted}; font-size:12px;">vs yesterday feed</span>`)}
            ${card("Yesterday", yestValue, `<span style="color:${EMAIL.muted}; font-size:12px;">previous day feed</span>`)}
            ${card(
              "Avg match",
              `${insights.avgMatchThisHour}`,
              `<span style="color:${EMAIL.success}; font-weight:700; font-size:12px;">${insights.highMatchCount} strong fit${insights.highMatchCount === 1 ? "" : "s"} ready</span>`,
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
          background:#fff; border:1px solid ${EMAIL.line}; border-radius:14px;">
          <tr>
            <td style="padding:14px 14px 16px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:14px; font-weight:800; color:${EMAIL.ink};">${escapeHtml(code)}</td>
                  <td align="right">
                    <span style="
                      display:inline-block; min-width:22px; text-align:center;
                      background:${EMAIL.accentSoft}; color:${EMAIL.accentDark};
                      border-radius:999px; padding:2px 8px;
                      font-size:11px; font-weight:800;">${m.count}</span>
                  </td>
                </tr>
              </table>
              <div style="font-size:11px; color:${EMAIL.sub}; margin-top:10px; line-height:1.45;">
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
        ${sectionHeader("Where to hunt")}
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
      background:#fff; border:1px solid ${EMAIL.line}; border-radius:14px; margin-bottom:10px;">
      <tr>
        <td style="padding:14px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="44" style="vertical-align:middle; padding-right:12px;">
                <span style="
                  display:inline-block; width:38px; height:38px; line-height:38px;
                  border-radius:50%; background:${EMAIL.accentSoft}; color:${EMAIL.accentDark};
                  font-size:12px; font-weight:800; text-align:center;">
                  ${escapeHtml(initials)}
                </span>
              </td>
              <td style="vertical-align:middle;">
                <a href="${safeUrl(j.job_url)}" style="
                  display:block; font-size:14px; font-weight:700; color:${EMAIL.ink};
                  text-decoration:none; line-height:1.35;">
                  ${escapeHtml(j.title)}
                </a>
                <div style="font-size:12px; color:${EMAIL.muted}; margin-top:3px;">${meta}</div>
              </td>
              <td width="72" align="center" style="vertical-align:middle; padding:0 12px;">
                <div style="font-size:15px; font-weight:800; color:${color};">${pct}%</div>
                <table width="56" cellpadding="0" cellspacing="0" align="center" style="margin-top:6px; background:${EMAIL.line}; border-radius:999px;">
                  <tr>
                    <td width="${Math.max(1, Math.round(56 * pct / 100))}" style="background:${color}; height:4px; line-height:0; font-size:0; border-radius:999px 0 0 999px;">&nbsp;</td>
                    <td style="height:4px; line-height:0; font-size:0;">&nbsp;</td>
                  </tr>
                </table>
              </td>
              <td width="96" align="right" style="vertical-align:middle;">
                <a href="${safeUrl(j.job_url)}" style="
                  display:inline-block; background:${EMAIL.accent}; color:#fff;
                  border:1px solid ${EMAIL.accentDark}; text-decoration:none;
                  border-radius:10px; padding:9px 16px;
                  font-size:11px; font-weight:800; letter-spacing:.04em;">
                  Apply →
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
      <div style="text-align:center; margin-top:8px; margin-bottom:4px;">
        <a href="${DASHBOARD_URL}" style="
          display:inline-block; background:${EMAIL.dark}; color:#fff;
          text-decoration:none; border-radius:12px;
          padding:12px 22px; font-size:13px; font-weight:800;">
          See all ${jobs.length} matches on your dashboard →
        </a>
      </div>`
    : "";

  return `
    <tr>
      <td style="padding:24px 27px 0;">
        ${sectionHeader("Your shortlist")}
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
                    <div style="font-size:10px; font-weight:700; color:#8a8478; text-transform:uppercase; letter-spacing:.12em;">
                      Scraper pipeline · last 12h
                    </div>
                    <div style="font-size:12px; color:#8a8478; margin-top:6px; line-height:1.4;">
                      Raw jobs ingested by the scraper (not the same as live-feed match counts above).
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
      <td style="padding:28px 32px 36px; text-align:center;">
        <div style="color:${EMAIL.ink}; font-size:16px; font-weight:800; letter-spacing:-0.02em; margin-bottom:8px;">
          Momentum beats perfection.
        </div>
        <div style="color:${EMAIL.sub}; font-size:13px; line-height:1.55; max-width:420px; margin:0 auto 20px;">
          Pick one role from this list, tailor your resume, and hit apply. That's how offers happen.
        </div>
        <a href="${DASHBOARD_URL}" style="
          display:inline-block; background:${EMAIL.accent}; color:#fff;
          text-decoration:none; border-radius:14px;
          padding:15px 32px; font-size:15px; font-weight:800;
          box-shadow:0 6px 20px rgba(196,92,74,0.35);">
          Open your dashboard →
        </a>
        <div style="color:${EMAIL.muted}; font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; margin-top:24px;">
          Atriveo · Hourly job intelligence
        </div>
        <div style="margin-top:10px; font-size:11px; line-height:1.8;">
          <a href="${DASHBOARD_URL}" style="color:${EMAIL.muted}; text-decoration:underline;">Live feed</a>
          &nbsp;·&nbsp;
          <a href="${DASHBOARD_URL}/clickedjobs" style="color:${EMAIL.muted}; text-decoration:underline;">Clicked jobs</a>
          &nbsp;·&nbsp;
          <a href="${DASHBOARD_URL}/settings" style="color:${EMAIL.muted}; text-decoration:underline;">Manage alerts</a>
        </div>
      </td>
    </tr>`;
}

// ─── render: full email ───────────────────────────────────────────────────────

function renderEmail(insights: Insights, jobs: Job[], sessionTime: string): string {
  const marketPulse = getMarketPulse(insights);
  const copy = motivationalCopy(insights, jobs.length);
  const preheader = `${copy.headline} · ${fmtNumber(insights.thisHour)} this hour · ${insights.highMatchCount} strong fits · NYC ${marketPulse.ny} · SEA ${marketPulse.sea}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Atriveo · Your top ${jobs.length} matches</title>
</head>
<body style="margin:0;padding:0;background:${EMAIL.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; visibility:hidden; opacity:0; color:transparent; height:0; width:0;">
    ${escapeHtml(preheader)}
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL.bg}; padding:28px 12px;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="
        max-width:640px; width:100%;
        background:${EMAIL.card}; border:1px solid ${EMAIL.line};
        border-radius:20px; box-shadow:0 12px 40px rgba(26,24,20,0.08);">
        ${renderHeader(sessionTime)}
        ${renderMotivationHero(insights, jobs.length)}
        ${renderBestMatch(insights.bestMatch)}
        ${renderStatsCards(insights)}
        ${renderTitleBlock(jobs.length, insights.avgMatchThisHour)}
        ${renderTopRankedRoles(jobs)}
        ${renderTargetMarkets(insights)}
        ${renderScrapeVolume(insights)}
        ${renderFooter()}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── render: plain-text alternative ───────────────────────────────────────────

function renderText(insights: Insights, jobs: Job[], sessionTime: string): string {
  const tToday = trendArrow(insights.todayTotal, insights.yesterdayTotal);
  const marketPulse = getMarketPulse(insights);
  const lines: string[] = [];

  const copy = motivationalCopy(insights, jobs.length);
  const total12h = insights.last12h.reduce((s, b) => s + b.jobs, 0);
  lines.push(`ATRIVEO · ${copy.headline}`);
  lines.push(copy.sub);
  lines.push(`Live · ${sessionTime}`);
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
  lines.push("VOLUME (published feeds — same as dashboard)");
  lines.push(`  This hour: ${fmtNumber(insights.thisHour)} live feed jobs`);
  lines.push(`  Today:     ${fmtNumber(insights.todayTotal)}${tToday.hasPrev ? `  (${tToday.arrow} ${tToday.sign}${tToday.pct}% vs yesterday feed)` : ""}`);
  if (insights.yesterdayTotal != null) {
    lines.push(`  Yesterday: ${fmtNumber(insights.yesterdayTotal)} full-day total`);
  }
  lines.push(`  Avg match: ${insights.avgMatchThisHour}  ·  ${insights.highMatchCount} strong fit (CareerOps ≥${STRONG_FIT_THRESHOLD})`);
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
  lines.push("Momentum beats perfection — pick one role and apply today.");
  lines.push(`Open dashboard: ${DASHBOARD_URL}`);

  return lines.join("\n");
}

// ─── mock data (MOCK=1 preview) ───────────────────────────────────────────────

function mockJobs(): Job[] {
  // Provide raw `score` (0–250) + ats/fit so CareerOps resolves the same way
  // the dashboard would. `pct` is the intended CareerOps result; back it out
  // into a raw score (0.7 weight dominates) for a faithful preview.
  const mk = (title: string, company: string, location: string, level: string, pct: number): Job => ({
    title, company, location, level,
    score: Math.round((pct / 100) * MAX_RAW_SCORE),
    ats_score: pct,
    fit_score: pct,
    score_pct: pct,
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

  // Derive aggregates from the mock jobs through the real CareerOps path so the
  // preview reflects exactly what loadInsights() produces on live data.
  const pcts = jobs.map(computePct);
  const avgMatchThisHour = pcts.length
    ? Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length)
    : 0;

  return {
    thisHour: jobs.length,
    todayTotal: 3577,
    yesterdayTotal: 4455,
    last12h,
    avgMatchThisHour,
    highMatchCount: pcts.filter((p) => p >= STRONG_FIT_THRESHOLD).length,
    midMatchCount: pcts.filter((p) => p >= 50 && p < STRONG_FIT_THRESHOLD).length,
    lowMatchCount: pcts.filter((p) => p < 50).length,
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

  // Hour window for the latest run.
  const now = new Date();
  const hourStart = new Date(now);
  hourStart.setMinutes(0, 0, 0);
  const hourEnd = new Date(hourStart);
  hourEnd.setHours(hourEnd.getHours() + 1);

  // 1. Load the same published JSON feeds the dashboard API serves.
  const [jobsAll, jobsToday, jobsYesterday] = await Promise.all([
    loadFeedJobs("hour"),
    loadFeedJobs("today"),
    loadFeedJobs("yesterday"),
  ]);
  if (jobsAll.length === 0) {
    console.log("Hour feed is empty — nothing to send.");
    return;
  }

  // 2. MongoDB is used ONLY for the 12h scrape pipeline chart.
  const mongoUri = process.env.MONGO_URI;
  let db: Db | null = null;
  let client: import("mongodb").MongoClient | null = null;
  let sessionTime = now.toLocaleString("en-US", {
    timeZone: NY_TZ,
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });

  if (mongoUri) {
    try {
      const { MongoClient } = await import("mongodb");
      client = new MongoClient(mongoUri, { appName: "AtriveoMailer" });
      await client.connect();
      db = client.db("job_pipeline");

      const latestSession = await db
        .collection("sessions")
        .findOne({ archived: false }, { sort: { run_at: -1 } });
      if (latestSession?.run_at) {
        const runAtRaw = latestSession.run_at;
        const runAt = runAtRaw instanceof Date ? runAtRaw : new Date(runAtRaw as string);
        sessionTime = runAt.toLocaleString("en-US", {
          timeZone: NY_TZ,
          month: "short", day: "numeric",
          hour: "numeric", minute: "2-digit", hour12: true,
        });
      }
    } catch (err) {
      console.warn("MongoDB unavailable — volume trends will be empty.", (err as Error).message);
      db = null;
    }
  }

  // 3. Build insights from feed data (counts + CareerOps) and Mongo (12h chart only).
  const insights = await loadInsights(db, hourStart, hourEnd, jobsAll, {
    today: jobsToday.length,
    yesterday: jobsYesterday.length > 0 ? jobsYesterday.length : null,
  });

  if (client) await client.close();

  console.log(
    `Feed parity · hour=${insights.thisHour} today=${insights.todayTotal} yesterday=${insights.yesterdayTotal ?? "—"} ` +
    `avg=${insights.avgMatchThisHour} strong=${insights.highMatchCount}`,
  );

  const jobs = jobsAll
    .sort((a, b) => computePct(b) - computePct(a))
    .slice(0, 20);

  // 4. Render and send (or preview locally with PREVIEW=1)
  const subject = emailSubject(insights, jobs.length, sessionTime);
  const html    = renderEmail(insights, jobs, sessionTime);
  const text    = renderText(insights, jobs, sessionTime);

  if (process.env.PREVIEW === "1") {
    const fs = await import("fs/promises");
    const previewPath = resolve(__dirname, "preview.html");
    await fs.writeFile(previewPath, html, "utf8");
    console.log(`✓ Preview written: ${previewPath} (feed jobs: ${jobsAll.length} · top: ${jobs.length})`);
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
  console.log(`✓ Email sent (id: ${data.id}) · feed jobs: ${jobsAll.length} · top: ${jobs.length}`);
}

main().catch(console.error);
