// "Meaning fingerprints" (embeddings) for smart search.
// A small free model, running inside this server, turns text into 384 numbers.
// Texts with a similar meaning get similar numbers, so "edit videos" can find "video editor".
import { env, pipeline } from '@huggingface/transformers';
import { settings } from '../config.js';
import { withSameMeaning } from '../words.js';

env.cacheDir = settings.modelCacheDir;

let extractor = null;
const recentQueries = new Map(); // search text → fingerprint, so repeated searches are instant

async function model() {
  extractor ??= pipeline('feature-extraction', settings.embeddingModel, { dtype: 'q8' });
  return extractor;
}

export async function embed(text) {
  const output = await (await model())(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

export async function embedQuery(text) {
  const key = text.trim().toLowerCase();
  if (recentQueries.has(key)) return recentQueries.get(key);
  const vector = await embed(withSameMeaning(key));
  recentQueries.set(key, vector);
  if (recentQueries.size > 200) recentQueries.delete(recentQueries.keys().next().value);
  return vector;
}

// Postgres (pgvector) reads vectors written like "[0.1,0.2,…]".
export const toSqlVector = vector => `[${vector.map(value => value.toFixed(6)).join(',')}]`;

// The model reads about 250 words, so the most telling details come first.
export function meaningText(link) {
  return [
    link.title,
    (link.tasks ?? []).join('. '),
    link.summary,
    link.description !== link.summary && link.description,
    link.useFor,
    (link.tags ?? []).join(', '),
    (link.searchWords ?? []).join(', '),
    link.category,
    (link.features ?? []).join('. '),
    link.audience,
    (link.headings ?? []).slice(0, 8).join('. '),
    link.collection,
    link.note,
  ]
    .filter(Boolean)
    .join('. ')
    .slice(0, 1500);
}
