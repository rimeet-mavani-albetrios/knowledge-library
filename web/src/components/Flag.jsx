// A country's flag next to its name: <Flag code="IN" /> → 🇮🇳, or a small "IN" label on computers that can't draw
// flag emoji (Windows shows them as two plain letters). Hidden from screen readers: the name next to it says it.
import { countryFlag } from './country-names.js';
import './flag.css';

export default function Flag({ code, className = '' }) {
  if (!/^[A-Z]{2}$/.test(code ?? '')) return null;
  const emoji = countryFlag(code);
  return (
    <span className={`${emoji ? 'flag-emoji' : 'flag-pill'} ${className}`.trim()} aria-hidden="true">
      {emoji || code}
    </span>
  );
}
