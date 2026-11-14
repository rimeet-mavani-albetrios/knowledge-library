// Top bar: library name, theme switch, the owner's buttons, and a small search box once you scroll down.
import { useEffect, useRef, useState } from 'react';
import { Plus, Sun, Moon, Monitor, LogIn, LogOut, Download, Ellipsis, BookmarkPlus, ChartColumn, CopyCheck } from 'lucide-react';
import { LogoMark } from './Icons.jsx';
import EmailMenu from './EmailMenu.jsx';
import { useTheme } from '../hooks.js';
import './header-stats.css';

const THEMES = [
  ['light', Sun, 'Light theme'],
  ['dark', Moon, 'Dark theme'],
  ['system', Monitor, 'Match my device'],
];

function ThemeSwitch() {
  const [choice, setChoice] = useTheme();
  const index = Math.max(0, THEMES.findIndex(([value]) => value === choice));
  const [, CurrentIcon, currentLabel] = THEMES[index];
  const [nextValue, , nextLabel] = THEMES[(index + 1) % THEMES.length];
  return (
    <>
      <div className="segmented theme-switch" role="group" aria-label="Theme">
        {THEMES.map(([value, Icon, label]) => (
          <button key={value} type="button" aria-pressed={choice === value} aria-label={label} title={label} onClick={() => setChoice(value)}>
            <Icon size={17} aria-hidden="true" />
          </button>
        ))}
      </div>
      {/* Phones only have room for one button: each tap moves on to the next theme. */}
      <button
        type="button"
        className="icon-btn theme-cycle"
        aria-label={`${currentLabel}. Tap for ${nextLabel.toLowerCase()}`}
        title={`${currentLabel}. Tap for ${nextLabel.toLowerCase()}`}
        onClick={() => setChoice(nextValue)}
      >
        <CurrentIcon size={18} aria-hidden="true" />
      </button>
    </>
  );
}

function OwnerMenu({ canLogOut, onLogout, onSaveButton, onDuplicates }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = event => !ref.current?.contains(event.target) && setOpen(false);
    // Esc puts the focus back on the ⋯ button, the first button in here.
    const onKey = event => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      ref.current?.querySelector('button')?.focus();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="icon-btn" aria-label="More options" title="More options" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Ellipsis size={20} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSaveButton();
            }}
          >
            <BookmarkPlus size={16} aria-hidden="true" /> Save button for your browser
          </button>
          {/* Links you may have saved twice (Duplicates.jsx) */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDuplicates();
            }}
          >
            <CopyCheck size={16} aria-hidden="true" /> Find duplicates
          </button>
          <p className="menu-label">Download a backup</p>
          <a role="menuitem" href="/api/export?format=json" onClick={() => setOpen(false)}>
            <Download size={16} aria-hidden="true" /> All data (JSON)
          </a>
          <a role="menuitem" href="/api/export?format=csv" onClick={() => setOpen(false)}>
            <Download size={16} aria-hidden="true" /> Spreadsheet (CSV)
          </a>
          <a role="menuitem" href="/api/export?format=html" onClick={() => setOpen(false)}>
            <Download size={16} aria-hidden="true" /> Browser bookmarks (HTML)
          </a>
          <EmailMenu onClose={() => setOpen(false)} />
          {canLogOut && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
            >
              <LogOut size={16} aria-hidden="true" /> Log out
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// "Stats" opens the Stats page (and, while it's open, goes back to the library). Everyone can see it, like the links.
// Resting the mouse on it gets the page ready, so the click shows it at once.
function StatsButton({ open, onClick, onReady }) {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-stats"
      aria-label="Stats"
      aria-pressed={open}
      title={open ? 'Back to your library' : 'Your library in numbers: where your tools come from, what changed'}
      onClick={onClick}
      onPointerEnter={onReady}
      onFocus={onReady}
    >
      <ChartColumn size={17} aria-hidden="true" />
      <span className="hide-small">Stats</span>
    </button>
  );
}

// `search` is the small search box, shown once the big one has scrolled out of sight.
export default function Header({ me, search, onAdd, onLogin, onLogout, onSaveButton, onDuplicates, statsOpen, onStats, onStatsReady }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll(); // the page may open already scrolled down, like after a reload
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`app-header${scrolled ? ' is-scrolled' : ''}${search ? ' has-search' : ''}`}>
      <div className="container header-row">
        <a className="brand" href="/">
          <LogoMark />
          <div className="brand-text">
            <h1>{me?.title ?? 'Knowledge Library'}</h1>
          </div>
        </a>
        {search && <div className="header-search">{search}</div>}
        <div className="header-actions">
          <ThemeSwitch />
          {me?.owner ? (
            <>
              <OwnerMenu canLogOut={me.mode === 'password'} onLogout={onLogout} onSaveButton={onSaveButton} onDuplicates={onDuplicates} />
              <StatsButton open={statsOpen} onClick={onStats} onReady={onStatsReady} />
              <button type="button" className="btn btn-primary btn-add" aria-label="Add links" onClick={onAdd}>
                <Plus size={18} aria-hidden="true" />
                <span className="hide-small">Add links</span>
                <span className="show-small">Add</span>
              </button>
            </>
          ) : (
            <>
              {me ? <StatsButton open={statsOpen} onClick={onStats} onReady={onStatsReady} /> : null}
              {me?.mode === 'password' && (
                <button type="button" className="btn btn-ghost" onClick={onLogin}>
                  <LogIn size={17} aria-hidden="true" /> Log in
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
