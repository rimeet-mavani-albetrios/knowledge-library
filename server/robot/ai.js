// Asks a free AI (Groq by default) to describe a website: summary, what you can do with it, who it's for,
// features, quick start, level, category, tags and search words.
//
// Groq's free plan gives each model its own daily limit. When one model is used up, the robot
// moves to the next one in the list. When all are used up, it pauses and tries again later.
import { ai as config, CATEGORIES, PRICING } from '../config.js';
import { normalizeTags } from './describe.js';

const MAX_TEXT = 3500; // of the saved page
const MAX_EXTRA_TEXT = 900; // of each extra page of the website
const MAX_KNOWN_TAGS = 80;
const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Thrown when no model can be used right now. `until` says when to try again.
export class AiPaused extends Error {
  constructor(reason, until) {
    super(reason);
    this.until = until;
  }
}

const models = [...config.models];
const coolUntil = new Map(); // model → time it can be used again
let pausedUntil = 0;
let pauseReason = '';

export const aiEnabled = () => Boolean(config.apiKey && models.length);

export function aiState() {
  if (!aiEnabled()) return { enabled: false, paused: false };
  return { enabled: true, paused: Date.now() < pausedUntil, reason: pauseReason, until: pausedUntil };
}

function pause(reason, ms) {
  pausedUntil = Date.now() + ms;
  pauseReason = reason;
  throw new AiPaused(reason, pausedUntil);
}

// How long the AI service asks us to wait, from its response headers (in milliseconds).
function retryAfter(res) {
  const header = res.headers.get('retry-after');
  if (header && !Number.isNaN(Number(header))) return Number(header) * 1000;
  const reset = res.headers.get('x-ratelimit-reset-requests') ?? res.headers.get('x-ratelimit-reset-tokens');
  const match = /(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?/.exec(reset ?? '');
  const ms = ((Number(match?.[1] ?? 0) * 60 + Number(match?.[2] ?? 0)) * 60 + Number(match?.[3] ?? 0)) * 1000;
  return ms || 60_000;
}

export async function describeWithAi(info) {
  if (!aiEnabled()) throw new AiPaused('no AI key is set', Infinity);
  if (Date.now() < pausedUntil) throw new AiPaused(pauseReason, pausedUntil);
  const messages = buildPrompt(info);

  for (let round = 0; round < 3; round++) {
    const ready = models.filter(model => (coolUntil.get(model) ?? 0) <= Date.now());
    if (!ready.length) {
      const wait = Math.min(...models.map(model => coolUntil.get(model))) - Date.now();
      if (wait > 20_000) pause('the free AI limit is used up for now', wait);
      await sleep(Math.max(wait, 0));
      continue;
    }
    for (const model of ready) {
      let res;
      try {
        res = await fetch(config.endpoint, {
          method: 'POST',
          headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.2,
            max_tokens: 1500,
            response_format: { type: 'json_object' },
            // gpt-oss models "think" before answering; a little thinking is enough here.
            ...(model.startsWith('openai/gpt-oss') && { reasoning_effort: 'low' }),
          }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (err) {
        pause(`couldn't reach the AI (${err.cause?.code ?? err.name})`, 2 * 60_000);
      }

      if (res.ok) return parseAnswer(await res.json());
      const body = await res.text();
      if (res.status === 429) {
        coolUntil.set(model, Date.now() + retryAfter(res));
        continue; // try the next model
      }
      if (res.status === 401 || res.status === 403) pause(`the AI key was refused (${res.status})`, 60 * 60_000);
      if (res.status === 404 || /model.{0,40}(not (found|exist|supported)|decommissioned)/i.test(body)) {
        console.warn(`AI model ${model} is not available, removing it from the list`);
        models.splice(models.indexOf(model), 1);
        if (!models.length) pause('none of the AI models are available', 60 * 60_000);
        continue;
      }
      if (res.status >= 500) pause(`the AI service had a problem (${res.status})`, 2 * 60_000);
      throw new Error(`AI error ${res.status}: ${body.slice(0, 200)}`);
    }
  }
  pause('the free AI limit is used up for now', 5 * 60_000);
}

function buildPrompt(info) {
  const facts = [
    `URL: ${info.url}`,
    info.title && `Page title: ${info.title}`,
    info.siteName && `Website: ${info.siteName}`,
    info.description && `Page description: ${info.description}`,
    info.keywords?.length && `Page keywords: ${info.keywords.join(', ')}`,
    info.github &&
      `GitHub: ${info.github.stars} stars, language ${info.github.language ?? 'n/a'}, topics: ${info.github.topics.join(', ') || 'none'}, license: ${info.github.license ?? 'none'}`,
    info.headings?.length && `Headings on the pages: ${info.headings.slice(0, 20).join(' | ')}`,
  ]
    .filter(Boolean)
    .join('\n');
  const extraPages = (info.extra ?? [])
    .map(page => `${page.label} page ("${page.title}"):\n"""\n${page.text.slice(0, MAX_EXTRA_TEXT)}\n"""`)
    .join('\n\n');
  const knownTags = (info.knownTags ?? []).slice(0, MAX_KNOWN_TAGS);

  return [
    {
      role: 'system',
      content: 'You catalog web resources for a personal knowledge library. Answer with one JSON object and nothing else. Write in simple, plain English.',
    },
    {
      role: 'user',
      content: `Describe this resource so it is easy to find later, by someone searching for what they want to do.

${facts}

Page text (may be cut off):
"""
${info.text.slice(0, MAX_TEXT) || '(no text could be read)'}
"""
${extraPages ? `\nOther pages of the same website:\n\n${extraPages}\n` : ''}
Tags already used in this library: ${knownTags.length ? knownTags.join(', ') : '(none yet)'}

Return JSON with these keys:
- "title": the short, clean name of the resource (for example "Ollama", not "GitHub - ollama/ollama: Get up and running with…")
- "summary": 2 sentences: what it is and what it does
- "overview": 3 to 5 sentences with more detail: what it offers and how it works
- "useFor": one short sentence starting with a verb, saying when someone would use it
- "tasks": 4 to 8 things someone can do with it, each 2 to 7 everyday words starting with a verb (for example "convert PDF to Excel", "remove image background", "run AI models offline")
- "audience": one short sentence saying who it is for
- "features": 3 to 6 short key features, each under 8 words
- "quickStart": up to 3 short steps to start using it, only if the information above says how; otherwise []
- "level": one of "beginner", "intermediate", "advanced": how much skill someone needs to use it
- "category": exactly one of ${JSON.stringify(CATEGORIES)}
- "tags": 3 to 6 topic tags in Title Case, 1 to 3 words each (for example "AI Agents", "PDF Tools", "Image Generation"). Use tags from the list above when they fit; make a new tag only when none fits.
- "searchWords": 8 to 15 other words or short phrases someone might type to find this: synonyms, related topics, other names for what it does
- "pricing": one of ${JSON.stringify(PRICING)}

Use only facts from the information above. If it is thin, keep the text short instead of guessing.`,
    },
  ];
}

const LEVELS = ['beginner', 'intermediate', 'advanced'];

const list = (value, max, maxLength) =>
  (Array.isArray(value) ? value : String(value ?? '').split(/[,;\n]/))
    .map(clean)
    .filter(item => item && item.length <= maxLength)
    .slice(0, max);

function parseAnswer(response) {
  const content = response.choices?.[0]?.message?.content ?? '';
  const answer = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
  const category = clean(answer.category).toLowerCase();
  const level = clean(answer.level).toLowerCase();
  return {
    title: clean(answer.title).slice(0, 120),
    summary: clean(answer.summary).slice(0, 600),
    overview: clean(answer.overview).slice(0, 1200),
    useFor: clean(answer.useFor).slice(0, 240),
    tasks: list(answer.tasks, 8, 80),
    audience: clean(answer.audience).slice(0, 240),
    features: list(answer.features, 6, 100),
    quickStart: list(answer.quickStart, 3, 160),
    level: LEVELS.includes(level) ? level : '',
    // Small models sometimes change the spelling a little ("tutorial" for "Tutorial & Course").
    category:
      CATEGORIES.find(name => name.toLowerCase() === category) ??
      CATEGORIES.find(name => category && name.toLowerCase().includes(category)) ??
      'Other',
    tags: normalizeTags(list(answer.tags, 8, 40)),
    searchWords: list(answer.searchWords, 15, 40).map(word => word.toLowerCase()),
    pricing: PRICING.includes(answer.pricing) ? answer.pricing : 'unknown',
  };
}
