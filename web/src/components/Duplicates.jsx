// "Find duplicates" (the owner's ••• menu): links you may have saved twice, in three kinds of groups:
//   Same page:    one page saved under two addresses (ad codes on one, youtu.be and youtube.com, a GitHub folder)
//   Same website: several pages of one website (its home page and its pricing page). GitHub, YouTube, shops and
//                 the like are left out: there every page is a different thing.
//   Same name:    two links with the same name on different websites ("Gupshup" on gupshup.io and gupshup.ai)
// For each group: "Keep both" (it's fine: the group stops showing), "Delete" one, or "Merge into this one" (the
// others' tags, notes, collection, star and opens move onto it, then the others are deleted).
// Nothing is deleted without asking first. The groups come from server/duplicates.js.
// Inside a <dialog>, so every "show this or nothing" is written `cond ? (…) : null`, never `cond && …`.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Combine, Copy, ExternalLink, Globe, LoaderCircle, RotateCcw, Star, Trash2, Type } from 'lucide-react';
import Modal from './Modal.jsx';
import { SiteIcon } from './LinkCard.jsx';
import { useToast } from './Toasts.jsx';
import { useConfirm } from './Confirm.jsx';
import { api } from '../api.js';
import { forgetLinks } from '../compare.js';
import { hueOf } from '../categories.jsx';
import { fullDate, fullDateTime, hostOf } from '../format.js';
import './duplicates.css';

const KINDS = [
  { value: 'page', label: 'Same page', short: 'Page', Icon: Copy, hint: 'The same page, saved under two addresses.' },
  {
    value: 'site',
    label: 'Same website',
    short: 'Website',
    Icon: Globe,
    hint: 'Pages of one website. GitHub, YouTube, shops and the like are left out: there every page is its own thing.',
  },
  { value: 'title', label: 'Same name', short: 'Name', Icon: Type, hint: 'Links with the same name at different addresses.' },
];

const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;

// "wati.io/pricing" — the address without https:// and www., to tell pages of one website apart.
function shortAddress(url) {
  try {
    const { hostname, pathname, search } = new URL(url);
    return `${hostname.replace(/^www\./, '')}${pathname === '/' ? '' : pathname}${search}`;
  } catch {
    return url;
  }
}

// One link in a group: icon, name (with its star), address, when it was added, how often you opened it.
function DupRow({ link, busy, onMerge, onDelete }) {
  const opens = link.opens ? `Opened ${link.opens === 1 ? 'once' : `${link.opens} times`}` : 'Never opened';
  return (
    <li className="dup-row" style={hueOf(link.category)}>
      <SiteIcon link={link} className="row-icon dup-icon" />
      <div className="dup-text">
        <p className="dup-name">
          <span className="dup-title">{link.title || hostOf(link.url)}</span>
          {link.favorite ? (
            <span className="star-btn is-on dup-star" title="A favorite">
              <Star size={15} aria-hidden="true" />
              <span className="sr-only">A favorite</span>
            </span>
          ) : null}
        </p>
        <a className="dup-url" href={link.url} target="_blank" rel="noopener noreferrer" title={`Open ${hostOf(link.url)} in a new tab`}>
          <span>{shortAddress(link.url)}</span>
          <ExternalLink size={12} aria-hidden="true" />
        </a>
        <p className="dup-meta">
          <span title={fullDateTime(link.createdAt)}>Added {fullDate(link.createdAt)}</span>
          <span>{opens}</span>
          {link.collection ? <span>{link.collection}</span> : null}
        </p>
      </div>
      <div className="dup-actions">
        <button type="button" className="btn btn-ghost dup-merge" disabled={busy} onClick={() => onMerge(link)}>
          <Combine size={15} aria-hidden="true" /> Merge into this one
        </button>
        <button
          type="button"
          className="icon-btn icon-btn-sm danger"
          disabled={busy}
          aria-label={`Delete ${link.title}`}
          title="Delete this link"
          onClick={() => onDelete(link)}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

function Group({ group, busy, onKeep, onMerge, onDelete }) {
  const { Icon } = KINDS.find(kind => kind.value === group.kind);
  const many = group.links.length;
  return (
    <section className={`dup-group${busy ? ' is-busy' : ''}`} aria-label={group.label} aria-busy={busy || undefined}>
      <header className="dup-group-head">
        <Icon size={16} className="dup-group-icon" aria-hidden="true" />
        <h3 className="dup-group-title" title={group.label}>
          {group.kind === 'title' ? `“${group.label}”` : group.label}
        </h3>
        <span className="dup-group-count">{plural(many, 'link')}</span>
        {busy ? <LoaderCircle size={16} className="spin dup-group-spin" aria-hidden="true" /> : null}
        <button type="button" className="btn btn-ghost dup-keep" disabled={busy} onClick={() => onKeep(group)} title="They’re fine as they are: stop showing this group">
          {many === 2 ? 'Keep both' : `Keep all ${many}`}
        </button>
      </header>
      <ul className="dup-rows">
        {group.links.map(link => (
          <DupRow key={link.id} link={link} busy={busy} onMerge={keep => onMerge(group, keep)} onDelete={link => onDelete(group, link)} />
        ))}
      </ul>
    </section>
  );
}

// The same boxes as the loaded window (the tabs, then the groups), so nothing moves when the groups arrive.
function SkeletonGroups() {
  return (
    <>
      <span className="skeleton dup-skeleton-tabs" aria-hidden="true" />
      <div className="dup-scroll" aria-hidden="true">
        <span className="skeleton dup-skeleton-hint" />
        <div className="dup-list">
          {[0, 1].map(n => (
            <div key={n} className="dup-group">
              <span className="skeleton dup-skeleton-head" />
              {[0, 1].map(row => (
                <div key={row} className="dup-row">
                  <span className="skeleton row-icon dup-icon" />
                  <span className="dup-text">
                    <span className="skeleton skeleton-text" />
                    <span className="skeleton skeleton-text short" />
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default function Duplicates({ open, onClose }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [picked, setPicked] = useState(''); // the tab you chose; '' = the first one with groups in it
  const [busy, setBusy] = useState(''); // the group being changed right now
  const list = useQuery({ queryKey: ['duplicates'], queryFn: () => api('/duplicates'), enabled: open, staleTime: 0 });

  const [order, setOrder] = useState(null); // once you've changed something: group key → its place in the list

  const groups = list.data?.groups ?? [];
  const counts = list.data?.counts ?? { page: 0, site: 0, title: 0 };
  const total = counts.page + counts.site + counts.title;

  // Each time it opens: the groups in the server's order again, and your tab, unless nothing is left in it.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setOrder(null);
      if (picked && !counts[picked]) setPicked('');
    }
  }

  const kind = picked || KINDS.find(option => counts[option.value] > 0)?.value || 'page';
  // The list holds still while you work through it: the server puts the biggest groups first, but a group that just
  // lost a link stays where it is until the window opens again, instead of jumping away from under your mouse.
  const place = group => order?.get(group.key) ?? Infinity;
  const shown = groups.filter(group => group.kind === kind);
  if (order) shown.sort((a, b) => place(a) - place(b));
  const current = KINDS.find(option => option.value === kind);

  // Does one change, then gets the groups again (counts and all), and tells the rest of the page.
  // This tab stays chosen, also when its last group goes: "Nothing left here", not a jump to another tab.
  async function change(group, work, done, { linksChanged = true } = {}) {
    setPicked(group.kind);
    setOrder(known => known ?? new Map(groups.map((item, i) => [item.key, i])));
    setBusy(group.key);
    try {
      await work();
      if (linksChanged) {
        queryClient.invalidateQueries({ queryKey: ['links'] });
        queryClient.invalidateQueries({ queryKey: ['facets'] });
        queryClient.invalidateQueries({ queryKey: ['me'] });
        queryClient.invalidateQueries({ queryKey: ['map'] });
        queryClient.invalidateQueries({ queryKey: ['saved-check'] });
      }
      await queryClient.invalidateQueries({ queryKey: ['duplicates'] });
      toast(done);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy('');
    }
  }

  function keep(group) {
    const ids = group.links.map(link => link.id);
    change(group, () => api('/duplicates/keep', { method: 'POST', body: { key: group.key, ids } }), 'Kept. This group won’t show here again.', {
      linksChanged: false,
    });
  }

  async function remove(group, link) {
    const sure = await confirm({
      title: 'Delete this link?',
      message: `“${link.title}” (${shortAddress(link.url)}) will be removed from your library. This can’t be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!sure) return;
    change(
      group,
      async () => {
        await api(`/links/${link.id}`, { method: 'DELETE' });
        forgetLinks([link.id]); // it leaves your compare picks and recent comparisons too
        queryClient.removeQueries({ queryKey: ['link', link.id] });
      },
      'Link deleted',
    );
  }

  async function merge(group, target) {
    const others = group.links.filter(link => link.id !== target.id);
    const what = others.length === 1 ? `“${others[0].title}” (${shortAddress(others[0].url)})` : `The other ${others.length} links`;
    const sure = await confirm({
      title: `Merge into “${target.title}”?`,
      message: `${what} will be deleted. Their tags, notes, collection, star and opens move onto “${target.title}” first. This can’t be undone.`,
      confirmLabel: 'Merge',
      danger: true,
    });
    if (!sure) return;
    change(
      group,
      async () => {
        await api('/duplicates/merge', { method: 'POST', body: { keep: target.id, ids: others.map(link => link.id) } });
        forgetLinks(others.map(link => link.id)); // they leave your compare picks and recent comparisons too
        for (const link of others) queryClient.removeQueries({ queryKey: ['link', link.id] });
        queryClient.invalidateQueries({ queryKey: ['link', target.id] });
      },
      `Merged into “${target.title}”`,
    );
  }

  let body;
  if (list.isPending) {
    body = <SkeletonGroups />;
  } else if (list.isError) {
    body = (
      <div className="dup-empty" role="alert">
        <p>{list.error.message}</p>
        <button type="button" className="btn btn-ghost" onClick={() => list.refetch()}>
          <RotateCcw size={15} aria-hidden="true" /> Try again
        </button>
      </div>
    );
  } else if (!total) {
    body = (
      <div className="dup-empty is-clear">
        <span className="dup-empty-mark" aria-hidden="true">
          <CircleCheck size={26} />
        </span>
        <h3>No duplicates left</h3>
        <p>Every link in your library is its own thing. If you save a page twice later, it shows up here.</p>
      </div>
    );
  } else {
    body = (
      <>
        <div className="segmented segmented-text dup-tabs" role="group" aria-label="Kind of duplicates">
          {KINDS.map(option => (
            <button key={option.value} type="button" aria-pressed={kind === option.value} onClick={() => setPicked(option.value)}>
              <option.Icon size={15} aria-hidden="true" />
              <span className="dup-tab-long">{option.label}</span>
              <span className="dup-tab-short">{option.short}</span>
              <span className="dup-tab-count">{counts[option.value]}</span>
            </button>
          ))}
        </div>
        {/* Only this part scrolls: the title, the × and the tabs stay in view. A new tab starts at its top. */}
        <div className="dup-scroll" key={kind}>
          <p className="dup-hint">{current.hint}</p>
          {shown.length ? (
            <div className="dup-list">
              {shown.map(group => (
                <Group key={group.key} group={group} busy={busy === group.key} onKeep={keep} onMerge={merge} onDelete={remove} />
              ))}
            </div>
          ) : (
            <div className="dup-empty is-clear is-small">
              <CircleCheck size={20} aria-hidden="true" />
              <p>Nothing left here.</p>
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Find duplicates"
      description="Links you may have saved twice. Keep both, delete one, or merge them into one. Nothing is deleted without asking you first."
      size="lg"
      className="dup-dialog"
    >
      {body}
    </Modal>
  );
}
