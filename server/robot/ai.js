// Asks a free AI (Groq by default) to describe a website: summary, what you can do with it, who it's for,
// features, quick start, level, category, tags and search words.
//
// Groq's free plan gives each model its own daily limit. When one model is used up, the robot
// moves to the next one in the list. When all are used up, it pauses and tries again later.
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ai as config, CATEGORIES, PRICING } from '../config.js';
import { normalizeTags } from './describe.js';
import { hostOf } from './url.js';

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

// Filling the whole library at once (server/scripts/fill-facts.js) without the free AI's daily limit:
// with FACTS_AI=record each question is written to a file for Claude instead of being asked, and with
// FACTS_AI=replay the answer comes from Claude's answers files. A question is named by the fact, the link and its
// number within that check ("company:abc123:1"), so a page that changed a little in between still finds its answer.
export const aiTask = new AsyncLocalStorage();
const fill = { mode: process.env.FACTS_AI ?? '', dir: process.env.FACTS_AI_DIR || path.join('.data', 'facts-ai') };
let fillAnswers = null;
export const fillMode = () => fill.mode;

function loadFillAnswers() {
  const answers = new Map();
  for (const file of fs.readdirSync(fill.dir).filter(name => /^answers.*\.jsonl$/.test(name))) {
    for (const line of fs.readFileSync(path.join(fill.dir, file), 'utf8').split('\n')) {
      try {
        const { key, answer } = JSON.parse(line);
        if (key) answers.set(key, typeof answer === 'string' ? answer : JSON.stringify(answer));
      } catch {
        // an empty or broken line
      }
    }
  }
  return answers;
}

function fillAnswer(messages, maxTokens) {
  const task = aiTask.getStore();
  if (!task) throw new AiPaused(`this question has no name, so it can't be filled (${fill.mode})`, Infinity);
  const key = `${task.key}:${task.n++}`;
  if (fill.mode === 'record') {
    fs.mkdirSync(fill.dir, { recursive: true });
    fs.appendFileSync(path.join(fill.dir, 'questions.jsonl'), `${JSON.stringify({ key, maxTokens, messages })}\n`);
    // An empty answer, so the check goes on to its next question (company: the terms page after the privacy page).
    return { choices: [{ message: { content: '{}' } }] };
  }
  fillAnswers ??= loadFillAnswers();
  if (!fillAnswers.has(key)) throw new AiPaused(`Claude has no answer for ${key}`, Infinity);
  return { choices: [{ message: { content: fillAnswers.get(key) } }] };
}

export const aiEnabled = () => Boolean(fill.mode || (config.apiKey && models.length));

export function aiState() {
  if (fill.mode) return { enabled: true, paused: false };
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
  return parseAnswer(await chat(buildPrompt(info), 1500));
}

// Thrown when the AI's answer to "Which should I pick?" can't be used: not JSON, or a pick that isn't one of the
// links. Guessing would put "Best pick" on a link the AI never chose, so the owner is asked to try again instead.
export class AiUnclear extends Error {
  constructor() {
    super('The AI gave an unclear answer. Try again.');
  }
}

// The compare window's "Which should I pick?": the AI reads 2 to 4 links side by side and picks one.
// Answers { pickId, reason, others: [{ id, when }] }.
export async function pickWithAi(links) {
  const blocks = links.map((link, index) =>
    [
      `[${index + 1}] ${link.title} (${link.source === 'github' ? 'GitHub' : hostOf(link.url)})`,
      `Price: ${link.pricing}`,
      link.level && `Level: ${link.level}`,
      link.useFor && `Use it for: ${link.useFor}`,
      link.summary && `Summary: ${link.summary}`,
      link.tasks.length && `Can do: ${link.tasks.join('; ')}`,
      link.features.length && `Key features: ${link.features.join('; ')}`,
      link.github && `GitHub: ${link.github.stars} stars, language ${link.github.language ?? 'n/a'}, license ${link.github.license ?? 'none'}`,
      `The owner's status: ${link.myStatus || 'not set'}, opened ${link.opens} times`,
      link.note && `The owner's note: ${clean(link.note).slice(0, 300)}`,
    ]
      .filter(Boolean)
      .join('\n'),
  );
  const response = await chat(
    [
      {
        role: 'system',
        content: 'You help someone choose between tools from their own saved library. Answer with one JSON object and nothing else. Write in simple, plain English.',
      },
      {
        role: 'user',
        content: `Which of these is the best pick for most people, and when would someone choose each of the others instead?

${blocks.join('\n\n')}

Return JSON with these keys:
- "pick": the number of the best one
- "reason": one or two short sentences saying why
- "others": for every other one, { "number": its number, "when": one short sentence starting with "Choose it when" }

Use only the facts above.`,
      },
    ],
    600,
  );
  const content = response.choices?.[0]?.message?.content ?? '';
  let answer;
  try {
    answer = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
  } catch {
    throw new AiUnclear();
  }
  // Only a whole number from 1 to the number of links is a link ("2" is fine; 0, 5 or 1.5 are not).
  const at = number => (/^\d+$/.test(String(number ?? '').trim()) ? links[Number(number) - 1] : undefined);
  const pick = at(answer?.pick);
  if (!pick) throw new AiUnclear();
  return {
    pickId: pick.id,
    reason: clean(answer.reason).slice(0, 400),
    others: (Array.isArray(answer.others) ? answer.others : [])
      .map(other => ({ id: at(other?.number)?.id, when: clean(other?.when).slice(0, 240) }))
      .filter(other => other.id && other.id !== pick.id && other.when),
  };
}

// One question to the free AI, moving on to the next model when one is used up (see the top of this file).
// Gives back the AI service's whole answer.
export async function chat(messages, maxTokens) {
  if (fill.mode) return fillAnswer(messages, maxTokens);
  if (!aiEnabled()) throw new AiPaused('no AI key is set', Infinity);
  if (Date.now() < pausedUntil) throw new AiPaused(pauseReason, pausedUntil);

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
            max_tokens: maxTokens,
            response_format: { type: 'json_object' },
            // gpt-oss models "think" before answering; a little thinking is enough here.
            ...(model.startsWith('openai/gpt-oss') && { reasoning_effort: 'low' }),
          }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (err) {
        pause(`couldn't reach the AI (${err.cause?.code ?? err.name})`, 2 * 60_000);
      }

      if (res.ok) return res.json();
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
