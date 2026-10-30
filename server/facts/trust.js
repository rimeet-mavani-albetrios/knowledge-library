// The trust grade, A to F, made only from facts already collected: is it flagged as unsafe, does it use a secure
// connection, how old is it, do we know who runs it, does it have a privacy policy, how many trackers it loads.
// A pure function: same facts in, same grade out. Returns null while too little is known.
const YEAR = 365.25 * 24 * 3600_000;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function ageText(ms) {
  const years = Math.floor(ms / YEAR);
  if (years >= 1) return plural(years, 'year');
  return plural(Math.max(1, Math.floor(ms / (YEAR / 12))), 'month');
}

export function gradeTrust(facts = {}, now = Date.now()) {
  const reasons = [];
  let score = 0;
  let best = 0; // the highest score possible with what is known
  let known = 0;
  const add = (points, max, ok, text) => {
    score += points;
    best += max;
    // `partial`: not bad, but it didn't earn all its points. It doesn't count as a passed check.
    reasons.push(ok && points < max ? { ok, text, partial: true } : { ok, text });
  };

  const { safety, tls, age, company, wikidata, trackers } = facts;
  if (safety && !safety.ok) {
    const threats = (safety.threats ?? []).join(', ').toLowerCase().replace(/_/g, ' ');
    return { grade: 'F', reasons: [{ ok: false, text: `Google Safe Browsing warns about this website${threats ? ` (${threats})` : ''}` }] };
  }
  if (safety?.ok) reasons.push({ ok: true, text: 'Not on Google’s list of unsafe websites' });

  if (tls) {
    known++;
    if (tls.ok) add(2, 2, true, 'Uses a secure connection (HTTPS)');
    else add(-3, 2, false, tls.validTo && new Date(tls.validTo) < now ? 'Its security certificate has run out' : 'No working secure connection (HTTPS)');
  }

  const created = age?.created ? new Date(age.created) : null;
  if (created && !Number.isNaN(created.getTime())) {
    known++;
    const ms = now - created;
    const text = `Online for ${ageText(ms)}`;
    if (ms >= 5 * YEAR) add(2, 2, true, text);
    else if (ms >= 2 * YEAR) add(1, 2, true, text);
    else if (ms >= YEAR) add(0, 2, true, text);
    else add(-2, 2, false, `A very new website (${ageText(ms)} old)`);
  }

  const owner = company?.name || wikidata?.name;
  if (company !== undefined || wikidata !== undefined) {
    known++;
    if (owner) add(1, 1, true, `We know who runs it: ${owner}`);
    else add(0, 1, false, 'Couldn’t find who runs it');
    if (company !== undefined) {
      if (company?.policy?.privacy) add(1, 1, true, 'Has a privacy policy');
      else add(-1, 1, false, 'No privacy policy found');
    }
  }
  if (wikidata?.id) add(1, 1, true, 'Listed on Wikidata, the free encyclopedia of facts');

  if (trackers) {
    known++;
    const { count } = trackers;
    if (count === 0) add(1, 1, true, 'No ad or tracking scripts found');
    else if (count <= 3) add(1, 1, true, `Only ${plural(count, 'tracker')} found`);
    else if (count <= 7) add(0, 1, false, `${plural(count, 'tracker')} found`);
    else if (count <= 11) add(-1, 1, false, `Many trackers (${count})`);
    else add(-2, 1, false, `Lots of trackers (${count})`);
  }

  if (known < 2 || best <= 0) return null;
  const share = score / best;
  let grade = share >= 0.85 ? 'A' : share >= 0.65 ? 'B' : share >= 0.45 ? 'C' : share >= 0.25 ? 'D' : 'F';
  if (tls && !tls.ok && grade < 'D') grade = 'D'; // no secure connection: never better than D
  // Good news first, then the things to watch.
  return { grade, reasons: [...reasons.filter(reason => reason.ok), ...reasons.filter(reason => !reason.ok)] };
}
