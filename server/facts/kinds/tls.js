// The website's lock: does it have a working secure connection (HTTPS), and until when is its certificate valid?
import tls from 'node:tls';
import { assertPublic } from '../../robot/page.js';

export default {
  kind: 'tls',
  everyDays: 14,
  perRun: 20,
  sources: ['web'],
  order: 10,
  async collect(link, facts, { host }) {
    await assertPublic(`https://${host}/`);
    return new Promise((resolve, reject) => {
      const socket = tls.connect({ host, port: 443, servername: host, timeout: 10_000 }, () => {
        const cert = socket.getPeerCertificate();
        const validTo = cert?.valid_to ? new Date(cert.valid_to) : null;
        socket.end();
        resolve({
          ok: socket.authorized && Boolean(validTo) && validTo > new Date(),
          validTo: validTo && !Number.isNaN(validTo.getTime()) ? validTo.toISOString() : null,
          issuer: cert?.issuer?.O ?? null,
        });
      });
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('timed out'));
      });
      socket.on('error', err => {
        // No HTTPS at all, or a broken certificate: that's the answer. A missing website is not.
        if (['ECONNREFUSED', 'ERR_SSL_WRONG_VERSION_NUMBER', 'EPROTO'].includes(err.code) || /certificate|SSL/i.test(err.message)) {
          resolve({ ok: false, validTo: null, issuer: null });
        } else if (err.code === 'ENOTFOUND') {
          resolve(null);
        } else {
          reject(err);
        }
      });
    });
  },
};
