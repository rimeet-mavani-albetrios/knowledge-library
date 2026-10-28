// Small helpers for showing numbers, dates and addresses.

export const compactNumber = n =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 3 }).format(n ?? 0);

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

export function timeAgo(date) {
  const seconds = (new Date(date) - Date.now()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

export const fullDate = date =>
  new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(date));

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export const PRICING_LABELS = {
  free: 'Free',
  'open-source': 'Open source',
  freemium: 'Free plan',
  paid: 'Paid',
};

export const STATUS_LABELS = {
  queued: 'Waiting',
  reading: 'Reading page…',
  summarizing: 'Writing summary…',
  ready: 'Done',
  failed: "Couldn't read",
};

export const isWorking = link => link.status === 'queued' || link.status === 'reading' || link.status === 'summarizing';

export const LEVEL_LABELS = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

// Your own to-do list for websites.
export const MY_STATUS_LABELS = {
  'to-try': 'To try',
  using: 'Using',
  done: 'Done',
};
