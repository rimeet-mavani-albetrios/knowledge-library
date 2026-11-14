// Which website a link belongs to. "docs.wati.io/pricing" and "wati.io" are the same website (wati.io), so the
// library can say "you already saved this website" and let pages of one company share facts like its country.
// Some websites hold many different things (every GitHub project, every YouTube video): there each page is its own.

// Endings that take two parts, like "co.uk": the website is the name in front of them ("bbc.co.uk").
const TWO_PART_ENDINGS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in',
  'firm.in', 'gen.in', 'ind.in', 'co.nz', 'co.jp', 'co.kr', 'co.za', 'co.id', 'co.il', 'com.br', 'com.mx', 'com.ar', 'com.sg',
  'com.my', 'com.tr', 'com.cn', 'com.hk', 'com.tw', 'com.pk', 'com.bd', 'com.ng', 'com.eg', 'com.sa', 'com.ua', 'com.vn',
  'com.ph', 'com.co',
]);

// Hosting addresses where every name in front is someone else's website ("my-app.vercel.app").
const HOSTED_ENDINGS = [
  'vercel.app', 'netlify.app', 'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'herokuapp.com', 'onrender.com', 'web.app',
  'firebaseapp.com', 'notion.site', 'framer.website', 'framer.app', 'framer.ai', 'webflow.io', 'substack.com', 'medium.com',
  'blogspot.com', 'wordpress.com', 'carrd.co', 'bubbleapps.io', 'replit.app', 'repl.co', 'lovable.app', 'glitch.me', 'gitbook.io',
  'readthedocs.io', 'super.site', 'wixsite.com', 'hashnode.dev', 'streamlit.app', 'hf.space', 'fly.dev', 'up.railway.app',
  'railway.app', 'surge.sh', 'mintlify.app', 'softr.app', 'beehiiv.com', 'ghost.io', 'myshopify.com', 'azurewebsites.net',
  'appspot.com', 'amplifyapp.com', 'deno.dev',
];

// Big websites that hold many different things: two pages there are two different links, not one website twice.
const PLATFORMS = new Set([
  'github.com', 'gitlab.com', 'bitbucket.org', 'youtube.com', 'youtu.be', 'vimeo.com', 'medium.com', 'dev.to', 'substack.com',
  'hashnode.com', 'amazon.com', 'amazon.in', 'amazon.co.uk', 'amazon.de', 'amazon.ae', 'flipkart.com', 'noon.com', 'etsy.com',
  'ebay.com', 'aliexpress.com', 'skool.com', 'npmjs.com', 'pypi.org', 'huggingface.co', 'kaggle.com', 'producthunt.com', 'x.com',
  'twitter.com', 'linkedin.com', 'reddit.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'threads.net', 't.me', 'discord.com',
  'discord.gg', 'google.com', 'apple.com', 'microsoft.com', 'dribbble.com', 'behance.net', 'figma.com', 'notion.so', 'goodreads.com',
  'udemy.com', 'coursera.org', 'wikipedia.org', 'stackoverflow.com', 'apify.com', 'gumroad.com', 'chatgpt.com',
]);

function hostOf(input) {
  try {
    const url = new URL(String(input).trim());
    return /^https?:$/.test(url.protocol) ? url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '') : '';
  } catch {
    return '';
  }
}

// "https://docs.wati.io/pricing" → "wati.io"; "https://my-app.vercel.app" → "my-app.vercel.app"; "" when it isn't a web address.
export function mainDomain(input) {
  const host = hostOf(input);
  if (!host || /^[\d.]+$/.test(host) || !host.includes('.')) return host;
  const parts = host.split('.');
  const hosted = HOSTED_ENDINGS.find(ending => host.endsWith(`.${ending}`));
  if (hosted) return parts.slice(-(hosted.split('.').length + 1)).join('.');
  const keep = TWO_PART_ENDINGS.has(parts.slice(-2).join('.')) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

// True for websites like GitHub or YouTube, where each page is a different thing.
export function isPlatform(input) {
  const domain = mainDomain(input);
  return PLATFORMS.has(domain) || PLATFORMS.has(hostOf(input));
}
