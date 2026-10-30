// Which website a link belongs to, for the facts that look a website up by its name: Cloudflare Radar wants its
// domain ("cursor.com" for docs.cursor.com), YouTube its name ("Cursor"). Both are null when the answer would be
// about someone else: a GitHub repository is not github.com, and a blog on vercel.app is not Vercel.
import { hostOf, sourceOf } from '../robot/url.js';
import { parseRepo } from '../robot/github.js';

// Big websites full of other people's pages. Only their home page is about the website itself.
const PLATFORMS = new Set([
  'github.com', 'gitlab.com', 'bitbucket.org', 'youtube.com', 'youtu.be', 'medium.com', 'dev.to', 'hashnode.com',
  'x.com', 'twitter.com', 'linkedin.com', 'reddit.com', 'facebook.com', 'instagram.com', 'threads.net', 'tiktok.com',
  'pinterest.com', 'quora.com', 'news.ycombinator.com', 'producthunt.com', 'huggingface.co', 'npmjs.com', 'pypi.org',
  'chromewebstore.google.com', 'chrome.google.com', 'apps.apple.com', 'play.google.com', 'docs.google.com',
  'drive.google.com', 'sites.google.com', 'addons.mozilla.org', 'marketplace.visualstudio.com', 'gumroad.com',
  'notion.so', 'dribbble.com', 'behance.net', 'amazon.com', 'amazon.in', 'flipkart.com', 't.me', 'discord.com', 'discord.gg',
]);

// Hosting where every name.host.app is someone's own site: the host's popularity says nothing about it.
const SHARED_HOSTS = [
  'github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'notion.site', 'substack.com',
  'medium.com', 'herokuapp.com', 'web.app', 'firebaseapp.com', 'appspot.com', 'framer.website', 'framer.ai', 'framer.app',
  'webflow.io', 'carrd.co', 'gitbook.io', 'readthedocs.io', 'wordpress.com', 'blogspot.com', 'replit.app', 'repl.co',
  'streamlit.app', 'glitch.me', 'onrender.com', 'fly.dev', 'railway.app', 'wixsite.com', 'super.site', 'softr.app',
  'lovable.app', 'bubbleapps.io', 'hashnode.dev', 'mintlify.app', 'ghost.io', 'beehiiv.com', 'myshopify.com',
  'square.site', 'tilda.ws', 'hf.space', 'azurewebsites.net', 'cloudfront.net', 'amplifyapp.com', 'surge.sh', 'deno.dev',
];

// Websites where only some pages are other people's: a Figma design file is not about Figma.
const USER_PAGES = {
  'figma.com': /^\/(design|file|proto|board|slides|community\/file)\//,
  'canva.com': /^\/design\//,
  'loom.com': /^\/share\//,
};

// "bbc.co.uk" is one website, not a page of "co.uk".
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ne', 'or', 'go', 'gen', 'ltd', 'plc', 'nom', 'int']);

const isHomePage = url => {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') === '';
  } catch {
    return false;
  }
};

export function baseDomain(host) {
  const parts = host.split('.');
  const longSuffix = parts.length > 2 && parts.at(-1).length === 2 && SECOND_LEVEL.has(parts.at(-2));
  return parts.slice(longSuffix ? -3 : -2).join('.');
}

// The domain to look up, or null when the link is a page on someone else's website (or has no real domain).
export function siteDomain(link) {
  const host = hostOf(link.url);
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')) return null;
  if (SHARED_HOSTS.some(shared => host.endsWith(`.${shared}`))) return null;
  const domain = baseDomain(host);
  if ((PLATFORMS.has(host) || PLATFORMS.has(domain)) && !isHomePage(link.url)) return null;
  if (USER_PAGES[domain]?.test(new URL(link.url).pathname)) return null;
  return domain;
}

// Separators between a website's name and the rest: "Supergrow - AI LinkedIn Ghostwriter", "Pricing | Wati".
const TITLE_PARTS = /\s+[|–—\-:·•]\s+/;
const GENERIC_NAMES = /^(home|homepage|welcome|index|untitled|dashboard|login|log in|sign in|sign up|pricing|blog|docs)$/i;
// "Cursor Docs" → "Cursor": nobody searches YouTube for "Cursor Docs tutorial".
const PAGE_WORDS = /\s+(docs|documentation|blog|pricing|plans|help( center)?|guide|support|api|app|official (site|website)|home( ?page)?)$/i;
const plain = text => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const looksLikeDomain = text => /^[\w-]+(\.[\w-]+)+$/.test(text); // "zapier.com" as the site's name

// The name people would type into YouTube, or null when it would find videos about something else.
export function siteName(link) {
  const source = link.source ?? sourceOf(link.url);
  if (source === 'youtube') return null;
  if (source === 'github') {
    // "langchain" is clear on its own; "ui" needs its owner: "shadcn ui".
    const repo = parseRepo(link.url);
    if (!repo) return null;
    if (repo.name.length >= 5) return repo.name;
    const owner = repo.owner.replace(/[-_.]+/g, ' ');
    return owner.toLowerCase().split(' ').includes(repo.name.toLowerCase()) ? owner : `${owner} ${repo.name}`;
  }
  const domain = siteDomain(link);
  if (!domain) return null;
  const label = domain.split('.')[0];
  const usable = text => {
    const name = String(text ?? '').trim().replace(PAGE_WORDS, '');
    return name && name.length <= 40 && !GENERIC_NAMES.test(name) && !looksLikeDomain(name) ? name : '';
  };
  // The website's own name first, then the part of the page title with the domain in it ("Wati" in "Pricing | Wati").
  const titlePart = (link.title ?? '').split(TITLE_PARTS).find(part => plain(part).includes(plain(label)));
  return usable(link.site_name ?? link.siteName) || usable(titlePart) || label.charAt(0).toUpperCase() + label.slice(1);
}
