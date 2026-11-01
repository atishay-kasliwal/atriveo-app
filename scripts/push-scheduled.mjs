import { dayKeyOf, shiftDay } from './applied-core.mjs';
import { when } from './assessments.mjs';

const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });
const nyClock = (now) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(now).map(x => [x.type, x.value])); return { hour: Number(p.hour), weekday: p.weekday }; };
/** Catch-up windows allow a restart without sending old reminders late at night. */
export function pushSchedule(now = new Date()) {
  const hour = Number(clock.format(now));
  return { assessmentStage: hour >= 9 && hour < 12 ? 'tomorrow' : hour >= 15 && hour < 19 ? 'today' : null };
}
export function scheduledPushes({ now = new Date(), assessments = [] }) {
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
  // An open assessment with no deadline yet is still a task left: one message each on Monday, Wednesday and Friday morning.
  const { hour, weekday } = nyClock(now);
  if (hour >= 9 && hour < 12 && ['Mon', 'Wed', 'Fri'].includes(weekday)) {
    for (const row of assessments) {
      if ((row.status && row.status !== 'open') || row.deadlineAt) continue;
      out.push({ id: `assessment:${row.id}:undated:${day}`, notification: {
        title: String(row.company || 'An assessment').slice(0, 100), body: 'Assessment waiting, no deadline set yet. Add one in Atriveo.',
        url: '/assessments', type: 'assessment_open', data: { assessmentId: row.id },
      } });
    }
  }
  return out;
}
