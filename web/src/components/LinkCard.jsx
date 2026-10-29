// One link as a card (preview picture, category, title, summary or why it matched your search, tags),
// as a short row for the list view, or as a tile for the compact view (icon, name, website and a few small tags).
import { memo, useLayoutEffect, useRef, useState } from 'react';
import { ExternalLink, Star, Unlink, LoaderCircle, Clock, CircleAlert, Check, Columns3 } from 'lucide-react';
import { CategoryBadge, categoryStyle, hueOf } from '../categories.jsx';
import { GitHubIcon } from './Icons.jsx';
import Highlight from './Highlight.jsx';
import { usePeek } from './Peek.jsx';
import { useInTray } from '../compare.js';
import { useUpdateLink, useCountOpen } from '../hooks.js';
import { compactNumber, fullDate, fullDateTime, hostOf, siteOf, PRICING_LABELS, STATUS_LABELS, MY_STATUS_LABELS, isWorking } from '../format.js';
import './views.css';

const REMEMBER_MAX = 2000; // more than the whole library, so no known-bad address is pushed out and tried again
const REMEMBER_DAYS = 14; // then it gets another chance (the site may have fixed it)
const DAY = 24 * 60 * 60 * 1000;
const QUICK_LOAD = 100; // a picture that arrives this fast (from the browser's own cache) shows without the fade

// Pictures that turned out broken or too small (some sites use their tiny logo, which looks blurry when stretched),
// and site icons that didn't load (a wrong address, a blocked image). They're remembered on this device, so next
// time the colored band (or the category's icon) shows straight away, instead of trying again and swapping.
const badPictures = rememberedList('kl-bad-pictures');
const badIcons = rememberedList('kl-bad-icons');
// Pictures already loaded once on this page: they show at once when you come back to them, without fading in again.
const loadedPictures = new Set();

// A list of addresses kept in this browser's storage, each with the day it was added, newest last.
function rememberedList(key) {
  const now = Date.now();
  const saved = new Map();
  try {
    const list = JSON.parse(localStorage.getItem(key));
    for (const entry of Array.isArray(list) ? list : []) {
      // Older saves kept only the address: those count from today.
      const [url, at] = typeof entry === 'string' ? [entry, now] : Array.isArray(entry) ? entry : [];
      if (typeof url === 'string' && typeof at === 'number' && now - at < REMEMBER_DAYS * DAY) saved.set(url, at);
    }
  } catch {
    // Private browsing, or a broken save: start with an empty list.
  }
  let timer = 0;
  return {
    has: url => saved.has(url),
    add(url) {
      // Offline, every picture fails: none of them is really broken, so nothing is remembered.
      if (!url || saved.has(url) || navigator.onLine === false) return;
      saved.set(url, Date.now());
      // Saved a moment after the last one, so twenty pictures failing at once while you scroll mean one save.
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(key, JSON.stringify([...saved].slice(-REMEMBER_MAX)));
        } catch {
          // Private browsing: it's only remembered until the page closes.
        }
      }, 500);
    },
  };
}

// The picture stays invisible until it has loaded and passed the size check, then fades in over its colored frame.
// A picture the browser already has shows at once, with no fade, so a card that's drawn again (a new page of
// links, back from another search, the peek or the details window) never flashes its picture.
function Picture({ url, onFail }) {
  // null while it loads, 'fade' once it arrived, 'now' when it shows without the fade.
  const [shown, setShown] = useState(() => (loadedPictures.has(url) ? 'now' : null));
  const ref = useRef(null);
  const mountedAt = useRef(0);
  const settled = useRef(false); // the size check or the failure happens once, even if the browser reports twice

  const fail = () => {
    if (settled.current) return;
    settled.current = true;
    badPictures.add(url);
    onFail();
  };
  const loaded = (img, quick) => {
    if (settled.current) return;
    if (img.naturalWidth < 300) return fail();
    settled.current = true;
    loadedPictures.add(url);
    setShown(current => current ?? (quick ? 'now' : 'fade'));
  };

  // Already there when the card is drawn (in the browser's memory)? It shows, or the band takes its place,
  // before the first paint. (A lazy picture that hasn't started loading has no width yet, so it waits.)
  // It runs once, when the picture is first drawn: the picture's address never changes (a new one is a new Picture).
  useLayoutEffect(() => {
    mountedAt.current = performance.now();
    const img = ref.current;
    if (img.complete && img.naturalWidth > 0) loaded(img, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <img
      ref={ref}
      src={url}
      alt=""
      className={`preview-picture${shown ? ' is-shown' : ''}${shown === 'now' ? ' is-instant' : ''}`}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={fail}
      onLoad={event => loaded(event.currentTarget, performance.now() - mountedAt.current < QUICK_LOAD)}
    />
  );
}

// The colored band shown when a link has no preview picture (or it fails to load).
export function Preview({ link, big = false }) {
  // The failed picture is remembered by its address: a new picture (after "Read again") gets its own chance.
  const [failedUrl, setFailedUrl] = useState(null);
  const [failedIcon, setFailedIcon] = useState(null);
  const { Icon } = categoryStyle(link.category);
  const working = isWorking(link);
  const imageFailed = failedUrl === link.imageUrl || badPictures.has(link.imageUrl);
  const iconFailed = failedIcon === link.iconUrl || badIcons.has(link.iconUrl);
  const iconBroke = () => {
    badIcons.add(link.iconUrl);
    setFailedIcon(link.iconUrl);
  };

  if (link.imageUrl && !imageFailed && !working) {
    return (
      <div className={`preview${big ? ' preview-big' : ''}`} style={hueOf(link.category)}>
        <Picture key={link.imageUrl} url={link.imageUrl} onFail={() => setFailedUrl(link.imageUrl)} />
      </div>
    );
  }
  return (
    <div className={`preview preview-band${big ? ' preview-big' : ''}`} style={hueOf(link.category)}>
      {working ? (
        <span className="preview-status">
          {link.status === 'queued' ? <Clock size={18} aria-hidden="true" /> : <LoaderCircle size={18} className="spin" aria-hidden="true" />}
          {STATUS_LABELS[link.status]}
        </span>
      ) : link.source === 'github' ? (
        <span className="preview-tile"><GitHubIcon size={30} /></span>
      ) : link.iconUrl && !iconFailed ? (
        <span className="preview-tile">
          <img src={link.iconUrl} alt="" width="32" height="32" loading="lazy" referrerPolicy="no-referrer" onError={iconBroke} />
        </span>
      ) : (
        <Icon size={34} aria-hidden="true" />
      )}
    </div>
  );
}

// The star: only the owner can change it; visitors see it on favorites.
export function FavoriteButton({ link, owner, className = '' }) {
  const update = useUpdateLink();
  if (!owner) {
    return link.favorite ? (
      <span className={`star-btn is-on ${className}`} title="A favorite">
        <Star size={17} aria-hidden="true" />
        <span className="sr-only">A favorite</span>
      </span>
    ) : null;
  }
  return (
    <button
      type="button"
      className={`star-btn${link.favorite ? ' is-on' : ''} ${className}`}
      aria-pressed={link.favorite}
      aria-label={link.favorite ? `Remove ${link.title} from favorites` : `Add ${link.title} to favorites`}
      title={link.favorite ? 'Remove from favorites' : 'Add to favorites'}
      onClick={() => update.mutate({ link, changes: { favorite: !link.favorite } })}
    >
      <Star size={17} aria-hidden="true" />
    </button>
  );
}

// Goes straight to the website. Clicking anywhere else on a card or row opens its details instead.
// `iconOnly` is the small arrow in a tile's corner; `label` and `className` dress it up elsewhere (the peek).
export function OpenButton({ link, owner, iconOnly = false, label = 'Open', className = 'btn btn-open', onClick }) {
  const host = hostOf(link.url);
  const countOpen = useCountOpen();
  return (
    <a
      className={`${className}${iconOnly ? ' btn-open-icon' : ''}`}
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${host} in a new tab`}
      title={`Open ${host}`}
      onClick={() => {
        if (owner) countOpen(link.id);
        onClick?.();
      }}
    >
      {!iconOnly && <span>{label}</span>}
      <ExternalLink size={iconOnly ? 15 : 14} aria-hidden="true" />
    </a>
  );
}

// The website's own little icon, or the category's icon when it has none. `big` is the tile's 46px square.
// `children` sit on top of it (the small "in compare" badge on rows and tiles).
export function SiteIcon({ link, className = 'row-icon', big = false, children }) {
  const [failedIcon, setFailedIcon] = useState(null);
  const { Icon } = categoryStyle(link.category);
  const img = big ? 26 : 22;
  const failed = failedIcon === link.iconUrl || badIcons.has(link.iconUrl);
  const broke = () => {
    badIcons.add(link.iconUrl);
    setFailedIcon(link.iconUrl);
  };
  return (
    <span className={className} aria-hidden="true">
      {isWorking(link) ? (
        <LoaderCircle size={big ? 20 : 18} className="spin" />
      ) : link.source === 'github' ? (
        <GitHubIcon size={big ? 24 : 20} />
      ) : link.iconUrl && !failed ? (
        <img src={link.iconUrl} alt="" width={img} height={img} loading="lazy" referrerPolicy="no-referrer" onError={broke} />
      ) : (
        <Icon size={big ? 22 : 19} />
      )}
      {children}
    </span>
  );
}

// The invisible button over a whole card or row: opens the details, or, while you're selecting links, ticks it.
function CardButton({ link, onOpen, selectable, selected, onToggle }) {
  if (selectable) {
    return (
      <>
        <button type="button" className="card-open" onClick={() => onToggle(link.id)} aria-pressed={selected} aria-label={`Select ${link.title}`} />
        <span className="select-box" aria-hidden="true">
          {selected && <Check size={15} strokeWidth={3} />}
        </span>
      </>
    );
  }
  return <button type="button" className="card-open" onClick={() => onOpen(link.id)} aria-label={`Open details for ${link.title}`} />;
}

// Is the link in the compare picks? Then it gets a small "In compare" mark. The card asks the picks one yes-or-no
// question, so adding or removing a pick re-draws only this card. While you select links to change many at once
// the mark is hidden, so the card doesn't follow the picks then.
// `popIn` is on only when the link was added while its card shows. A card that arrives already in compare (a new
// page of links while you scroll, another search) shows its mark still, instead of every mark popping in again.
function useInCompare(link, selectable) {
  const inCompare = useInTray(link.id, !selectable);
  const [inAtStart, setInAtStart] = useState(inCompare);
  if (inAtStart && !inCompare) setInAtStart(false);
  return { inCompare, popIn: inCompare && !inAtStart };
}

// The small badge on the icon of a row or tile in the compare picks. (Cards get a labelled chip instead.)
const CompareDot = ({ popIn }) => (
  <span className={`in-compare-dot${popIn ? ' is-new' : ''}`}>
    <Columns3 size={11} strokeWidth={2.4} />
  </span>
);

// "Added 12 Oct 2026", with the exact time as a tooltip.
function Added({ date, className = '' }) {
  if (!date) return null;
  return (
    <span className={className}>
      Added <time dateTime={date} title={fullDateTime(date)}>{fullDate(date)}</time>
    </span>
  );
}

// One link as a short row, for the list view: about 8 fit on a laptop screen.
export const LinkRow = memo(function LinkRow({ link, owner, onOpen, selectable = false, selected = false, onToggle }) {
  const { inCompare, popIn } = useInCompare(link, selectable);
  const working = isWorking(link);
  const pricing = PRICING_LABELS[link.pricing];
  const peek = usePeek(link, { owner, onOpen, selectable });

  return (
    <article className={`row${working ? ' is-working' : ''}${selected ? ' is-selected' : ''}`}
      data-id={link.id} style={hueOf(link.category)} {...peek}>
      <CardButton link={link} onOpen={onOpen} selectable={selectable} selected={selected} onToggle={onToggle} />
      <SiteIcon link={link}>{inCompare && <CompareDot popIn={popIn} />}</SiteIcon>
      <div className="row-main">
        <div className="row-top">
          <h3 className="row-title">{link.title}</h3>
          {inCompare && <span className="sr-only">In compare</span>}
          <span className="row-host">{siteOf(link)}</span>
        </div>
        {working ? (
          <p className="row-text muted">{STATUS_LABELS[link.status]}</p>
        ) : link.snippet ? (
          <p className="row-text" title="Where your search words appear">
            <Highlight text={link.snippet} />
          </p>
        ) : (
          (link.summary || link.description) && <p className="row-text">{link.summary || link.description}</p>
        )}
        <div className="row-meta">
          <CategoryBadge name={link.category} />
          {pricing && !working && <span className="pill">{pricing}</span>}
          {MY_STATUS_LABELS[link.myStatus] && <span className="pill pill-status">{MY_STATUS_LABELS[link.myStatus]}</span>}
          {link.health === 'broken' && (
            <span className="warn">
              <Unlink size={13} aria-hidden="true" /> May be broken
            </span>
          )}
          {link.github && (
            <span className="row-stars">
              <Star size={13} aria-hidden="true" /> {compactNumber(link.github.stars)}
            </span>
          )}
          {link.tags.length > 0 && (
            <span className="row-tags">
              {link.tags.slice(0, 3).map(tag => (
                <span key={tag} className="row-tag">
                  #{tag}
                </span>
              ))}
            </span>
          )}
          <Added date={link.createdAt} className="row-date hide-small" />
        </div>
      </div>
      <div className="row-actions">
        <FavoriteButton link={link} owner={owner} />
        <OpenButton link={link} owner={owner} />
      </div>
    </article>
  );
});

// The small tags along the bottom of a tile: the category (its short name, in its color) and the price on the left,
// a GitHub project's stars and a favorite's star at the right end. They stay on one line: a price with no room left
// is left out instead of being cut in half (the peek and the details still have it). While the page is still being
// read the category and price aren't known yet, so a grey shape stands in for them.
function TileTags({ link, working }) {
  const pricing = working ? null : PRICING_LABELS[link.pricing];
  const stars = working || !link.github ? null : compactNumber(link.github.stars);
  return (
    <div className="tile-tags">
      <span className="tile-tags-main">
        {working ? (
          <span className="tile-tag-skeleton skeleton" />
        ) : (
          <span className="tile-tag tile-cat">{categoryStyle(link.category).short}</span>
        )}
        {pricing ? <span className="tile-tag">{pricing}</span> : null}
      </span>
      {stars || link.favorite ? (
        <span className="tile-tags-end">
          {stars ? (
            <span className="tile-stars">
              <Star size={12} aria-hidden="true" />
              {stars}
              <span className="sr-only"> stars on GitHub</span>
            </span>
          ) : null}
          {link.favorite ? (
            <span className="tile-fav">
              <Star size={13} aria-hidden="true" />
              <span className="sr-only">A favorite</span>
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

// One link as a tile, for the compact view: about eight fit on a line of a big screen, like files in a folder.
// The name, the website and a few small tags are all it shows; rest the mouse on it (or open it) for the rest.
export const LinkTile = memo(function LinkTile({ link, owner, onOpen, selectable = false, selected = false, onToggle }) {
  const { inCompare, popIn } = useInCompare(link, selectable);
  const working = isWorking(link);
  const peek = usePeek(link, { owner, onOpen, selectable });

  return (
    <article className={`tile${working ? ' is-working' : ''}${selected ? ' is-selected' : ''}`}
      data-id={link.id} style={hueOf(link.category)} {...peek}>
      <CardButton link={link} onOpen={onOpen} selectable={selectable} selected={selected} onToggle={onToggle} />
      <SiteIcon link={link} className="tile-icon" big>
        {inCompare && <CompareDot popIn={popIn} />}
      </SiteIcon>
      {!selectable && <OpenButton link={link} owner={owner} iconOnly />}
      <div className="tile-text">
        <h3 className="tile-title">{link.title}</h3>
        {inCompare && <span className="sr-only">In compare</span>}
        <p className="tile-host">{working ? STATUS_LABELS[link.status] : siteOf(link)}</p>
      </div>
      <TileTags link={link} working={working} />
    </article>
  );
});

function LinkCard({ link, owner, onOpen, selectable = false, selected = false, onToggle }) {
  const { inCompare, popIn } = useInCompare(link, selectable);
  const working = isWorking(link);
  const tags = link.tags.slice(0, 3);
  const pricing = PRICING_LABELS[link.pricing];
  const peek = usePeek(link, { owner, onOpen, selectable });

  return (
    <article className={`card${working ? ' is-working' : ''}${selected ? ' is-selected' : ''}`}
      data-id={link.id} style={hueOf(link.category)} {...peek}>
      <CardButton link={link} onOpen={onOpen} selectable={selectable} selected={selected} onToggle={onToggle} />
      <Preview link={link} />
      {pricing && !working && <span className="price-pill">{pricing}</span>}
      {inCompare && (
        <span className={`in-compare-chip${popIn ? ' is-new' : ''}`}>
          <Columns3 size={13} strokeWidth={2.4} aria-hidden="true" />
          In compare
        </span>
      )}
      <div className="card-body">
        <div className="card-meta">
          <CategoryBadge name={link.category} />
          {MY_STATUS_LABELS[link.myStatus] && <span className="pill pill-status">{MY_STATUS_LABELS[link.myStatus]}</span>}
          <span className="card-host">{siteOf(link)}</span>
          <FavoriteButton link={link} owner={owner} />
        </div>
        <h3 className="card-title">{link.title}</h3>
        {working ? (
          <div className="skeleton-lines" aria-hidden="true">
            <span />
            <span />
          </div>
        ) : link.snippet ? (
          <p className="card-summary card-snippet" title="Where your search words appear">
            <Highlight text={link.snippet} />
          </p>
        ) : (
          (link.summary || link.description) && <p className="card-summary">{link.summary || link.description}</p>
        )}
        {tags.length > 0 && (
          <ul className="card-tags" aria-label="Tags">
            {tags.map(tag => (
              <li key={tag}>#{tag}</li>
            ))}
            {link.tags.length > 3 && <li className="more">+{link.tags.length - 3}</li>}
          </ul>
        )}
        <footer className="card-foot">
          {link.health === 'broken' ? (
            <span className="warn"><Unlink size={14} aria-hidden="true" /> Link may be broken</span>
          ) : link.status === 'failed' ? (
            <span className="warn"><CircleAlert size={14} aria-hidden="true" /> Couldn’t read this page</span>
          ) : link.github ? (
            <span><Star size={14} aria-hidden="true" /> {compactNumber(link.github.stars)}{link.github.language ? ` · ${link.github.language}` : ''}</span>
          ) : (
            <Added date={link.createdAt} />
          )}
          <OpenButton link={link} owner={owner} />
        </footer>
      </div>
    </article>
  );
}

export default memo(LinkCard);
