// Shared by the price watch and "What's new" (server/facts/kinds/prices.js and features.js):
// which page of a website to read, its text cut short for the free AI, and asking the AI for a JSON answer.
// (This file is not in kinds/, so the facts runner doesn't load it as a kind.)
import { readPage } from '../robot/page.js';
import { chat } from '../robot/ai.js';

const PIECE = 240; // letters per piece when the text is cut down to its useful parts

// The page the robot found for this label ('Pricing', 'Features') when it first read the website, or ''.
// The runner may hand over a database row (page_links) or a link from toLink() (pageLinks).
export function pageLinkOf(link, label) {
  const list = link.pageLinks ?? link.page_links ?? [];
  return (Array.isArray(list) ? list : []).find(entry => entry?.label === label)?.url ?? '';
}

// The path of an address: "/pricing" for https://example.com/pricing?ref=nav.
export function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

// Reads a page now. { text, headings }, or null when it can't be read right now (blocked, slow, gone).
export async function readNow(url) {
  const page = await readPage(url, { timeout: 15_000 });
  if (!page.ok || !page.text || page.text.length < 80) return null;
  return { text: page.text, headings: page.headings ?? [] };
}

// The parts of a long text that match `pattern` (with the piece before and after each), up to `max` letters,
// so the AI reads the plans on a pricing page instead of its first screen of marketing.
export function around(text, pattern, max) {
  if (text.length <= max) return text;
  const pieces = text.match(new RegExp(`[\\s\\S]{1,${PIECE}}(?=\\s|$)|\\S+`, 'g')) ?? [];
  const keep = new Set();
  pieces.forEach((piece, i) => {
    if (pattern.test(piece)) [i - 1, i, i + 1].forEach(j => keep.add(j));
  });
  let out = '';
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i < 0 || i >= pieces.length) continue;
    if (out.length + pieces[i].length > max) break;
    out += pieces[i];
  }
  return out.trim() || text.slice(0, max);
}

// One question to the free AI; its answer as an object. Throws AiPaused when the AI is resting.
export async function askJson(prompt, maxTokens) {
  const response = await chat(
    [
      {
        role: 'system',
        content: 'You read websites for a personal library and note facts about them. Answer with one JSON object and nothing else.',
      },
      { role: 'user', content: prompt },
    ],
    maxTokens,
  );
  const content = response.choices?.[0]?.message?.content ?? '';
  return JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
}

export const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim();

// "Pro plan", "pro-plan" and "Pro  Plan" are the same name.
export const nameKey = text => clean(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
