// A pop-up window built on the browser's own <dialog>: it keeps keyboard focus inside and closes with Esc.
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function Modal({ open, onClose, title, className = '', children, labelledBy }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog.open) {
      dialog.showModal();
      // Put the cursor in the main box (marked data-autofocus) instead of on the close button.
      dialog.querySelector('[data-autofocus]')?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onClick={event => {
        if (event.target === ref.current) onClose(); // a click on the dark background closes it
      }}
    >
      {open && (
        <div className="modal-inner">
          {title && (
            <header className="modal-head">
              <h2 id={labelledBy}>{title}</h2>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
                <X size={20} />
              </button>
            </header>
          )}
          {children}
        </div>
      )}
    </dialog>
  );
}
