// Country names and flags from 2-letter codes ("US" → "United States", 🇺🇸), for the facts cards.
const names = new Intl.DisplayNames(['en'], { type: 'region' });
// Short names for the chips, the way people say them.
const SHORT = { US: 'USA', GB: 'UK', AE: 'UAE', KR: 'South Korea', CZ: 'Czechia', RU: 'Russia' };

export function countryName(code, { short = false } = {}) {
  if (!code) return '';
  if (code === 'EU') return 'the EU';
  if (short && SHORT[code]) return SHORT[code];
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

export function flag(code) {
  if (!/^[A-Z]{2}$/.test(code ?? '')) return '';
  return String.fromCodePoint(...[...code].map(letter => 0x1f1e6 + letter.charCodeAt(0) - 65));
}
