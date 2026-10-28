// Short messages at the bottom of the screen ("Link deleted", "Copied").
import { createContext, useCallback, useContext, useState } from 'react';
import { CircleCheck, CircleAlert } from 'lucide-react';

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const show = useCallback((message, tone = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(list => [...list.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts(list => list.filter(toast => toast.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            {toast.tone === 'error' ? <CircleAlert size={18} aria-hidden="true" /> : <CircleCheck size={18} aria-hidden="true" />}
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
