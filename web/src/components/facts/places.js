// Country names and flags for the facts cards ("US" → "United States", 🇺🇸). The same helpers as
// ../country-names.js (one list for the whole site); only "EU" reads "the EU" here ("Your data is kept in the EU").
import { countryFlag, countryName as nameOf } from '../country-names.js';

export { countryOf, countrySource } from '../country-names.js';

export function countryName(code, options) {
  return code === 'EU' ? 'the EU' : nameOf(code, options);
}

// 🇺🇸 as text, or "" where the browser can't draw flags. Inside a page, <Flag code="US" /> (../Flag.jsx) is nicer.
export const flag = countryFlag;
