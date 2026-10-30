// YouTube buzz: about how many tutorial videos there are, and the most watched of the best matches.
// facts.youtube = { query: "Notion tutorial", videos: 1200000, top: [{ title, url, views, channel }] }.
import { CirclePlay, ExternalLink } from 'lucide-react';
import './popularity.css';

export const tab = 'popularity';
export const order = 20;

const SHOWN = 3;
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 3 });

const videoId = url => {
  try {
    return new URL(url).searchParams.get('v');
  } catch {
    return null;
  }
};

// YouTube's own count is a rough guess, so it's rounded: "About 12K videos".
const videoCount = n => (n >= 1000 ? `About ${compact.format(n)} videos` : `${n} ${n === 1 ? 'video' : 'videos'}`);

export default function YouTubeBuzz({ facts }) {
  const youtube = facts?.youtube;
  if (!youtube) return null; // not looked up yet, or a YouTube video itself
  const top = (youtube.top ?? []).slice(0, SHOWN);
  const searchUrl = youtube.query ? `https://www.youtube.com/results?search_query=${encodeURIComponent(youtube.query)}` : null;

  return (
    <section className="fact-card fact-youtube">
      <h3 className="fact-card-title">
        <CirclePlay size={14} aria-hidden="true" /> On YouTube
      </h3>
      {top.length > 0 ? (
        <>
          <p className="fact-youtube-count">
            <strong>{videoCount(youtube.videos)}</strong>
            {youtube.query ? <> for “{youtube.query}”</> : null}
          </p>
          <ul className="fact-videos" aria-label="Most watched tutorials">
            {top.map(video => {
              const id = videoId(video.url);
              return (
                <li key={video.url}>
                  <a href={video.url} target="_blank" rel="noopener noreferrer" title={video.title}>
                    <span className="fact-video-thumb">
                      {id ? (
                        <img src={`https://i.ytimg.com/vi/${id}/mqdefault.jpg`} alt="" loading="lazy" referrerPolicy="no-referrer" />
                      ) : null}
                      <CirclePlay size={22} aria-hidden="true" />
                    </span>
                    <span className="fact-video-text">
                      <strong>{video.title}</strong>
                      <span>
                        {[video.channel, `${compact.format(video.views)} views`].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
          {searchUrl ? (
            <a className="fact-more" href={searchUrl} target="_blank" rel="noopener noreferrer">
              See all on YouTube <ExternalLink size={13} aria-hidden="true" />
            </a>
          ) : null}
        </>
      ) : (
        <p className="fact-empty">No YouTube tutorials found for it yet.</p>
      )}
    </section>
  );
}
