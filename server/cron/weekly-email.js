// "Your library this week", by email. The daily wake-up (POST /api/cron/daily, 9:00 India time) runs this every day:
// it sends on Mondays, only while the weekly email is on, and at most once a week, even if the wake-up comes twice.
// When Monday's email didn't go out (that wake-up failed), the next day's wake-up catches up.
// A quiet week still gets a short "quiet week" note, so you can see the email works.
import { getMeta, setMeta } from '../db.js';
import { sendWeeklyEmail } from '../email/weekly.js';
import { emailOn, SENT } from '../email/settings.js';

const AT_MOST = 3 * 86_400_000; // 3 days: a Monday still sends after a catch-up on Tuesday or Wednesday, so the email stays on Mondays
const OVERDUE = 7.5 * 86_400_000; // 7.5 days: a Monday was missed (a normal week is 7 days, give or take a late wake-up)

const indiaDay = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date); // 2026-11-02

export default async function weeklyEmail({ now, isMonday } = {}) {
  const time = new Date(now ?? Date.now());
  if (!(await emailOn())) return 'skipped: weekly email is off or not set up';
  const last = Date.parse((await getMeta(SENT)) ?? ''); // not a number when no email went out yet: that waits for a Monday
  if (time - last < AT_MOST) return 'skipped: already sent this week';
  if (!isMonday && !(time - last > OVERDUE)) return 'skipped: not Monday';
  // The same key on the same day: Resend sends it once, even if two wake-ups ask at the same moment.
  const { changes } = await sendWeeklyEmail({ now: time, key: `weekly-email-${indiaDay(time)}` });
  await setMeta(SENT, time.toISOString());
  console.log(`Weekly email sent: ${changes} ${changes === 1 ? 'change' : 'changes'}.`);
  return 'sent';
}
