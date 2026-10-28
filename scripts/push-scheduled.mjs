import { dayKeyOf, shiftDay } from './applied-core.mjs';
import { when } from './assessments.mjs';

const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });
/** Catch-up windows allow a restart without sending old reminders late at night. */
export function pushSchedule(now = new Date()) {
  const hour = Number(clock.format(now));
  return { assessmentStage: hour >= 9 && hour < 12 ? 'tomorrow' : hour >= 15 && hour < 19 ? 'today' : null, summary: hour >= 20 && hour < 23 };
}
const quantity = (n, singular, plural = `${singular}s`) => `${n} ${n === 1 ? singular : plural}`;
export function scheduledPushes({ now = new Date(), assessments = [], progress, replies = [] }) {
  const day = dayKeyOf(now), schedule = pushSchedule(now), out = [];
  if (schedule.assessmentStage) {
    const targetDay = schedule.assessmentStage === 'tomorrow' ? shiftDay(day, 1) : day;
    for (const row of assessments) {
      if ((row.status && row.status !== 'open') || !row.deadlineAt || Date.parse(row.deadlineAt) <= +now || dayKeyOf(row.deadlineAt) !== targetDay) continue;
      out.push({ id: `assessment:${row.id}:${new Date(row.deadlineAt).toISOString()}:${schedule.assessmentStage}`, notification: {
        title: 'Assessment deadline', body: `${String(row.company || 'Your').slice(0, 100)} assessment is due ${when(row.deadlineAt, +now)} (New York).`,
        url: '/assessments', type: 'assessment_deadline', data: { assessmentId: row.id, deadlineAt: row.deadlineAt },
      } });
    }
  }
  if (schedule.summary && progress) {
    // Replies are first replies recorded on outreach messages, not every employer
    // email: interview/assessment/rejection events aren't mislabeled as replies.
    const replyCount = replies.filter(row => dayKeyOf(row.reply?.at) === day).length;
    out.push({ id: `summary:${day}`, notification: { title: 'Your Atriveo daily summary',
      body: `Today: ${quantity(progress.appliedToday, 'application')}, ${quantity(replyCount, 'recruiter reply', 'recruiter replies')}, ${quantity(progress.interviewEmailsToday, 'interview update')}.`,
      url: '/stats', type: 'daily_summary', data: { day, timeZone: 'America/New_York' },
    } });
  }
  return out;
}
