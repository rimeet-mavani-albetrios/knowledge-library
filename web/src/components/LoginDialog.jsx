// Owner login.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Modal from './Modal.jsx';
import { api } from '../api.js';

export function LoginForm({ onDone }) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api('/login', { method: 'POST', body: { password } }),
    onSuccess: () => {
      setPassword('');
      queryClient.invalidateQueries();
      onDone?.();
    },
  });

  return (
    <form
      className="login-form"
      onSubmit={event => {
        event.preventDefault();
        login.mutate();
      }}
    >
      <label>
        Owner password
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          autoFocus
          data-autofocus
          required
          value={password}
          onChange={event => setPassword(event.target.value)}
        />
      </label>
      {login.isError && <p className="form-error">{login.error.message}</p>}
      <button type="submit" className="btn btn-primary" disabled={login.isPending}>
        {login.isPending ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  );
}

export default function LoginDialog({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title="Log in" labelledBy="login-title" className="login-dialog">
      <p className="hint">Log in to add, edit and delete links.</p>
      <LoginForm onDone={onClose} />
    </Modal>
  );
}
