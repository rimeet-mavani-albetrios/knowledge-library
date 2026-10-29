// Our own tooltips in place of the browser's yellow `title` boxes, for the whole app at once.
// <TooltipLayer /> is mounted once (main.jsx). It watches the page: every `title` attribute it sees becomes
// `data-tip`, so the browser's tooltip can never show. Elements with no visible text and no aria-label (icon
// buttons) get the title as their aria-label, so screen readers still hear it.
// Hovering (after a short wait) or keyboard-focusing an element with `data-tip` shows a small dark label above it,
// or below when there is no room. It hides on mouse-out, blur, scroll, Esc and any click.
// Not on touch screens. Nothing shows inside an element marked `data-no-tip`.
// The label is a "manual popover" (the browser's top layer), so it is also seen above open dialog windows.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './tooltip.css';

const DELAY = 400; // ms before a tip shows
const QUICK_FOR = 1000; // ms after a tip hid during which the next one shows at once
const GAP = 8; // space between the element and the tip (the arrow sits in it)
const EDGE = 8; // the least distance to the edge of the screen

export default function TooltipLayer() {
  const ref = useRef(null);

  useEffect(() => {
    const tip = ref.current;
    const text = tip.firstElementChild;
    const coarse = window.matchMedia('(pointer: coarse)');
    const removals = new WeakMap(); // title attributes we took away ourselves, so we don't mistake them for React's
    let anchor = null; // the element the tip is about right now
    let pendingFor = null; // the element waiting for its delay
    let timer = 0;
    let quickUntil = 0;

    // Does this element already have a name for screen readers?
    const named = el => el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') || el.getAttribute('alt') || el.textContent.trim();

    // Move `title` to `data-tip` (and to aria-label when nothing else names the element).
    function convert(el) {
      const title = el.getAttribute('title');
      if (title === null) return;
      removals.set(el, (removals.get(el) ?? 0) + 1);
      el.removeAttribute('title');
      if (!title.trim()) return;
      el.setAttribute('data-tip', title);
      if (el.hasAttribute('data-tip-named') || !named(el)) {
        el.setAttribute('aria-label', title);
        el.setAttribute('data-tip-named', '');
      }
    }

    // React took the title away: forget the tip, and the aria-label if it came from the title.
    function clear(el) {
      el.removeAttribute('data-tip');
      if (el.hasAttribute('data-tip-named')) {
        el.removeAttribute('aria-label');
        el.removeAttribute('data-tip-named');
      }
      if (el === anchor) hide();
    }

    function place() {
      const a = anchor.getBoundingClientRect();
      const r = tip.getBoundingClientRect();
      let top = a.top - r.height - GAP;
      const below = top < EDGE && a.bottom + GAP + r.height <= window.innerHeight - EDGE;
      if (below) top = a.bottom + GAP;
      top = Math.max(EDGE, Math.min(top, window.innerHeight - r.height - EDGE));
      const middle = a.left + a.width / 2;
      const left = Math.max(EDGE, Math.min(middle - r.width / 2, window.innerWidth - r.width - EDGE));
      tip.style.left = `${Math.round(left)}px`;
      tip.style.top = `${Math.round(top)}px`;
      tip.style.setProperty('--arrow-x', `${Math.round(Math.max(12, Math.min(middle - left, r.width - 12)))}px`);
      tip.classList.toggle('is-below', below);
    }

    function show(el) {
      clearTimeout(timer);
      timer = 0;
      pendingFor = null;
      const moving = Boolean(anchor); // from one element straight to the next: no fade again
      anchor = el;
      text.textContent = el.getAttribute('data-tip');
      if (!moving) {
        tip.classList.remove('is-on');
        tip.hidden = false;
        try {
          tip.showPopover?.();
        } catch {
          // Not in the top layer, then: it is a fixed box on the page instead.
        }
      }
      place(); // measuring also makes the browser notice the hidden look, so adding is-on fades it in
      tip.classList.add('is-on');
    }

    function hide() {
      clearTimeout(timer);
      timer = 0;
      pendingFor = null;
      if (!anchor) return;
      anchor = null;
      quickUntil = Date.now() + QUICK_FOR;
      tip.classList.remove('is-on');
      try {
        tip.hidePopover?.();
      } catch {
        // already hidden
      }
      tip.hidden = true;
    }

    function schedule(el) {
      if (el === anchor || el === pendingFor) return;
      clearTimeout(timer);
      if (anchor || Date.now() < quickUntil) {
        show(el);
        return;
      }
      pendingFor = el;
      timer = setTimeout(() => show(el), DELAY);
    }

    // The tipped element under the pointer or focus, if tips are allowed there.
    const tipped = node => {
      const el = node?.closest?.('[data-tip]');
      return el && !el.closest('[data-no-tip]') ? el : null;
    };

    const onOver = event => {
      if (coarse.matches) return;
      const el = tipped(event.target);
      if (el) schedule(el);
    };
    const onOut = event => {
      const el = tipped(event.target);
      if (!el || el.contains(event.relatedTarget)) return;
      if (el === anchor) hide();
      else if (el === pendingFor) {
        clearTimeout(timer);
        timer = 0;
        pendingFor = null;
      }
    };
    const onFocusIn = event => {
      const el = tipped(event.target);
      if (!el) return;
      let byKeyboard = true;
      try {
        byKeyboard = el.matches(':focus-visible');
      } catch {
        // older browser: show it anyway
      }
      if (byKeyboard) show(el);
    };
    const onFocusOut = event => {
      if (tipped(event.target) === anchor) hide();
    };
    const onKey = event => {
      if (event.key === 'Escape') hide();
    };

    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') {
          const el = record.target;
          if (el.hasAttribute('title')) {
            convert(el);
            if (el === anchor) {
              text.textContent = el.getAttribute('data-tip');
              place();
            }
          } else {
            const ours = removals.get(el) ?? 0;
            if (ours > 0) removals.set(el, ours - 1);
            else clear(el);
          }
          continue;
        }
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1 || node === tip) continue;
          if (node.hasAttribute('title')) convert(node);
          for (const el of node.querySelectorAll('[title]')) convert(el);
        }
      }
      if (anchor && !anchor.isConnected) hide();
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
    for (const el of document.querySelectorAll('[title]')) convert(el);

    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('mousedown', hide, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('scroll', hide, { capture: true, passive: true });
    window.addEventListener('resize', hide);
    coarse.addEventListener?.('change', hide);

    return () => {
      hide();
      observer.disconnect();
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('mousedown', hide, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('scroll', hide, { capture: true });
      window.removeEventListener('resize', hide);
      coarse.removeEventListener?.('change', hide);
    };
  }, []);

  return createPortal(
    <div ref={ref} className="tip" role="tooltip" popover="manual" hidden>
      <span className="tip-text" />
      <span className="tip-arrow" aria-hidden="true" />
    </div>,
    document.body,
  );
}
