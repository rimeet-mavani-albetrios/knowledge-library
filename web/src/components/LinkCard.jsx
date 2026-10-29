// One link as a card (preview picture, category, title, summary or why it matched your search, tags),
// as a short row for the list view, or as a small tile for the compact view (icon, name, website).
import { memo, useState } from 'react';
import { ExternalLink, Star, Unlink, LoaderCircle, Clock, CircleAlert, Check } from 'lucide-react';
import { CategoryBadge, categoryStyle, hueOf } from '../categories.jsx';
import { GitHubIcon } from './Icons.jsx';
import Highlight from './Highlight.jsx';
import { usePeek } from './Peek.jsx';
import { useUpdateLink, useCountOpen } from '../hooks.js';
import { compactNumber, fullDate, fullDateTime, hostOf, siteOf, PRICING_LABELS, STATUS_LABELS, MY_STATUS_LABELS, isWorking } from '../format.js';
import './views.css';

// Pictures that turned out broken or too small (some sites use their tiny logo, which looks blurry when stretched).
// They're remembered on this device, so next time the colored band shows straight away instead of flashing.
const BAD_PICTURES = 'kl-bad-pictures';
const badPictures = new Set(readList(BAD_PICTURES));
// Pictures already loaded once on this page: they show at once when you come back to them, without fading in again.
const loadedPictures = new Set();
// Site icons that didn't load (a wrong address, a blocked image): the category's icon shows at once next time,
// instead of an empty square until the icon fails again.
const badIcons = new Set();

function readList(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? [];
  } catch {
    return [];
  }
}

function rememberBadPicture(url) {
  badPictures.add(url);
  try {
    localStorage.setItem(BAD_PICTURES, JSON.stringify([...badPictures].slice(-2000)));
  } catch {
    // Private browsing: it's only remembered until the page closes.
  }
}

// The picture stays invisible until it has loaded and passed the size check, then fades in over its colored frame.
function Picture({ url, onFail }) {
  const [shown, setShown] = useState(() => loadedPictures.has(url));
  const fail = () => {
    rememberBadPicture(url);
    onFail();
  };
  return (
    <img
      src={url}
      alt=""
      className={`preview-picture${shown ? ' is-shown' : ''}`}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={fail}
      onLoad={event => {
        if (event.currentTarget.naturalWidth < 300) return fail();
        loadedPictures.add(url);
        setShown(true);
      }}
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

// The website's own little icon, or the category's icon when it has none. `big` is the tile's 44px square.
export function SiteIcon({ link, className = 'row-icon', big = false }) {
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
  const working = isWorking(link);
  const pricing = PRICING_LABELS[link.pricing];
  const peek = usePeek(link, { owner, onOpen, selectable });

  return (
    <article className={`row${working ? ' is-working' : ''}${selected ? ' is-selected' : ''}`} style={hueOf(link.category)} {...peek}>
      <CardButton link={link} onOpen={onOpen} selectable={selectable} selected={selected} onToggle={onToggle} />
      <SiteIcon link={link} />
      <div className="row-main">
        <div className="row-top">
          <h3 className="row-title">{link.title}</h3>
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

// One link as a small tile, for the compact view: many fit on one line, like files in a folder.
// The name and website are all it shows; rest the mouse on it (or open it) for the rest.
export const LinkTile = memo(function LinkTile({ link, owner, onOpen, selectable = false, selected = false, onToggle }) {
  const working = isWorking(link);
  const peek = usePeek(link, { owner, onOpen, selectable });

  return (
    <article className={`tile${working ? ' is-working' : ''}${selected ? ' is-selected' : ''}`} style={hueOf(link.category)} {...peek}>
      <CardButton link={link} onOpen={onOpen} selectable={selectable} selected={selected} onToggle={onToggle} />
      <SiteIcon link={link} className="tile-icon" big />
      {!selectable && <OpenButton link={link} owner={owner} iconOnly />}
      <h3 className="tile-title">{link.title}</h3>
      <p className="tile-host">
        <span>{working ? STATUS_LABELS[link.status] : siteOf(link)}</span>
        {link.favorite && (
          <span className="tile-star" title="A favorite">
            <Star size={12} aria-hidden="true" />
            <span className="sr-only">A favorite</span>
          </span>
        )}
      </p>
    </article>
  );
});

function LinkCard({ link, owner, onOpen, selectable = false, selected = false, onToggle }) {
  const working = isWorking(link);
  const tags = link.tags.slice(0, 3);
  const pricing = PRICING_LABELS[link.pricing];
  const peek = usePeek(link, { owner, onOpen, selectable });

  return (
    <article className={`card${working ? ' is-working' : ''}${selected ? ' is-selected' : ''}`} style={hueOf(link.category)} {...peek}>
      <CardButton link={link} onOpen={onOpen} selectable={selectable} selected={selected} onToggle={onToggle} />
      <Preview link={link} />
      {pricing && !working && <span className="price-pill">{pricing}</span>}
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
