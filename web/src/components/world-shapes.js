// The shapes of the countries for WorldMap.jsx, worked out once. This file (with the map data and the map maths) is
// loaded only when a map is first shown, so the rest of the site doesn't wait for it.
// The map data (world-atlas, "110m": small and simple) names countries by number (840 = United States); the rest of
// the app uses two-letter codes ("US"), so ISO_CODES turns one into the other.
import { feature } from 'topojson-client';
import { geoEqualEarth, geoPath } from 'd3-geo';
import world from 'world-atlas/countries-110m.json';

export const WIDTH = 960;
export const HEIGHT = 421; // the world without Antarctica is this tall at this width (Equal Earth projection)

const ISO_CODES = {
  '004': 'AF', '008': 'AL', '010': 'AQ', '012': 'DZ', '024': 'AO', '031': 'AZ', '032': 'AR', '036': 'AU', '040': 'AT',
  '044': 'BS', '050': 'BD', '051': 'AM', '056': 'BE', '064': 'BT', '068': 'BO', '070': 'BA', '072': 'BW', '076': 'BR',
  '084': 'BZ', '090': 'SB', '096': 'BN', '100': 'BG', '104': 'MM', '108': 'BI', '112': 'BY', '116': 'KH', '120': 'CM',
  '124': 'CA', '140': 'CF', '144': 'LK', '148': 'TD', '152': 'CL', '156': 'CN', '158': 'TW', '170': 'CO', '178': 'CG',
  '180': 'CD', '188': 'CR', '191': 'HR', '192': 'CU', '196': 'CY', '203': 'CZ', '204': 'BJ', '208': 'DK', '214': 'DO',
  '218': 'EC', '222': 'SV', '226': 'GQ', '231': 'ET', '232': 'ER', '233': 'EE', '238': 'FK', '242': 'FJ', '246': 'FI',
  '250': 'FR', '260': 'TF', '262': 'DJ', '266': 'GA', '268': 'GE', '270': 'GM', '275': 'PS', '276': 'DE', '288': 'GH',
  '300': 'GR', '304': 'GL', '320': 'GT', '324': 'GN', '328': 'GY', '332': 'HT', '340': 'HN', '348': 'HU', '352': 'IS',
  '356': 'IN', '360': 'ID', '364': 'IR', '368': 'IQ', '372': 'IE', '376': 'IL', '380': 'IT', '384': 'CI', '388': 'JM',
  '392': 'JP', '398': 'KZ', '400': 'JO', '404': 'KE', '408': 'KP', '410': 'KR', '414': 'KW', '417': 'KG', '418': 'LA',
  '422': 'LB', '426': 'LS', '428': 'LV', '430': 'LR', '434': 'LY', '440': 'LT', '442': 'LU', '450': 'MG', '454': 'MW',
  '458': 'MY', '466': 'ML', '478': 'MR', '484': 'MX', '496': 'MN', '498': 'MD', '499': 'ME', '504': 'MA', '508': 'MZ',
  '512': 'OM', '516': 'NA', '524': 'NP', '528': 'NL', '540': 'NC', '548': 'VU', '554': 'NZ', '558': 'NI', '562': 'NE',
  '566': 'NG', '578': 'NO', '586': 'PK', '591': 'PA', '598': 'PG', '600': 'PY', '604': 'PE', '608': 'PH', '616': 'PL',
  '620': 'PT', '624': 'GW', '626': 'TL', '630': 'PR', '634': 'QA', '642': 'RO', '643': 'RU', '646': 'RW', '682': 'SA',
  '686': 'SN', '688': 'RS', '694': 'SL', '703': 'SK', '704': 'VN', '705': 'SI', '706': 'SO', '710': 'ZA', '716': 'ZW',
  '724': 'ES', '728': 'SS', '729': 'SD', '732': 'EH', '740': 'SR', '748': 'SZ', '752': 'SE', '756': 'CH', '760': 'SY',
  '762': 'TJ', '764': 'TH', '768': 'TG', '780': 'TT', '784': 'AE', '788': 'TN', '792': 'TR', '795': 'TM', '800': 'UG',
  '804': 'UA', '807': 'MK', '818': 'EG', '826': 'GB', '834': 'TZ', '840': 'US', '854': 'BF', '858': 'UY', '860': 'UZ',
  '862': 'VE', '887': 'YE', '894': 'ZM',
};
// Three shapes have no number in the map data.
const BY_NAME = { Kosovo: 'XK', 'N. Cyprus': 'CY', Somaliland: 'SO' };

// Countries too small for this map, where companies are often based: they get a dot instead. [code, longitude, latitude]
const SMALL = [
  ['SG', 103.82, 1.35], ['HK', 114.17, 22.32], ['MO', 113.55, 22.17], ['MT', 14.45, 35.9], ['BH', 50.55, 26.07],
  ['MC', 7.42, 43.74], ['LI', 9.55, 47.16], ['AD', 1.52, 42.51], ['SM', 12.46, 43.94], ['GI', -5.35, 36.14],
  ['JE', -2.13, 49.21], ['GG', -2.58, 49.45], ['IM', -4.55, 54.23], ['MU', 57.55, -20.25], ['SC', 55.45, -4.68],
  ['MV', 73.5, 4.17], ['BB', -59.55, 13.19], ['BM', -64.75, 32.3], ['KY', -81.25, 19.31], ['VG', -64.62, 18.42],
  ['AG', -61.8, 17.07], ['LC', -60.98, 13.9], ['GD', -61.68, 12.12], ['KN', -62.75, 17.33], ['AW', -69.97, 12.52],
  ['CW', -68.99, 12.17], ['CV', -23.6, 15.1], ['WS', -172.1, -13.76], ['TO', -175.2, -21.18], ['PF', -149.4, -17.6],
  ['GU', 144.79, 13.44],
];

// [{ code, d }] for the countries (Antarctica left out: nothing comes from there and it takes a lot of room),
// and [{ code, x, y }] for the small ones.
export function worldShapes() {
  const countries = feature(world, world.objects.countries).features.filter(country => country.id !== '010');
  const projection = geoEqualEarth().fitSize([WIDTH, HEIGHT], { type: 'FeatureCollection', features: countries });
  const path = geoPath(projection).digits(1);
  const shapes = countries
    .map(country => ({ code: ISO_CODES[country.id] ?? BY_NAME[country.properties.name] ?? '', d: path(country) }))
    .filter(shape => shape.code && shape.d);
  const drawn = new Set(shapes.map(shape => shape.code));
  const dots = SMALL.filter(([code]) => !drawn.has(code)).map(([code, lon, lat]) => {
    const [x, y] = projection([lon, lat]);
    return { code, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  });
  return { shapes, dots };
}
