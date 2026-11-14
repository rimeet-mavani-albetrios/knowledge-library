// The server: the API (/api/...) plus the website, in one Node.js app.
//   npm run dev    → for building it on your computer (the website reloads when you change it)
//   npm start      → for running it for real (Render runs this)
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import compression from 'compression';
import { ROOT, settings, IS_PRODUCTION } from './config.js';
import { connect } from './db.js';
import { api } from './api.js';
import { resumeQueue } from './worker.js';
import { ownerMode } from './auth.js';
import { aiEnabled } from './robot/ai.js';
import { embedQuery } from './robot/embed.js';
import { vocabulary } from './words.js';

const DEV = process.argv.includes('--dev');
const WEB_DIST = path.join(ROOT, 'web', 'dist');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render sits in front of the app
app.use(compression());
app.use((req, res, next) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('x-frame-options', 'DENY');
  if (!DEV) {
    res.setHeader(
      'content-security-policy',
      // frame-src: the History tab's "Look back" shows the Internet Archive's old copy of a website inside the window.
      "default-src 'self'; img-src * data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; frame-src https://web.archive.org; frame-ancestors 'none'; base-uri 'self'",
    );
  }
  next();
});
app.use('/api', express.json({ limit: '5mb' }), api);

if (DEV) {
  // Vite serves the website with instant reload while you work on it.
  const { createServer } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const vite = await createServer({
    configFile: false,
    root: path.join(ROOT, 'web'),
    plugins: [react()],
    server: { middlewareMode: true },
    appType: 'spa',
  });
  console.log('  Website changes show up instantly. Restart "npm run dev" after changing server files.');
  app.use(vite.middlewares);
} else if (fs.existsSync(WEB_DIST)) {
  app.use('/assets', express.static(path.join(WEB_DIST, 'assets'), { immutable: true, maxAge: '1y' }));
  app.use(express.static(WEB_DIST, { maxAge: '1h' }));
  app.get('/{*path}', (req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
} else {
  app.get('/', (req, res) => res.send('The website is not built yet. Run "npm run build", or use "npm run dev".'));
}

// Take the port before opening the database: when another copy is already running, this one stops here.
// (Two copies writing to the same built-in database at once is what can break it.)
await new Promise(resolve =>
  app.listen(settings.port, err => {
    if (!err) return resolve();
    console.error(
      err.code === 'EADDRINUSE'
        ? `Port ${settings.port} is busy: the library is probably already running in another window. Stopping this copy.`
        : `Could not start the server: ${err.message}`,
    );
    process.exit(1);
  }),
);
await connect();
console.log(`Knowledge Library is running: http://localhost:${settings.port}`);
console.log(`  Database: ${settings.databaseUrl ? 'Neon / Postgres' : 'built-in (saved in .data/)'}`);
console.log(`  AI summaries: ${aiEnabled() ? 'on' : 'off (add GROQ_API_KEY to turn them on)'}`);
const mode = ownerMode();
if (mode === 'open') console.log('  Login: off on this computer (set ADMIN_PASSWORD to turn it on)');
if (mode === 'locked') console.warn('  ADMIN_PASSWORD is not set, so nobody can add or change links.');
if (IS_PRODUCTION && !settings.sessionSecret) console.warn('  Tip: set SESSION_SECRET to a long random text.');
await resumeQueue();
// Loads the word list (for spelling) and the meaning model now, so the first search doesn't wait for them.
Promise.all([vocabulary(), embedQuery('warm up')]).catch(err => console.error('Getting search ready failed:', err.message));
