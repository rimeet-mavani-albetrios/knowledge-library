// Ad and tracking scripts on the home page, found by their addresses in the page's code (our own list below).
// Scripts that load later through a tag manager can't be seen, so the real number can be higher.

// [name, address parts]. An address matches when its host ends with one of the parts, or the page's code mentions it.
const TRACKERS = [
  ['Google Analytics', ['google-analytics.com', 'analytics.google.com']],
  ['Google Tag Manager', ['googletagmanager.com']],
  ['Google Ads', ['googleadservices.com', 'googleads.g.doubleclick.net', 'adservice.google.com']],
  ['DoubleClick', ['doubleclick.net']],
  ['Google AdSense', ['googlesyndication.com', 'pagead2.googlesyndication.com']],
  ['Google Optimize', ['googleoptimize.com']],
  ['Meta Pixel', ['connect.facebook.net', 'facebook.com/tr']],
  ['LinkedIn Insight', ['snap.licdn.com', 'px.ads.linkedin.com']],
  ['X (Twitter) Ads', ['static.ads-twitter.com', 'analytics.twitter.com', 'ads-api.twitter.com']],
  ['TikTok Pixel', ['analytics.tiktok.com']],
  ['Pinterest Tag', ['ct.pinterest.com', 's.pinimg.com/ct']],
  ['Snap Pixel', ['sc-static.net', 'tr.snapchat.com']],
  ['Reddit Pixel', ['redditstatic.com/ads', 'alb.reddit.com', 'pixel-config.reddit.com']],
  ['Quora Pixel', ['a.quora.com/qevents']],
  ['Microsoft Ads', ['bat.bing.com']],
  ['Microsoft Clarity', ['clarity.ms']],
  ['Hotjar', ['hotjar.com', 'hotjar.io']],
  ['FullStory', ['fullstory.com']],
  ['Mouseflow', ['mouseflow.com']],
  ['Smartlook', ['smartlook.com']],
  ['Lucky Orange', ['luckyorange.com', 'luckyorange.net']],
  ['Crazy Egg', ['crazyegg.com']],
  ['Inspectlet', ['inspectlet.com']],
  ['Contentsquare', ['contentsquare.net']],
  ['LogRocket', ['logrocket.io', 'lr-ingest.io', 'lr-in-prod.com']],
  ['Heap', ['heapanalytics.com', 'heap-api.com']],
  ['Mixpanel', ['mixpanel.com', 'mxpnl.com']],
  ['Amplitude', ['amplitude.com']],
  ['Segment', ['segment.com', 'segment.io']],
  ['RudderStack', ['rudderlabs.com', 'rudderstack.com']],
  ['PostHog', ['posthog.com']],
  ['Pendo', ['pendo.io']],
  ['Kissmetrics', ['kissmetrics.io', 'kissmetrics.com']],
  ['Woopra', ['woopra.com']],
  ['Clicky', ['getclicky.com', 'static.getclicky.com']],
  ['StatCounter', ['statcounter.com']],
  ['Matomo Cloud', ['matomo.cloud']],
  ['Plausible', ['plausible.io']],
  ['Fathom', ['usefathom.com']],
  ['Simple Analytics', ['simpleanalyticscdn.com']],
  ['Cloudflare Web Analytics', ['cloudflareinsights.com']],
  ['Vercel Analytics', ['vercel-insights.com', 'va.vercel-scripts.com']],
  ['HubSpot', ['hs-scripts.com', 'hs-analytics.net', 'hsadspixel.net', 'hs-banner.com']],
  ['Marketo', ['marketo.net', 'mktoresp.com']],
  ['Pardot', ['pardot.com']],
  ['Customer.io', ['customer.io', 'customerioforms.com']],
  ['Klaviyo', ['klaviyo.com']],
  ['Intercom', ['intercom.io', 'intercomcdn.com']],
  ['Drift', ['driftt.com', 'drift.com']],
  ['Clearbit', ['clearbitscripts.com', 'clearbit.com']],
  ['ZoomInfo', ['zi-scripts.com', 'ws.zoominfo.com']],
  ['6sense', ['6sc.co']],
  ['Leadfeeder', ['lfeeder.com', 'leadfeeder.com']],
  ['Leadinfo', ['leadinfo.net']],
  ['Koala', ['getkoala.com']],
  ['RB2B', ['b2bjsstore', 'rb2b.com']],
  ['Demandbase', ['demandbase.com']],
  ['Bombora', ['ml314.com']],
  ['Optimizely', ['optimizely.com']],
  ['VWO', ['visualwebsiteoptimizer.com', 'wingify.com']],
  ['AB Tasty', ['abtasty.com']],
  ['Adobe Analytics', ['omtrdc.net', '2o7.net', 'adobedtm.com', 'demdex.net']],
  ['Tealium', ['tiqcdn.com', 'tealiumiq.com']],
  ['Quantcast', ['quantserve.com', 'quantcount.com']],
  ['Comscore', ['scorecardresearch.com']],
  ['Chartbeat', ['chartbeat.com', 'chartbeat.net']],
  ['Parse.ly', ['parsely.com', 'parse.ly']],
  ['Criteo', ['criteo.com', 'criteo.net']],
  ['Taboola', ['taboola.com']],
  ['Outbrain', ['outbrain.com']],
  ['AdRoll', ['adroll.com']],
  ['Amazon Ads', ['amazon-adsystem.com']],
  ['Xandr (AppNexus)', ['adnxs.com']],
  ['Rubicon Project', ['rubiconproject.com']],
  ['PubMatic', ['pubmatic.com']],
  ['Moat', ['moatads.com']],
  ['Yandex Metrica', ['mc.yandex.ru', 'mc.yandex.com']],
  ['Baidu Analytics', ['hm.baidu.com']],
  ['Branch', ['branch.io']],
  ['AppsFlyer', ['appsflyer.com', 'onelink.me']],
  ['Impact', ['impactcdn.com', 'impact.com/js']],
  ['PartnerStack', ['partnerstack.com']],
  ['Rewardful', ['rewardful.com']],
  ['FirstPromoter', ['firstpromoter.com']],
  ['Ahrefs Analytics', ['analytics.ahrefs.com']],
  ['Hubspot Chat', ['usemessages.com']],
];

// Visitor counters that use no cookies and follow no one around: listed, but not counted as trackers.
const GENTLE = new Set(['Plausible', 'Fathom', 'Simple Analytics', 'Cloudflare Web Analytics', 'Vercel Analytics', 'Ahrefs Analytics']);

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// An address part, preceded by a dot, slash or quote (so "notclarity.ms.example" doesn't count as clarity.ms).
const PATTERNS = TRACKERS.map(([name, parts]) => [name, new RegExp(`(?:^|[\\s/."'\`(=])(?:${parts.map(escape).join('|')})`, 'i')]);

export function findTrackers(code) {
  return PATTERNS.filter(([, pattern]) => pattern.test(code)).map(([name]) => name);
}

export default {
  kind: 'trackers',
  everyDays: 30,
  perRun: 15,
  sources: ['web'],
  order: 10,
  async collect(link, facts, ctx) {
    const home = await ctx.home();
    if (!home.ok) {
      if (home.final) return null; // gone, or it doesn't let robots read it
      throw new Error(`home page not readable (${home.status ?? home.error})`);
    }
    const { $ } = home;
    // Where trackers hide: script, frame, image and preload addresses, inline scripts, and <noscript> pixels.
    const code = [
      ...$('script[src], iframe[src], img[src], link[href]').map((_, element) => $(element).attr('src') || $(element).attr('href')).get(),
      // Inline scripts, but not page data (JSON, Next.js content), which can mention any website.
      ...$('script:not([src])')
        .filter((_, element) => !/json/i.test($(element).attr('type') ?? '') && $(element).attr('id') !== '__NEXT_DATA__')
        .map((_, element) => $(element).html())
        .get()
        .filter(text => text.length < 20_000 && !text.startsWith('self.__next_f')),
      ...$('noscript').map((_, element) => $(element).html()).get(),
    ].join('\n');
    const found = findTrackers(code);
    const names = found.filter(name => !GENTLE.has(name));
    return { count: names.length, names, gentle: found.filter(name => GENTLE.has(name)) };
  },
};
