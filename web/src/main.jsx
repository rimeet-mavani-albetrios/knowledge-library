import { Component, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RotateCw } from 'lucide-react';
import '@fontsource-variable/figtree';
import '@fontsource-variable/bricolage-grotesque';
import './styles.css';
import App from './App.jsx';
import SavePage from './components/SavePage.jsx';
import { ToastProvider } from './components/Toasts.jsx';
import { ConfirmProvider } from './components/Confirm.jsx';
import TooltipLayer from './components/Tooltip.jsx';
import { LogoMark } from './components/Icons.jsx';

// The "Save to library" button opens /save in a small window.
const Page = window.location.pathname === '/save' ? SavePage : App;

const queryClient = new QueryClient({
  defaultOptions: {
    // Results loaded in the last 5 minutes show at once when you come back to them, without loading again.
    // (Adding or changing a link refreshes them straight away.)
    queries: { staleTime: 5 * 60_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

// If the page itself crashes (a bug, or a very old browser), a short message and a Reload button instead of a blank page.
// React keeps the error in the browser's console. It uses the look of the private library's login page (`.gate`).
class ErrorCatcher extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="gate" role="alert">
        <LogoMark size={44} />
        <h1>Something went wrong</h1>
        <p>The page ran into a problem. Your links are safe. Reloading usually fixes it.</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          <RotateCw size={16} aria-hidden="true" /> Reload
        </button>
      </main>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorCatcher>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ConfirmProvider>
            <Page />
            {/* Our own tooltips in place of the browser's `title` boxes, once for the whole app. */}
            <TooltipLayer />
          </ConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorCatcher>
  </StrictMode>,
);
