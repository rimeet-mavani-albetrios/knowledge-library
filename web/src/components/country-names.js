// Country names and flags from two-letter codes ("US"), for the world map, the filters, the Stats page and the
// facts cards (facts/places.js passes these on). The browser knows the names itself (Intl.DisplayNames), so no list
// of countries has to be downloaded. To show a flag inside a page, use <Flag code="US" /> (Flag.jsx): it draws the
// flag, or a small "US" label on computers that can't draw flags (Windows shows flag emoji as two plain letters).

const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
// Short names for chips, the way people say them.
const SHORT = { US: 'USA', GB: 'UK', AE: 'UAE', KR: 'South Korea', CZ: 'Czechia', RU: 'Russia' };

// "US" → "United States" ({ short: true } → "USA"). An unknown code stays as it is; no code gives "".
export function countryName(code, { short = false } = {}) {
  if (!code) return '';
  if (short && SHORT[code]) return SHORT[code];
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

let flagsWork = null; // worked out once, the first time a flag is needed

// Can this browser draw flag emoji? A flag is two "regional indicator" letters that the emoji font joins into one
// picture. Where it can't (Windows), they show as two letters ("US"). Checked by drawing one on a small hidden
// canvas: a real flag is one letter wide and colored (Switzerland: red and white), the letters are two wide and gray.
export function flagEmojiWorks() {
  if (flagsWork !== null) return flagsWork;
  flagsWork = (() => {
    if (typeof document === 'undefined') return true;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return false;
      ctx.font = '24px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
      const swiss = '\u{1F1E8}\u{1F1ED}';
      const pair = ctx.measureText(swiss).width;
      const letter = ctx.measureText('\u{1F1E8}').width;
      if (!(pair > 0) || pair > letter * 1.5) return false;
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#000';
      ctx.fillText(swiss, 0, 0);
      const pixels = ctx.getImageData(0, 0, 32, 32).data;
      for (let i = 0; i < pixels.length; i += 4) {
        const [r, g, b, a] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
        if (a > 60 && Math.max(r, g, b) - Math.min(r, g, b) > 60) return true;
      }
      return false;
    } catch {
      return false; // a browser that hides the canvas (privacy settings): the letters always work
    }
  })();
  return flagsWork;
}

// "US" → 🇺🇸 as text, or "" where the browser would show it as two plain letters (the name next to it says enough).
export const countryFlag = code =>
  /^[A-Z]{2}$/.test(code ?? '') && flagEmojiWorks()
    ? String.fromCodePoint(...[...code].map(letter => 0x1f1a5 + letter.charCodeAt(0)))
    : '';

// The link's one country from its website facts: the `place` fact once the robot has worked it out (it already
// weighs the company's own page, Wikidata, other pages of the same website…), before that the company or Wikidata.
// The same order as COUNTRY_OF on the server, so cards, filters and the map always agree.
export function countryOf(facts = {}) {
  const code = String((facts.place !== undefined ? facts.place?.country : facts.company?.country || facts.wikidata?.country) ?? '').toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : '';
}

// Where the country of `place` came from, in a few quiet words: "same website as doubletick.io".
export function countrySource(place) {
  switch (place?.source) {
    case 'company':
      return 'from the website’s own legal pages';
    case 'wikidata':
      return 'from Wikidata';
    case 'website':
      return place.from ? `same website as ${place.from}` : 'from another page of the same website';
    case 'github':
      return place.location ? `GitHub owner’s profile: “${place.location}”` : 'GitHub owner’s profile';
    case 'platform':
      return place.from ? `where ${place.from} is based` : 'where the website is based';
    case 'ending':
      return place.from ? `guessed from the ${place.from} ending` : 'guessed from the address';
    default:
      return '';
  }
}
