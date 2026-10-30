// The weekly email's lines in the ⋯ menu: the on/off switch and "Send test email". Only the owner sees the menu.
// Until a Resend key is set up on the server, both lines are greyed out with a hint.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Send } from 'lucide-react';
import { api } from '../api.js';
import { useToast } from './Toasts.jsx';
import './email-menu.css';

const KEY = ['email-settings'];

export default function EmailMenu({ onClose }) {
  const toast = useToast();
  const client = useQueryClient();
  const settings = useQuery({ queryKey: KEY, queryFn: () => api('/email/settings') });
  const ready = Boolean(settings.data?.ready);
  const on = Boolean(settings.data?.on);

  const turn = useMutation({
    mutationFn: next => api('/email/settings', { method: 'POST', body: { on: next } }),
    // The switch moves at once; it moves back if the server says no.
    onMutate: next => {
      const before = client.getQueryData(KEY);
      client.setQueryData(KEY, old => ({ ...old, on: next }));
      return before;
    },
    onSuccess: data => {
      client.setQueryData(KEY, data);
      toast(data.on ? { title: 'Weekly email on', description: 'It comes every Monday morning.' } : { title: 'Weekly email off', tone: 'info' });
    },
    onError: (err, next, before) => {
      client.setQueryData(KEY, before);
      toast(err.message, 'error');
    },
  });

  // The menu closes, and a message says how it went.
  const sendTest = async () => {
    onClose();
    const sending = toast({ title: 'Sending a test email…', tone: 'info', duration: 0 });
    try {
      const sent = await api('/email/test', { method: 'POST' });
      toast.dismiss(sending);
      toast({ title: 'Test email sent', description: `To ${sent.to}. It can take a minute. Check spam too.`, duration: 7000 });
    } catch (err) {
      toast.dismiss(sending);
      toast(err.message, 'error');
    }
  };

  return (
    <>
      <p className="menu-label">Weekly email</p>
      <button
        type="button"
        role="menuitemcheckbox"
        className="email-menu-switch"
        aria-checked={on}
        disabled={!ready || turn.isPending}
        onClick={() => turn.mutate(!on)}
      >
        <Mail size={16} aria-hidden="true" />
        <span className="email-menu-text">
          Weekly email
          <small>{ready ? 'Every Monday morning' : settings.isPending ? 'Checking…' : 'Needs a Resend key first'}</small>
        </span>
        <span className="email-menu-track" aria-hidden="true">
          <span />
        </span>
      </button>
      <button type="button" role="menuitem" disabled={!ready} onClick={sendTest}>
        <Send size={16} aria-hidden="true" /> Send test email
      </button>
    </>
  );
}
