// The no-AI backup: a simple description built from the page itself.
// Every link gets this right away; the AI version replaces it when the free AI is available.
import { prettyUrl } from './url.js';

const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim();

// First matching rule wins. Each rule: [category, test on host + path, test on the link's words].
const CATEGORY_RULES = [
  ['Video & Podcast', /^(youtube\.com|youtu\.be|vimeo\.com|loom\.com|open\.spotify\.com\/(show|episode)|podcasts\.apple\.com)\//, /\bpodcasts?\b/],
  ['Book', /^goodreads\.com\/book\//, null],
  ['Shopping', /^(amazon\.[a-z.]+|flipkart\.com|noon\.com|etsy\.com)\//, null],
  ['Community', /^(skool\.com|discord\.(gg|com)|reddit\.com\/r)\//, /\bcommunity\b/],
  ['Testing', null, /\b(e2e|end-to-end|test automation|qa testing|bug report\w*)\b/],
  ['UI Components', null, /\b(ui components?|component library|tailwind components?|shadcn)\b/],
  ['Dataset', /^(kaggle\.com\/datasets|huggingface\.co\/datasets)\//, /\bdatasets?\b/],
  ['Article', /^(medium\.com|dev\.to|substack\.com|hashnode\.dev)\/|\/(blog|engineering|posts?|articles?|news)\//, /\b(blog post|essay|newsletter)\b/],
  ['Documentation', /^(docs|developers?)\.|\/docs?(\/|$)/, /\b(documentation|api reference)\b/],
  ['Tutorial & Course', /\/(learn|courses?|tutorials?)\//, /\b(tutorials?|course|beginners?|lessons?|bootcamp|handbook)\b/],
  ['Prompts', null, /\bprompts?\b/],
  ['Workflows & Automation', null, /\b(workflows?|automat\w*|zapier|no-code)\b/],
  ['Agents, Skills & MCP', null, /\b(skills?|agents?|agentic|mcp)\b/],
  ['Design', null, /\b(design|figma|whiteboard\w*|diagrams?|icons?|fonts?|ui kit)\b/],
  ['AI Tool', null, /\b(ai|llms?|gpt|chatbot|generative|machine learning|text-to-\w+)\b/],
];

// Tag → words that suggest it.
const TAG_RULES = {
  ai: /\b(ai|artificial intelligence)\b/,
  llm: /\b(llms?|large language models?|gpt|claude|gemini|llama|mistral)\b/,
  agents: /\bagents?\b|\bagentic\b/,
  prompts: /\bprompts?\b/,
  rag: /\brag\b|retrieval/,
  chatbot: /\bchat ?bots?\b/,
  image: /\bimages?\b|\bphoto/,
  video: /\bvideos?\b/,
  audio: /\baudio\b|\bspeech\b|\bvoice\b|\bmusic\b/,
  coding: /\bcod(e|ing)\b|\bprogramming\b|\bdevelopers?\b/,
  python: /\bpython\b/,
  javascript: /\bjavascript\b|\bnode\.?js\b/,
  automation: /\bautomat\w*\b|\bworkflows?\b/,
  design: /\bdesign\b|\bui\b|\bfigma\b|\bdiagrams?\b/,
  writing: /\bwrit(e|ing)\b|\bcopywrit/,
  'self-hosted': /\bself-?host/,
  'local-ai': /\b(run|runs|running) (\w+ )?locally\b|\boffline\b/,
  api: /\bapis?\b/,
  beginner: /\bbeginners?\b|\bintroduct/,
  mcp: /\bmcp\b|model context protocol/,
};

// Short words that are written in capitals inside tags: "AI Agents", "PDF Tools".
const CAPITALS = new Set(['ai', 'ml', 'llm', 'api', 'pdf', 'mcp', 'rag', 'ui', 'ux', 'seo', 'csv', 'json', 'sql', 'db', 'gpt',
  'ocr', 'tts', 'sdk', 'cli', 'css', 'html', 'saas', 'crm', 'nlp', 'gpu', 'svg', 'faq', 'vr', 'ar', '3d']);
// Names with their own spelling.
const SPELLINGS = {
  apis: 'APIs', llms: 'LLMs', gpts: 'GPTs', ios: 'iOS', macos: 'macOS', chatgpt: 'ChatGPT', openai: 'OpenAI', github: 'GitHub',
  youtube: 'YouTube', javascript: 'JavaScript', typescript: 'TypeScript', nodejs: 'Node.js', huggingface: 'Hugging Face',
};

// "local-ai" → "Local AI", "ai agents" → "AI Agents". A tag typed with capitals ("ChatGPT") stays as it is.
export function displayTag(tag) {
  const text = clean(tag).replace(/^#/, '').replace(/_+/g, ' ');
  if (/[A-Z]/.test(text)) return text;
  return text
    .replace(/-/g, ' ')
    .split(' ')
    .map(word =>
      SPELLINGS[word] ?? (CAPITALS.has(word) ? word.toUpperCase() : /\d/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)),
    )
    .join(' ');
}

// "AI Agents", "ai-agent" and "AI Agent" are the same tag.
export const tagKey = tag => clean(tag).toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/(?<=.{3})s$/, '');

// Tidy tags, without doubles. `known` are the tags the library already uses (most used first):
// a new tag that means the same as a known one takes the known spelling, so tags don't split into look-alikes.
export function normalizeTags(tags, known = []) {
  const spelling = new Map();
  for (const tag of known) if (!spelling.has(tagKey(tag))) spelling.set(tagKey(tag), tag);
  const result = new Map();
  for (const tag of tags ?? []) {
    const display = displayTag(tag);
    const key = tagKey(display);
    if (key && display.length <= 40 && !result.has(key)) result.set(key, spelling.get(key) ?? display);
  }
  return [...result.values()].slice(0, 8);
}

// "Transformers.js · Hugging Face" → "Transformers.js". Keeps the title when unsure.
export function cleanTitle(title, siteName, host) {
  title = clean(title);
  // GitHub pages are titled "GitHub - owner/repo: description".
  const github = /^GitHub - ([^:]+?)(?::\s.*)?$/.exec(title);
  if (github) return github[1];
  const parts = title.split(/\s+[|·–—-]\s+/);
  if (parts.length < 2) return title;
  const last = parts.at(-1).toLowerCase();
  const brand = host.split('.').at(-2) ?? '';
  if (last === siteName.toLowerCase() || last.replace(/\s+/g, '').includes(brand) || last === 'home') {
    return parts.slice(0, -1).join(' – ');
  }
  return title;
}

function firstSentences(text, max) {
  const sentences = clean(text).match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [];
  let result = '';
  for (const sentence of sentences) {
    if (result && (result + sentence).length > max) break;
    result += sentence;
  }
  result = result.trim();
  return result.length > max ? `${result.slice(0, max - 1).trimEnd()}…` : result;
}

export function basicDescription(link, text) {
  const where = prettyUrl(link.url).toLowerCase() + '/';
  // Title, description and topics say what a link is. Long page text mentions everything, so it's a last resort.
  const words = [link.title, link.description || text.slice(0, 300), link.github?.topics?.join(' '), (link.headings ?? []).slice(0, 6).join(' ')]
    .join(' ')
    .toLowerCase();

  const rule = CATEGORY_RULES.find(([, whereTest, wordsTest]) => whereTest?.test(where) || wordsTest?.test(words));
  const category = rule?.[0] ?? (link.source === 'github' ? 'Code Library' : 'Other');

  const tags = [...(link.github?.topics ?? []).slice(0, 5)];
  for (const [tag, test] of Object.entries(TAG_RULES)) if (test.test(words)) tags.push(tag);
  if (link.github?.license) tags.push('open-source');

  return {
    summary: firstSentences(link.description || text, 320),
    overview: '',
    useFor: '',
    tasks: [],
    audience: '',
    features: [],
    quickStart: [],
    level: '',
    category,
    tags: normalizeTags(tags),
    // The words the website gives search engines are a good start.
    searchWords: (link.keywords ?? []).map(word => word.toLowerCase()).slice(0, 15),
    pricing: link.github?.license ? 'open-source' : 'unknown',
  };
}
