// The detail panel that slides in from the right: what the website does, your star, status and note,
// other links that do the same job, then everything else the robot collected (folded), and editing.
// The arrows (or the ← → keys) go through the results without closing the panel.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  X, ExternalLink, Copy, Pencil, RefreshCw, Trash2, Star, Check, Unlink, LoaderCircle, Folder, CircleAlert, ArrowRight,
  Search, FileText, ChevronLeft, ChevronRight, ChevronDown,
} from 'lucide-react';
import { api, toQuery } from '../api.js';
import { CategoryBadge, categoryStyle } from '../categories.jsx';
import { Dropdown } from './Popover.jsx';
import { Preview, FavoriteButton } from './LinkCard.jsx';
import Highlight from './Highlight.jsx';
import { useToast } from './Toasts.jsx';
import { trackLinks, patchLinks, useUpdateLink, useCountOpen } from '../hooks.js';
import {
  compactNumber, fullDate, hostOf, timeAgo, PRICING_LABELS, STATUS_LABELS, LEVEL_LABELS, MY_STATUS_LABELS, isWorking,
} from '../format.js';

const SHOWN_HEADINGS = 10;

// To try / Using / Done. Click the chosen one again to clear it.
function MyStatus({ link, owner }) {
  const update = useUpdateLink();
  if (!owner) return MY_STATUS_LABELS[link.myStatus] ? <span className="pill pill-status">{MY_STATUS_LABELS[link.myStatus]}</span> : null;
  return (
    <div className="segmented segmented-text my-status" role="group" aria-label="Your status">
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

// The section titles of the website: a table of contents of what's on it.
function Headings({ headings, title }) {
  const [all, setAll] = useState(false);
  const list = headings.filter(heading => heading !== title);
  if (!list.length) return null;
  return (
    <section className="drawer-section">
      <h3>What’s on the website</h3>
      <ul className="headings">
        {(all ? list : list.slice(0, SHOWN_HEADINGS)).map(heading => (
          <li key={heading}>{heading}</li>
        ))}
      </ul>
      {list.length > SHOWN_HEADINGS && (
        <button type="button" className="link-btn" onClick={() => setAll(!all)}>
          {all ? 'Show less' : `Show all ${list.length}`}
        </button>
      )}
    </section>
  );
}

function EditForm({ link, categories, onDone }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    title: link.title,
    category: link.category,
    tags: link.tags.join(', '),
    collection: link.collection,
    note: link.note,
    summary: link.summary,
    tasks: link.tasks.join('\n'),
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/links/${link.id}`, { method: 'PATCH', body: { ...form, tags: form.tags.split(','), tasks: form.tasks.split('\n') } }),
    onSuccess: ({ link: saved }) => {
      patchLinks(queryClient, [saved]);
      queryClient.invalidateQueries({ queryKey: ['facets'] });
      toast('Changes saved');
      onDone();
    },
  });
  const field = key => ({ value: form[key], onChange: event => setForm({ ...form, [key]: event.target.value }) });

  return (
    <form
      className="edit-form"
      onSubmit={event => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <label>
        Title
        <input className="input" required maxLength={200} {...field('title')} />
      </label>
      <div className="field-label">
        Category
        <Dropdown
          title="Category"
          className="dropdown-field"
          value={form.category}
          options={categories.map(name => ({ value: name, label: name, Icon: categoryStyle(name).Icon }))}
          onChange={category => setForm({ ...form, category })}
        />
      </div>
      <label>
        Tags <span className="hint">separate with commas</span>
        <input className="input" {...field('tags')} placeholder="video, free, editing" />
      </label>
      <label>
        Collection <span className="hint">optional</span>
        <input className="input" maxLength={80} {...field('collection')} placeholder="Video tools" />
      </label>
      <label>
        Summary
        <textarea className="input" rows={3} maxLength={1000} {...field('summary')} />
      </label>
      <label>
        What you can do with it <span className="hint">one per line, helps search find it</span>
        <textarea className="input" rows={4} {...field('tasks')} placeholder={'convert PDF to Excel\nmerge PDFs'} />
      </label>
      <label>
        Your note <span className="hint">helps search find it</span>
        <textarea className="input" rows={2} maxLength={1000} {...field('note')} placeholder="Why you saved this" />
      </label>
      {save.isError && <p className="form-error">{save.error.message}</p>}
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

// `ids` are the results on screen, in order, so the arrows can go to the one before or after.
// `onNearEnd` loads more results when you reach the last one.
export default function LinkDrawer({ id, q, owner, categories, ids = [], onClose, onOpen, onTag, onNearEnd }) {
  const ref = useRef(null);
  const countOpen = useCountOpen();
  const position = ids.indexOf(id);
  const previous = position > 0 ? ids[position - 1] : null;
  const next = position >= 0 && position < ids.length - 1 ? ids[position + 1] : null;

  useEffect(() => {
    if (position >= 0 && position >= ids.length - 3) onNearEnd?.();
  }, [position, ids.length, onNearEnd]);

  // Each new link starts at the top of the panel.
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [id]);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);

  // With a search, the server also says where its words appear on the website.
  const detail = useQuery({
    queryKey: ['link', id, q],
    queryFn: () => api(`/links/${id}?${toQuery({ q })}`),
    enabled: Boolean(id),
    placeholderData: previous => (previous?.link.id === id ? previous : undefined),
  });
  const link = detail.data?.link;

  useEffect(() => {
    const dialog = ref.current;
    if (id && !dialog.open) dialog.showModal();
    if (!id && dialog.open) dialog.close();
    setEditing(false);
    setConfirmDelete(false);
    // Opening a link counts as using it, so the ones you use most come up first in search.
    if (id && owner) countOpen(id);
  }, [id, owner, countOpen]);

  const refresh = useMutation({
    mutationFn: () => api(`/links/${id}/refresh`, { method: 'POST' }),
    onSuccess: ({ link: queued }) => {
      trackLinks([queued]);
      patchLinks(queryClient, [queued]);
      toast('Reading the page again…');
    },
    onError: error => toast(error.message, 'error'),
  });
  const remove = useMutation({
    mutationFn: () => api(`/links/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['links'] });
      queryClient.invalidateQueries({ queryKey: ['facets'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
      queryClient.invalidateQueries({ queryKey: ['map'] });
      toast('Link deleted');
      onClose();
    },
    onError: error => toast(error.message, 'error'),
  });

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('Couldn’t copy. Select the address and copy it instead.', 'error');
    }
  }

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-label={link ? link.title : 'Link details'}
      onClose={onClose}
      onClick={event => event.target === ref.current && onClose()}
      onKeyDown={event => {
        if (editing || event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.target.closest('input, textarea, select')) return;
        const to = event.key === 'ArrowLeft' ? previous : event.key === 'ArrowRight' ? next : null;
        if (to) {
          event.preventDefault();
          onOpen(to);
        }
      }}
    >
      {id && (
        <div className="drawer-inner">
          <div className="drawer-top">
            {position >= 0 && ids.length > 1 && (
              <div className="drawer-nav">
                <button type="button" className="icon-btn" onClick={() => onOpen(previous)} disabled={!previous} aria-label="Previous result" title="Previous result (←)">
                  <ChevronLeft size={20} />
                </button>
                <button type="button" className="icon-btn" onClick={() => onOpen(next)} disabled={!next} aria-label="Next result" title="Next result (→)">
                  <ChevronRight size={20} />
                </button>
              </div>
            )}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close details">
              <X size={20} />
            </button>
          </div>

          {detail.isLoading && (
            <div className="drawer-loading">
              <LoaderCircle className="spin" size={24} aria-hidden="true" /> Loading…
            </div>
          )}
          {detail.isError && <p className="form-error">{detail.error.message}</p>}

          {link && (
            <>
              <Preview link={link} big />
              <div className="drawer-body">
                <div className="card-meta">
                  <CategoryBadge name={link.category} />
                  {PRICING_LABELS[link.pricing] && <span className="pill">{PRICING_LABELS[link.pricing]}</span>}
                  {LEVEL_LABELS[link.level] && <span className="pill">{LEVEL_LABELS[link.level]}</span>}
                  {isWorking(link) && (
                    <span className="pill pill-accent">
                      <LoaderCircle size={13} className="spin" aria-hidden="true" /> {STATUS_LABELS[link.status]}
                    </span>
                  )}
                </div>
                <h2 className="drawer-title">{link.title}</h2>
                <a className="drawer-url" href={link.url} target="_blank" rel="noopener noreferrer">
                  {hostOf(link.url)}
                  {new URL(link.url).pathname.length > 1 && <span>{new URL(link.url).pathname}</span>}
                </a>

                <div className="drawer-actions">
                  <a className="btn btn-primary" href={link.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={17} aria-hidden="true" /> Open website
                  </a>
                  <button type="button" className="icon-btn" onClick={copyLink} aria-label={copied ? 'Copied' : 'Copy link'} title={copied ? 'Copied' : 'Copy link'}>
                    {copied ? <Check size={18} /> : <Copy size={18} />}
                  </button>
                  <FavoriteButton link={link} owner={owner} className="icon-btn" />
                  {owner && !editing && (
                    <>
                      <button type="button" className="icon-btn" title="Edit" aria-label="Edit" onClick={() => setEditing(true)}>
                        <Pencil size={18} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Read the page again and rewrite the summary"
                        aria-label="Refresh summary"
                        onClick={() => refresh.mutate()}
                        disabled={refresh.isPending || isWorking(link)}
                      >
                        <RefreshCw size={18} />
                      </button>
                      <button type="button" className="icon-btn danger" title="Delete" aria-label="Delete" onClick={() => setConfirmDelete(true)}>
                        <Trash2 size={18} />
                      </button>
                    </>
                  )}
                </div>

                <MyStatus link={link} owner={owner} />

                {confirmDelete && (
                  <div className="confirm" role="alert">
                    <p>Delete this link from your library?</p>
                    <div>
                      <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                        Keep it
                      </button>
                      <button type="button" className="btn btn-danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
                        Delete
                      </button>
                    </div>
                  </div>
                )}

                {editing ? (
                  <EditForm link={link} categories={categories} onDone={() => setEditing(false)} />
                ) : (
                  <>
                    {link.summary && <p className="drawer-summary">{link.summary}</p>}
                    {link.snippet && (
                      <p className="drawer-match">
                        <Search size={15} aria-hidden="true" />
                        <span>
                          <Highlight text={link.snippet} />
                        </span>
                      </p>
                    )}
                    {link.useFor && <p className="drawer-use">{link.useFor}</p>}
                    {owner && link.aiStatus === 'basic' && !isWorking(link) && (
                      <p className="hint-box">This is a basic description from the page. Add a free Groq key to get AI summaries.</p>
                    )}
                    {link.aiStatus === 'pending' && !isWorking(link) && (
                      <p className="hint-box">The free AI is resting. A better summary will be added automatically later.</p>
                    )}
                    {link.status === 'failed' && (
                      <p className="hint-box warn">
                        <CircleAlert size={16} aria-hidden="true" /> The robot couldn’t read this page. Try the refresh button.
                      </p>
                    )}
                    {link.health === 'broken' && (
                      <p className="hint-box warn">
                        <Unlink size={16} aria-hidden="true" /> The page seems to be gone.
                      </p>
                    )}

                    {link.note && (
                      <section className="drawer-section">
                        <h3>Your note</h3>
                        <p className="note">{link.note}</p>
                      </section>
                    )}

                    {link.tasks.length > 0 && (
                      <section className="drawer-section">
                        <h3>What you can do with it</h3>
                        <ul className="tasks">
                          {link.tasks.map(task => (
                            <li key={task}>
                              <ArrowRight size={15} aria-hidden="true" /> {task.charAt(0).toUpperCase() + task.slice(1)}
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}

                    {detail.data.similar.length > 0 && (
                      <section className="drawer-section">
                        <h3>Alternatives in your library</h3>
                        <ul className="similar">
                          {detail.data.similar.map(other => (
                            <li key={other.id}>
                              <button type="button" onClick={() => onOpen(other.id)}>
                                <CategoryBadge name={other.category} />
                                <strong>{other.title}</strong>
                                <span>{other.summary || other.description}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}

                    {link.features.length > 0 && (
                      <section className="drawer-section">
                        <h3>Key features</h3>
                        <ul className="features">
                          {link.features.map(feature => (
                            <li key={feature}>
                              <Check size={16} aria-hidden="true" /> {feature}
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}

                    {link.quickStart?.length > 0 && (
                      <section className="drawer-section">
                        <h3>Quick start</h3>
                        <ol className="steps">
                          {link.quickStart.map(step => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                      </section>
                    )}

                    {(link.overview || link.audience) && (
                      <section className="drawer-section">
                        <h3>Overview</h3>
                        {link.overview && <p className="overview">{link.overview}</p>}
                        {link.audience && (
                          <p className="audience">
                            <strong>Who it’s for:</strong> {link.audience}
                          </p>
                        )}
                      </section>
                    )}

                    {link.tags.length > 0 && (
                      <section className="drawer-section">
                        <h3>Tags</h3>
                        <div className="tag-list">
                          {link.tags.map(tag => (
                            <button key={tag} type="button" onClick={() => onTag(tag)}>
                              #{tag}
                            </button>
                          ))}
                        </div>
                      </section>
                    )}

                    <details className="more-details">
                      <summary>
                        More details <ChevronDown size={16} aria-hidden="true" />
                      </summary>
                      {link.pageLinks?.length > 0 && (
                        <section className="drawer-section">
                          <h3>Important links</h3>
                          <div className="page-links">
                            {link.pageLinks.map(item => (
                              <a key={item.url} href={item.url} target="_blank" rel="noopener noreferrer">
                                {item.label} <ExternalLink size={13} aria-hidden="true" />
                              </a>
                            ))}
                          </div>
                        </section>
                      )}

                      {link.headings && <Headings headings={link.headings} title={link.title} />}

                      <section className="drawer-section">
                        <h3>Details</h3>
                        <dl className="facts">
                          <dt>Added</dt>
                          <dd>{fullDate(link.createdAt)}</dd>
                          {link.collection && (
                            <>
                              <dt>Collection</dt>
                              <dd>
                                <Folder size={14} aria-hidden="true" /> {link.collection}
                              </dd>
                            </>
                          )}
                          {link.siteName && (
                            <>
                              <dt>Website</dt>
                              <dd>{link.siteName}</dd>
                            </>
                          )}
                          {link.opens > 0 && (
                            <>
                              <dt>Opened</dt>
                              <dd>
                                {link.opens} {link.opens === 1 ? 'time' : 'times'}
                                {link.openedAt && `, last ${timeAgo(link.openedAt)}`}
                              </dd>
                            </>
                          )}
                          {link.pagesRead?.length > 0 && (
                            <>
                              <dt>Pages read</dt>
                              <dd className="pages-read">
                                {link.pagesRead.map(page => (
                                  <a key={page.url} href={page.url} target="_blank" rel="noopener noreferrer">
                                    <FileText size={13} aria-hidden="true" /> {page.label || page.title}
                                  </a>
                                ))}
                              </dd>
                            </>
                          )}
                          {link.searchWords?.length > 0 && (
                            <>
                              <dt>Also found by</dt>
                              <dd className="muted-words">{link.searchWords.join(', ')}</dd>
                            </>
                          )}
                          {link.github && (
                            <>
                              <dt>GitHub</dt>
                              <dd>
                                <Star size={14} aria-hidden="true" /> {compactNumber(link.github.stars)} stars
                                {link.github.language && ` · ${link.github.language}`}
                                {link.github.license && ` · ${link.github.license}`}
                              </dd>
                              {link.github.pushedAt && (
                                <>
                                  <dt>Last update</dt>
                                  <dd>{timeAgo(link.github.pushedAt)}</dd>
                                </>
                              )}
                            </>
                          )}
                        </dl>
                      </section>
                    </details>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </dialog>
  );
}
