// The compare window: a quick verdict on top (CompareVerdict.jsx), then one column per link and one row per fact
// (price, level, what it does, your use…). Small marks point out the cheapest, the easiest, the one you use most
// and the one with the most GitHub stars. Rows where every link is the same fold into one quiet "Same for all"
// line at the end of their section; "Only show differences" hides them too. Phones get their own layout: each row
// lists the links one under another, so you never swipe sideways to see the next one.
// Column heads are CompareHead.jsx: a slim strip with each name stays at the top, and the pictures and buttons sit
// in the first row under it, scrolling away with the facts. The buttons at the right of the tools row are
// CompareActions.jsx.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeDollarSign, Check, ChevronDown, ChevronUp, Flame, Info, Sprout, Star, Trophy, Unlink, X } from 'lucide-react';
import Modal from './Modal.jsx';
import CompareHead, { CompareMedia, PickThisOne } from './CompareHead.jsx';
import CompareActions from './CompareActions.jsx';
import CompareVerdict from './CompareVerdict.jsx';
import { factsSection, useCompareFacts } from './CompareFacts.jsx';
import { api } from '../api.js';
import { CategoryBadge, hueOf } from '../categories.jsx';
import { FavoriteButton, OpenButton, SiteIcon } from './LinkCard.jsx';
import { detailQuery } from './LinkDrawer.jsx';
import { useToast } from './Toasts.jsx';
import { PHONE, useMediaQuery, useUpdateLink } from '../hooks.js';
import { MIN_COMPARE, rememberComparison, removePicks, useComparePicks } from '../compare.js';
import { compactNumber, fullDate, timeAgo, LEVEL_LABELS, MY_STATUS_LABELS, PRICING_LABELS } from '../format.js';
import './compare-window.css';

const SHOWN_ITEMS = 3; // of the "can do" and "key features" lists, before "+N more"
const SUMMARY_LINES = 2;
const NOTE_LINES = 3;

const PRICE_RANK = { free: 0, 'open-source': 0, freemium: 1, paid: 2 };
const LEVEL_RANK = { beginner: 0, intermediate: 1, advanced: 2 };

// The columns that win a row: the lowest (or highest) score, but only when the links really differ
// and at least two of them have a score.
function winners(links, score, highest = false) {
  const scores = links.map(link => (link ? score(link) : undefined));
  const known = scores.filter(value => value !== undefined && value !== null);
  if (known.length < 2) return new Set();
  const best = highest ? Math.max(...known) : Math.min(...known);
  if (known.every(value => value === best)) return new Set();
  return new Set(scores.flatMap((value, i) => (value === best ? [i] : [])));
}

const listText = list => (list ?? []).join(' | ');
const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);
const isEmpty = value => value === undefined || value === null || value === '' || value === false;

// A few items of a list, with "+N more" to see them all. `open` and onToggle belong to the row: every column of a
// row opens together, so the lists stay side by side. One extra item is shown rather than a "+1 more" button.
function ShortList({ items, open, onToggle }) {
  const cut = items.length > SHOWN_ITEMS + 1;
  const shown = cut && !open ? items.slice(0, SHOWN_ITEMS) : items;
  return (
    <>
      <ul className="compare-list">
        {shown.map((item, i) => (
          <li key={`${i}-${item}`}>{capitalize(item)}</li>
        ))}
      </ul>
      {cut ? (
        <button type="button" className="compare-more" aria-expanded={open} onClick={onToggle}>
          {open ? 'Show less' : `+${items.length - SHOWN_ITEMS} more`}
          {open ? <ChevronUp size={14} aria-hidden="true" /> : null}
        </button>
      ) : null}
    </>
  );
}

// Long text cut to a few lines, with "More" when it really is cut (measured, so short text gets no button).
// Like ShortList, the row decides whether it is open.
function ClampText({ text, lines, open, onToggle, className = '' }) {
  const ref = useRef(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const box = ref.current;
    if (open || !box) return undefined;
    const measure = () => setCut(box.scrollHeight > box.clientHeight + 1);
    measure();
    // A wider or narrower column changes where the text breaks.
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [text, lines, open]);
  return (
    <>
      <p ref={ref} className={`compare-clamp${open ? ' is-open' : ''} ${className}`} style={{ '--lines': lines }}>
        {text}
      </p>
      {cut ? (
        <button type="button" className="compare-more" aria-expanded={open} onClick={onToggle}>
          {open ? 'Less' : 'More'}
          {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </button>
      ) : null}
    </>
  );
}

// To try / Using / Done, right in the table (owner only). Click the chosen one again to clear it.
function StatusCell({ link }) {
  const update = useUpdateLink();
  return (
    <div className="segmented segmented-text compare-status" role="group" aria-label={`Your status for ${link.title}`}>
      {Object.entries(MY_STATUS_LABELS).map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={link.myStatus === value}
          onClick={() => update.mutate({ link, changes: { myStatus: link.myStatus === value ? '' : value } })}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// Every row: `value` is what's compared ("same in every column?"), `render(link, ui)` what's shown (`ui` is
// { open, onToggle } for rows that can open), `text` the words for the "Same for all" line, `mark` the winners'
// badge, `short` a value that fits beside the link's name on a phone. A `span` row is one cell across all columns.
// `facts` are the website facts of the links (CompareFacts.jsx), for the "Website facts" section at the end.
function sectionsFor(links, owner, facts) {
  const count = links.length;
  const tagCounts = new Map();
  for (const link of links) for (const tag of new Set(link.tags ?? [])) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  const common = [...tagCounts.keys()].filter(tag => tagCounts.get(tag) === count);
  const otherTags = link => [...new Set(link.tags ?? [])].filter(tag => tagCounts.get(tag) < count);
  const someShare = [...tagCounts.values()].some(n => n > 1 && n < count);
  const onGithub = links.filter(link => link.github).length;
  const anyBroken = links.some(link => link.health === 'broken');

  return [
    {
      title: 'At a glance',
      rows: [
        {
          key: 'price',
          label: 'Price',
          short: true,
          value: link => link.pricing,
          text: link => PRICING_LABELS[link.pricing] ?? link.pricing,
          render: link => PRICING_LABELS[link.pricing] ?? <span className="compare-none">Not known</span>,
          mark: { label: 'Cheapest', Icon: BadgeDollarSign, wins: winners(links, link => PRICE_RANK[link.pricing]) },
        },
        {
          key: 'level',
          label: 'Level',
          short: true,
          value: link => link.level,
          text: link => LEVEL_LABELS[link.level] ?? link.level,
          render: link => LEVEL_LABELS[link.level],
          mark: { label: 'Easiest', Icon: Sprout, wins: winners(links, link => LEVEL_RANK[link.level]) },
        },
        { key: 'category', label: 'Category', short: true, value: link => link.category, render: link => <CategoryBadge name={link.category} /> },
        { key: 'use', label: 'Use it for', value: link => link.useFor, render: link => link.useFor },
        {
          key: 'summary',
          label: 'What it is',
          value: link => link.summary,
          render: (link, ui) => (link.summary ? <ClampText text={link.summary} lines={SUMMARY_LINES} {...ui} /> : null),
        },
      ],
    },
    {
      title: 'What it can do',
      rows: [
        {
          key: 'tasks',
          label: 'Can do',
          value: link => listText(link.tasks),
          text: link => link.tasks.join(', '),
          render: (link, ui) => (link.tasks?.length ? <ShortList items={link.tasks} {...ui} /> : null),
        },
        {
          key: 'features',
          label: 'Key features',
          value: link => listText(link.features),
          text: link => link.features.join(', '),
          render: (link, ui) => (link.features?.length ? <ShortList items={link.features} {...ui} /> : null),
        },
        // The tags every link has, once across the columns…
        common.length > 0 && {
          key: 'tags-common',
          label: 'All have',
          span: true,
          renderAll: () => (
            <div className="compare-tags">
              {common.map(tag => (
                <span key={tag} className="compare-tag is-common">
                  #{tag}
                </span>
              ))}
            </div>
          ),
        },
        // …then each link's own: first the ones only it has, then (quietly) the ones some others have too.
        {
          key: 'tags',
          label: common.length ? 'Other tags' : 'Tags',
          hint: someShare ? 'Grey: others have it too.' : undefined,
          value: link => otherTags(link).sort().join(' | '),
          render: link => {
            const tags = otherTags(link);
            if (!tags.length) return null;
            const only = tags.filter(tag => tagCounts.get(tag) === 1);
            const some = tags.filter(tag => tagCounts.get(tag) > 1);
            return (
              <div className="compare-tags" style={hueOf(link.category)}>
                {only.length ? <span className="compare-tags-lead">Only here</span> : null}
                {only.map(tag => (
                  <span key={tag} className="compare-tag is-only">
                    #{tag}
                  </span>
                ))}
                {some.map(tag => (
                  <span key={tag} className="compare-tag">
                    #{tag}
                  </span>
                ))}
              </div>
            );
          },
        },
      ].filter(Boolean),
    },
    {
      title: 'Your use',
      rows: [
        {
          key: 'status',
          label: 'Your status',
          short: !owner,
          value: link => link.myStatus,
          text: link => MY_STATUS_LABELS[link.myStatus] ?? link.myStatus,
          // Owners always see the row: it's where they set the status.
          always: owner,
          render: link => (owner ? <StatusCell link={link} /> : (MY_STATUS_LABELS[link.myStatus] ?? null)),
        },
        {
          key: 'favorite',
          label: 'Favorite',
          short: true,
          value: link => (link.favorite ? 'yes' : ''),
          text: () => 'Yes',
          always: owner,
          render: link =>
            owner ? (
              <FavoriteButton link={link} owner className="icon-btn compare-star" />
            ) : link.favorite ? (
              <span className="compare-fav">
                <Star size={14} aria-hidden="true" /> Favorite
              </span>
            ) : null,
        },
        {
          key: 'opens',
          label: 'Opened',
          short: true,
          value: link => String(link.opens ?? 0),
          text: link => (link.opens > 0 ? `${link.opens} ${link.opens === 1 ? 'time' : 'times'}` : 'Not yet'),
          render: link =>
            link.opens > 0 ? (
              <>
                {link.opens} {link.opens === 1 ? 'time' : 'times'}
                {link.openedAt ? <span className="compare-sub">last {timeAgo(link.openedAt)}</span> : null}
              </>
            ) : (
              <span className="compare-none">Not yet</span>
            ),
          mark: { label: 'You use most', Icon: Flame, wins: winners(links, link => link.opens, true) },
        },
        { key: 'added', label: 'Added', short: true, value: link => fullDate(link.createdAt), render: link => fullDate(link.createdAt) },
        { key: 'collection', label: 'Collection', short: true, value: link => link.collection, render: link => link.collection },
        {
          key: 'note',
          label: 'Your note',
          value: link => link.note,
          render: (link, ui) => (link.note ? <ClampText text={link.note} lines={NOTE_LINES} className="compare-note" {...ui} /> : null),
        },
        anyBroken && {
          key: 'health',
          label: 'Link check',
          short: true,
          value: link => link.health,
          text: link => (link.health === 'broken' ? 'May be broken' : 'Works'),
          render: link =>
            link.health === 'broken' ? (
              <span className="warn">
                <Unlink size={14} aria-hidden="true" /> May be broken
              </span>
            ) : (
              'Works'
            ),
        },
      ].filter(Boolean),
    },
    // Only worth a section when at least two links are on GitHub: one alone has nothing to be compared with
    // (its stars and language are in its column head).
    onGithub >= 2 && {
      title: 'GitHub',
      rows: [
        {
          key: 'stars',
          label: 'Stars',
          short: true,
          value: link => String(link.github?.stars ?? ''),
          text: link => compactNumber(link.github.stars),
          render: link => (link.github ? compactNumber(link.github.stars) : null),
          mark: { label: 'Most stars', Icon: Star, wins: winners(links, link => link.github?.stars, true) },
        },
        { key: 'language', label: 'Language', short: true, value: link => link.github?.language, render: link => link.github?.language },
        { key: 'license', label: 'License', short: true, value: link => link.github?.license, render: link => link.github?.license },
        {
          key: 'updated',
          label: 'Last update',
          short: true,
          value: link => link.github?.pushedAt,
          text: link => timeAgo(link.github.pushedAt),
          render: link => (link.github?.pushedAt ? timeAgo(link.github.pushedAt) : null),
        },
      ],
    },
    factsSection(links, facts, winners),
  ].filter(Boolean);
}

// Everything the table needs, worked out once per set of links: for each section the rows that differ (and the
// owner's rows that are always there), the rows that are the same for all (one quiet line), each link's wins for
// the quick verdict (the same marks as the table), and how many rows differ.
function buildModel(links, owner, facts) {
  if (!links.length) return null;
  const wins = links.map(() => []);
  let differences = 0;
  const sections = sectionsFor(links, owner, facts).map(section => {
    const rows = [];
    const same = [];
    for (const row of section.rows) {
      if (row.span) {
        rows.push(row);
        continue;
      }
      const values = links.map(link => {
        const value = row.value(link);
        return isEmpty(value) ? '' : value;
      });
      const differs = values.some(value => value !== values[0]);
      if (differs) differences += 1;
      for (const i of row.mark?.wins ?? []) wins[i].push({ key: row.key, label: row.mark.label, Icon: row.mark.Icon });
      if (row.always || differs) rows.push({ ...row, differs });
      else if (values[0] !== '') same.push({ key: row.key, label: row.label, text: row.text ? row.text(links[0]) : String(values[0]) });
      // (nobody has it: no row at all)
    }
    return { title: section.title, rows, same };
  });
  return { sections, wins, differences };
}

const differencesText = n => (n === 0 ? 'No differences' : n === 1 ? '1 difference' : `${n} differences`);

// What a cell shows: the value (or a dash) and, when its column wins the row, the win mark.
function cellContent(row, link, i, ui, content = row.render(link, ui)) {
  return (
    <>
      {isEmpty(content) ? <span className="compare-none">—</span> : content}
      {row.mark?.wins.has(i) ? (
        <span className="compare-mark">
          <row.mark.Icon size={14} aria-hidden="true" /> {row.mark.label}
        </span>
      ) : null}
    </>
  );
}

// "Same for all: Level: Beginner · Collection: Tech". A long value is cut; its tooltip has all of it.
function SameForAll({ items }) {
  return (
    <p className="compare-same-list">
      {items.map(item => (
        <span key={item.key} className="compare-same-item" title={`${item.label}: ${item.text}`}>
          <span className="compare-same-key">{item.label}:</span> {item.text}
        </span>
      ))}
    </p>
  );
}

// ---------- Phones ----------

// The links as small chips above the rows, always in view. One line each: icon and name (tap for the details),
// "Pick this one", the Open arrow and the take-out cross. They keep their size while you scroll: chips that
// changed shape would resize the scrolling box under them and make the rows jump.
function PhoneHeads({ ids, links, owner, aiPickId, onOpenLink, onRemove, onReady, onClose }) {
  const last = ids.length <= MIN_COMPARE;
  return (
    <ul className="compare-chips" aria-label="The links you compare">
      {links.map((link, i) =>
        link ? (
          <li key={ids[i]} className={`compare-chip${link.id === aiPickId ? ' is-ai-pick' : ''}`} style={hueOf(link.category)}>
            <SiteIcon link={link} className="compare-mini-icon" />
            <button
              type="button"
              className="compare-chip-name"
              onClick={() => onOpenLink(link.id)}
              onPointerEnter={() => onReady(link.id)}
              onFocus={() => onReady(link.id)}
              title="Open the details"
            >
              {link.title}
            </button>
            {link.id === aiPickId ? <Trophy size={14} className="compare-chip-trophy" role="img" aria-label="AI pick" /> : null}
            <span className="compare-chip-pick">
              <PickThisOne link={link} owner={owner} onClose={onClose} />
            </span>
            <OpenButton link={link} owner={owner} iconOnly className="btn btn-open compare-chip-open" />
            <button
              type="button"
              className="icon-btn icon-btn-sm compare-chip-remove"
              onClick={() => onRemove(link.id)}
              aria-disabled={last || undefined}
              aria-label={`Remove ${link.title} from the comparison`}
              title={last ? 'Compare needs at least 2 links' : 'Take it out'}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </li>
        ) : (
          <li key={ids[i]} className="compare-chip is-loading" aria-hidden="true">
            <span className="skeleton skeleton-text" />
          </li>
        ),
      )}
    </ul>
  );
}

// One section on a phone: each row's name, then every link's value under it, each starting with the link's icon
// and name. Short values sit beside the name.
function PhoneSection({ section, links, onlyDiff, aiPickIndex, uiFor }) {
  return (
    <section className="compare-psection">
      <h3 className="compare-psection-title">{section.title}</h3>
      {section.rows.map(row =>
        row.span ? (
          <div key={row.key} className="compare-prow">
            <h4 className="compare-prow-label">{row.label}</h4>
            {row.renderAll()}
          </div>
        ) : (
          <div key={row.key} className={`compare-prow${!onlyDiff && row.differs ? ' is-diff' : ''}`}>
            <h4 className="compare-prow-label">
              {row.label}
              {row.hint ? <span className="compare-row-hint">{row.hint}</span> : null}
            </h4>
            <ul className={`compare-lines${row.short ? ' is-short' : ''}`}>
              {links.map((link, i) => {
                const ui = uiFor(row);
                const content = row.render(link, ui);
                // A link without a value: its dash sits beside its name instead of taking a line of its own.
                const classes = [isEmpty(content) && 'is-empty', row.mark?.wins.has(i) && 'is-winner', i === aiPickIndex && 'is-ai-pick'];
                return (
                  <li key={link.id} className={['compare-line', ...classes].filter(Boolean).join(' ')}>
                    <span className="compare-line-who" style={hueOf(link.category)}>
                      <SiteIcon link={link} className="compare-mini-icon" />
                      <span className="compare-line-name">{link.title}</span>
                    </span>
                    <div className="compare-line-value">{cellContent(row, link, i, ui, content)}</div>
                  </li>
                );
              })}
            </ul>
          </div>
        ),
      )}
      {section.same.length ? (
        <div className="compare-pfold">
          <span className="compare-pfold-label">Same for all</span>
          <SameForAll items={section.same} />
        </div>
      ) : null}
    </section>
  );
}

// ---------- The window ----------

// What the window can show at once, before the server answers: the links as the last comparison, the list or a
// details window already has them (a details window also knows its similar links, for "Compare all"). So the
// table is there the moment the window opens, with no skeleton; the server's fresh copy replaces it quietly.
function knownLinks(queryClient, ids, previous, picks) {
  const wanted = new Set(ids);
  const known = new Map();
  const add = link => wanted.has(link?.id) && !known.has(link.id) && known.set(link.id, link);
  for (const link of previous?.items ?? []) add(link);
  for (const [, data] of queryClient.getQueriesData({ queryKey: ['link'] })) {
    add(data?.link);
    for (const link of data?.similar ?? []) add(link);
  }
  for (const [, data] of queryClient.getQueriesData({ queryKey: ['links'] })) {
    for (const page of data?.pages ?? []) for (const link of page.items) add(link);
  }
  // Last, the copies kept with your picks, which may be older (very old picks only kept a name: those wait).
  for (const pick of picks) if (Array.isArray(pick.tags)) add(pick);
  const items = ids.map(id => known.get(id)).filter(Boolean);
  return items.length ? { items } : undefined;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// `ids` are the links to compare (from the address bar, so Back closes the window). onOpenLink(id) shows a link's
// details; onChangeIds(ids) takes a link out (here, or when one is gone from the library). onEditLinks() opens the
// window for adding or swapping links (App's, from the tools row). `q` is the search, for loading details ahead
// the way the details window asks for them. `instant` swaps the window in and out without its fade.
export function CompareWindow({ ids, q, owner, instant = false, onClose, onOpenLink, onChangeIds, onEditLinks }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const picks = useComparePicks();
  const phone = useMediaQuery(PHONE);
  // While the window fades out, the last links stay in it.
  const lastIds = useRef(ids);
  if (ids.length) lastIds.current = ids;
  const shownIds = ids.length ? ids : lastIds.current;
  const key = shownIds.join(',');
  const open = ids.length > 0;
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [answer, setAnswer] = useState(null); // { key, pickId, reason, others }
  const [expanded, setExpanded] = useState(() => new Set()); // the rows opened with "More"
  const [scrolled, setScrolled] = useState(false); // rows pass under the column names: a soft shadow there
  const [flash, setFlash] = useState(null); // { index }: the column just picked in the quick verdict
  const scrollRef = useRef(null);
  const tableRef = useRef(null);
  const latest = useRef(null); // the comparison as last loaded, for "recent comparisons"

  // This component stays mounted while the window is closed, so each opening starts fresh: rows folded again
  // and no shadow (the scrolling box is new, at the top). Switching between the phone and computer layout swaps
  // the scrolling box too.
  const [wasOpen, setWasOpen] = useState(open);
  const [wasPhone, setWasPhone] = useState(phone);
  if (wasOpen !== open || wasPhone !== phone) {
    if (open && !wasOpen) setExpanded(new Set());
    setWasOpen(open);
    setWasPhone(phone);
    setScrolled(false);
  }

  const data = useQuery({
    queryKey: ['compare', key],
    queryFn: () => api(`/compare?ids=${encodeURIComponent(key)}`),
    enabled: shownIds.length > 0,
    placeholderData: previous => knownLinks(queryClient, shownIds, previous, picks),
  });
  const byId = useMemo(() => new Map((data.data?.items ?? []).map(link => [link.id, link])), [data.data]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const links = useMemo(() => shownIds.map(id => byId.get(id) ?? null), [byId, key]);
  // (No links at all, before the first comparison, is not "loaded": there's nothing to work out.)
  const loaded = links.length > 0 && links.every(Boolean);
  const facts = useCompareFacts(key);
  const model = useMemo(() => (loaded ? buildModel(links, owner, facts) : null), [links, loaded, owner, facts]);
  const visible = useMemo(
    () =>
      (model?.sections ?? [])
        .map(section => (onlyDiff ? { ...section, rows: section.rows.filter(row => row.differs), same: [] } : section))
        .filter(section => section.rows.length || section.same.length),
    [model, onlyDiff],
  );

  // A link deleted in the meantime: take it out of the comparison (and the tray), and say so.
  // With fewer than 2 left there's nothing to compare, so the window closes.
  useEffect(() => {
    if (!ids.length || !data.data || data.isPlaceholderData) return;
    const gone = ids.filter(id => !byId.has(id));
    if (!gone.length) return;
    removePicks(gone);
    latest.current = null; // not to be kept in "recent comparisons" with a link that's gone
    const left = ids.filter(id => byId.has(id));
    onChangeIds(left.length >= MIN_COMPARE ? left : []);
    toast({ title: gone.length === 1 ? 'A link is gone' : `${gone.length} links are gone`, description: 'It is no longer in your library.', tone: 'info' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.data, data.isPlaceholderData]);

  // "Recent comparisons" keep each opened comparison once, as it ends (the window closes or the page is left),
  // with the links it ended with. Saving at every change would leave a trail of half-made ones in the list when
  // you add links one by one. The links count once the server's copy is in and every one of them is there.
  useEffect(() => {
    if (open && loaded && !data.isPlaceholderData) latest.current = links;
  }, [open, loaded, data.isPlaceholderData, links]);
  useEffect(() => {
    if (!open) return undefined;
    const save = () => {
      if (latest.current) rememberComparison(latest.current);
      latest.current = null;
    };
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [open]);

  // The quick verdict's highlight of a column fades by itself.
  useEffect(() => {
    if (!flash) return undefined;
    const timer = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(timer);
  }, [flash]);

  const shownAnswer = answer?.key === key ? answer : null;
  const aiPickId = shownAnswer?.pickId ?? null;
  const aiPickIndex = aiPickId ? shownIds.indexOf(aiPickId) : -1;
  const titleOf = id => byId.get(id)?.title ?? 'This one';

  const remove = id => {
    if (shownIds.length <= MIN_COMPARE) return;
    removePicks([id]);
    onChangeIds(shownIds.filter(other => other !== id));
  };
  const ready = id => queryClient.prefetchQuery(detailQuery(id, q));
  const toggleRow = rowKey =>
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  const uiFor = row => ({ open: expanded.has(row.key), onToggle: () => toggleRow(row.key) });

  // A soft shadow under the column names once rows pass beneath them: on a computer when the table's top row
  // gets stuck (the quick verdict above it has gone), on a phone as soon as the rows move under the chips. Only
  // a change of yes/no re-draws. The shadow changes no size, so one plain line is enough: nothing moves the scroll.
  const onScroll = event => {
    const table = tableRef.current;
    const next = event.currentTarget.scrollTop > (phone || !table ? 0 : table.offsetTop);
    if (next !== scrolled) setScrolled(next);
  };

  // A card of the quick verdict: on a computer, bring its column into view and light it up for a moment; on a
  // phone (no columns), open its details.
  const showLink = i => {
    if (phone) {
      onOpenLink(shownIds[i]);
      return;
    }
    const box = scrollRef.current;
    const cells = tableRef.current?.tHead?.rows[0]?.cells;
    if (box && cells?.[i + 1]) {
      const view = box.getBoundingClientRect();
      const cell = cells[i + 1].getBoundingClientRect();
      const left = view.left + cells[0].getBoundingClientRect().width; // the row names cover the left edge
      const shift = cell.left < left ? cell.left - left : cell.right > view.right ? cell.right - view.right : 0;
      if (shift) box.scrollBy({ left: shift, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
    setFlash({ index: i });
  };

  const verdict = model ? (
    <CompareVerdict links={links} wins={model.wins} aiPickId={aiPickId} phone={phone} onSelect={showLink} />
  ) : null;
  const sameMessage = (
    <>
      <Check size={16} aria-hidden="true" /> These links are the same in every row. Turn off “Only show differences” to see them.
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Compare ${shownIds.length} links`}
      description="Side by side. Click a name for its details."
      size="lg"
      className="compare-dialog"
      instant={instant}
    >
      <div className="compare-tools">
        <div className="compare-diff">
          <button type="button" className="compare-switch" role="switch" aria-checked={onlyDiff} onClick={() => setOnlyDiff(!onlyDiff)}>
            <span className="compare-switch-track" aria-hidden="true">
              <span />
            </span>
            Only show differences
          </button>
          {model ? <span className="compare-diff-count">{differencesText(model.differences)}</span> : null}
        </div>
        <CompareActions
          ids={shownIds}
          owner={owner}
          loaded={loaded}
          answer={shownAnswer}
          onAnswer={setAnswer}
          onEdit={onEditLinks}
          onClose={onClose}
        />
      </div>

      {shownAnswer ? (
        <div className="compare-answer" role="status">
          <span className="compare-answer-icon" aria-hidden="true">
            <Trophy size={18} />
          </span>
          <div>
            <p className="compare-answer-pick">
              Best pick: <strong>{titleOf(shownAnswer.pickId)}</strong>
            </p>
            {shownAnswer.reason ? <p>{shownAnswer.reason}</p> : null}
            {shownAnswer.others?.length ? (
              <ul>
                {shownAnswer.others.map(other => (
                  <li key={other.id}>
                    <strong>{titleOf(other.id)}:</strong> {other.when}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="compare-answer-note">
              <Info size={13} aria-hidden="true" /> Written by the free AI from what your library knows. Check before you decide.
            </p>
          </div>
          <button type="button" className="icon-btn icon-btn-sm" onClick={() => setAnswer(null)} aria-label="Hide the AI's answer" title="Hide">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {data.isError && !data.data ? (
        <div className="compare-error" role="alert">
          <p>{data.error.message}</p>
          <button type="button" className="btn btn-ghost" onClick={() => data.refetch()}>
            Try again
          </button>
        </div>
      ) : phone ? (
        <>
          <PhoneHeads
            ids={shownIds}
            links={links}
            owner={owner}
            aiPickId={aiPickId}
            onOpenLink={onOpenLink}
            onRemove={remove}
            onReady={ready}
            onClose={onClose}
          />
          <div ref={scrollRef} className={`compare-scroll compare-phone${scrolled ? ' is-scrolled' : ''}`} onScroll={onScroll} aria-busy={!loaded}>
            {model ? (
              <>
                {verdict}
                {visible.map(section => (
                  <PhoneSection key={section.title} section={section} links={links} onlyDiff={onlyDiff} aiPickIndex={aiPickIndex} uiFor={uiFor} />
                ))}
                {!visible.length ? <p className="compare-same">{sameMessage}</p> : null}
              </>
            ) : (
              <div className="compare-pskeleton" aria-hidden="true">
                {Array.from({ length: 5 }, (_, row) => (
                  <div key={row}>
                    <span className="skeleton skeleton-text short" />
                    <span className="skeleton skeleton-text" />
                    <span className="skeleton skeleton-text" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div
          ref={scrollRef}
          className={`compare-scroll${scrolled ? ' is-scrolled' : ''}`}
          style={{ '--cols': shownIds.length }}
          onScroll={onScroll}
          aria-busy={!loaded}
        >
          {verdict}
          <table ref={tableRef} className="compare-table">
            <thead>
              <tr>
                <th scope="col" className="compare-corner">
                  <span className="sr-only">What</span>
                </th>
                {links.map((link, i) => (
                  <CompareHead
                    key={shownIds[i]}
                    link={link}
                    index={i}
                    count={shownIds.length}
                    aiPick={aiPickId === shownIds[i]}
                    onOpenLink={onOpenLink}
                    onRemove={() => remove(shownIds[i])}
                    onReady={() => ready(shownIds[i])}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {/* The pictures and buttons: an ordinary row, there from the start (its loading shapes too). */}
              <tr className="compare-media-row">
                <th scope="row">
                  <span className="sr-only">Picture and buttons</span>
                </th>
                {links.map((link, i) => (
                  <CompareMedia
                    key={shownIds[i]}
                    link={link}
                    aiPick={aiPickId === shownIds[i]}
                    flash={flash?.index === i}
                    owner={owner}
                    onOpenLink={onOpenLink}
                    onReady={() => ready(shownIds[i])}
                    onClose={onClose}
                  />
                ))}
              </tr>
              {!model
                ? Array.from({ length: 6 }, (_, row) => (
                    <tr key={`s${row}`} aria-hidden="true">
                      <th scope="row">
                        <span className="skeleton skeleton-text short" />
                      </th>
                      {shownIds.map(id => (
                        <td key={id}>
                          <span className="skeleton skeleton-text" />
                        </td>
                      ))}
                    </tr>
                  ))
                : visible.map(section => [
                    <tr key={section.title} className="compare-section">
                      <th scope="colgroup" colSpan={shownIds.length + 1}>
                        <span>{section.title}</span>
                      </th>
                    </tr>,
                    ...section.rows.map(row =>
                      row.span ? (
                        <tr key={row.key} className="compare-span-row">
                          <th scope="row">{row.label}</th>
                          <td colSpan={shownIds.length}>{row.renderAll()}</td>
                        </tr>
                      ) : (
                        <tr key={row.key} className={!onlyDiff && row.differs ? 'is-diff' : undefined}>
                          <th scope="row">
                            {row.label}
                            {row.hint ? <span className="compare-row-hint">{row.hint}</span> : null}
                          </th>
                          {links.map((link, i) => {
                            const classes = [row.mark?.wins.has(i) && 'is-winner', i === aiPickIndex && 'is-ai-pick', flash?.index === i && 'is-flash'];
                            return (
                              <td key={link.id} className={classes.filter(Boolean).join(' ') || undefined}>
                                {cellContent(row, link, i, uiFor(row))}
                              </td>
                            );
                          })}
                        </tr>
                      ),
                    ),
                    section.same.length ? (
                      <tr key={`${section.title}-same`} className="compare-fold">
                        <th scope="row">Same for all</th>
                        <td colSpan={shownIds.length}>
                          <SameForAll items={section.same} />
                        </td>
                      </tr>
                    ) : null,
                  ])}
              {model && !visible.length ? (
                <tr>
                  <td colSpan={shownIds.length + 1} className="compare-same">
                    {sameMessage}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
