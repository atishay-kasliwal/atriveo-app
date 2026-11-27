/**
 * Where you are: the US states you want jobs in, and whether remote / US-wide postings count too.
 * Today, Staffing and the phone app use it to star nearby jobs and put them first. Shared by the
 * browser, the Staffing server and the settings API, so all three read a location the same way.
 */

const STATE_LIST = 'AL|Alabama;AK|Alaska;AZ|Arizona;AR|Arkansas;CA|California;CO|Colorado;CT|Connecticut;DE|Delaware;DC|District of Columbia;FL|Florida;GA|Georgia;HI|Hawaii;ID|Idaho;IL|Illinois;IN|Indiana;IA|Iowa;KS|Kansas;KY|Kentucky;LA|Louisiana;ME|Maine;MD|Maryland;MA|Massachusetts;MI|Michigan;MN|Minnesota;MS|Mississippi;MO|Missouri;MT|Montana;NE|Nebraska;NV|Nevada;NH|New Hampshire;NJ|New Jersey;NM|New Mexico;NY|New York;NC|North Carolina;ND|North Dakota;OH|Ohio;OK|Oklahoma;OR|Oregon;PA|Pennsylvania;RI|Rhode Island;SC|South Carolina;SD|South Dakota;TN|Tennessee;TX|Texas;UT|Utah;VT|Vermont;VA|Virginia;WA|Washington;WV|West Virginia;WI|Wisconsin;WY|Wyoming'
  .split(';').map((s) => s.split('|'));

/** Every state you can pick, in alphabetical order of its name: [code, name]. */
export const STATES = STATE_LIST.map(([code, name]) => [code, name]).sort((a, b) => a[1].localeCompare(b[1]));
const CODES = new Set(STATE_LIST.map(([code]) => code));
const BY_NAME = new Map(STATE_LIST.map(([code, name]) => [name.toLowerCase(), code]));

/** What you start with when nothing is saved. */
export const DEFAULT_PLACE = Object.freeze({ states: Object.freeze(['WA', 'IL', 'MI']), remote: true });

/**
 * Big job markets named without a state ("Greater Seattle Area", "New York City Metropolitan Area").
 * Only read when a part of the location carries no state of its own.
 */
const METROS = [
  ['Seattle', 'WA'], ['Bellevue', 'WA'], ['Redmond', 'WA'], ['Tacoma', 'WA'], ['Spokane', 'WA'],
  ['Chicago', 'IL'], ['Detroit', 'MI'], ['Ann Arbor', 'MI'], ['Grand Rapids', 'MI'],
  ['San Francisco', 'CA'], ['Bay Area', 'CA'], ['Silicon Valley', 'CA'], ['San Jose', 'CA'], ['Los Angeles', 'CA'], ['San Diego', 'CA'],
  ['New York City', 'NY'], ['New York', 'NY'], ['Boston', 'MA'], ['Washington DC', 'DC'], ['Washington D\\.C\\.', 'DC'],
  ['Dallas', 'TX'], ['Fort Worth', 'TX'], ['Houston', 'TX'], ['Austin', 'TX'], ['Atlanta', 'GA'], ['Denver', 'CO'],
  ['Phoenix', 'AZ'], ['Minneapolis', 'MN'], ['Philadelphia', 'PA'], ['Pittsburgh', 'PA'], ['Miami', 'FL'], ['Tampa', 'FL'],
  ['Orlando', 'FL'], ['Raleigh', 'NC'], ['Research Triangle', 'NC'], ['Charlotte', 'NC'], ['Nashville', 'TN'],
  ['Salt Lake City', 'UT'], ['Columbus', 'OH'], ['Cleveland', 'OH'], ['Cincinnati', 'OH'], ['St\\.? Louis', 'MO'],
  ['Kansas City', 'MO'], ['Indianapolis', 'IN'], ['Milwaukee', 'WI'], ['Baltimore', 'MD'], ['Las Vegas', 'NV'],
].map(([name, code]) => [new RegExp(`\\b${name}\\b`, 'i'), code]);

const COUNTRY_US = /^(?:us|usa|u\.s\.a?\.?|united states(?: of america)?)$/i;

/** A state code from one comma part: "WA", "wa", "Washington", "D.C.". */
function code(part) {
  const p = part.replace(/\./g, '').trim();
  if (/^[a-z]{2}$/i.test(p) && CODES.has(p.toUpperCase())) return p.toUpperCase();
  return BY_NAME.get(p.toLowerCase());
}

/** The states a location names, e.g. "Austin, TX; Chicago, IL" → TX, IL. Foreign places name none. */
export function statesIn(location) {
  const found = new Set();
  if (!location) return found;
  const text = String(location).replace(/&amp;/gi, '&').replace(/&nbsp;| /gi, ' ');
  for (const raw of text.split(/[;|/()]|\s+or\s+/i)) {
    const segment = raw.trim();
    if (!segment) continue;
    // "Portland, Oregon Metropolitan Area" → "Portland, Oregon"; a ZIP or the country after the state is dropped.
    const parts = segment.split(',').map((p) => p.replace(/^greater\s+/i, '').replace(/\s+(?:metropolitan|metro)?\s*area$/i, '').trim()).filter(Boolean);
    while (parts.length > 1 && (COUNTRY_US.test(parts.at(-1)) || /^\d{5}(?:-\d{4})?$/.test(parts.at(-1)))) parts.pop();
    // "Seattle, WA" or "Seattle, Washington": the state is last.
    const last = parts.length > 1 ? code(parts.at(-1)) : undefined;
    if (last) { found.add(last); continue; }
    // Staffing feeds put the code first: "CA - Sunnyvale", "NY New York".
    const prefix = segment.match(/^([A-Z]{2})\s*(?:[-–—:]\s*|\s)\S/);
    if (prefix && CODES.has(prefix[1])) { found.add(prefix[1]); continue; }
    // A state on its own: "Washington", "New Jersey, USA".
    const only = parts.length === 1 ? code(parts[0]) : undefined;
    if (only) { found.add(only); continue; }
    const metro = METROS.find(([re]) => re.test(segment));
    if (metro) found.add(metro[1]);
  }
  return found;
}

const REMOTE = /\b(?:remote|work from home|wfh|telecommute|anywhere)\b/i;
/** "US" and "USA" in capitals only, so "us" in a sentence doesn't count. */
const mentionsUs = (s) => /\b(?:US|USA|U\.S\.A?\.?)\b/.test(s) || /\bunited states\b/i.test(s);
/** Words that say how remote, not where: "Nationwide Remote", "Remote - Fully", "100% remote". */
const FILLER = /\b(?:remote|work|from|home|wfh|telecommute|anywhere|nationwide|fully|full|time|first|only|based|location|locations|in|the|position|role|100%?|us|usa|united|states|of|america)\b|[-–—:,.%()]/gi;

/**
 * A posting anyone in the US can take: remote within the US, or the whole country ("USA", "United States",
 * "Nationwide"). "Remote - Singapore" and "Ireland (Remote-First)" are not.
 */
export function remoteOrUs(location) {
  if (!location) return false;
  const text = String(location).trim();
  if (COUNTRY_US.test(text) || /^nationwide$/i.test(text)) return true;
  if (!REMOTE.test(text) && !/\bnationwide\b/i.test(text)) return false;
  if (mentionsUs(text) || statesIn(text).size) return true;
  return text.replace(FILLER, ' ').trim() === '';
}

/**
 * How near a posting is to you: 3 = in the state you are in right now (place.here, from "Use my location"),
 * 2 = in one of your saved states, 1 = remote or US-wide (when you count those), 0 = anywhere else.
 * Higher comes first and gets the star.
 */
export function placeRank(location, place) {
  const p = place || DEFAULT_PLACE;
  const states = statesIn(location);
  if (p.here && states.has(p.here)) return 3;
  if (p.states.some((s) => states.has(s))) return 2;
  if (p.remote && remoteOrUs(location)) return 1;
  return 0;
}

/** A saved or submitted place, cleaned: known state codes only (at most 20, no repeats), remote a boolean. */
export function normalizePlace(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { states: [...DEFAULT_PLACE.states], remote: DEFAULT_PLACE.remote };
  const states = Array.isArray(input.states)
    ? [...new Set(input.states.filter((s) => typeof s === 'string').map((s) => s.trim().toUpperCase()).filter((s) => CODES.has(s)))].slice(0, 20)
    : [...DEFAULT_PLACE.states];
  return { states, remote: typeof input.remote === 'boolean' ? input.remote : DEFAULT_PLACE.remote };
}

/** A submitted place, or null if it holds anything that isn't a known state code or a boolean. */
export function parsePlace(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if ('states' in input && (!Array.isArray(input.states) || input.states.length > 20 || !input.states.every((s) => typeof s === 'string' && CODES.has(s.toUpperCase())))) return null;
  if ('remote' in input && typeof input.remote !== 'boolean') return null;
  return normalizePlace(input);
}

/** The place as query parameters for the Staffing server: "near=WA,IL,MI&remote=1", plus "&here=WA" when known. */
export function placeQuery(place) {
  const p = place || DEFAULT_PLACE;
  return `near=${p.states.join(',')}&remote=${p.remote ? 1 : 0}${p.here && CODES.has(p.here) ? `&here=${p.here}` : ''}`;
}

/** The place a Staffing request asks for, or null when it names none (then location doesn't change the order). */
export function placeFromQuery(params) {
  if (!params.has('near')) return null;
  const states = (params.get('near') || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => CODES.has(s));
  const here = (params.get('here') || '').trim().toUpperCase();
  return { states: [...new Set(states)], remote: params.get('remote') === '1', ...(CODES.has(here) ? { here } : {}) };
}

/** A state's name from its code ("WA" → "Washington"). */
export const stateName = (code) => STATE_LIST.find(([c]) => c === code)?.[1] ?? code;

/**
 * The state a point is in, from the borders in src/data/us-states.json (loaded by the caller, so the browser only
 * fetches them when you ask to use your location). Null outside the 50 states and DC.
 */
export function stateAt(lat, lon, borders) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const hit = inState(lat * 100, lon * 100, borders);
  if (hit) return hit;
  // The borders are rounded to about 1 km, so a point on a shore can land in the water: look about 1 km around
  // (no further, or a city just over the border, like Windsor or Tijuana, would count as the US).
  for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [0.7, -0.7], [-0.7, 0.7], [-0.7, -0.7]]) {
    const near = inState(lat * 100 + dy, lon * 100 + dx, borders);
    if (near) return near;
  }
  return null;
}

function inState(y, x, borders) {
  for (const [code, rings] of Object.entries(borders)) {
    // Even-odd over every ring of the state, so lakes and enclaves (holes) count as outside.
    let inside = false;
    for (const flat of rings) {
      const pts = [];
      for (let i = 0, px = 0, py = 0; i < flat.length; i += 2) { px += flat[i]; py += flat[i + 1]; pts.push(px, py); }
      for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
        const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    if (inside) return code;
  }
  return null;
}
