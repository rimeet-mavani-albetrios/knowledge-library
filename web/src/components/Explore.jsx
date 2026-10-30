// The Explore page: an atlas of your library on the whole screen. Land, countries (categories), and a city for every link.
//
// - Drag to move, scroll or pinch to zoom (or the + − buttons, or the arrow keys and + −). Esc steps back.
// - Far out you see the islands (categories); closer in, the topics inside them; close up, each link's name and logo.
// - Click a dot: the map glides to it, its closest links light up and connect with lines (thicker = more alike),
//   and a card shows what it is, with Open website, Details and Compare.
// - Click land or a name: the map frames that island, and a card shows its top tags and links.
// - The Topics list does the same; pointing at a row lights up its island. The small map in the corner shows where you are.
// - The search box lists the best matches as you type; Enter lights them all up on the map.
// - The trail at the top shows the links you walked through, and lets you jump back; the browser's Back button steps back too.
//
// It's a step of its own in the address bar (?explore=1, and &focus=<link id> or &island=<category> for what's picked), so
// Back, Forward and reloading all work. The map itself is drawn by explore/map-view.js: see there for how.
// This file (and Sigma, the drawing library) is only loaded when you open the page, so the home page stays light.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { api } from '../api.js';
import { hueOf } from '../categories.jsx';
import { PHONE, useMediaQuery } from '../hooks.js';
import { MapView } from './explore/map-view.js';
import { prepareWorld } from './explore/world.js';
import { readColors } from './explore/colors.js';
import { FocusCard, IslandCard } from './explore/SideCard.jsx';
import { SearchBox } from './explore/SearchBox.jsx';
import { FirstHint, HoverTip, MiniMap, Topics, useFirstHint, ZoomButtons } from './explore/Panels.jsx';
import './explore.css';

// Under ['map'], so the map is fetched again when links are added or changed (see useProgressPolling).
export const exploreQuery = { queryKey: ['map', 'explore'], queryFn: () => api('/map/explore'), staleTime: 60_000 };

const TOPICS_KEY = 'kl-explore-topics';

// A land shape that breathes while the real map is on its way.
const LOADING_LAND =
  'M133 131Q135 131 137 129Q139 127 140 124Q141 121 141 118Q141 115 142 112Q144 109 147 106Q151 103 154 100Q157 97 160 97Q163 97 165 94Q167 92 170 93Q173 95 176 95Q180 95 183 94Q187 93 189 91Q191 88 193 86Q195 84 195 80Q195 77 196 74Q197 71 197 68Q197 65 196 62Q195 58 192 56Q188 53 186 51Q184 49 182 48Q179 46 176 48Q174 49 171 49Q168 48 168 46Q167 43 165 41Q164 39 162 36Q161 34 158 31Q156 28 153 28Q150 28 147 29Q144 30 141 28Q138 26 136 24Q134 22 132 21Q129 20 127 18Q124 17 120 11Q116 6 113 6Q110 5 108 8Q106 10 102 11Q99 11 97 9Q95 6 92 4Q90 2 87 2Q84 2 81 2Q78 3 76 5Q74 7 71 8Q68 9 66 7Q64 5 60 6Q56 7 53 7Q50 7 49 11Q48 14 50 17Q53 20 52 23Q50 26 49 29Q47 31 47 34Q47 37 44 40Q41 42 39 44Q37 47 37 50Q36 53 36 56Q36 59 38 62Q41 65 43 69Q44 72 41 71Q38 70 36 72Q34 74 31 74Q28 74 25 73Q21 72 18 73Q14 73 11 76Q8 79 6 81Q4 84 3 87Q3 90 7 96Q10 102 12 105Q14 107 16 109Q19 111 22 111Q25 110 28 108Q32 106 35 104Q37 102 39 99Q40 96 42 94Q43 91 45 88Q47 85 50 85Q54 84 56 83Q58 81 61 83Q63 84 60 86Q58 87 58 90Q58 94 58 97Q58 100 60 102Q61 104 64 106Q67 107 70 107Q73 106 76 106Q80 106 83 105Q86 105 87 102Q88 99 89 96Q90 93 89 90Q87 87 89 85Q91 83 93 86Q94 88 97 90Q99 91 100 89Q102 87 105 86Q107 84 109 82Q111 80 114 82Q117 84 119 86Q120 89 119 92Q119 94 119 97Q119 100 122 103Q125 106 122 106Q119 107 120 110Q120 112 121 115Q122 118 121 121Q119 124 119 126Q119 129 122 130Q125 131 128 131Q131 131 133 131z';

function savedTopicsOpen() {
  try {
    return localStorage.getItem(TOPICS_KEY) !== 'closed';
  } catch {
    return true;
  }
}

export default function Explore({ params, setParams, owner, start, onOpenLink, onCompare, onShowCategory }) {
  const map = useQuery(exploreQuery);
  const world = useMemo(() => (map.data ? prepareWorld(map.data) : null), [map.data]);
  const phone = useMediaQuery(PHONE);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const root = useRef(null);
  const paper = useRef(null);
  const top = useRef(null);
  const trailBox = useRef(null);
  const card = useRef(null);
  const topics = useRef(null);
  const mini = useRef(null);
  const miniCanvas = useRef(null);
  const controls = useRef(null);
  const tip = useRef(null);
  const searchBox = useRef(null);
  const probes = useRef({});
  const view = useRef(null);
  const [broken, setBroken] = useState(false); // no WebGL in this browser
  const [hint, dismissHint] = useFirstHint();
  const [topicsOpen, setTopicsOpen] = useState(savedTopicsOpen);

  // ---------- Steps in the address bar ----------
  // Every step Explore adds remembers how many steps back the library is (exploreDepth), so "Library" can jump
  // straight back there, however far you walked. `exploreBase` 1 means the library really is there (Explore was
  // opened from it); 0 means this page was opened straight from an address, with no library step behind it.
  useLayoutEffect(() => {
    const state = window.history.state;
    if (state?.exploreDepth !== undefined) return; // a reload keeps the steps (and these numbers)
    const base = state?.step === 'explore' ? 1 : 0;
    window.history.replaceState({ ...state, exploreDepth: base, exploreBase: base }, '');
  }, []);

  const close = useCallback(() => {
    const { exploreDepth: depth, exploreBase: base } = window.history.state ?? {};
    if (base === 1 && depth >= 1) window.history.go(-depth);
    else setParams({ explore: false, focus: '', island: '' });
  }, [setParams]);

  // Picking a link or an island is a step of its own, so Back goes to what you had before.
  const step = useCallback(
    changes => {
      const { exploreDepth = 0, exploreBase = 0 } = window.history.state ?? {};
      setParams(changes, 'explore-focus');
      window.history.replaceState({ ...window.history.state, exploreDepth: exploreDepth + 1, exploreBase }, '');
    },
    [setParams],
  );
  const choose = useCallback(
    index => {
      if (!world || index < 0) return;
      const id = world.ids[index];
      if (id === paramsRef.current.focus) {
        view.current?.flyToDot(index);
        return;
      }
      step({ focus: id, island: '' });
    },
    [world, step],
  );
  const chooseIsland = useCallback(
    category => {
      if (category === paramsRef.current.island) {
        view.current?.flyToIsland(category);
        return;
      }
      step({ island: category, focus: '' });
    },
    [step],
  );
  const clearPicked = useCallback(() => setParams({ focus: '', island: '' }), [setParams]);

  const focus = world && params.focus ? (world.indexOf.get(params.focus) ?? -1) : -1;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const island = world && !params.focus && params.island && world.islandOf.has(params.island) ? params.island : '';

  // The trail: the links you walked through. A link you go back to (with Back, or a click on the trail) cuts the
  // trail there; a new one is added at the end; letting go of the picked link starts a fresh trail.
  const [trail, setTrail] = useState(() => (params.focus ? [{ id: params.focus, depth: window.history.state?.exploreDepth }] : []));
  useEffect(() => {
    const id = params.focus;
    setTrail(old => {
      if (!id) return [];
      const at = old.findIndex(item => item.id === id);
      if (at >= 0) return at === old.length - 1 ? old : old.slice(0, at + 1);
      return [...old, { id, depth: window.history.state?.exploreDepth }];
    });
  }, [params.focus]);
  const jumpBack = place => {
    const here = window.history.state?.exploreDepth;
    const there = trail[place].depth;
    if (here !== undefined && there !== undefined && here > there) window.history.go(there - here);
    else setParams({ focus: trail[place].id });
  };

  // ---------- The drawing engine ----------
  const [text, setText] = useState('');
  const handlers = useRef({});
  handlers.current = {
    pick: index => {
      dismissHint();
      choose(index);
    },
    pickIsland: category => {
      dismissHint();
      chooseIsland(category);
    },
    clear: () => {
      dismissHint();
      if (paramsRef.current.focus || paramsRef.current.island) clearPicked();
    },
    // The picked dot needs no card under the mouse: the big card is about it already.
    hover: (index, x, y) => tip.current?.place(index === focusRef.current ? -1 : index, x, y),
    moved: () => dismissHint(),
  };

  useLayoutEffect(() => {
    let engine;
    try {
      engine = new MapView(paper.current, {
        pick: (...args) => handlers.current.pick(...args),
        pickIsland: (...args) => handlers.current.pickIsland(...args),
        clear: () => handlers.current.clear(),
        hover: (...args) => handlers.current.hover(...args),
        moved: () => handlers.current.moved(),
      });
    } catch (err) {
      console.error('The map could not start:', err.message);
      setBroken(true);
      return undefined;
    }
    view.current = engine;
    return () => {
      engine.destroy();
      view.current = null;
    };
  }, []);

  // The colors, read from the page; again when the theme changes or the fonts arrive.
  useEffect(() => {
    if (!world) return undefined;
    const read = () => view.current?.setColors(readColors(root.current, probes.current));
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    document.fonts?.ready.then(read);
    return () => observer.disconnect();
  }, [world]);

  // The map data, to the engine. Fresh data while you look (a link was added) keeps your place on the map.
  const glided = useRef(false);
  useEffect(() => {
    if (!world || !view.current) return undefined;
    view.current.setWorld(world);
    // Opened by a click on the home map: glide in to the island nearest to that spot (the spot itself may be sea).
    if (glided.current || !start || paramsRef.current.focus || paramsRef.current.island) return undefined;
    const spot = { x: start.x, y: (1 - start.y) * world.aspect };
    const distance = item => (item.x - spot.x) ** 2 + (item.y - spot.y) ** 2;
    const nearest = world.islands.reduce((best, item) => (!best || distance(item) < distance(best) ? item : best), null) ?? spot;
    const timer = setTimeout(() => {
      glided.current = true;
      view.current?.zoomTo(nearest.x, nearest.y, 2.6);
    }, 420);
    return () => clearTimeout(timer);
  }, [world, start]);

  // The picked link: light it up and glide to it with its closest links. (Only when the pick is new: fresh data while
  // you look doesn't move the map.)
  const flownTo = useRef('');
  useEffect(() => {
    if (!world || !view.current) return;
    view.current.setFocus(focus);
    const id = focus >= 0 ? world.ids[focus] : '';
    // After the card is on screen, so the glide knows how much room is left beside (or above) it.
    if (id && id !== flownTo.current) requestAnimationFrame(() => view.current?.flyToDot(focus));
    if (id || !island) flownTo.current = id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, world]);

  // The picked island: it stands out, and the map frames it.
  useEffect(() => {
    if (!world || !view.current) return;
    view.current.setIsland(island);
    if (island && island !== flownTo.current) requestAnimationFrame(() => view.current?.flyToIsland(island));
    if (island || focus < 0) flownTo.current = island;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [island, world]);

  const light = useCallback((dots, frame) => {
    view.current?.setLit(dots);
    if (dots && frame) view.current?.fitDots([...dots], { most: 10 });
  }, []);

  // The bars and the card cover parts of the map: tell the engine, so "the middle" is the middle of what you can see,
  // and no names are placed under them.
  useLayoutEffect(() => {
    const measure = () => {
      const engine = view.current;
      if (!engine) return;
      // (Where an element really stands: while a card slides in, the browser's getBoundingClientRect would give its
      // place in the middle of the slide.)
      const box = element =>
        element && { left: element.offsetLeft, top: element.offsetTop, right: element.offsetLeft + element.offsetWidth, bottom: element.offsetTop + element.offsetHeight };
      const topBox = box(top.current);
      const topEdge = topBox?.bottom ?? 0;
      const trailBoxNow = trailBox.current?.getBoundingClientRect(); // (it stands by a shift to the middle: only this sees that)
      const trailEdge = trailBoxNow?.bottom ?? 0;
      const cardBox = box(card.current);
      const topicsBox = box(topics.current);
      const covered = [topBox, trailBoxNow, cardBox, topicsBox, box(mini.current), box(controls.current)]
        .filter(Boolean)
        .map(rect => ({ l: rect.left - 4, r: rect.right + 4, t: rect.top - 4, b: rect.bottom + 4 }));
      engine.setInsets(
        {
          top: phone ? Math.max(topEdge, topicsBox?.bottom ?? 0, trailEdge) : topEdge,
          left: !phone && topicsOpen && topicsBox ? topicsBox.right : 0,
          right: cardBox && !phone ? window.innerWidth - cardBox.left : 0,
          bottom: cardBox && phone ? window.innerHeight - cardBox.top : 0,
        },
        covered,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [top.current, card.current, topics.current, trailBox.current]) if (element) observer.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [phone, focus, island, trail.length > 1, topicsOpen, world]); // eslint-disable-line react-hooks/exhaustive-deps

  // The small map in the corner draws from the engine.
  useEffect(() => {
    view.current?.setMiniMap(phone ? null : miniCanvas.current);
  }, [phone, world]);

  // ---------- Keys ----------
  useEffect(() => {
    const onKey = event => {
      if (document.querySelector('dialog[open]')) return; // a window (details, compare) is open on top
      const typing = event.target.closest?.('input, textarea, [contenteditable]');
      if (event.key === 'Escape') {
        event.preventDefault();
        if (typing) {
          if (text) setText('');
          else event.target.blur();
        } else if (paramsRef.current.focus || paramsRef.current.island) clearPicked();
        else if (text) setText('');
        else close();
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      const engine = view.current;
      const moves = { ArrowLeft: [-140, 0], ArrowRight: [140, 0], ArrowUp: [0, -140], ArrowDown: [0, 140] };
      if (moves[event.key]) engine?.panBy(...moves[event.key]);
      else if (event.key === '+' || event.key === '=') engine?.zoomBy(1.6);
      else if (event.key === '-' || event.key === '_') engine?.zoomBy(1 / 1.6);
      else if (event.key === '0') engine?.fitAll();
      else if (event.key === '/') searchBox.current?.focus();
      else return;
      event.preventDefault(); // before the page's own shortcuts ("/" for the library's search box)
      dismissHint();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, close, clearPicked]);

  // The library behind this page can't be reached with Tab while it's open.
  useEffect(() => {
    const behind = [document.querySelector('.app-header'), document.getElementById('links'), document.querySelector('.skip-link')].filter(Boolean);
    for (const element of behind) element.inert = true;
    root.current?.focus({ preventScroll: true });
    return () => {
      for (const element of behind) element.inert = false;
    };
  }, []);

  const toggleTopics = () => {
    setTopicsOpen(open => {
      try {
        localStorage.setItem(TOPICS_KEY, open ? 'closed' : 'open');
      } catch {
        // private browsing: it's only remembered until the page closes
      }
      return !open;
    });
  };

  const total = world?.n ?? 0;
  const point = index => view.current?.setPreview(index);
  const ready = Boolean(world && total > 0 && !broken);

  return (
    <section
      className={`explore${focus >= 0 || island ? ' has-card' : ''}${ready ? ' is-ready' : ''}`}
      ref={root}
      tabIndex={-1}
      aria-label="Explore your library on a map"
      style={world ? { '--mini-height': `${Math.round(214 * world.aspect)}px` } : undefined}
    >
      <div
        className="explore-paper"
        ref={paper}
        role="img"
        aria-label={`Map of your library: ${total} links, placed by meaning. Arrow keys move, plus and minus zoom, 0 shows the whole map.`}
      />

      <header className="explore-top" ref={top}>
        <div className="explore-top-start">
          <button type="button" className="btn btn-ghost explore-back" onClick={close}>
            <ArrowLeft size={18} aria-hidden="true" />
            <span>Library</span>
          </button>
          <div className="explore-title">
            <h1>Explore</h1>
            {total > 0 && <span>{total.toLocaleString()} links</span>}
          </div>
        </div>
        <SearchBox world={world} text={text} setText={setText} inputRef={searchBox} onWalk={choose} onLight={light} />
        <div className="explore-top-end" />
      </header>

      {focus >= 0 && trail.length > 1 && (
        <nav className="explore-trail" ref={trailBox} aria-label="Links you walked through">
          <ol>
            {trail.map((item, place) => {
              const index = world.indexOf.get(item.id);
              const name = index === undefined ? 'A removed link' : world.titles[index];
              return (
                <li key={`${item.id}-${place}`}>
                  {place > 0 && <ChevronRight size={14} aria-hidden="true" />}
                  {place === trail.length - 1 ? (
                    <span aria-current="location">{name}</span>
                  ) : (
                    <button type="button" onClick={() => jumpBack(place)}>
                      {name}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      {ready && (
        <Topics
          world={world}
          phone={phone}
          picked={island}
          panelRef={topics}
          open={topicsOpen}
          onToggle={toggleTopics}
          onPoint={category => view.current?.setPointed(category)}
          onPick={chooseIsland}
        />
      )}
      {ready && !phone && <MiniMap aspect={world.aspect} canvasRef={miniCanvas} boxRef={mini} onJump={(x, y, smooth) => view.current?.centerOn(x, y, { smooth })} />}
      {ready && <ZoomButtons controlsRef={controls} engine={view} />}
      {ready && focus < 0 && !island && <FirstHint state={hint} />}
      {ready && <HoverTip world={world} tipRef={tip} />}

      {focus >= 0 && (
        <FocusCard
          world={world}
          index={focus}
          owner={owner}
          cardRef={card}
          onWalk={choose}
          onPoint={point}
          onClose={clearPicked}
          onOpenLink={onOpenLink}
          onCompare={onCompare}
        />
      )}
      {island && <IslandCard key={island} world={world} category={island} cardRef={card} onWalk={choose} onPoint={point} onClose={clearPicked} onShow={onShowCategory} />}

      {broken ? (
        <div className="explore-state is-solid" role="alert">
          <p>This browser can't draw the map, because WebGL is turned off or missing.</p>
          <p className="explore-state-small">Everything on the map is also in your library.</p>
          <button type="button" className="btn btn-primary" onClick={close}>
            Back to the library
          </button>
        </div>
      ) : map.isLoading ? (
        <div className="explore-state" role="status">
          <svg className="explore-loading" viewBox="0 0 200 135" aria-hidden="true">
            <path d={LOADING_LAND} />
          </svg>
          Drawing your map…
        </div>
      ) : map.isError ? (
        <div className="explore-state is-solid" role="alert">
          <p>Couldn't draw the map. {map.error.message}</p>
          <button type="button" className="btn btn-ghost" onClick={() => map.refetch()}>
            Try again
          </button>
        </div>
      ) : total === 0 ? (
        <div className="explore-state">Your map appears here as you add links.</div>
      ) : null}

      {/* One hidden element per category, in its own color, for the canvas to read the colors from (colors.js). */}
      <div className="explore-probes" aria-hidden="true">
        {world?.categories.map(category => (
          <span
            key={category.name}
            style={hueOf(category.name)}
            ref={element => {
              probes.current[category.name] = element;
            }}
          />
        ))}
      </div>
    </section>
  );
}
