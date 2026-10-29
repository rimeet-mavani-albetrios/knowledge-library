// GitHub stars, written down once a week, so the Popularity tab can draw a line of how they grew.
import { parseRepo, readRepo } from '../../robot/github.js';

export default {
  kind: 'stars',
  everyDays: 7,
  perRun: 30,
  sources: ['github'],
  order: 10,
  async collect(link) {
    const ref = parseRepo(link.url);
    if (!ref) return null;
    const repo = await readRepo(ref, { readme: false }).catch(() => null);
    const stars = repo && !repo.missing ? repo.stats.stars : link.github?.stars;
    return Number.isFinite(stars) ? { stars } : null;
  },
  changes(link, oldValue, newValue) {
    return newValue ? [{ kind: 'stars', data: { stars: newValue.stars } }] : [];
  },
};
