// The "Weekly email" card at the end of the Stats page (owner only): whether the Monday email is on, where it goes,
// when it last went out, and what this week's would hold. The switch and "Send test email" are in the ⋯ menu
// (EmailMenu.jsx); this card shares its settings (the same 'email-settings' question to the server).
// This file's default export makes it an "extra card" (see StatsPage.jsx); its styles are in changes.css, next to
// the "This week" card it sits beside.
import { useQuery } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { api } from '../../api.js';
import { fullDate } from '../../format.js';
import { plural } from './shared.jsx';
import './changes.css';

export default function WeeklyEmailCard({ stats, owner }) {
  const settings = useQuery({ queryKey: ['email-settings'], queryFn: () => api('/email/settings'), enabled: owner, retry: false });
  if (!owner) return null;
  const { ready, on, to, lastSent } = settings.data ?? {};
  const counts = { price: 0, feature: 0, rising: 0, dead: 0 };
  for (const item of stats.changes.items) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  const week = [
    counts.price && plural(counts.price, 'price change'),
    counts.feature && plural(counts.feature, 'new feature'),
    counts.rising && plural(counts.rising, 'site getting popular', 'sites getting popular'),
    counts.dead && plural(counts.dead, 'link that stopped working', 'links that stopped working'),
  ].filter(Boolean);
  const status = settings.isPending ? '' : ready ? (on ? 'On' : 'Off') : 'Not set up';

  return (
    <section className="stats-card stats-email" aria-labelledby="stats-email">
      <header className="stats-card-head stats-email-head">
        <span className="stats-email-icon" aria-hidden="true">
          <Mail size={18} />
        </span>
        <div>
          <p className="stats-kicker" aria-hidden="true">
            Every Monday
          </p>
          <h3 id="stats-email">Weekly email</h3>
          <p className="stats-card-sub">The week’s new prices, new features and links that stopped working.</p>
        </div>
        {status ? <span className={`stats-email-status${on && ready ? ' is-on' : ''}`}>{status}</span> : null}
      </header>
      <p className="stats-email-week">
        <strong>This week so far:</strong> {week.length ? week.join(', ') : 'nothing new yet'}.
      </p>
      {settings.isPending ? null : ready ? (
        <p className="stats-quiet">
          {on ? `Goes to ${to}.` : 'It is turned off.'} {lastSent ? `Last sent ${fullDate(lastSent)}.` : 'Not sent yet.'} Turn it on or off,
          or send yourself a test, from the ⋯ menu at the top.
        </p>
      ) : (
        <p className="stats-quiet">
          To get it, add a free Resend key and your email address to the server’s settings (RESEND_API_KEY and
          WEEKLY_EMAIL_TO; the README says how).
        </p>
      )}
    </section>
  );
}
