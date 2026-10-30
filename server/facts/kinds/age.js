// When the website's address was first registered (RDAP, the newer WHOIS). Some country endings (.io, .so…) don't
// share it; then the first copy in the Internet Archive says since when it has been online at least.
const USER_AGENT = 'KnowledgeLibrary/1.0 (personal link library; facts)';

const fromTimestamp = timestamp =>
  new Date(`${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T00:00:00Z`).toISOString();

export default {
  kind: 'age',
  everyDays: 180,
  perRun: 20,
  sources: ['web'],
  order: 20, // after `archive`
  async collect(link, facts, { domain, platform }) {
    if (!platform) {
      const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
        headers: { accept: 'application/rdap+json, application/json', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const event = (data.events ?? []).find(item => /registration/i.test(item.eventAction ?? ''));
        const created = event?.eventDate && new Date(event.eventDate);
        if (created && !Number.isNaN(created.getTime())) return { created: created.toISOString(), source: 'rdap' };
      } else if (res.status >= 500 || res.status === 429) {
        throw new Error(`rdap answered ${res.status}`);
      }
    }
    const first = facts.archive?.years?.[0];
    return first ? { created: fromTimestamp(first.timestamp), source: 'archive' } : null;
  },
};
