// The weekly email's on/off switch and when it last went out, kept in the `meta` table.
// It is on by itself once RESEND_API_KEY and WEEKLY_EMAIL_TO are set; the ⋯ menu turns it off and on again.
import { getMeta, setMeta } from '../db.js';
import { emailReady, emailTo } from './send.js';

const SWITCH = 'weekly_email'; // 'on' | 'off'
export const SENT = 'weekly_email_sent'; // ISO time of the last weekly email (test emails don't count)

export async function emailOn() {
  return emailReady() && (await getMeta(SWITCH)) !== 'off';
}

export const turnEmail = on => setMeta(SWITCH, on ? 'on' : 'off');

export async function emailSettings() {
  return {
    ready: emailReady(), // a Resend key and an address are set
    on: await emailOn(),
    to: emailReady() ? emailTo() : '',
    lastSent: await getMeta(SENT),
  };
}
