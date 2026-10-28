import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushSchedule, scheduledPushes } from '../scripts/push-scheduled.mjs';
const row = (id, deadlineAt, extra = {}) => ({ id, company: 'Example', deadlineAt, ...extra });
test('assessment windows use New York calendar dates and exclude non-actionable deadlines', () => {
  const now = new Date('2026-10-28T13:00:00Z'); // 9 AM NY
  const assessments = [row('tomorrow', '2026-10-30T03:59:00Z'), row('today', '2026-10-29T03:59:00Z'), row('none', null), row('invalid', 'bad'), row('done', '2026-10-30T03:59:00Z', { status: 'done' }), row('dismissed', '2026-10-30T03:59:00Z', { status: 'dismissed' })];
  const morning = scheduledPushes({ now, assessments });
  assert.equal(morning.length, 1); assert.match(morning[0].id, /^assessment:tomorrow:/); assert.match(morning[0].notification.body, /tomorrow at 11:59 PM/);
  assert.equal(scheduledPushes({ now: new Date('2026-10-28T12:59:59Z'), assessments }).length, 0);
  assert.equal(scheduledPushes({ now: new Date('2026-10-28T16:00:00Z'), assessments }).length, 0);
  const afternoon = scheduledPushes({ now: new Date('2026-10-28T19:00:00Z'), assessments });
  assert.equal(afternoon.length, 1); assert.match(afternoon[0].id, /^assessment:today:/);
  assert.equal(scheduledPushes({ now: new Date('2026-10-28T19:00:00Z'), assessments: [row('past', '2026-10-28T18:00:00Z')] }).length, 0);
  assert.equal(scheduledPushes({ now: new Date('2026-10-28T23:00:00Z'), assessments }).length, 0);
});
test('tomorrow reminder is correct across daylight saving transitions', () => {
  for (const [now, deadline] of [['2026-10-31T13:00:00Z', '2026-11-02T04:59:00Z'], ['2026-03-07T14:00:00Z', '2026-03-09T03:59:00Z']]) {
    const out = scheduledPushes({ now: new Date(now), assessments: [row('dst', deadline)] });
    assert.equal(out.length, 1); assert.match(out[0].notification.body, /tomorrow at 11:59 PM/);
  }
  assert.equal(pushSchedule(new Date('2026-11-01T14:00:00Z')).assessmentStage, 'tomorrow');
});
test('daily summary counts the New York day, uses accurate reply wording, and has a stable dedup ID', () => {
  const now = new Date('2026-10-29T00:00:00Z'); // Oct 28, 8 PM NY
  const progress = { appliedToday: 30, interviewEmailsToday: 1 };
  const replies = [{ reply: { at: '2026-10-28T15:00:00Z' } }, { reply: { at: '2026-10-28T22:00:00Z' } }, { reply: { at: '2026-10-28T03:59:00Z' } }];
  const [out] = scheduledPushes({ now, progress, replies });
  assert.equal(out.id, 'summary:2026-10-28'); assert.equal(out.notification.body, 'Today: 30 applications, 2 recruiter replies, 1 interview update.'); assert.equal(out.notification.url, '/stats');
  assert.equal(scheduledPushes({ now: new Date('2026-10-29T01:00:00Z'), progress, replies })[0].id, out.id);
  assert.equal(scheduledPushes({ now: new Date('2026-10-28T23:59:59Z'), progress }).length, 0);
  assert.equal(scheduledPushes({ now: new Date('2026-10-29T03:00:00Z'), progress }).length, 0);
  assert.match(scheduledPushes({ now, progress: { appliedToday: 0, interviewEmailsToday: 0 } })[0].notification.body, /0 applications, 0 recruiter replies, 0 interview updates/);
});
