// The Internet Archive's copies of the home page, one per year, for the "look back" slider.
const USER_AGENT = 'KnowledgeLibrary/1.0 (personal link library; facts)';

export default {
  kind: 'archive',
  everyDays: 30,
  perRun: 10,
  sources: ['web'],
  order: 10,
  async collect(link, facts, { host }) {
    const url = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(host)}&output=json&fl=timestamp&filter=statuscode:200&collapse=timestamp:4`;
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(40_000) });
    if (!res.ok) throw new Error(`archive answered ${res.status}`);
    const rows = await res.json().catch(() => []);
    const years = rows
      .slice(1)
      .map(([timestamp]) => ({ year: Number(timestamp.slice(0, 4)), timestamp }))
      .filter(item => item.year > 1990);
    return years.length ? { url: `https://${host}/`, years } : null;
  },
};
