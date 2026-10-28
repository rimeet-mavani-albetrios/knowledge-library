// Owner login. Only someone with ADMIN_PASSWORD can add, edit or delete links.
// - ADMIN_PASSWORD set: you log in once; a signed cookie keeps you logged in for 30 days.
// - No ADMIN_PASSWORD on your own computer: everyone is the owner, so testing is easy.
// - No ADMIN_PASSWORD online (NODE_ENV=production): nobody can change the library (safe default).
import crypto from 'node:crypto';
import { settings, IS_PRODUCTION } from './config.js';

const COOKIE = 'kl_session';
const MAX_AGE = 30 * 24 * 60 * 60; // seconds
const secret = settings.sessionSecret || crypto.createHash('sha256').update(`kl:${settings.adminPassword}`).digest('hex');
const failedLogins = new Map(); // ip → { count, since }

export function ownerMode() {
  if (settings.adminPassword) return 'password';
  return IS_PRODUCTION ? 'locked' : 'open';
}

const sign = value => crypto.createHmac('sha256', secret).update(value).digest('base64url');

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

export function isOwner(req) {
  const mode = ownerMode();
  if (mode === 'open') return true;
  if (mode === 'locked') return false;
  const [expires, signature] = readCookie(req, COOKIE).split('.');
  if (!expires || !signature || Number(expires) < Date.now() / 1000) return false;
  const expected = sign(expires);
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// "Secure" (HTTPS only) when the visit is over HTTPS, like on Render; plain http://localhost works too.
function setCookie(req, res, value, maxAge) {
  res.setHeader('set-cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${req.secure ? '; Secure' : ''}`);
}

export function login(req, res) {
  if (ownerMode() !== 'password') return res.json({ owner: isOwner(req) });

  const ip = req.ip ?? 'unknown';
  const record = failedLogins.get(ip);
  if (record && record.count >= 5 && Date.now() - record.since < 10 * 60_000) {
    return res.status(429).json({ error: 'Too many wrong passwords. Wait 10 minutes and try again.' });
  }

  const given = crypto.createHash('sha256').update(String(req.body?.password ?? '')).digest();
  const wanted = crypto.createHash('sha256').update(settings.adminPassword).digest();
  if (!crypto.timingSafeEqual(given, wanted)) {
    failedLogins.set(ip, record && Date.now() - record.since < 10 * 60_000 ? { ...record, count: record.count + 1 } : { count: 1, since: Date.now() });
    return res.status(401).json({ error: 'That password is not right.' });
  }
  failedLogins.delete(ip);
  const expires = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  setCookie(req, res, `${expires}.${sign(expires)}`, MAX_AGE);
  res.json({ owner: true });
}

export function logout(req, res) {
  setCookie(req, res, '', 0);
  res.json({ owner: false });
}

// Route guards.
export function requireOwner(req, res, next) {
  if (isOwner(req)) return next();
  res.status(ownerMode() === 'locked' ? 403 : 401).json({
    error: ownerMode() === 'locked' ? 'Set ADMIN_PASSWORD on the server to make changes.' : 'Log in to make changes.',
  });
}

export function requireReader(req, res, next) {
  if (!settings.privateLibrary || isOwner(req)) return next();
  res.status(401).json({ error: 'This library is private. Log in to see it.' });
}
