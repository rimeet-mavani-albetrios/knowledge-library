// The floating card beside the map: about the picked link, or about the picked island.
// On phones it is a sheet at the bottom, with a handle to drag it taller, or down and away.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Columns3, ExternalLink, Library, X } from 'lucide-react';
import { categoryStyle, CategoryBadge, hueOf } from '../../categories.jsx';
import { MAX_COMPARE, togglePick, useComparePicks } from '../../compare.js';
import { siteOf } from '../../format.js';
import { useCountOpen } from '../../hooks.js';
import { detailQuery } from '../LinkDrawer.jsx';
import { SiteIcon } from '../LinkCard.jsx';
import { useToast } from '../Toasts.jsx';
import { iconLink } from './world.js';

// The handle on a phone's sheet: drag it up for more room, or down to close. It only moves the sheet while your
// finger is on it; a short drag springs back.
function useSheetDrag(cardRef, onClose) {
  const [tall, setTall] = useState(false);
  const start = useRef(null);
  const handlers = {
    onPointerDown: event => {
      start.current = { y: event.clientY, id: event.pointerId };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: event => {
      if (!start.current || !cardRef.current) return;
      const moved = event.clientY - start.current.y;
      // Downward it follows your finger; upward it gives a little, because the sheet grows from its height instead.
      cardRef.current.style.transform = `translateY(${moved > 0 ? moved : moved / 4}px)`;
      cardRef.current.style.transition = 'none';
    },
    onPointerUp: event => {
      if (!start.current || !cardRef.current) return;
      const moved = event.clientY - start.current.y;
      start.current = null;
      cardRef.current.style.transform = '';
      cardRef.current.style.transition = '';
      if (moved > 70) {
        if (tall) setTall(false);
        else onClose();
      } else if (moved < -40) setTall(true);
      else if (Math.abs(moved) < 6) setTall(value => !value);
    },
    onPointerCancel: () => {
      start.current = null;
      if (!cardRef.current) return;
      cardRef.current.style.transform = '';
      cardRef.current.style.transition = '';
    },
  };
  return { tall, handlers };
}

function SheetHandle({ handlers }) {
  return (
    <div className="explore-card-grip" aria-hidden="true" {...handlers}>
      <span />
    </div>
  );
}

// Puts the link in the compare picks, or takes it out (the same rules and message as the details window).
function CompareButton({ link, onCompare }) {
  const picks = useComparePicks();
  const toast = useToast();
  const inCompare = Boolean(link) && picks.some(pick => pick.id === link.id);
  const full = !inCompare && picks.length >= MAX_COMPARE;
  return (
    <button
      type="button"
      className={`btn btn-ghost explore-compare${inCompare ? ' is-on' : ''}`}
      aria-pressed={inCompare}
      aria-disabled={!link || full || undefined}
      title={full ? 'You can compare up to 4 links' : inCompare ? 'Take it out of compare' : 'Add to compare'}
      onClick={() => {
        if (!link || full) return;
        togglePick(link);
        if (inCompare) return;
        const ids = [...picks.map(pick => pick.id), link.id];
        toast({
          title: 'Added to compare',
          description: `${ids.length} of ${MAX_COMPARE} picked`,
          tone: 'info',
          action: ids.length >= 2 ? { label: 'Compare now', onClick: () => onCompare(ids) } : undefined,
        });
      }}
    >
      {inCompare ? <Check size={16} aria-hidden="true" /> : <Columns3 size={16} aria-hidden="true" />}
      {inCompare ? 'In compare' : 'Compare'}
    </button>
  );
}

// A row with a link's little picture and name. Pointing at it lights up its dot on the map; a click walks there.
function LinkRow({ world, index, onWalk, onPoint, children }) {
  return (
    <li>
      <button
        type="button"
        className="explore-row"
        style={hueOf(world.category[index])}
        onClick={() => onWalk(index)}
        onPointerEnter={event => event.pointerType === 'mouse' && onPoint(index)}
        onPointerLeave={() => onPoint(-1)}
        onFocus={() => onPoint(index)}
        onBlur={() => onPoint(-1)}
      >
        <SiteIcon link={iconLink(world, index)} className="explore-row-icon" />
        <span className="explore-row-name">{world.titles[index]}</span>
        {children}
      </button>
    </li>
  );
}

// ---------- About a link ----------

export function FocusCard({ world, index, owner, cardRef, onWalk, onPoint, onClose, onOpenLink, onCompare }) {
  const id = world.ids[index];
  const detail = useQuery({ ...detailQuery(id, ''), staleTime: 60_000 });
  const countOpen = useCountOpen();
  const { tall, handlers } = useSheetDrag(cardRef, onClose);
  const link = detail.data?.link;
  const category = link?.category ?? world.category[index];
  const title = link?.title ?? world.titles[index];
  const summary = link?.summary || link?.description || '';
  const near = world.near[index];
  // Walking to another link keeps the card in place and changes what's on it, starting from its top.
  useEffect(() => {
    cardRef.current?.scrollTo?.({ top: 0 });
  }, [id, cardRef]);
  return (
    <aside className={`explore-card${tall ? ' is-tall' : ''}`} ref={cardRef} aria-label={`About ${title}`} style={hueOf(category)}>
      <SheetHandle handlers={handlers} />
      <div className="explore-card-head">
        <SiteIcon link={link ?? iconLink(world, index)} className="explore-card-icon" big />
        <div className="explore-card-name">
          <h2>{title}</h2>
          {link ? (
            <a href={link.url} target="_blank" rel="noopener noreferrer" onClick={() => owner && countOpen(id)}>
              {siteOf(link)}
            </a>
          ) : (
            <span className="explore-skeleton" style={{ width: '45%' }} />
          )}
        </div>
        <button type="button" className="icon-btn explore-card-close" aria-label="Close this card" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="explore-card-badge">
        <CategoryBadge name={category} />
      </div>
      {link ? (
        summary && <p className="explore-card-summary">{summary}</p>
      ) : detail.isError ? (
        <p className="explore-card-summary">Couldn't load the details. You can still open it below.</p>
      ) : (
        <p className="explore-card-summary" aria-hidden="true">
          <span className="explore-skeleton" />
          <span className="explore-skeleton" style={{ width: '70%' }} />
        </p>
      )}
      <div className="explore-card-actions">
        {link ? (
          <a className="btn btn-primary" href={link.url} target="_blank" rel="noopener noreferrer" onClick={() => owner && countOpen(id)}>
            <ExternalLink size={16} aria-hidden="true" />
            Open website
          </a>
        ) : (
          <span className="btn btn-primary is-waiting" aria-hidden="true">
            Open website
          </span>
        )}
        <button type="button" className="btn btn-ghost" onClick={() => onOpenLink(id)}>
          Details
        </button>
        <CompareButton link={link} onCompare={onCompare} />
      </div>
      {near.length > 0 && (
        <section className="explore-near" aria-label="Closest links">
          <h3>Closest links</h3>
          <ol>
            {near.map(({ index: other, alike }) => (
              <LinkRow key={other} world={world} index={other} onWalk={onWalk} onPoint={onPoint}>
                <span className="explore-near-alike" title={`${Math.round(alike * 100)}% alike`}>
                  <span className="explore-near-bar" aria-hidden="true">
                    <span style={{ width: `${Math.round(Math.min(1, Math.max(0, (alike - 0.25) / 0.65)) * 100)}%` }} />
                  </span>
                  <span className="sr-only">{Math.round(alike * 100)}% alike</span>
                </span>
              </LinkRow>
            ))}
          </ol>
        </section>
      )}
    </aside>
  );
}

// ---------- About an island ----------

export function IslandCard({ world, category, cardRef, onWalk, onPoint, onClose, onShow }) {
  const island = world.islandOf.get(category);
  const { Icon, short } = categoryStyle(category);
  const { tall, handlers } = useSheetDrag(cardRef, onClose);
  if (!island) return null;
  return (
    <aside className={`explore-card is-island${tall ? ' is-tall' : ''}`} ref={cardRef} aria-label={`About ${short}`} style={hueOf(category)}>
      <SheetHandle handlers={handlers} />
      <div className="explore-card-head">
        <span className="explore-island-mark" aria-hidden="true">
          <Icon size={22} />
        </span>
        <div className="explore-card-name">
          <h2>{category}</h2>
          <span className="explore-island-count">
            {island.count.toLocaleString()} {island.count === 1 ? 'link' : 'links'}
          </span>
        </div>
        <button type="button" className="icon-btn explore-card-close" aria-label="Close this card" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {island.tags.length > 0 && (
        <ul className="explore-tags" aria-label="Top tags">
          {island.tags.map(tag => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      )}
      <div className="explore-card-actions">
        <button type="button" className="btn btn-primary" onClick={() => onShow(category)}>
          <Library size={16} aria-hidden="true" />
          Show in library
        </button>
      </div>
      {island.top.length > 0 && (
        <section className="explore-near" aria-label="Top links">
          <h3>Top links</h3>
          <ol>
            {island.top.map(index => (
              <LinkRow key={index} world={world} index={index} onWalk={onWalk} onPoint={onPoint} />
            ))}
          </ol>
        </section>
      )}
    </aside>
  );
}
