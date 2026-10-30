// Wikidata, the free encyclopedia of facts: when the company behind the website was founded, by whom, and where.
// The match is the website's own address (Wikidata's "official website", P856), never a guess by name.
const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'KnowledgeLibrary/1.0 (personal link library; https://github.com/rimeet-mavani-albetrios/knowledge-library)';

// notion.so → https://notion.so, https://www.notion.so/, http://notion.so … (Wikidata writes them in many ways).
function addresses(hosts) {
  const out = new Set();
  for (const host of hosts) {
    for (const name of [host, `www.${host}`]) {
      for (const scheme of ['https', 'http']) {
        out.add(`<${scheme}://${name}>`);
        out.add(`<${scheme}://${name}/>`);
      }
    }
  }
  return [...out].join(' ');
}

const query = hosts => `SELECT ?item ?itemLabel ?inception ?founderLabel ?hqLabel ?cc ?hqcc WHERE {
  VALUES ?site { ${addresses(hosts)} }
  ?item wdt:P856 ?site .
  OPTIONAL { ?item wdt:P571 ?inception }
  OPTIONAL { ?item wdt:P112 ?founder }
  OPTIONAL { ?item wdt:P159 ?hq . OPTIONAL { ?hq wdt:P17 ?hqc . ?hqc wdt:P297 ?hqcc } }
  OPTIONAL { ?item wdt:P17 ?c . ?c wdt:P297 ?cc }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 60`;

export default {
  kind: 'wikidata',
  everyDays: 90,
  perRun: 10,
  sources: ['web'],
  order: 10,
  async collect(link, facts, { host, domain, platform }) {
    const hosts = [...new Set([host, platform ? null : domain].filter(Boolean))];
    const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query(hosts))}`, {
      headers: { accept: 'application/sparql-results+json', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Wikidata answered ${res.status}`);
    const rows = (await res.json()).results?.bindings ?? [];
    // One entry per Wikidata item; several items can share a website (an app and its company).
    const items = new Map();
    for (const row of rows) {
      const id = row.item.value.split('/').pop();
      const item = items.get(id) ?? { id, name: row.itemLabel?.value ?? '', founded: null, founders: new Set(), city: null, country: null };
      const year = row.inception?.value ? Number(row.inception.value.slice(0, 4)) : null;
      if (year && (!item.founded || year < item.founded)) item.founded = year;
      // A label that is just the item's id (Q123) means Wikidata has no English name for it.
      if (row.founderLabel?.value && !/^Q\d+$/.test(row.founderLabel.value)) item.founders.add(row.founderLabel.value);
      if (row.hqLabel?.value && !/^Q\d+$/.test(row.hqLabel.value)) item.city ??= row.hqLabel.value;
      item.country ??= row.cc?.value ?? row.hqcc?.value ?? null;
      items.set(id, item);
    }
    const score = item => (item.founded ? 2 : 0) + (item.founders.size ? 2 : 0) + (item.city ? 1 : 0) + (item.country ? 1 : 0);
    const best = [...items.values()].sort((a, b) => score(b) - score(a))[0];
    if (!best) return null;
    return {
      id: best.id,
      name: /^Q\d+$/.test(best.name) ? '' : best.name,
      founded: best.founded,
      founders: [...best.founders].slice(0, 6),
      city: best.city,
      country: best.country,
      url: `https://www.wikidata.org/wiki/${best.id}`,
    };
  },
};
