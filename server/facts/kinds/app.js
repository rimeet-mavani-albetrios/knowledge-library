// The website's phone apps. Only apps the website itself links to (an App Store or Google Play link on its home
// page) are used, never a guess by name. The iPhone app's rating comes from Apple's free lookup.
import { readHtml, sameName } from '../site.js';

const APPLE = /^https?:\/\/(?:apps|itunes)\.apple\.com\/.*\/id(\d{5,})/i;
const PLAY = /^https?:\/\/play\.google\.com\/store\/apps\/details\?(?:.*&)?id=([\w.]+)/i;
// The website's own "Download" or "Mobile" page, where the store links usually are.
const DOWNLOAD_PAGE = /\/(downloads?|mobile|apps|app|ios|iphone|get-the-app)\/?$/i;

async function appleApp(id) {
  const res = await fetch(`https://itunes.apple.com/lookup?id=${id}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`App Store answered ${res.status}`);
  const app = (await res.json()).results?.[0];
  if (!app) return null;
  return {
    id: String(app.trackId ?? id),
    name: app.trackName ?? '',
    rating: Number.isFinite(app.averageUserRating) ? Math.round(app.averageUserRating * 10) / 10 : null,
    ratings: app.userRatingCount ?? 0,
    url: app.trackViewUrl?.split('?')[0] ?? `https://apps.apple.com/app/id${id}`,
  };
}

export default {
  kind: 'app',
  everyDays: 30,
  perRun: 15,
  sources: ['web'],
  order: 10,
  async collect(link, facts, ctx) {
    const home = await ctx.home();
    const anchors = [...(home.ok ? home.anchors : []), ...(link.pageLinks ?? [])];
    // Store links in the page's links, or written in its code (some menus are built by scripts).
    const find = (list, html = '') => {
      const inCode = html.match(/https?:\/\/(?:apps|itunes)\.apple\.com\/[^"'\s<>]*?\/id\d{5,}|https?:\/\/play\.google\.com\/store\/apps\/details\?[^"'\s<>]*/gi) ?? [];
      const urls = [...list.map(anchor => anchor.url), ...inCode.map(url => url.replace(/&amp;/g, '&'))];
      return [urls.map(url => APPLE.exec(url)?.[1]).find(Boolean), urls.map(url => PLAY.exec(url)?.[1]).find(Boolean)];
    };
    let [appleId, playId] = find(anchors, home.html);
    if (!appleId && !playId) {
      const pages = [...new Set(anchors.map(anchor => anchor.url).filter(url => DOWNLOAD_PAGE.test(new URL(url).pathname) && sameName(new URL(url).hostname, ctx.domain)))];
      for (const page of pages.slice(0, 2)) {
        const other = await readHtml(page);
        if (other.ok) [appleId, playId] = find(other.anchors, other.html);
        if (appleId || playId) break;
      }
    }
    // A website that is gone or blocks robots stays that way; a slow one is tried again later.
    if (!home.ok && !appleId && !playId) {
      if (home.final) return null;
      throw new Error(`home page not readable (${home.status ?? home.error})`);
    }
    const ios = appleId ? await appleApp(appleId) : null;
    const android = playId ? { url: `https://play.google.com/store/apps/details?id=${playId}` } : null;
    return ios || android ? { ios, android } : null;
  },
};
