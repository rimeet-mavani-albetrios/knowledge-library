// The weekly email's settings and the "Send test email" button in the ⋯ menu. Owner only.
import express from 'express';
import { requireOwner } from '../auth.js';
import { emailReady } from '../email/send.js';
import { emailSettings, turnEmail } from '../email/settings.js';
import { sendWeeklyEmail } from '../email/weekly.js';

export const email = express.Router();
const NOT_READY = 'Add RESEND_API_KEY and WEEKLY_EMAIL_TO to the settings first (see the README).';
const TEST_GAP = 30_000; // one test email per 30 seconds, so a double click doesn't send two
let lastTest = 0;

email.get('/email/settings', requireOwner, async (req, res) => {
  res.json(await emailSettings());
});

email.post('/email/settings', requireOwner, async (req, res) => {
  if (typeof req.body?.on !== 'boolean') return res.status(400).json({ error: 'Say whether the weekly email is on or off.' });
  if (!emailReady()) return res.status(400).json({ error: NOT_READY });
  await turnEmail(req.body.on);
  res.json(await emailSettings());
});

// The same email as on Monday (the last 7 days), marked as a test. It doesn't count as the week's email.
email.post('/email/test', requireOwner, async (req, res) => {
  if (!emailReady()) return res.status(400).json({ error: NOT_READY });
  if (Date.now() - lastTest < TEST_GAP) return res.status(429).json({ error: 'A test email was just sent. Wait half a minute.' });
  lastTest = Date.now();
  try {
    res.json(await sendWeeklyEmail({ test: true }));
  } catch (err) {
    lastTest = 0;
    console.error('Test email failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});
