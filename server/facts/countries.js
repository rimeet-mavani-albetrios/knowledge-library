// Small helpers for "which country is this link from?" (kinds/place.js), with no paid service and no download:
// - countryFromText("Bengaluru, India") → "IN", for the free-text "location" on a GitHub profile
// - countryFromEnding("shop.example.in") → "IN", for a website whose address ends in a country's own ending
// - platformHome("https://www.youtube.com/watch?v=…") → { country: "US", domain: "youtube.com" }
// Country names come from Node itself (Intl.DisplayNames), so no list of countries has to be kept up to date here.
import { mainDomain } from '../robot/domain.js';

const NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

// Codes Node knows that are not countries today: old ones (UK, SU, YU…), groups (EU, UN) and test codes (XA).
const NOT_COUNTRIES = new Set([
  'AN', 'BU', 'CS', 'DD', 'DY', 'FX', 'HV', 'NH', 'RH', 'SU', 'TP', 'UK', 'VD', 'YD', 'YU', 'ZR',
  'AC', 'CP', 'CQ', 'DG', 'EA', 'EU', 'EZ', 'IC', 'QO', 'TA', 'UN', 'XA', 'XB', 'ZZ',
]);

// "US" → true; "EU", "XX" or "us" → false.
export function isCountry(code) {
  if (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code) || NOT_COUNTRIES.has(code)) return false;
  try {
    return NAMES.of(code) !== code;
  } catch {
    return false;
  }
}

// "  Côte d’Ivoire!" → "cote d ivoire": small letters, no accents, words split by single spaces.
const plain = text =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

// ---------- Names → codes ----------

// Other ways people write a country.
const COUNTRY_ALIASES = {
  US: ['usa', 'u s a', 'united states of america', 'the us', 'the usa'],
  GB: ['uk', 'u k', 'england', 'scotland', 'wales', 'northern ireland', 'great britain', 'britain'],
  AE: ['uae', 'u a e', 'emirates'],
  KR: ['korea', 'republic of korea'],
  CZ: ['czech republic'],
  NL: ['holland', 'the netherlands'],
  TR: ['turkey', 'turkiye'],
  RU: ['russian federation'],
  VN: ['viet nam'],
  HK: ['hong kong'],
  MO: ['macao', 'macau'],
  PS: ['palestine'],
  CD: ['dr congo', 'drc'],
  CI: ['ivory coast'],
  MM: ['burma'],
  SA: ['ksa'],
  CN: ['prc', 'mainland china'],
  DE: ['deutschland'],
  CH: ['schweiz', 'suisse'],
  ES: ['espana'],
  BR: ['brasil'],
  IN: ['bharat'],
};
// Country names that are also something else people write in a location: "Atlanta, Georgia" is in the US.
const SKIP_NAMES = new Set(['georgia']);

// Big tech cities and regions, for profiles that only name a city ("Berlin", "San Francisco Bay Area").
// Names used in two countries (Cambridge, Hyderabad in Pakistan…) are left out or go to the more likely one.
const PLACES = {
  US: [
    'san francisco', 'sf', 'bay area', 'silicon valley', 'new york city', 'nyc', 'brooklyn', 'manhattan', 'seattle',
    'austin', 'boston', 'los angeles', 'chicago', 'palo alto', 'mountain view', 'menlo park', 'cupertino', 'redmond',
    'denver', 'portland', 'atlanta', 'miami', 'san diego', 'san jose', 'oakland', 'berkeley', 'pittsburgh',
    'philadelphia', 'houston', 'dallas', 'salt lake city', 'jersey city', 'washington dc', 'raleigh', 'nashville',
    'minneapolis', 'detroit', 'phoenix', 'las vegas', 'boulder', 'sunnyvale', 'santa clara', 'stanford', 'new england',
    // US states, written out
    'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida',
    'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland',
    'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada',
    'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma',
    'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah',
    'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming',
  ],
  CA: ['toronto', 'vancouver', 'montreal', 'ottawa', 'calgary', 'waterloo', 'ontario', 'quebec', 'british columbia', 'alberta'],
  GB: ['london', 'manchester', 'edinburgh', 'bristol', 'glasgow', 'leeds', 'oxford'],
  IN: [
    'bengaluru', 'bangalore', 'mumbai', 'bombay', 'delhi', 'new delhi', 'hyderabad', 'pune', 'chennai', 'kolkata',
    'ahmedabad', 'surat', 'gurgaon', 'gurugram', 'noida', 'jaipur', 'kochi', 'indore', 'chandigarh', 'vadodara',
    'karnataka', 'maharashtra', 'gujarat', 'tamil nadu', 'kerala', 'telangana', 'uttar pradesh', 'west bengal',
    'rajasthan', 'haryana',
  ],
  DE: ['berlin', 'munich', 'munchen', 'hamburg', 'frankfurt', 'cologne', 'koln', 'stuttgart', 'bavaria'],
  FR: ['paris', 'lyon', 'toulouse', 'marseille', 'bordeaux', 'nantes'],
  NL: ['amsterdam', 'rotterdam', 'utrecht', 'eindhoven', 'the hague'],
  SE: ['stockholm', 'gothenburg', 'malmo'],
  DK: ['copenhagen'],
  NO: ['oslo'],
  FI: ['helsinki'],
  CH: ['zurich', 'geneva', 'lausanne', 'basel'],
  AT: ['vienna', 'wien'],
  IE: ['dublin'],
  PT: ['lisbon', 'porto'],
  ES: ['madrid', 'barcelona', 'valencia'],
  IT: ['milan', 'rome', 'turin'],
  PL: ['warsaw', 'krakow', 'wroclaw', 'gdansk', 'poznan'],
  CZ: ['prague', 'brno'],
  EE: ['tallinn'],
  UA: ['kyiv', 'kiev', 'lviv', 'kharkiv'],
  RU: ['moscow', 'saint petersburg', 'st petersburg'],
  TR: ['istanbul', 'ankara'],
  IL: ['tel aviv', 'jerusalem', 'haifa'],
  AE: ['dubai', 'abu dhabi'],
  SG: ['singapore'],
  CN: ['shanghai', 'beijing', 'shenzhen', 'hangzhou', 'guangzhou'],
  JP: ['tokyo', 'osaka', 'kyoto'],
  KR: ['seoul'],
  TW: ['taipei'],
  AU: ['sydney', 'melbourne', 'brisbane', 'perth', 'adelaide', 'new south wales', 'queensland'],
  NZ: ['auckland', 'wellington'],
  BR: ['sao paulo', 'rio de janeiro'],
  MX: ['mexico city'],
  AR: ['buenos aires'],
  CO: ['bogota', 'medellin'],
  NG: ['lagos', 'abuja'],
  KE: ['nairobi'],
  ZA: ['cape town', 'johannesburg'],
  EG: ['cairo'],
  ID: ['jakarta', 'bandung'],
  TH: ['bangkok'],
  PH: ['manila'],
  VN: ['ho chi minh city', 'hanoi', 'saigon'],
  MY: ['kuala lumpur'],
  PK: ['karachi', 'lahore', 'islamabad'],
  BD: ['dhaka'],
  GE: ['tbilisi'],
};

// US state codes that are no country's code ("Austin, TX"). "CA" is written for California far more than for Canada.
const US_STATE_CODES = new Set('AK CT DC FL HI IA KS MI ND NH NJ NM NV NY OH OK OR RI TX UT VT WA WI WV WY CA'.split(' '));
// State codes that are also a country's code ("IN" is Indiana and India): on their own they say nothing.
const UNCLEAR_CODES = new Set('AL AR AZ CO DE GA ID IL IN KY LA MA MD ME MN MO MS MT NC NE PA SC SD TN VA'.split(' '));
const CANADA_CODES = new Set(['ON', 'BC', 'QC', 'AB']);

// plain name → code, for countries ("india", "united states", "usa") and for places ("berlin", "texas").
const COUNTRY_BY_NAME = new Map();
const PLACE_BY_NAME = new Map();
for (let a = 65; a <= 90; a++) {
  for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    if (!isCountry(code)) continue;
    const name = NAMES.of(code); // "Bosnia & Herzegovina", "Myanmar (Burma)", "Hong Kong SAR China", "St. Lucia"
    const forms = [name, name.replace(/&/g, 'and'), name.replace(/\s*\(.*\)/, ''), name.replace(/ SAR China$/, ''), name.replace(/^St\. /, 'Saint ')];
    for (const form of forms.map(plain)) if (form && !SKIP_NAMES.has(form)) COUNTRY_BY_NAME.set(form, code);
  }
}
for (const [code, names] of Object.entries(COUNTRY_ALIASES)) for (const name of names) COUNTRY_BY_NAME.set(name, code);
for (const [code, names] of Object.entries(PLACES)) for (const name of names) PLACE_BY_NAME.set(name, code);
const LONGEST = 4; // words in the longest name we look for ("united states of america")

// A two-letter part, like the "TX" of "Austin, TX", the "DE" of "Berlin, DE" or a lone "US". `alone`: nothing else
// was written, so "CA" can't be read as California.
function codePart(part, alone) {
  const code = part.toUpperCase();
  if (code === 'UK') return { country: 'GB' };
  if (CANADA_CODES.has(code)) return alone ? {} : { place: 'CA' };
  if (US_STATE_CODES.has(code)) return alone ? {} : { place: 'US' };
  if (UNCLEAR_CODES.has(code)) return {};
  return isCountry(code) ? { country: code } : {};
}

// The country in a free-text location ("Bengaluru, India", "San Francisco, CA", "Berlin", "🇮🇳"), or null when the
// text names none ("Remote", "Earth") or names two different ones ("India / USA").
export function countryFromText(text) {
  const raw = String(text ?? '').slice(0, 200);
  const countries = new Set();
  const places = new Set();
  // A flag (two "regional indicator" letters) is a country code in disguise.
  for (const [flag] of raw.matchAll(/[\u{1F1E6}-\u{1F1FF}]{2}/gu)) {
    const code = String.fromCharCode(...[...flag].map(letter => letter.codePointAt(0) - 0x1f1e6 + 65));
    if (isCountry(code)) countries.add(code);
  }
  const parts = raw.split(/[,/|;·•()[\]\n]+|\s[-–—]\s/).map(plain).filter(Boolean);
  for (const part of parts) {
    if (/^[a-z]{2}$/.test(part)) {
      const { country, place } = codePart(part, parts.length === 1);
      if (country) countries.add(country);
      if (place) places.add(place);
      continue;
    }
    // The longest names first, so "new jersey" is the US state and not the island of Jersey.
    const words = part.split(' ');
    const used = new Array(words.length).fill(false);
    for (let size = Math.min(LONGEST, words.length); size >= 1; size--) {
      for (let start = 0; start + size <= words.length; start++) {
        if (used.slice(start, start + size).some(Boolean)) continue;
        const name = words.slice(start, start + size).join(' ');
        const country = COUNTRY_BY_NAME.get(name);
        const place = PLACE_BY_NAME.get(name);
        // "us" and "uk" only count as a whole part ("Remote, US"), never inside a sentence ("join us").
        if (country && !(name.length <= 2 && words.length > 1)) countries.add(country);
        else if (place) places.add(place);
        else continue;
        used.fill(true, start, start + size);
      }
    }
  }
  if (countries.size === 1) return [...countries][0];
  if (countries.size === 0 && places.size === 1) return [...places][0];
  return null;
}

// ---------- Address endings ----------

// Endings that people use for websites from their own country. Endings sold worldwide as short, catchy names
// (.io .ai .co .me .tv .gg .so .sh .to .ly .fm .am .im .cc .ws .is .md .st…) are never used, nor .app or .dev.
const COUNTRY_ENDINGS = {
  in: 'IN', ae: 'AE', uk: 'GB', de: 'DE', fr: 'FR', pl: 'PL', nl: 'NL', es: 'ES', it: 'IT', jp: 'JP', kr: 'KR', br: 'BR',
  ca: 'CA', au: 'AU', sg: 'SG', ch: 'CH', se: 'SE', no: 'NO', dk: 'DK', fi: 'FI', at: 'AT', be: 'BE', ie: 'IE', pt: 'PT',
  cz: 'CZ', sk: 'SK', hu: 'HU', ro: 'RO', bg: 'BG', gr: 'GR', hr: 'HR', si: 'SI', ee: 'EE', lv: 'LV', lt: 'LT', lu: 'LU',
  ua: 'UA', ru: 'RU', tr: 'TR', il: 'IL', sa: 'SA', qa: 'QA', kw: 'KW', om: 'OM', bh: 'BH', eg: 'EG', za: 'ZA', ng: 'NG',
  ke: 'KE', pk: 'PK', bd: 'BD', lk: 'LK', np: 'NP', cn: 'CN', hk: 'HK', tw: 'TW', id: 'ID', my: 'MY', th: 'TH', vn: 'VN',
  ph: 'PH', nz: 'NZ', mx: 'MX', ar: 'AR', cl: 'CL', pe: 'PE', uy: 'UY', us: 'US',
};

// "docs.example.co.in" → { country: "IN", ending: ".in" }, or null.
export function countryFromEnding(host) {
  const ending = String(host ?? '').toLowerCase().replace(/\.$/, '').split('.').at(-1);
  return COUNTRY_ENDINGS[ending] ? { country: COUNTRY_ENDINGS[ending], ending: `.${ending}` } : null;
}

// ---------- Big platforms ----------

// Websites full of other people's pages, and where the company behind each one is based. A video's own maker is
// unknown, so the platform's home is the best answer. It also beats the website's own legal page: amazon.in's names
// Amazon's Indian branch and noon.com's its Saudi one, but both companies are run from elsewhere.
const PLATFORM_HOMES = {
  'youtube.com': 'US', 'youtu.be': 'US', 'vimeo.com': 'US', 'noon.com': 'AE', 'flipkart.com': 'IN', 'skool.com': 'US',
  'npmjs.com': 'US', 'pypi.org': 'US', 'gitlab.com': 'US', 'medium.com': 'US', 'substack.com': 'US', 'dev.to': 'US',
  'dribbble.com': 'US', 'behance.net': 'US', 'producthunt.com': 'US', 'reddit.com': 'US', 'x.com': 'US',
  'twitter.com': 'US', 'linkedin.com': 'US', 'facebook.com': 'US', 'instagram.com': 'US', 'threads.net': 'US',
  'etsy.com': 'US', 'ebay.com': 'US', 'aliexpress.com': 'CN', 'discord.com': 'US', 'discord.gg': 'US', 't.me': 'AE',
  'udemy.com': 'US', 'coursera.org': 'US', 'gumroad.com': 'US', 'kaggle.com': 'US', 'linktr.ee': 'AU',
};
const ANY_ENDING = { amazon: 'US' }; // amazon.com, amazon.in, amazon.co.uk, amazon.ae…

export function platformHome(url) {
  const domain = mainDomain(url);
  const country = PLATFORM_HOMES[domain] ?? ANY_ENDING[domain.split('.')[0]];
  return country ? { country, domain } : null;
}
