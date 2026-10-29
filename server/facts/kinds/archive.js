// The Internet Archive's copies of the home page, one per year, for the "look back" slider.
// The archive turns away robots that ask too often ("429"), so questions go one at a time, 6 seconds apart,
// and after a 429 the robot leaves the archive alone for 15 minutes instead of failing on every link.
const USER_AGENT = 'KnowledgeLibrary/1.0 (personal link library; facts)';
const GAP_MS = 6000;
const COOL_MS = 15 * 60_000;

let nextTurn = 0;
let coolUntil = 0;

async function myTurn() {
  const now = Date.now();
  const at = Math.max(now, nextTurn);
  nextTurn = at + GAP_MS;
  if (at > now) await new Promise(resolve => setTimeout(resolve, at - now));
}

export default {
  kind: 'archive',
  everyDays: 30,
  perRun: 10,
  sources: ['web'],
  order: 10,
  resting: () => Date.now() < coolUntil,
  async collect(link, facts, { host }) {
    await myTurn();
    if (Date.now() < coolUntil) throw new Error('the archive asked us to slow down; trying again later');
    const url = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(host)}&output=json&fl=timestamp&filter=statuscode:200&collapse=timestamp:4`;
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(40_000) });
    if (res.status === 429) coolUntil = Date.now() + COOL_MS;
    if (!res.ok) throw new Error(`archive answered ${res.status}`);
    const rows = await res.json().catch(() => []);
    const years = rows
      .slice(1)
      .map(([timestamp]) => ({ year: Number(timestamp.slice(0, 4)), timestamp }))
      .filter(item => item.year > 1990);
    return years.length ? { url: `https://${host}/`, years } : null;
  },
};
