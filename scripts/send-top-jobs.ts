/**
 * Send a top-10 jobs digest email via Resend for the most recent pipeline session.
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

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── config ───────────────────────────────────────────────────────────────────

const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL ?? "katishay@gmail.com";
const RESEND_FROM  = process.env.RESEND_FROM  ?? "Atriveo Jobs <jobs@atriveo.com>";

// score_pct is computed during Python export and may not be stored in MongoDB.
// 130 is the max possible raw score from the scoring rubric.
const MAX_SCORE = 130;

// ─── types ────────────────────────────────────────────────────────────────────

interface Job {
  title: string;
  company: string;
  location: string;
  level: string;
  keyword_score: number;
  job_url: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function computePct(job: Job): number {
  return Math.min(100, Math.round((job.keyword_score / MAX_SCORE) * 100));
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
    case "New Grad": return { bg: "rgba(37,99,235,0.08)", text: "#1d4ed8", border: "rgba(37,99,235,0.2)" };
    case "Entry":    return { bg: "rgba(8,145,178,0.08)", text: "#0e7490", border: "rgba(8,145,178,0.2)" };
    case "Mid":      return { bg: "rgba(22,163,74,0.08)", text: "#15803d", border: "rgba(22,163,74,0.2)" };
    default:         return { bg: "#f1f5f9", text: "#475569", border: "#e2e8f0" };
  }
}

// ─── email template ───────────────────────────────────────────────────────────

// Column widths (px) — fixed so every row aligns perfectly.
const COL = { rank: 44, level: 96, match: 68, apply: 88 };

function renderEmail(jobs: Job[], sessionTime: string): string {
  const rows = jobs.map((j, i) => {
    const rank      = i + 1;
    const pct       = computePct(j);
    const sc        = scoreColor(rank);
    const lc        = levelColor(j.level);
    const rankBg    = rank <= 3 ? "linear-gradient(135deg,#2563eb,#0891b2)" : "#e2e8f0";
    const rankColor = rank <= 3 ? "#fff" : "#64748b";
    const rowBg     = rank % 2 === 0 ? "#f8fafc" : "#ffffff";

    return `
    <tr style="background:${rowBg};">
      <td width="${COL.rank}" style="padding:14px 0 14px 16px; vertical-align:middle;">
        <span style="
          display:inline-block; width:26px; height:26px; line-height:26px;
          border-radius:50%; background:${rankBg};
          color:${rankColor}; font-size:11px; font-weight:700; text-align:center;">
          ${rank}
        </span>
      </td>
      <td style="padding:14px 12px; vertical-align:middle;">
        <a href="${j.job_url}" style="
          font-size:13px; font-weight:600; color:#0f172a;
          text-decoration:none; line-height:1.35; display:block;">
          ${j.title}
        </a>
        <span style="font-size:11.5px; color:#64748b; margin-top:2px; display:block;">
          ${j.company}${j.location ? " &middot; " + j.location : ""}
        </span>
      </td>
      <td width="${COL.level}" style="padding:14px 8px; vertical-align:middle; text-align:center;">
        <span style="
          display:inline-block;
          background:${lc.bg}; color:${lc.text};
          border:1px solid ${lc.border};
          border-radius:99px; padding:3px 10px;
          font-size:11px; font-weight:600; white-space:nowrap;">
          ${j.level}
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
      </td>
      <td width="${COL.apply}" style="padding:14px 16px 14px 8px; vertical-align:middle; text-align:right;">
        <a href="${j.job_url}" style="
          display:inline-block; background:#2563eb; color:#fff;
          text-decoration:none; border-radius:6px;
          padding:5px 14px; font-size:11px; font-weight:600; white-space:nowrap;">
          Apply →
        </a>
      </td>
    </tr>
    <tr><td colspan="5" style="padding:0; line-height:0; font-size:0;">
      <div style="height:1px; background:#e2e8f0;"></div>
    </td></tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9; padding:32px 16px;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px; width:100%;">

        <!-- ── header ── -->
        <tr>
          <td style="
            background:linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #1e40af 100%);
            border-radius:14px 14px 0 0; padding:28px 32px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <!-- logo mark -->
                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="
                        width:36px; height:36px;
                        background:linear-gradient(135deg,#2563eb,#0891b2);
                        border-radius:10px; text-align:center; vertical-align:middle;
                        box-shadow:0 0 18px rgba(37,99,235,0.4);">
                        <span style="color:#fff; font-size:16px; font-weight:800; line-height:36px;">A</span>
                      </td>
                      <td style="padding-left:10px; vertical-align:middle;">
                        <div style="color:#fff; font-size:15px; font-weight:700; letter-spacing:-0.02em;">Atriveo</div>
                        <div style="color:#94a3b8; font-size:10.5px; margin-top:1px;">Job Feed</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr><td style="padding-top:18px;">
                <div style="color:#fff; font-size:24px; font-weight:700; letter-spacing:-0.03em;">
                  Top 10 Jobs This Hour
                </div>
                <div style="color:#94a3b8; font-size:12.5px; margin-top:5px;">
                  <span style="
                    display:inline-block; width:7px; height:7px; border-radius:50%;
                    background:#22c55e; box-shadow:0 0 6px #22c55e;
                    margin-right:6px; vertical-align:middle;">
                  </span>
                  Run at ${sessionTime} &nbsp;&middot;&nbsp; ranked by match score
                </div>
              </td></tr>
            </table>
          </td>
        </tr>

        <!-- ── top accent bar ── -->
        <tr>
          <td style="
            height:3px;
            background:linear-gradient(90deg,#2563eb,#0891b2,#22c55e);
            border-left:1px solid #e2e8f0; border-right:1px solid #e2e8f0;">
          </td>
        </tr>

        <!-- ── body ── -->
        <tr>
          <td style="
            background:#fff;
            border-left:1px solid #e2e8f0; border-right:1px solid #e2e8f0;
            padding:0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <colgroup>
                <col width="${COL.rank}">
                <col>
                <col width="${COL.level}">
                <col width="${COL.match}">
                <col width="${COL.apply}">
              </colgroup>
              <!-- column header -->
              <tr style="background:#f8fafc; border-bottom:2px solid #e2e8f0;">
                <td width="${COL.rank}" style="padding:10px 0 10px 16px;"></td>
                <td style="padding:10px 12px; font-size:10px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:.08em;">Role</td>
                <td width="${COL.level}" style="padding:10px 8px; font-size:10px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:.08em; text-align:center;">Level</td>
                <td width="${COL.match}" style="padding:10px 8px; font-size:10px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:.08em; text-align:center;">Match</td>
                <td width="${COL.apply}" style="padding:10px 16px 10px 8px;"></td>
              </tr>
              ${rows}
            </table>
          </td>
        </tr>

        <!-- ── footer ── -->
        <tr>
          <td style="
            background:#fff;
            border:1px solid #e2e8f0; border-top:none;
            border-radius:0 0 14px 14px;
            padding:20px 32px 24px;
            text-align:center;">
            <a href="https://atriveo-app.pages.dev" style="
              display:inline-block;
              background:linear-gradient(135deg,#2563eb,#0891b2);
              color:#fff; text-decoration:none;
              border-radius:8px; padding:11px 32px;
              font-size:13.5px; font-weight:600;
              box-shadow:0 4px 14px rgba(37,99,235,0.3);">
              Open Dashboard →
            </a>
            <div style="color:#94a3b8; font-size:11px; margin-top:16px; line-height:1.6;">
              Atriveo &nbsp;&middot;&nbsp; sent automatically every hour<br>
              <a href="https://atriveo-app.pages.dev" style="color:#94a3b8;">atriveo-app.pages.dev</a>
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
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

  // 1. Find the most recent non-archived session
  const latestSession = await db
    .collection("sessions")
    .findOne({ archived: false }, { sort: { run_at: -1 } });

  if (!latestSession) {
    console.log("No active sessions found — nothing to send.");
    await client.close();
    return;
  }

  const sessionId   = latestSession.session_id as string;
  const sessionTime = new Date(latestSession.run_at as string).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });

  // 2. Fetch top 10 jobs by keyword_score from that session
  const jobs = (await db
    .collection("jobs")
    .find({ session_id: sessionId })
    .sort({ keyword_score: -1 })
    .limit(10)
    .project({ _id: 0, title: 1, company: 1, location: 1, level: 1, keyword_score: 1, job_url: 1 })
    .toArray()) as Job[];

  await client.close();

  if (jobs.length === 0) {
    console.log(`Session ${sessionId} has no jobs — skipping.`);
    return;
  }

  // 3. Render and send
  const subject = `Atriveo · Top ${jobs.length} jobs — ${sessionTime}`;
  const html    = renderEmail(jobs, sessionTime);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: RESEND_FROM, to: [NOTIFY_EMAIL], subject, html }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body}`);
  }

  const data = await res.json() as { id: string };
  console.log(`✓ Email sent (id: ${data.id}) · session: ${sessionId} · jobs: ${jobs.length}`);
}

main().catch(console.error);
