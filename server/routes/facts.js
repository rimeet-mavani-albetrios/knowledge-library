// Website facts for the detail window's tabs, and the owner's "Is it right for me?" check.
import express from 'express';
import { query } from '../db.js';
import { isOwner, requireOwner, requireReader } from '../auth.js';
import { getLink } from '../links.js';
import { AiPaused } from '../robot/ai.js';
import { collectNow, isCollecting, pendingKinds } from '../facts/runner.js';
import { fitWithAi } from '../facts/fit.js';

export const factsRoutes = express.Router();
const HISTORY_ROWS = 400;

// The link, its facts and its history in one question to the database: from far away (your computer in India,
// the database in Ohio) each question costs about a third of a second.
async function factsOf(id) {
  const { rows: [row] } = await query(
    `SELECT l.id, l.source, l.status, f.facts, f.checked,
       (SELECT coalesce(json_agg(latest ORDER BY latest.found_at), '[]'::json) FROM (
          SELECT kind, data, found_at FROM link_history WHERE link_id = l.id ORDER BY found_at DESC LIMIT ${HISTORY_ROWS}
        ) latest) AS history
     FROM links l LEFT JOIN link_facts f ON f.link_id = l.id WHERE l.id = $1`,
    [id],
  );
  if (!row) return null;
  // Oldest first, so a line can be drawn from left to right.
  const byKind = { stars: [], price: [], feature: [], dead: [], rising: [] };
  for (const item of row.history) (byKind[item.kind] ??= []).push({ ...item.data, at: item.found_at });
  return { link: row, found: { facts: row.facts ?? {}, checked: row.checked ?? {}, history: byKind } };
}

// `collect=1` (sent for the link on screen, not for links loaded ahead): when you're the owner and some facts were
// never checked, they're checked now in the background; the window asks again while `collecting` is true.
factsRoutes.get('/links/:id/facts', requireReader, async (req, res) => {
  const result = await factsOf(req.params.id);
  if (!result) return res.status(404).json({ error: 'This link is not in the library any more.' });
  const { link, found } = result;
  const pending = await pendingKinds(link, found.checked);
  if (pending.length && req.query.collect === '1' && isOwner(req) && link.status === 'ready') collectNow(link.id);
  res.json({ ...found, pending, collecting: isCollecting(link.id) });
});

factsRoutes.post('/links/:id/fit', requireOwner, async (req, res) => {
  const need = String(req.body?.need ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (need.length < 3) return res.status(400).json({ error: 'Type what you need it for.' });
  const link = await getLink(req.params.id);
  if (!link) return res.status(404).json({ error: 'This link is not in the library any more.' });
  const facts = (await factsOf(link.id))?.found.facts ?? {};
  try {
    res.json(await fitWithAi(link, facts, need));
  } catch (err) {
    if (err instanceof SyntaxError) return res.status(502).json({ error: 'The AI’s answer came back garbled. Try again.' });
    if (!(err instanceof AiPaused)) throw err;
    const minutes = Math.max(1, Math.ceil((err.until - Date.now()) / 60_000));
    res.status(503).json({
      error: Number.isFinite(err.until)
        ? `The free AI is resting for about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}. Try again then.`
        : 'The free AI is not set up yet (no Groq key).',
    });
  }
});
