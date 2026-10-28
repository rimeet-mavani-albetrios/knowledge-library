// Small windows that open from a button: our own dropdown menus (Sort, Collection) and the Filters panel.
// On big screens they hang under their button. On phones they slide up from the bottom of the screen
// (a "sheet") with the page dimmed behind. Click outside or press Esc to close.
// They look the same on every computer and phone, unlike the browser's own <select> dropdowns.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';

// `anchor` is the button that opens it: clicks on it don't count as "outside", and Esc gives it the focus back.
// `focusFirst` (a CSS selector) is what gets the focus when it opens.
export function Popover({ open, onClose, anchor, label, role, className = '', focusFirst, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (open && focusFirst) ref.current?.querySelector(focusFirst)?.focus({ preventScroll: true });
  }, [open, focusFirst]);
  useEffect(() => {
    if (!open) return;
    const outside = event => {
      if (ref.current?.contains(event.target) || anchor.current?.contains(event.target)) return;
      onClose();
    };
    const onKey = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
      anchor.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return (
    <>
      <div className="sheet-backdrop" aria-hidden="true" />
      <div ref={ref} className={`popover ${className}`} role={role} aria-label={role ? label : undefined}>
        {/* Only phones show this title bar, where the popover is a sheet at the bottom of the screen. */}
        <div className="sheet-head">
          <span>{label}</span>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

// Our own dropdown: a button with the current choice, and a list to pick from.
// Keys: ↓ or Enter opens it, ↑ ↓ move, Enter picks, Esc closes.
// `options` are [{ value, label, short?, Icon?, count? }]; `title` names the list ("Sort by").
// `short` is shown on the button on phones.
export function Dropdown({ title, value, options, onChange, icon: ButtonIcon, className = '' }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const button = useRef(null);
  const list = useRef(null);
  const current = options.find(option => option.value === value) ?? options[0];

  // Opening puts the focus on the chosen option, so ↑ ↓ start from there.
  useEffect(() => {
    if (!open) return;
    const items = list.current?.querySelectorAll('[role="option"]') ?? [];
    (list.current?.querySelector('[aria-selected="true"]') ?? items[0])?.focus({ preventScroll: true });
  }, [open]);

  const pick = next => {
    setOpen(false);
    button.current?.focus();
    if (next !== value) onChange(next);
  };

  const onListKey = event => {
    const items = [...list.current.querySelectorAll('[role="option"]')];
    const index = items.indexOf(document.activeElement);
    const to = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 }[event.key];
    if (to !== undefined) {
      event.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className={`dropdown ${className}`}>
      <button
        ref={button}
        type="button"
        className={`tool-btn${open ? ' is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${title}: ${current.label}`}
        title={`${title}: ${current.label}`}
        onClick={() => setOpen(!open)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {ButtonIcon && <ButtonIcon size={16} aria-hidden="true" className="tool-icon" />}
        <span className="tool-label">
          {current.short ? (
            <>
              <span className="hide-small">{current.label}</span>
              <span className="show-small">{current.short}</span>
            </>
          ) : (
            current.label
          )}
        </span>
        <ChevronDown size={15} aria-hidden="true" className="tool-chevron" />
      </button>
      <Popover open={open} onClose={close} anchor={button} label={title} className="menu-pop">
        <div ref={list} role="listbox" aria-label={title} onKeyDown={onListKey}>
          {options.map(({ value: optionValue, label, Icon, count }) => (
            <button
              key={optionValue}
              type="button"
              role="option"
              aria-selected={optionValue === value}
              className="menu-option"
              onClick={() => pick(optionValue)}
            >
              {Icon && <Icon size={16} aria-hidden="true" className="menu-icon" />}
              <span className="menu-text">{label}</span>
              {count !== undefined && <span className="menu-count">{count}</span>}
              <Check size={16} aria-hidden="true" className="menu-check" />
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}
