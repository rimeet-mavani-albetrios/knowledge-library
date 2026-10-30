// YouTube buzz: about how many videos there are for "<website> tutorial", and the most watched of the best matches.
// Uses the free YouTube Data API (GOOGLE_API_KEY). Google gives 10,000 units a day: a search costs 100 and the
// views cost 1, so at most 80 links a day are looked up (counted in the database, so restarts don't reset it).
import { query } from '../../db.js';
import { siteDomain, siteName } from '../site-domain.js';

const API = 'https://www.googleapis.com/youtube/v3';
const MAX_SEARCHES_PER_DAY = 80;
const COUNTER = 'youtube_searches';
const SHOWN = 5;
const ENOUGH = 3; // fewer good matches than this: search again with the website's address
const NOT_TOPICS = new Set('the and for with your you from into that this tool tools app apps website websites online free best tutorial'.split(' '));

// Google's daily units start again at midnight in California.
const quotaDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

// The day today's searches ran out: the robot then stops asking until tomorrow, instead of failing on every link.
let usedUpOn = null;

// Counts one search in the database in a single step, so links checked at the same time can't miss each other.
async function countSearch() {
  const day = quotaDay();
  const { rows } = await query(
    `INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = CASE
       WHEN meta.value LIKE '{%' AND meta.value::jsonb ->> 'day' = $3
       THEN jsonb_build_object('day', $3::text, 'count', coalesce((meta.value::jsonb ->> 'count')::int, 0) + 1)::text
       ELSE $2 END
     RETURNING value`,
    [COUNTER, JSON.stringify({ day, count: 1 }), day],
  );
  if (JSON.parse(rows[0].value).count > MAX_SEARCHES_PER_DAY) {
    usedUpOn = day;
    throw new Error('YouTube: today’s free searches are used up; the rest wait for tomorrow');
  }
}

async function youtube(path, params) {
  const search = new URLSearchParams({ ...params, key: process.env.GOOGLE_API_KEY });
  const res = await fetch(`${API}/${path}?${search}`, { signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`YouTube answered ${res.status}: ${body.error?.errors?.[0]?.reason ?? body.error?.message ?? 'no reason'}`);
  return body;
}

// "Notion" is in "Notion Tutorial for Beginners", but not in "Linear Algebra Full Course" for a site called "Linear.app".
const mentions = (text, name) => {
  const words = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const haystack = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return Boolean(words) && haystack.includes(` ${words} `);
};

const wordsOf = text => String(text ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

// What the website is about, in its own tags and tasks: "hosting", "deploy" for Render, "automation" for Zapier.
function topicsOf(link, name) {
  const own = new Set(wordsOf(name));
  const text = [link.category, ...(link.tags ?? []), ...(link.tasks ?? []), link.useFor].join(' ');
  return new Set(wordsOf(text).filter(word => (word.length > 2 || word === 'ai') && !NOT_TOPICS.has(word) && !own.has(word)));
}

// A video is about this website when it names the website's address, or names the website and one of its topics.
// "Render" alone is not enough: "how to render! #ibispaint" is a drawing video, not one about render.com.
function isAbout(video, { name, domain, topics }) {
  const { title = '', description = '', channelTitle = '' } = video.snippet ?? {};
  const text = `${title} ${description}`;
  if (domain && text.toLowerCase().includes(domain)) return true;
  return mentions(`${title} ${channelTitle}`, name) && wordsOf(text).some(word => topics.has(word));
}

// One search: YouTube's rough video count, and the details of its best matches.
async function lookUp(words) {
  await countSearch();
  const search = await youtube('search', {
    part: 'snippet',
    q: words,
    type: 'video',
    order: 'relevance',
    maxResults: String(SHOWN),
    safeSearch: 'moderate',
  });
  const ids = (search.items ?? []).map(item => item.id?.videoId).filter(Boolean);
  const found = ids.length ? await youtube('videos', { part: 'snippet,statistics', id: ids.join(',') }) : { items: [] };
  return { words, total: Number(search.pageInfo?.totalResults ?? 0), videos: found.items ?? [] };
}

export default {
  kind: 'youtube',
  everyDays: 30,
  perRun: 75, // plus the links you open, up to 80 a day in all (see countSearch)
  needs: ['GOOGLE_API_KEY'],
  sources: ['web', 'github'], // a YouTube link is a video already
  resting: () => usedUpOn === quotaDay(),

  async collect(link) {
    const name = siteName(link);
    if (!name) return null; // a YouTube video itself, or a page on someone else's website
    const site = { name, domain: siteDomain(link), topics: topicsOf(link, name) };
    let best = await lookUp(`${name} tutorial`);
    let good = best.videos.filter(video => isAbout(video, site));
    // Few good matches: the name is probably an everyday word ("Render", "Make"), so the address finds better ones.
    if (good.length < ENOUGH && site.domain && site.domain !== name.toLowerCase()) {
      const second = await lookUp(`${site.domain} tutorial`).catch(() => null); // today's searches may be used up
      const more = second?.videos.filter(video => isAbout(video, site)) ?? [];
      if (more.length > good.length) {
        const seen = new Set(more.map(video => video.id));
        good = [...more, ...good.filter(video => !seen.has(video.id))];
        best = second;
      }
    }
    const top = good
      .map(video => ({
        title: video.snippet.title,
        url: `https://www.youtube.com/watch?v=${video.id}`,
        views: Number(video.statistics?.viewCount ?? 0),
        channel: video.snippet.channelTitle ?? '',
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, SHOWN);
    // When none of the best matches is about this website, YouTube's count is about something else too.
    return { query: best.words, videos: top.length ? best.total : 0, top };
  },
};
