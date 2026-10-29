// An "are you sure?" window of our own (never the browser's confirm()).
// Ask with `const confirm = useConfirm()`, then:
//   if (await confirm({ title: 'Delete this link?', message: '…', confirmLabel: 'Delete', danger: true })) …
// It gives true for the main button and false for Cancel, Esc or a click outside.
// Cancel has the focus when it opens, so Enter by habit never deletes anything: Enter only presses the main
// button once you have moved (Tab) onto it.
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { TriangleAlert, CircleHelp } from 'lucide-react';
import Modal from './Modal.jsx';
import './confirm.css';

const ConfirmContext = createContext(async () => false);
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }) {
  const [ask, setAsk] = useState(null); // { title, message, confirmLabel, cancelLabel, danger }
  const pending = useRef(null); // answers the question that is open right now
  const last = useRef(null); // the question just answered, kept on screen while the window fades out

  const confirm = useCallback(
    options =>
      new Promise(resolve => {
        pending.current?.(false); // a new question closes the one before it
        pending.current = resolve;
        last.current = options;
        setAsk(options);
      }),
    [],
  );
  const finish = useCallback(result => {
    const resolve = pending.current;
    pending.current = null;
    setAsk(null);
    resolve?.(result);
  }, []);

  const view = ask ?? last.current;
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal open={Boolean(ask)} onClose={() => finish(false)} labelledBy="confirm-title" size="sm" className={`confirm-dialog${view?.danger ? ' is-danger' : ''}`}>
        {view && (
          <div className="confirm-body">
            <span className="confirm-icon" aria-hidden="true">
              {view.danger ? <TriangleAlert size={22} /> : <CircleHelp size={22} />}
            </span>
            <div className="confirm-text">
              <h2 id="confirm-title">{view.title}</h2>
              {view.message && <p>{view.message}</p>}
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => finish(false)} data-autofocus>
                {view.cancelLabel ?? 'Cancel'}
              </button>
              <button type="button" className={`btn ${view.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => finish(true)}>
                {view.confirmLabel ?? 'OK'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}
