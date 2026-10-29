// Short messages in the corner of the screen ("Link deleted", "Copied"), our own instead of the browser's alert().
// Use with `const toast = useToast()`, then either:
//   toast('Changes saved')                         // a plain line (tone 'success')
//   toast("Can't reach the library.", 'error')
//   toast({ title: 'Link deleted', description: 'From "Design".', tone: 'info',
//           action: { label: 'Undo', onClick: () => … }, duration: 6000 })
//   const id = toast(…); toast.dismiss(id)         // close one by hand; duration 0 (or Infinity) keeps it open until closed
// Tones: 'success' | 'error' | 'info' | 'warning'. At most 3 are shown; the oldest goes when a 4th arrives.
// The timer pauses while the mouse (or keyboard focus) is on them.
// The stack is a "manual popover": that puts it in the browser's top layer, so it is seen above open dialog windows
// (the detail window, "Add links"), which would otherwise cover it with their backdrop.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CircleCheck, CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import './toasts.css';

const MAX = 3;
const LEAVE_MS = 220; // the slide-out time (toasts.css)
const ICONS = { success: CircleCheck, error: CircleAlert, info: Info, warning: TriangleAlert };

const ToastContext = createContext(Object.assign(() => '', { dismiss: () => {} }));
export const useToast = () => useContext(ToastContext);

// How long a message stays: errors and warnings a little longer, and longer again when there is a button to click.
function timeFor({ tone, action, duration }) {
  if (duration !== undefined) return duration;
  return (tone === 'error' || tone === 'warning' ? 6000 : 4000) + (action ? 2000 : 0);
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const list = useRef([]); // the same list, readable at once (state is only read on the next render)
  const timers = useRef(new Map()); // id -> { handle, left, started }
  const paused = useRef(false);
  const box = useRef(null);
  const count = useRef(0);

  const api = useMemo(() => {
    const commit = next => {
      list.current = next;
      setToasts(next);
    };
    const remove = id => {
      timers.current.delete(id);
      commit(list.current.filter(toast => toast.id !== id));
    };
    // Slide a message out, then take it away.
    const dismiss = id => {
      const timer = timers.current.get(id);
      if (timer) clearTimeout(timer.handle);
      timers.current.delete(id);
      if (!list.current.some(toast => toast.id === id && !toast.leaving)) return;
      commit(list.current.map(toast => (toast.id === id ? { ...toast, leaving: true } : toast)));
      setTimeout(() => remove(id), LEAVE_MS);
    };
    const arm = (id, left) => {
      const handle = paused.current ? null : setTimeout(() => dismiss(id), left);
      timers.current.set(id, { handle, left, started: Date.now() });
    };
    const pause = () => {
      if (paused.current) return;
      paused.current = true;
      for (const timer of timers.current.values()) {
        clearTimeout(timer.handle);
        timer.handle = null;
        timer.left = Math.max(1000, timer.left - (Date.now() - timer.started)); // at least a second after you leave
      }
    };
    const resume = () => {
      if (!paused.current) return;
      paused.current = false;
      for (const [id, timer] of timers.current) arm(id, timer.left);
    };

    const show = (input, tone) => {
      const given = typeof input === 'object' && input !== null ? input : { title: String(input ?? ''), tone };
      const toast = { ...given, tone: ICONS[given.tone] ? given.tone : 'success' };
      // The same message twice in a row only restarts the first one's timer instead of showing it twice.
      const same = list.current.find(
        other => !other.leaving && !other.action && !toast.action && other.title === toast.title && other.description === toast.description && other.tone === toast.tone,
      );
      if (same) {
        clearTimeout(timers.current.get(same.id)?.handle);
        arm(same.id, timeFor(toast));
        return same.id;
      }
      const id = `t${(count.current += 1)}`;
      const live = list.current.filter(other => !other.leaving);
      for (const old of live.slice(0, Math.max(0, live.length - (MAX - 1)))) dismiss(old.id);
      commit([...list.current, { ...toast, id }]);
      const time = timeFor(toast);
      if (Number.isFinite(time) && time > 0) arm(id, time);
      return id;
    };
    return Object.assign(show, { dismiss, pause, resume });
  }, []);

  // Keep the stack in the top layer while it has something to show. A new message puts it back on top,
  // above any dialog window opened in the meantime (the top layer is stacked in the order things were opened).
  const seen = useRef(0);
  useEffect(() => {
    const el = box.current;
    const grew = toasts.length > seen.current;
    seen.current = toasts.length;
    if (!el || typeof el.showPopover !== 'function') return; // older browser: it stays a fixed box on the page
    try {
      const open = el.matches(':popover-open');
      if (!toasts.length) {
        if (open) el.hidePopover();
      } else if (!open) {
        el.showPopover();
      } else if (grew && !el.contains(document.activeElement)) {
        el.hidePopover();
        el.showPopover();
      }
    } catch {
      // Not in the top layer, then: the fixed position still shows it on the page.
    }
  }, [toasts]);

  const onBlur = useCallback(
    event => {
      if (!event.currentTarget.contains(event.relatedTarget)) api.resume();
    },
    [api],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        ref={box}
        className="toasts"
        role="status"
        aria-live="polite"
        popover="manual"
        data-no-tip
        onMouseEnter={api.pause}
        onMouseLeave={api.resume}
        onFocus={api.pause}
        onBlur={onBlur}
      >
        {toasts.map(toast => (
          <Toast key={toast.id} toast={toast} onDismiss={api.dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ toast, onDismiss }) {
  const Icon = ICONS[toast.tone];
  return (
    <div className={`toast is-${toast.tone}${toast.leaving ? ' is-leaving' : ''}`}>
      <span className="toast-icon" aria-hidden="true">
        <Icon size={17} />
      </span>
      <div className="toast-text">
        <p className="toast-title">{toast.title}</p>
        {toast.description && <p className="toast-desc">{toast.description}</p>}
      </div>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action.onClick?.();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
