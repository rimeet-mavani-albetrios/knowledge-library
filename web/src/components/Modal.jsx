// A pop-up window built on the browser's own <dialog>: it keeps keyboard focus inside and closes with Esc.
// It lives in the browser's "top layer", so a second one (an "are you sure?" question) opens above the first.
// Props: open, onClose, title, description (a line under the title), size 'sm' | 'md' | 'lg', className,
// labelledBy (the id of your own heading when you don't pass a title), children.
// `instant` swaps the window in and out without the fade (going straight from one window to another).
// Mark the box that should get the cursor with data-autofocus.
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import './modal.css';

const CLOSE_MS = 160; // the fade-out time (modal.css)

export default function Modal({ open, onClose, title, description, size = 'md', className = '', children, labelledBy, instant = false }) {
  const ref = useRef(null);
  const pressedBackdrop = useRef(false); // the click that closes must start AND end on the dark background
  // The content is on the page: while open, and while it fades out. Set during the render that opens, and taken
  // away only once the fade is over, so the content is never thrown away and drawn again fresh as it starts to
  // fade (the fading window showed a reset copy of itself: an empty list, a blank form).
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  const ids = useId();
  const titleId = labelledBy ?? (title ? `${ids}-title` : undefined);
  const descId = description ? `${ids}-desc` : undefined;

  // Before the screen is drawn, so a window swapped for another (see `instant`) never leaves a frame in between.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (open) {
      dialog.classList.remove('is-closing');
      if (!dialog.open) {
        dialog.showModal();
        // Put the cursor in the main box (marked data-autofocus) instead of on the close button.
        dialog.querySelector('[data-autofocus]')?.focus();
      }
      return undefined;
    }
    if (!dialog.open || instant) {
      if (dialog.open) dialog.close();
      setPresent(false);
      return undefined;
    }
    dialog.classList.add('is-closing');
    const timer = setTimeout(() => {
      dialog.classList.remove('is-closing');
      if (dialog.open) dialog.close();
      setPresent(false);
    }, CLOSE_MS);
    return () => clearTimeout(timer);
    // `instant` is read when `open` changes; it never starts a change by itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`modal modal-${size} ${className}${instant ? ' is-instant' : ''}`}
      aria-labelledby={titleId}
      aria-describedby={descId}
      onClose={onClose}
      onCancel={event => {
        // Esc: close through onClose so the window fades out like the other ways of closing.
        event.preventDefault();
        onClose();
      }}
      onPointerDown={event => {
        pressedBackdrop.current = event.target === ref.current;
      }}
      onClick={event => {
        // A click on the dark background closes it. Selecting text and letting go outside the window does not.
        if (pressedBackdrop.current && event.target === ref.current) onClose();
      }}
    >
      {present ? (
        <div className="modal-inner">
          {title && (
            <header className="modal-head">
              <div className="modal-titles">
                <h2 id={titleId}>{title}</h2>
                {description && (
                  <p id={descId} className="modal-desc">
                    {description}
                  </p>
                )}
              </div>
              <button type="button" className="icon-btn modal-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
                <X size={20} aria-hidden="true" />
              </button>
            </header>
          )}
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
