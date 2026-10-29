// Country names and flags from two-letter codes ("US"), for the world map, the filters and the Stats page.
// The browser knows the names itself (Intl.DisplayNames), so no list of countries has to be downloaded.

const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;

// "US" → "United States". An unknown code stays as it is.
export function countryName(code) {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

// "US" → 🇺🇸 (two "regional indicator" letters, which phones and Macs show as a flag).
export const countryFlag = code =>
  /^[A-Z]{2}$/.test(code ?? '') ? String.fromCodePoint(...[...code].map(letter => 0x1f1a5 + letter.charCodeAt(0))) : '';
