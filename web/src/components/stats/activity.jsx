// "Rhythm": a calendar of the last year, one small square per day (a column per week, Monday at the top), darker on
// days you added more links. A switch shows the days you last opened links instead (a link only remembers the last
// time you opened it, so each link counts once). Beside it: the year's total, the busiest day and how many days
// had something.
// A big import fills one dark square and leaves the rest empty: a note says why, so it doesn't look broken.
// On a phone the calendar scrolls sideways and starts at today, the end that matters most.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Card, dayDate, dayKey, dayName, plural } from './shared.jsx';
import './activity.css';

const WEEKS = 53;
const LEVELS = 4; // shades of color for days that have something
const MODES = {
  added: { label: 'Added', one: 'link added', many: 'links added', empty: 'No links added in the last year.' },
  opened: { label: 'Opened', one: 'link opened', many: 'links opened', empty: 'You haven’t opened any links in the last year.' },
};

// The year as columns of 7 days (Monday first), ending with this week. Days after today are null (empty cells).
function weeksUpTo(today) {
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  const first = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - (WEEKS - 1) * 7);
  return Array.from({ length: WEEKS }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => {
      const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + week * 7 + day);
      return date > today ? null : date;
    }),
  );
}

// A month's short name over the week its 1st day is in. The first column gets one too when most of its month is
// still to come (from the 10th on, the next month's name would crowd it).
function monthLabels(weeks) {
  const short = new Intl.DateTimeFormat('en-GB', { month: 'short' });
  const labels = [];
  let last = -3;
  weeks.forEach((days, week) => {
    const start = days.find(date => date?.getDate() === 1) ?? (week === 0 && days[0].getDate() <= 10 ? days[0] : null);
    if (!start || week - last < 3) return;
    labels.push({ week, name: short.format(start) });
    last = week;
  });
  return labels;
}

// 1 (a little) to 4 (the most). The busiest day can be 100 times a normal one, so the shades follow "times as many"
// (like the world map), or a single busy day would make all the others look empty.
const levelOf = (count, max) => (count ? 1 + Math.round((max > 1 ? Math.log(count) / Math.log(max) : 1) * (LEVELS - 1)) : 0);

export function Activity({ activity, totals, plate }) {
  const [mode, setMode] = useState('added');
  const scroller = useRef(null);
  const words = MODES[mode];

  const { weeks, labels } = useMemo(() => {
    const now = new Date();
    const list = weeksUpTo(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    return { weeks: list, labels: monthLabels(list) };
  }, []);
  const firstDay = dayKey(weeks[0][0]);
  const counts = useMemo(
    () => new Map((activity[mode] ?? []).filter(({ day }) => day >= firstDay).map(({ day, count }) => [day, count])),
    [activity, mode, firstDay],
  );
  const max = Math.max(0, ...counts.values());
  const sum = [...counts.values()].reduce((total, count) => total + count, 0);
  const busiest = [...counts].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0];

  // Phones: start scrolled to the right end (this week).
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, []);

  // One big import day ("all 1,030 links came in on 28 Oct"): said plainly under the calendar.
  const imported = activity.busiestDay;
  const showImport =
    mode === 'added' && imported && imported.day >= firstDay && totals.links >= 20 && imported.count / totals.links > 0.6;

  return (
    <Card
      id="stats-activity"
      plate={plate}
      kicker="Rhythm"
      title="Your year of links"
      sub="One square per day. The darker it is, the more happened that day."
      className={`stats-activity is-${mode}`}
      action={
        <div className="segmented segmented-text" role="group" aria-label="What the calendar shows">
          {Object.entries(MODES).map(([key, { label }]) => (
            <button key={key} type="button" aria-pressed={mode === key} onClick={() => setMode(key)}>
              {label}
            </button>
          ))}
        </div>
      }
    >
      <div className="cal-wrap">
        <div className="cal-scroll" ref={scroller}>
          <div className="cal" aria-hidden="true">
            <div className="cal-months">
              {labels.map(({ week, name }) => (
                <span key={week} style={{ gridColumn: week + 1 }}>
                  {name}
                </span>
              ))}
            </div>
            <div className="cal-weekdays">
              <span style={{ gridRow: 1 }}>Mon</span>
              <span style={{ gridRow: 3 }}>Wed</span>
              <span style={{ gridRow: 5 }}>Fri</span>
            </div>
            <div className="cal-grid">
              {weeks.flatMap((days, week) =>
                days.map((date, day) => {
                  if (!date) return <span key={`${week}-${day}`} className="cal-day is-future" />;
                  const key = dayKey(date);
                  const count = counts.get(key) ?? 0;
                  return (
                    <span
                      key={key}
                      className={`cal-day l${levelOf(count, max)}`}
                      title={`${dayName(key)}: ${count ? plural(count, words.one, words.many) : 'nothing'}`}
                    />
                  );
                }),
              )}
            </div>
          </div>
        </div>
        <dl className="cal-facts">
          <div>
            <dt>In the last year</dt>
            <dd>{plural(sum, words.one, words.many)}</dd>
          </div>
          <div>
            <dt>Busiest day</dt>
            <dd>{busiest ? `${dayName(busiest[0])} · ${busiest[1].toLocaleString()}` : '–'}</dd>
          </div>
          <div>
            <dt>Days with something</dt>
            <dd>{plural(counts.size, 'day')}</dd>
          </div>
        </dl>
      </div>
      <div className="cal-foot">
        <p className="sr-only">
          {sum
            ? `${plural(sum, words.one, words.many)} in the last year, on ${plural(counts.size, 'day')}.`
            : words.empty}
        </p>
        <span className="cal-key" aria-hidden="true">
          Less
          {Array.from({ length: LEVELS + 1 }, (_, i) => (
            <i key={i} className={`cal-day l${i}`} />
          ))}
          More
        </span>
        {showImport ? (
          <p className="stats-note">
            <CalendarDays size={15} aria-hidden="true" />
            <span>
              {imported.count === totals.links ? 'All' : imported.count.toLocaleString()} of your links came in on{' '}
              {dayName(imported.day)}, the day you brought them in, so that one square is dark and the rest are empty.
              Links you add from now on fill in the other days.
            </span>
          </p>
        ) : mode === 'opened' ? (
          <p className="stats-note">
            <CalendarDays size={15} aria-hidden="true" />
            <span>
              {totals.opened
                ? 'A link counts on the last day you opened it, so each one shows up once.'
                : 'Links you open from the library show up here.'}
            </span>
          </p>
        ) : null}
      </div>
    </Card>
  );
}
