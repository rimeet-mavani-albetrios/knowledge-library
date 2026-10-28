// Connects to the database.
// With DATABASE_URL (Neon, on Render) it uses real Postgres.
// Without it (your computer) it uses PGlite: the same Postgres, running inside Node, saved in the .data folder.
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, settings } from './config.js';

let db = null;
let opening = null;

// The first visitors can arrive while the database is still opening: they all wait for the same connection.
export function connect() {
  opening ??= open();
  return opening;
}

async function open() {
  if (settings.databaseUrl) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: settings.databaseUrl,
      // A search and its filter counts ask a few questions at once; each needs its own connection.
      max: 10,
      // Opening a connection to Neon takes about a second, so keep them while you use the library.
      // After 5 quiet minutes they close, so Neon can still go to sleep and save free hours.
      idleTimeoutMillis: 5 * 60_000,
    });
    pool.on('error', err => console.error('Database connection error:', err.message));
    db = {
      kind: 'postgres',
      query: (text, params) => pool.query(text, params),
      exec: text => pool.query(text),
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const { vector } = await import('@electric-sql/pglite-pgvector');
    const dir = process.env.PGLITE_DIR ?? path.join(ROOT, '.data', 'pglite');
    await fs.mkdir(dir, { recursive: true });
    const lite = await PGlite.create(dir, { extensions: { vector } });
    db = {
      kind: 'pglite',
      query: (text, params) => lite.query(text, params),
      exec: text => lite.exec(text),
      close: () => lite.close(),
    };
  }
  await db.exec(await fs.readFile(path.join(import.meta.dirname, 'schema.sql'), 'utf8'));
  return db;
}

export async function query(text, params = []) {
  return (await connect()).query(text, params);
}

export async function getMeta(key) {
  const { rows } = await query('SELECT value FROM meta WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

export async function setMeta(key, value) {
  await query('INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, String(value)]);
}
