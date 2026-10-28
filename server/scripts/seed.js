// Adds the 15 demo links (server/demo-links.txt) so you can try the library right away.
// Usage: npm run seed            (or: npm run seed -- my-links.txt)
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, query } from '../db.js';
import { addLinks } from '../links.js';
import { findUrls } from '../robot/url.js';
import { kick } from '../worker.js';

const file = process.argv[2] ?? path.join(import.meta.dirname, '..', 'demo-links.txt');
await connect();
const result = await addLinks(findUrls(await fs.readFile(file, 'utf8')));
console.log(`Added ${result.added.length} links, ${result.duplicates.length} were already there. Reading them now…`);

kick();
for (;;) {
  const { rows } = await query(`SELECT count(*)::int AS waiting FROM links WHERE status IN ('queued', 'reading', 'summarizing')`);
  if (!rows[0].waiting) break;
  process.stdout.write(`\r${rows[0].waiting} left…   `);
  await new Promise(resolve => setTimeout(resolve, 1000));
}
console.log('\rAll done.            ');
await (await connect()).close();
