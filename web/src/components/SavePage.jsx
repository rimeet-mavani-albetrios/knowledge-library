// The small window that the "Save to library" button opens. It saves the website you were on,
// then shows what the robot found: name, category and tags.
import { useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleCheck, LoaderCircle, CircleAlert, Copy } from 'lucide-react';
import { api } from '../api.js';
import { trackLinks, useTracked, useProgressPolling } from '../hooks.js';
import { CategoryBadge } from '../categories.jsx';
import { LogoMark } from './Icons.jsx';
import { LoginForm } from './LoginDialog.jsx';
import { STATUS_LABELS, hostOf, isWorking } from '../format.js';

function Saved({ link, title, icon }) {
  return (
    <div className="save-result">
      <p className="save-state">
        {icon} {title}
      </p>
      <h1 className="save-title">{link.title}</h1>
      <div className="card-meta">
        <CategoryBadge name={link.category} />
        <span className="card-host">{hostOf(link.url)}</span>
      </div>
      {link.summary && <p className="card-summary">{link.summary}</p>}
      {link.tags.length > 0 && (
        <ul className="card-tags" aria-label="Tags">
          {link.tags.map(tag => (
            <li key={tag}>#{tag}</li>
          ))}
        </ul>
      )}
      <div className="form-actions">
        <a className="btn btn-ghost" href={`/?link=${link.id}`} target="_blank" rel="noopener">
          Open in library
        </a>
        <button type="button" className="btn btn-primary" onClick={() => window.close()}>
          Close
        </button>
      </div>
    </div>
  );
}

export default function SavePage() {
  const url = new URLSearchParams(window.location.search).get('url') ?? '';
  const me = useQuery({ queryKey: ['me'], queryFn: () => api('/me') });
  const owner = Boolean(me.data?.owner);
  const save = useMutation({
    mutationFn: () => api('/links', { method: 'POST', body: { urls: [url] } }),
    onSuccess: data => trackLinks(data.added),
  });
  useProgressPolling();

  // Save once, as soon as we know you're the owner.
  const started = useRef(false);
  useEffect(() => {
    if (owner && url && !started.current) {
      started.current = true;
      save.mutate();
    }
  }, [owner, url, save]);

  const [link] = useTracked(save.data?.added.map(added => added.id) ?? []);
  const duplicate = save.data?.duplicates[0];

  let body;
  if (!url) body = <p>Nothing to save. Click “Save to library” in your bookmarks bar while you’re on a website.</p>;
  else if (me.isLoading) body = <p className="save-state"><LoaderCircle size={18} className="spin" aria-hidden="true" /> Loading…</p>;
  else if (!owner && me.data?.mode === 'password') {
    body = (
      <>
        <p>Log in to save <strong>{hostOf(url)}</strong> to your library.</p>
        <LoginForm />
      </>
    );
  } else if (!owner) body = <p>This library can’t be changed. Set ADMIN_PASSWORD on the server.</p>;
  else if (save.isError) body = <p className="form-error">{save.error.message}</p>;
  else if (save.data?.invalid.length) body = <p className="form-error">This address can’t be saved: {save.data.invalid[0]}</p>;
  else if (duplicate) body = <Saved link={duplicate} title="Already in your library" icon={<Copy size={18} className="warn" aria-hidden="true" />} />;
  else if (link && !isWorking(link)) {
    body =
      link.status === 'failed' ? (
        <Saved link={link} title="Saved, but the robot couldn’t read the page" icon={<CircleAlert size={18} className="bad" aria-hidden="true" />} />
      ) : (
        <Saved link={link} title="Saved to your library" icon={<CircleCheck size={18} className="ok" aria-hidden="true" />} />
      );
  } else {
    body = (
      <div className="save-result">
        <p className="save-state">
          <LoaderCircle size={18} className="spin accent" aria-hidden="true" /> {link ? STATUS_LABELS[link.status] : 'Saving…'}
        </p>
        <h1 className="save-title">{hostOf(url)}</h1>
        <p className="hint">The robot is reading the website and writing its summary and tags. You can close this window.</p>
      </div>
    );
  }

  return (
    <main className="save-page">
      <header className="save-head">
        <LogoMark size={26} />
        <strong>{me.data?.title ?? 'Knowledge Library'}</strong>
      </header>
      {body}
    </main>
  );
}
