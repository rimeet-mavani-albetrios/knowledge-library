// The smaller things that float over the map: the Topics list, the small map in the corner, the zoom buttons, the
// card that follows the mouse, and the "how to move" hint.
import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ChevronsLeft, ListTree, Minus, Plus, Scan } from 'lucide-react';
import { categoryStyle, hueOf } from '../../categories.jsx';
import { SiteIcon } from '../LinkCard.jsx';
import { iconLink } from './world.js';

// ---------- Topics ----------

// The categories, biggest first. Pointing at one lights up its island; a click flies there and picks it.
// On big screens a panel on the left that can fold away; on phones a row you swipe sideways.
export function Topics({ world, phone, picked, panelRef, open, onToggle, onPoint, onPick }) {
  // An island picked on the map: its row comes into view in the list.
  useEffect(() => {
    if (!picked) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    panelRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: calm ? 'auto' : 'smooth' });
  }, [picked, panelRef]);

  if (phone) {
    return (
      <nav className="explore-topics-row" ref={panelRef} aria-label="Topics">
        <div>
          {world.categories.map(category => (
            <button key={category.name} type="button" className="explore-topic-chip" style={hueOf(category.name)} aria-pressed={picked === category.name} onClick={() => onPick(category.name)}>
              <span className="explore-swatch" aria-hidden="true" />
              {category.short}
              <span className="explore-count">{category.dots.length}</span>
            </button>
          ))}
        </div>
      </nav>
    );
  }
  if (!open) {
    return (
      <button type="button" className="explore-topics-open" ref={panelRef} onClick={onToggle} aria-label="Show the list of topics" title="Show the list of topics">
        <ListTree size={17} aria-hidden="true" />
        Topics
      </button>
    );
  }
  return (
    <nav className="explore-topics" ref={panelRef} aria-label="Topics">
      <header>
        <h2>Topics</h2>
        <button type="button" className="icon-btn explore-topics-fold" onClick={onToggle} aria-label="Fold the list of topics away" title="Fold away">
          <ChevronsLeft size={17} aria-hidden="true" />
        </button>
      </header>
      <ul onPointerLeave={() => onPoint('')}>
        {world.categories.map(category => (
          <li key={category.name}>
            <button
              type="button"
              className="explore-topic"
              style={hueOf(category.name)}
              aria-pressed={picked === category.name}
              aria-label={`${category.name}, ${category.dots.length} links`}
              onPointerEnter={event => event.pointerType === 'mouse' && onPoint(category.name)}
              onFocus={() => onPoint(category.name)}
              onBlur={() => onPoint('')}
              onClick={() => onPick(category.name)}
            >
              <span className="explore-swatch" aria-hidden="true" />
              <span className="explore-topic-name">{category.short}</span>
              <span className="explore-count">{category.dots.length}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ---------- The small map in the corner ----------

// The whole land, with a rectangle for what you see now. Click or drag on it to go somewhere.
export function MiniMap({ aspect, canvasRef, boxRef, onJump }) {
  const dragging = useRef(false);
  const jump = (event, smooth) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onJump((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height, smooth);
  };
  return (
    <div className="explore-mini" ref={boxRef} style={{ aspectRatio: `${1 / aspect}` }} title="The whole map: click to jump there">
      <canvas
        ref={canvasRef}
        onPointerDown={event => {
          dragging.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          jump(event, true);
        }}
        onPointerMove={event => {
          if (dragging.current) jump(event, false);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        role="img"
        aria-label="Small overview of the whole map"
      />
    </div>
  );
}

// ---------- Zoom buttons ----------

export function ZoomButtons({ controlsRef, engine }) {
  return (
    <div className="explore-zoom" ref={controlsRef} role="group" aria-label="Zoom">
      <button type="button" className="explore-zoom-btn" aria-label="Zoom out" title="Zoom out (−)" onClick={() => engine.current?.zoomBy(1 / 1.8)}>
        <Minus size={18} />
      </button>
      <button type="button" className="explore-zoom-btn" aria-label="Zoom in" title="Zoom in (+)" onClick={() => engine.current?.zoomBy(1.8)}>
        <Plus size={18} />
      </button>
      <button type="button" className="explore-zoom-btn" aria-label="Show the whole map" title="Show the whole map (0)" onClick={() => engine.current?.fitAll()}>
        <Scan size={17} />
      </button>
    </div>
  );
}

// ---------- The card that follows the mouse ----------

// The engine moves it directly (no React drawing while the map moves); React only draws it when another dot is pointed at.
export function HoverTip({ world, tipRef }) {
  const [index, setIndex] = useState(-1);
  const box = useRef(null);
  useImperativeHandle(
    tipRef,
    () => ({
      place(dot, x, y) {
        setIndex(dot);
        const element = box.current;
        if (!element || dot < 0) return;
        // Above the dot, or below it near the top of the screen; never over the edge of the screen.
        const width = element.offsetWidth || 200;
        const parent = element.parentElement.clientWidth;
        const left = Math.min(Math.max(x, width / 2 + 8), parent - width / 2 - 8);
        const below = y < 130;
        element.style.transform = `translate(${left.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, ${below ? '18px' : 'calc(-100% - 18px)'})`;
      },
    }),
    [],
  );
  return (
    <div className="explore-tip" ref={box} hidden={index < 0} aria-hidden="true">
      {index >= 0 && world && (
        <>
          <SiteIcon link={iconLink(world, index)} className="explore-row-icon" />
          <span className="explore-tip-text">
            <strong>{world.titles[index]}</strong>
            <span style={hueOf(world.category[index])}>{categoryStyle(world.category[index]).short}</span>
          </span>
        </>
      )}
    </div>
  );
}

// ---------- The first-time hint ----------

const HINT_KEY = 'kl-explore-hint';

function hintSeen() {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false; // private browsing: it just shows again next time
  }
}

// Shows until your first move on the map, then fades. It's remembered on this device, so it comes only once.
export function useFirstHint() {
  const [hint, setHint] = useState(() => (hintSeen() ? 'off' : 'on'));
  const dismiss = useRef(() => {});
  dismiss.current = () => {
    if (hint !== 'on') return;
    setHint('leaving');
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // private browsing: it just shows again next time
    }
  };
  useEffect(() => {
    if (hint !== 'leaving') return undefined;
    const timer = setTimeout(() => setHint('off'), 400);
    return () => clearTimeout(timer);
  }, [hint]);
  return [hint, () => dismiss.current()];
}

export function FirstHint({ state }) {
  if (state === 'off') return null;
  const touch = window.matchMedia('(pointer: coarse)').matches;
  return <p className={`explore-hint${state === 'leaving' ? ' is-leaving' : ''}`}>{touch ? 'Pinch to zoom · Drag to move · Tap a dot to see what’s related' : 'Scroll to zoom · Drag to move · Click a dot to see what’s related'}</p>;
}
