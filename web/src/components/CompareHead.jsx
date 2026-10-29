// One column's head in the compare window, in two parts:
// - CompareHead: a slim strip in the table's top row (a <th>) that stays in view while you scroll: the link's
//   icon, name and website (plus stars and language for a GitHub repository), the × to take it out, and a small
//   medal on the icon for the AI's pick. It is always the same size, so nothing moves while you scroll.
// - CompareMedia: a cell in the first row under it, with the preview picture (and the "AI pick" badge) and the
//   buttons (Open, Details, "Pick this one"). It is an ordinary row: it scrolls away with the facts.
// Props (both): `link` (null while it loads), `aiPick` (the AI picked it), `owner`, onOpenLink(id) (details),
// onReady() (load the details ahead when the mouse comes near). CompareHead also: `index` and `count` (its place),
// onRemove() (take it out; not below 2 links). CompareMedia also: `flash` (light up for a moment, picked in the
// quick verdict), onClose() (close the window, for an action that ends the comparison).
import { Check, CircleCheck, Star, Trophy, X } from 'lucide-react';
import { hueOf } from '../categories.jsx';
import { OpenButton, Preview, SiteIcon } from './LinkCard.jsx';
import { useToast } from './Toasts.jsx';
import { useUpdateLink } from '../hooks.js';
import { MIN_COMPARE } from '../compare.js';
import { compactNumber, siteOf } from '../format.js';
import './compare-head.css';

// " · ★ 184K · Python": how popular a repository is and what it's written in, after the website's name.
function GitHubLine({ github }) {
  const hasStars = typeof github.stars === 'number';
  if (!hasStars && !github.language) return null;
  return (
    <>
      {' · '}
      <span className="compare-gh" title={hasStars ? `${github.stars.toLocaleString('en')} stars on GitHub` : undefined}>
        {hasStars ? (
          <>
            <Star size={12} aria-hidden="true" className="compare-gh-star" />
            {compactNumber(github.stars)}
            <span className="sr-only"> stars</span>
          </>
        ) : null}
        {hasStars && github.language ? ' · ' : null}
        {github.language || null}
      </span>
    </>
  );
}

export default function CompareHead({ link, index, count, aiPick, onOpenLink, onRemove, onReady }) {
  if (!link) {
    // The same shapes as a loaded strip (icon, name, website), so nothing moves when it arrives.
    return (
      <th scope="col" className="compare-head is-loading" aria-busy="true">
        <span className="sr-only">Loading</span>
        <div className="compare-head-id" aria-hidden="true">
          <span className="skeleton compare-skeleton-icon" />
          <span className="compare-skeleton-lines">
            <span className="skeleton skeleton-title" />
            <span className="skeleton skeleton-text short" />
          </span>
        </div>
      </th>
    );
  }
  const canRemove = count > MIN_COMPARE;
  return (
    <th
      scope="col"
      className={`compare-head${aiPick ? ' is-ai-pick' : ''}`}
      style={hueOf(link.category)}
      // Screen readers say this column name for every cell below it, so it's the short name, not every button.
      aria-label={aiPick ? `${link.title}, the AI pick` : link.title}
    >
      <div className="compare-head-id">
        <span className="compare-icon-wrap">
          <SiteIcon link={link} className="tile-icon compare-icon" />
          {/* The "AI pick" badge's small twin: the badge is on the picture, which scrolls away. */}
          {aiPick ? (
            <span className="compare-ai-medal" title="AI pick" aria-hidden="true">
              <Trophy size={10} />
            </span>
          ) : null}
        </span>
        <div className="compare-head-text">
          <button
            type="button"
            className="compare-name"
            onClick={() => onOpenLink(link.id)}
            onPointerEnter={onReady}
            onFocus={onReady}
            title={link.title}
          >
            {link.title}
          </button>
          <span className="compare-head-sub">
            <span className="compare-host">{siteOf(link)}</span>
            {link.github ? <GitHubLine github={link.github} /> : null}
          </span>
        </div>
        <button
          type="button"
          className="compare-remove"
          onClick={canRemove ? onRemove : undefined}
          aria-disabled={!canRemove || undefined}
          aria-label={`Take ${link.title} out of the comparison`}
          title={canRemove ? 'Take it out' : 'Compare needs at least 2 links'}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      <span className="sr-only">
        Link {index + 1} of {count}
      </span>
    </th>
  );
}

// The picture and the buttons, in the row under the strip. Every column's picture has the same height
// (--head-pic), so the buttons under them line up across the columns.
export function CompareMedia({ link, aiPick, flash, owner, onOpenLink, onReady, onClose }) {
  if (!link) {
    // The same shapes as a loaded cell (picture, two buttons), so nothing moves when it arrives.
    return (
      <td className="compare-media is-loading" aria-hidden="true">
        <div className="compare-head-media">
          <span className="skeleton compare-skeleton-picture" />
        </div>
        <div className="compare-head-actions">
          <span className="skeleton compare-skeleton-button" />
          <span className="skeleton compare-skeleton-button" />
        </div>
      </td>
    );
  }
  const classes = ['compare-media', aiPick && 'is-ai-pick', flash && 'is-flash'];
  const openDetails = () => onOpenLink(link.id);
  return (
    <td className={classes.filter(Boolean).join(' ')}>
      <div className="compare-head-media">
        <Preview link={link} />
        {aiPick ? (
          <span className="compare-ai-badge">
            <Trophy size={13} aria-hidden="true" /> AI pick
          </span>
        ) : null}
      </div>
      {/* Open and Details on the left, "Pick this one" at the right end: a decision, kept apart from just looking. */}
      <div className="compare-head-actions">
        <OpenButton link={link} owner={owner} />
        <button
          type="button"
          className="btn btn-ghost compare-details"
          onClick={openDetails}
          onPointerEnter={onReady}
          onFocus={onReady}
          aria-label={`Details of ${link.title}`}
        >
          Details
        </button>
        <PickThisOne link={link} owner={owner} onClose={onClose} />
      </div>
    </td>
  );
}

// "Pick this one" (owner only): ends the comparison with a decision. It marks the link as "Using", says so (with Undo),
// and closes the window. A link you already use shows "Using ✓" instead, and nothing closes.
// Also used outside the head (on phones). Props: `link`, `owner`, onClose() (close the window afterwards),
// `className` (optional, to dress it up elsewhere).
export function PickThisOne({ link, owner, onClose, className = '' }) {
  const update = useUpdateLink();
  const toast = useToast();
  if (!owner || !link) return null;

  if (link.myStatus === 'using') {
    return (
      <span className={`compare-pick is-done ${className}`} title={`You already use ${link.title}`}>
        <Check size={14} strokeWidth={2.5} aria-hidden="true" />
        <span className="compare-pick-label">Using</span>
        <span className="sr-only">: you already use {link.title}</span>
      </span>
    );
  }

  const pick = () => {
    const before = link.myStatus ?? '';
    // The window closes straight away, so the error comes from the promise: it still arrives after the close.
    update
      .mutateAsync({ link, changes: { myStatus: 'using' } })
      .catch(error => toast({ title: `Couldn't mark ${link.title} as Using`, description: error.message, tone: 'error' }));
    toast({
      title: `Marked ${link.title} as Using`,
      tone: 'success',
      action: { label: 'Undo', onClick: () => update.mutate({ link: { ...link, myStatus: 'using' }, changes: { myStatus: before } }) },
    });
    onClose();
  };

  return (
    <button
      type="button"
      className={`compare-pick ${className}`}
      onClick={pick}
      aria-label={`Pick ${link.title}: mark it as Using and close the comparison`}
      title="Pick this one: mark it as Using and close"
    >
      <CircleCheck size={15} aria-hidden="true" />
      {/* The long words where there's room, "Pick" in a narrow column, just the check in a very narrow one. */}
      <span className="compare-pick-label">
        <span className="compare-pick-long">Pick this one</span>
        <span className="compare-pick-short">Pick</span>
      </span>
    </button>
  );
}
