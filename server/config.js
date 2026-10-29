// Settings that come from environment variables (see .env.example), in one place.
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export const CATEGORIES = [
  'AI Tool',
  'AI Model & Benchmark',
  'Agents, Skills & MCP',
  'Prompts',
  'Developer Tool',
  'Code Library',
  'UI Components',
  'Backend & Hosting',
  'Testing',
  'Design',
  'Workflows & Automation',
  'Productivity',
  'Marketing & Social Media',
  'Sales & CRM',
  'Messaging & Email',
  'Startup & Business',
  'Finance',
  'Directory & List',
  'Tutorial & Course',
  'Documentation',
  'Article',
  'Video & Podcast',
  'Book',
  'Community',
  'News',
  'Shopping',
  'Dataset',
  'Other',
];

export const PRICING = ['free', 'open-source', 'freemium', 'paid', 'unknown'];

export const settings = {
  port: Number(process.env.PORT ?? 4747), // 4747 so it doesn't clash with other projects on 3000
  title: process.env.LIBRARY_TITLE || 'Knowledge Library',
  privateLibrary: process.env.PRIVATE_LIBRARY === 'true',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  sessionSecret: process.env.SESSION_SECRET ?? '',
  databaseUrl: process.env.DATABASE_URL ?? '',
  embeddingModel: 'Xenova/all-MiniLM-L6-v2',
  modelCacheDir: path.join(ROOT, '.cache', 'models'),
  pageSize: 24,
};

// Groq's free plan by default. Any OpenAI-compatible service works with AI_BASE_URL + AI_API_KEY.
// Each Groq model has its own daily limit, so the robot moves to the next model when one runs out.
export const ai = process.env.AI_BASE_URL
  ? {
      endpoint: `${process.env.AI_BASE_URL.replace(/\/$/, '')}/chat/completions`,
      apiKey: process.env.AI_API_KEY ?? '',
      models: (process.env.AI_MODELS ?? '').split(',').map(model => model.trim()).filter(Boolean),
    }
  : {
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey: process.env.GROQ_API_KEY ?? '',
      // (llama-3.1-8b-instant left this list in October 2026: Groq no longer offers it.)
      models: (process.env.AI_MODELS || 'openai/gpt-oss-20b,openai/gpt-oss-120b')
        .split(',')
        .map(model => model.trim())
        .filter(Boolean),
    };
