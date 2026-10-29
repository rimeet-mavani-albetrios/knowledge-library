// Owner login. The form is also used on the private-library gate page (App.jsx) and the save window (SavePage.jsx).
// Mistakes are shown in our own words under the field (never the browser's own bubble): an empty box,
// a wrong password (the server's message) or no connection. The form gives a little shake, and the eye button
// shows the password while you check it.
import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Eye, EyeOff } from 'lucide-react';
import Modal from './Modal.jsx';
import { api } from '../api.js';
import './login.css';

export function LoginForm({ onDone }) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false); // the password as plain text
  const [missing, setMissing] = useState(false); // submitted with an empty box
  const [shaking, setShaking] = useState(false);
  const input = useRef(null);
  const ids = useId();
  const login = useMutation({
    mutationFn: () => api('/login', { method: 'POST', body: { password } }),
    onSuccess: () => {
      setPassword('');
      queryClient.invalidateQueries();
      onDone?.();
    },
  });

  const error = missing ? 'Type your password.' : login.isError ? login.error.message : '';

  // A wrong password: shake, and put the cursor back on the word so it can be typed over.
  useEffect(() => {
    if (!login.isError) return;
    setShaking(true);
    input.current?.focus();
    input.current?.select();
  }, [login.isError]);

  return (
    <form
      className={`login-form${shaking ? ' is-shaking' : ''}`}
      noValidate
      onAnimationEnd={() => setShaking(false)}
      onSubmit={event => {
        event.preventDefault();
        if (login.isPending) return;
        if (!password) {
          setMissing(true);
          setShaking(true);
          input.current?.focus();
          return;
        }
        login.mutate();
      }}
    >
      <div className="login-field">
        <label htmlFor={`${ids}-password`}>Owner password</label>
        <div className="login-box">
          <input
            ref={input}
            id={`${ids}-password`}
            className="input"
            type={shown ? 'text' : 'password'}
            autoComplete="current-password"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
            data-autofocus
            value={password}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? `${ids}-error` : undefined}
            onChange={event => {
              setPassword(event.target.value);
              setMissing(false);
              if (login.isError) login.reset();
            }}
          />
          <button
            type="button"
            className="icon-btn login-eye"
            onClick={() => setShown(value => !value)}
            aria-pressed={shown}
            aria-label={shown ? 'Hide the password' : 'Show the password'}
            title={shown ? 'Hide the password' : 'Show the password'}
          >
            {shown ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </div>
        {error && (
          <p id={`${ids}-error`} className="field-error" role="alert">
            <CircleAlert size={15} aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
      </div>
      <button type="submit" className="btn btn-primary login-submit" disabled={login.isPending}>
        {login.isPending ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  );
}

export default function LoginDialog({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title="Log in" description="Log in to add, edit and delete links." labelledBy="login-title" size="sm" className="login-dialog">
      <LoginForm onDone={onClose} />
    </Modal>
  );
}
