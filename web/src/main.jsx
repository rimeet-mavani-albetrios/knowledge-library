import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/figtree';
import '@fontsource-variable/bricolage-grotesque';
import './styles.css';
import App from './App.jsx';
import SavePage from './components/SavePage.jsx';
import { ToastProvider } from './components/Toasts.jsx';

// The "Save to library" button opens /save in a small window.
const Page = window.location.pathname === '/save' ? SavePage : App;

const queryClient = new QueryClient({
  defaultOptions: {
    // Results loaded in the last 5 minutes show at once when you come back to them, without loading again.
    // (Adding or changing a link refreshes them straight away.)
    queries: { staleTime: 5 * 60_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Page />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
