// The search box at the top of the map. Typing shows the best matches in a small list: a click walks to that link.
// Enter lights up all the matches on the map and frames them. Esc clears it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { api, toQuery } from '../../api.js';
import { categoryStyle } from '../../categories.jsx';
import { useDebounced } from '../../hooks.js';
import { SiteIcon } from '../LinkCard.jsx';
import { iconLink } from './world.js';

const LIST_SIZE = 6;

// world: the map. onWalk(index): go to that link. onLight(dots, frame): the Set of dots to light up (null for none), and
// whether the map should move to show them. inputRef: for the "/" key.
export function SearchBox({ world, text, setText, inputRef, onWalk, onLight }) {
  const q = useDebounced(text.trim(), 240);
  const searching = q.length >= 2;
  const [open, setOpen] = useState(false); // the list of matches
  const [lit, setLit] = useState(false); // Enter was pressed: the matches are lit up on the map
  const [active, setActive] = useState(-1); // the row chosen with the arrow keys
  const box = useRef(null);

  const found = useQuery({
    queryKey: ['explore-search', q],
    queryFn: ({ signal }) => api(`/links?${toQuery({ q, limit: 60 })}`, { signal }),
    enabled: searching,
    staleTime: 60_000,
    placeholderData: previous => previous,
  });

  // The search gives the best matches first, then links that are only related. Only the best ones count (or, when
  // nothing matches well, the closest few), so the lit dots really are about what you typed.
  const answer = useMemo(() => {
    if (!searching || !found.data || !world) return null;
    const best = found.data.items.filter(link => link.match === 'best');
    const items = best.length ? best : found.data.items.slice(0, 20);
    const dots = items.map(link => world.indexOf.get(link.id)).filter(index => index !== undefined);
    return { dots, kind: best.length ? 'found' : found.data.closestOnly ? 'close' : 'related' };
  }, [searching, found.data, world]);

  const list = answer ? answer.dots.slice(0, LIST_SIZE) : [];
  const fresh = !found.isPlaceholderData && !found.isFetching;

  // A new word: the old lights go out and the list comes back.
  useEffect(() => {
    setLit(false);
    onLight(null);
    setActive(-1);
    setOpen(Boolean(text.trim()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const light = () => {
    if (!answer?.dots.length) return;
    setOpen(false);
    setLit(true);
    onLight(new Set(answer.dots), true);
  };

  // Fresh map data while the matches are lit (a link was added): the same matches stay lit, in their new places.
  useEffect(() => {
    if (lit && answer) onLight(new Set(answer.dots), false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer]);

  // Enter pressed before the answer arrived: it lights up as soon as it's here.
  const waiting = useRef(false);
  useEffect(() => {
    if (waiting.current && fresh && answer) {
      waiting.current = false;
      light();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh, answer]);

  // A click anywhere else closes the list.
  useEffect(() => {
    if (!open) return undefined;
    const outside = event => {
      if (!box.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const walk = index => {
    setOpen(false);
    inputRef.current?.blur();
    onWalk(index);
  };

  const onKeyDown = event => {
    if (event.key === 'ArrowDown' && list.length) {
      event.preventDefault();
      setOpen(true);
      setActive(place => (place + 1) % list.length);
    } else if (event.key === 'ArrowUp' && list.length) {
      event.preventDefault();
      setOpen(true);
      setActive(place => (place <= 0 ? list.length - 1 : place - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (active >= 0 && list[active] !== undefined) walk(list[active]);
      else if (fresh && answer) light();
      else waiting.current = true;
    }
  };

  const count = answer?.dots.length ?? 0;
  const empty = searching && fresh && answer && !count;
  return (
    <div className="explore-search-wrap" ref={box}>
      <form className={`explore-search${open && (list.length > 0 || empty) ? ' has-list' : ''}`} role="search" onSubmit={event => event.preventDefault()}>
        <Search size={17} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={text}
          onChange={event => setText(event.target.value)}
          onFocus={() => text.trim() && !lit && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Find a link on the map…"
          aria-label="Find a link on the map"
          enterKeyHint="search"
          role="combobox"
          aria-expanded={open && list.length > 0}
          aria-controls="explore-matches"
          aria-activedescendant={active >= 0 ? `explore-match-${active}` : undefined}
          autoComplete="off"
        />
        {lit && (
          <span className="explore-found" aria-live="polite">
            {answer?.kind === 'close' ? `${count} close` : answer?.kind === 'related' ? `${count} related` : `${count} ${count === 1 ? 'link' : 'links'}`}
          </span>
        )}
        {text && (
          <button type="button" className="explore-clear" aria-label="Clear the search" onClick={() => setText('')}>
            <X size={16} />
          </button>
        )}
      </form>
      {open && (list.length > 0 || empty) && (
        <div className="explore-matches" id="explore-matches" role="listbox" aria-label="Best matches">
          {empty && <p className="explore-matches-empty">Nothing on the map matches that.</p>}
          {list.map((index, place) => (
            <button
              key={index}
              id={`explore-match-${place}`}
              type="button"
              role="option"
              aria-selected={place === active}
              className={`explore-match${place === active ? ' is-active' : ''}`}
              onPointerEnter={() => setActive(place)}
              onClick={() => walk(index)}
            >
              <SiteIcon link={iconLink(world, index)} className="explore-row-icon" />
              <span className="explore-match-name">{world.titles[index]}</span>
              <span className="explore-match-kind">{categoryStyle(world.category[index]).short}</span>
            </button>
          ))}
          {count > 0 && (
            <button type="button" className="explore-match-all" onClick={light}>
              Show {count === 1 ? 'it' : `all ${count}`} on the map
              <kbd>Enter</kbd>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
