// Sends email with Resend's free plan (resend.com: 3,000 emails a month, 100 a day). One web request, no extra package.
// Needs RESEND_API_KEY and WEEKLY_EMAIL_TO. Without your own domain, Resend's test sender (onboarding@resend.dev)
// can only send to the email address you signed up to Resend with, so WEEKLY_EMAIL_TO has to be that address.
import { settings } from '../config.js';

const ENDPOINT = 'https://api.resend.com/emails';
const TEST_SENDER = 'onboarding@resend.dev';

export const emailTo = () => (process.env.WEEKLY_EMAIL_TO ?? '').trim();
export const emailReady = () => Boolean(process.env.RESEND_API_KEY && emailTo());
// Your own sender, once you verified a domain in Resend: WEEKLY_EMAIL_FROM="Library <library@yourdomain.com>".
const sender = () => process.env.WEEKLY_EMAIL_FROM?.trim() || `${settings.title} <${TEST_SENDER}>`;

// The website's address, for the buttons in the email. Render fills in RENDER_EXTERNAL_URL by itself.
export const siteUrl = () =>
  (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${settings.port}`).replace(/\/$/, '');

// Resend's answers in plain words.
function problem(status, message) {
  if (status === 401 || (status === 400 && /api key/i.test(message))) return 'Resend did not accept the key. Check RESEND_API_KEY.';
  if (status === 403 && /own email|testing emails|verify a domain/i.test(message)) {
    return "Resend's test sender can only send to the email you signed up with. Put that address in WEEKLY_EMAIL_TO.";
  }
  if (status === 429) return 'Resend says too many emails were sent today. Try again tomorrow.';
  return `Resend could not send the email${message ? `: ${message}` : ` (${status})`}.`;
}

// `key` stops the same email going out twice, even when it is asked for twice (Resend remembers it for 24 hours).
export async function sendEmail({ subject, html, text, key }) {
  if (!emailReady()) throw new Error('Add RESEND_API_KEY and WEEKLY_EMAIL_TO to send email.');
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'content-type': 'application/json',
        ...(key ? { 'idempotency-key': key } : {}),
      },
      body: JSON.stringify({ from: sender(), to: [emailTo()], subject, html, text }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new Error(`Could not reach Resend: ${err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(problem(res.status, String(data.message ?? '')));
  return { id: data.id, to: emailTo() };
}
