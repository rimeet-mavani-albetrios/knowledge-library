// The one way a list opens up: a "Show all 36 countries" button (<SeeMore>) and the part that slides open under it
// (<Reveal>). Every list uses these two, so opening more looks and feels the same everywhere.
// <MoreLink> is the same pill for a button that goes somewhere else instead ("Show all 31 in the library"), with an
// arrow in place of the chevron; give it your own icon for something else ("Show others").
import { ArrowRight, ChevronDown } from 'lucide-react';
import './see-more.css';

// more: the words while closed. less: the words while open. controls: the id of the part it opens.
export function SeeMore({ open, more, less = 'Show fewer', onClick, controls, className = '' }) {
  return (
    <button
      type="button"
      className={`see-more${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onClick}
    >
      <span>{open ? less : more}</span>
      <ChevronDown size={15} aria-hidden="true" className="see-more-chevron" />
    </button>
  );
}

export function MoreLink({ onClick, icon: Icon = ArrowRight, className = '', children }) {
  return (
    <button type="button" className={`see-more${className ? ` ${className}` : ''}`} onClick={onClick}>
      <span>{children}</span>
      <Icon size={15} aria-hidden="true" className="see-more-chevron" />
    </button>
  );
}

// The part that opens: it grows to its real height smoothly, and nothing inside can be reached while it's closed.
export function Reveal({ open, id, className = '', children }) {
  return (
    <div id={id} className={`reveal${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`} inert={!open}>
      <div className="reveal-inner">{children}</div>
    </div>
  );
}
