// The daily wake-up. Render's free plan sleeps when nobody visits, so nothing would run on its own: once a day
// GitHub Actions calls POST /api/cron/daily (see .github/workflows/daily.yml). That wakes the library; then it
// checks website facts for up to 4 minutes (server/facts/runner.js) and runs every job in server/cron/ (the weekly
// email…). Each job file default-exports `async ({ now, isMonday }) => {}`.
// Only a caller with the secret (the x-cron-secret header = CRON_SECRET) can start it.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';

export const cron = express.Router();
const FACTS_BUDGET = 4 * 60_000; // with the jobs after it, the whole call stays around 5 minutes
const RUNNER = path.join(import.meta.dirname, '..', 'facts', 'runner.js');
const JOBS = path.join(import.meta.dirname, '..', 'cron');
let running = null;

const hash = text => crypto.createHash('sha256').update(text).digest();
const sameSecret = (given, wanted) => crypto.timingSafeEqual(hash(given), hash(wanted));
const exists = file => fs.access(file).then(() => true, () => false);
const load = file => import(pathToFileURL(file).href);

cron.post('/cron/daily', async (req, res) => {
  const secret = process.env.CRON_SECRET ?? '';
  if (!secret) return res.status(503).json({ error: 'Set CRON_SECRET on the server to turn on the daily jobs.' });
  if (!sameSecret(String(req.get('x-cron-secret') ?? ''), secret)) return res.status(401).json({ error: 'Wrong cron secret.' });
  // A retry while the first call is still working (the caller gave up waiting) doesn't start a second round.
  if (running) return res.status(202).json({ running: true });
  running = daily().finally(() => {
    running = null;
  });
  res.json(await running);
});

async function daily() {
  const now = new Date();
  const started = Date.now();
  const result = { facts: 'skipped: no facts runner yet', jobs: {} };

  if (await exists(RUNNER)) {
    try {
      const { runFacts } = await load(RUNNER);
      result.facts = (await runFacts({ budgetMs: FACTS_BUDGET })) ?? 'done';
    } catch (err) {
      console.error('Daily facts check failed:', err);
      result.facts = `failed: ${err.message}`;
    }
  }

  const files = await fs.readdir(JOBS).catch(() => []); // no jobs folder yet: nothing to run
  const ctx = { now, isMonday: now.getUTCDay() === 1 }; // 03:30 UTC is 9:00 in India: the same day
  for (const file of files.filter(name => name.endsWith('.js')).sort()) {
    const name = file.slice(0, -3);
    try {
      await (await load(path.join(JOBS, file))).default(ctx);
      result.jobs[name] = 'ok';
    } catch (err) {
      console.error(`Daily job ${name} failed:`, err);
      result.jobs[name] = `failed: ${err.message}`;
    }
  }
  result.seconds = Math.round((Date.now() - started) / 1000);
  console.log(`Daily wake-up done in ${result.seconds}s.`);
  return result;
}
