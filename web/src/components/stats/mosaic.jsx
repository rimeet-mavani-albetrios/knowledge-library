// "Topics": every category as a colored tile, its size the number of links (a "treemap"). The tiles are laid out by
// the squarified method: rows of tiles along the shorter side, a tile joining a row only while that keeps the tiles
// closer to squares. So big topics are big squares, not long thin strips.
// A topic whose tile would be too small to show its name and number shares one "+N more" tile instead. That tile opens
// the small topics under the mosaic, as a grid of small tiles of the same look. While they are open the mosaic gives
// up room for them where the card has spare height (a wide screen, beside Health and Prices), so nothing else on the
// page moves; its tiles keep their places and only get a little flatter.
// For screen readers and the keyboard it is a list of buttons, biggest first. Click a topic to see its links.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, LayoutGrid } from 'lucide-react';
import { categoryStyle, hueOf } from '../../categories.jsx';
import { Reveal } from '../SeeMore.jsx';
import { Card, percent, plural } from './shared.jsx';
import './mosaic.css';

const MAX_TILES = 20; // more tiles than this make a mosaic too busy to read
const MIN_HEIGHT = 46; // a tile needs this much height for its name and number…
const LETTER_WIDTH = 6.8; // …and this much width per letter of its name, plus the tile's own padding and gap
const TILE_PADDING = 24;
const MORE_SMALLEST = 0.035; // the "+N more" tile is at least this part of the mosaic, or it would be too small to read…
const MORE_BIGGEST = 0.11; // …and at most this part: on a phone it would take half the mosaic, and it isn't a topic
const OPEN_ROOM = 170; // about how much height the open small tiles take from the mosaic on a wide screen
const REVEAL_TIME = 340; // a little longer than the opening takes (see-more.css)

// How stretched the longest tile of a row is when the row lies along `side`: 1 is a square, bigger is thinner.
function worst(row, side) {
  const sum = row.reduce((total, tile) => total + tile.area, 0);
  const areas = row.map(tile => tile.area);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

// Places `items` ({ count }) in a width × height box: [{ item, x, y, w, h }] in the same units.
export function squarify(items, width, height) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  if (!total || width <= 0 || height <= 0) return [];
  const scale = (width * height) / total;
  const placed = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let row = [];
  // Lays the row along the shorter side of what is left, then shrinks the free space by its thickness.
  const lay = () => {
    const sum = row.reduce((total, tile) => total + tile.area, 0);
    if (w >= h) {
      const thick = sum / h; // a column on the left
      let at = y;
      for (const tile of row) {
        placed.push({ item: tile.item, x, y: at, w: thick, h: tile.area / thick });
        at += tile.area / thick;
      }
      x += thick;
      w -= thick;
    } else {
      const thick = sum / w; // a row along the top
      let at = x;
      for (const tile of row) {
        placed.push({ item: tile.item, x: at, y, w: tile.area / thick, h: thick });
        at += tile.area / thick;
      }
      y += thick;
      h -= thick;
    }
    row = [];
  };
  for (const item of items) {
    const tile = { item, area: item.count * scale };
    const side = Math.min(w, h);
    if (row.length && worst([...row, tile], side) > worst(row, side)) lay();
    row.push(tile);
  }
  if (row.length) lay();
  return placed;
}

// The size of an element, kept up to date (the mosaic is drawn for its real shape: a phone is tall, a wide screen wide).
function useSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize(old => (Math.abs(old.width - width) < 1 && Math.abs(old.height - height) < 1 ? old : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

// Which topics get their own tile. It starts with as many as a mosaic can hold, and as long as some tile would be too
// small for its name and number, the smallest such topic moves to "+N more" and all are laid out again.
function split(categories, width, height, smallest) {
  const total = categories.reduce((sum, item) => sum + item.count, 0);
  if (!total || !width || !height) return { total, rects: [], rest: [] };
  // Open, the mosaic can get flatter (down to its smallest height in mosaic.css): a tile must still be tall enough
  // then, so the tiles don't change on opening.
  const flatter = height > smallest ? Math.max(smallest, height - OPEN_ROOM) / height : 1;
  const tallEnough = MIN_HEIGHT / flatter;
  const fits = ({ item, w, h }) =>
    item.more || (h >= tallEnough && w >= categoryStyle(item.value).short.length * LETTER_WIDTH + TILE_PADDING);
  let own = categories.slice(0, MAX_TILES);
  for (;;) {
    const kept = new Set(own);
    const rest = categories.filter(item => !kept.has(item));
    const sum = rest.reduce((all, item) => all + item.count, 0);
    const weight = Math.max(total * MORE_SMALLEST, Math.min(total * MORE_BIGGEST, sum));
    const more = rest.length ? [{ value: '', more: true, count: weight, links: sum, moreCount: rest.length }] : [];
    const rects = squarify([...own, ...more], width, height);
    const tooSmall = rects.filter(rect => !fits(rect)).at(-1);
    if (!tooSmall || own.length === 1) return { total, rects, rest };
    own = own.filter(item => item !== tooSmall.item);
  }
}

const pct = n => `${(n * 100).toFixed(3)}%`;

function Tile({ rect, box, shown, total, open, onShow, onMore }) {
  const { item, x, y, w } = rect;
  // The rects are made for the mosaic's height when closed; open it is a little flatter (`shown`).
  const h = rect.h * (shown.height / box.height);
  // What fits: a big tile shows icon, share, count and name; the others their name and count.
  const big = w >= 118 && h >= 92;
  const fit = big ? 'is-big' : 'is-mid';
  const place = {
    left: pct(x / box.width),
    top: pct(y / box.height),
    width: pct(w / box.width),
    height: pct(rect.h / box.height),
    '--count-size': `${Math.round(Math.max(16, Math.min(34, Math.sqrt(w * h) / 6.5)))}px`,
  };
  if (item.more) {
    return (
      <li className={`mosaic-cell ${fit}`} style={place}>
        <button
          type="button"
          className="mosaic-tile is-more"
          aria-expanded={open}
          aria-controls="stats-topics-more"
          onClick={onMore}
          title={open ? 'Hide the smaller topics' : 'Show the smaller topics'}
        >
          <ChevronDown size={16} aria-hidden="true" className="mosaic-more-chevron" />
          <span className="mosaic-count">+{item.moreCount}</span>
          <span className="mosaic-name">{big && w >= 150 ? `more · ${plural(item.links, 'link')}` : 'more'}</span>
        </button>
      </li>
    );
  }
  const { Icon, short } = categoryStyle(item.value);
  return (
    <li className={`mosaic-cell ${fit}`} style={{ ...place, ...hueOf(item.value) }}>
      <button
        type="button"
        className="mosaic-tile"
        onClick={() => onShow({ category: item.value })}
        aria-label={`${item.value}: ${plural(item.count, 'link')}. Show them in the library`}
        title={`${item.value} · ${plural(item.count, 'link')} (${percent(item.count, total)})`}
      >
        <span className="mosaic-top" aria-hidden="true">
          {big ? <Icon size={18} className="mosaic-icon" /> : <span className="mosaic-name">{short}</span>}
          {big ? <span className="mosaic-share">{percent(item.count, total)}</span> : null}
        </span>
        <span className="mosaic-foot" aria-hidden="true">
          <span className="mosaic-count">{item.count.toLocaleString()}</span>
          {big ? <span className="mosaic-name">{short}</span> : null}
        </span>
      </button>
    </li>
  );
}

// One small topic under the mosaic: the same look as a tile, its icon and name on top, its number under them.
function SmallTile({ value, count, total, onShow }) {
  const { Icon, short } = categoryStyle(value);
  return (
    <li style={hueOf(value)}>
      <button
        type="button"
        className="mosaic-tile mosaic-small"
        onClick={() => onShow({ category: value })}
        aria-label={`${value}: ${plural(count, 'link')}. Show them in the library`}
        title={`${value} · ${plural(count, 'link')} (${percent(count, total)})`}
      >
        <span className="mosaic-top" aria-hidden="true">
          <Icon size={15} className="mosaic-icon" />
          <span className="mosaic-name">{short}</span>
        </span>
        <span className="mosaic-count" aria-hidden="true">
          {count.toLocaleString()}
        </span>
      </button>
    </li>
  );
}

export function Mosaic({ categories, plate, onShow }) {
  const box = useRef(null);
  const size = useSize(box);
  const [open, setOpen] = useState(false);
  // While the small tiles are open or still moving, the tiles keep the places they had when closed: laid out again for
  // every height on the way, they would jump around.
  const [heldHeight, setHeldHeight] = useState(0);
  useEffect(() => {
    if (open) return undefined;
    const timer = setTimeout(() => setHeldHeight(0), REVEAL_TIME);
    return () => clearTimeout(timer);
  }, [open]);
  const toggle = () => {
    if (!open) setHeldHeight(held => held || size.height);
    setOpen(!open);
  };
  const layout = { width: size.width, height: heldHeight || size.height };
  const smallest = box.current ? parseFloat(getComputedStyle(box.current).minHeight) || 0 : 0;
  const { total, rects, rest } = split(categories, layout.width, layout.height, smallest);

  return (
    <Card
      id="stats-topics"
      plate={plate}
      kicker="Topics"
      title="What your library is about"
      sub="Each tile is a topic, sized by its links. Click one to see them."
      className="stats-mosaic"
    >
      {categories.length ? (
        <>
          <ol ref={box} className="mosaic" aria-label="Topics, biggest first">
            {size.width
              ? rects.map(rect => (
                  <Tile
                    key={rect.item.more ? 'more' : rect.item.value}
                    rect={rect}
                    box={layout}
                    shown={size}
                    total={total}
                    open={open}
                    onShow={onShow}
                    onMore={toggle}
                  />
                ))
              : null}
          </ol>
          {rest.length ? (
            <Reveal open={open} id="stats-topics-more" className="mosaic-reveal">
              <ul className="mosaic-small-grid" aria-label="Smaller topics">
                {rest.map(({ value, count }) => (
                  <SmallTile key={value} value={value} count={count} total={total} onShow={onShow} />
                ))}
              </ul>
            </Reveal>
          ) : null}
        </>
      ) : (
        <div className="stats-empty mosaic-empty">
          <LayoutGrid size={20} aria-hidden="true" />
          <strong>No topics yet</strong>
          <span>Add links and their topics show up here as tiles: the more links, the bigger the tile.</span>
        </div>
      )}
    </Card>
  );
}
