// Resume header location — derived from the job posting, not hardcoded.
//
// A resume shown to a Seattle team should read "Seattle, WA", not the home
// city. Feed rows carry a `location` string straight from the scraper, which
// is messy ("Plano, TX", "Indiana, United States", "Remote - US",
// "New York, NY; Austin, TX"), so normalize it to one short "City, ST" before
// it lands in the LaTeX header. Anything unusable — blank, remote-only, a
// country — falls back to HOME_LOCATION, which is the honest answer when the
// posting doesn't name a place.

export const HOME_LOCATION = "New York, NY";

const STATE_CODES = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "district of columbia": "DC", "washington dc": "DC",
};

const STATE_ABBREVS = new Set(Object.values(STATE_CODES));

// Countries/regions that carry no city signal — dropped, never shown alone.
const COUNTRY_ONLY = new Set([
  "united states", "united states of america", "usa", "us", "u.s.", "u.s.a.",
  "america", "remote", "anywhere", "worldwide", "global", "multiple locations",
]);

// Work-mode words that ride along with the place and aren't part of it.
const MODE_WORDS = /\b(remote|hybrid|on-?site|in-?office|in-?person|flexible|work from home|wfh)\b/gi;

function titleCaseWord(word) {
  if (!word) return word;
  if (STATE_ABBREVS.has(word.toUpperCase()) && word.length === 2) return word.toUpperCase();
  return word[0].toUpperCase() + word.slice(1);
}

/**
 * Normalize a scraped job location into a header-ready "City, ST".
 * Returns `fallback` whenever the posting names no usable place.
 */
export function resolveHeaderLocation(raw, fallback = HOME_LOCATION) {
  if (typeof raw !== "string") return fallback;

  // A posting that names several offices doesn't tell us where to say we are,
  // so it's treated exactly like a posting that names none: the home city.
  // "Seattle, WA or Remote" still resolves to Seattle — "Remote" isn't a place,
  // so only one real office survives.
  const places = new Set();
  for (const segment of raw.split(/[;|/\n]|\band\b|\bor\b|&/i)) {
    const place = resolveOnePlace(segment);
    if (place) places.add(place);
  }
  return places.size === 1 ? [...places][0] : fallback;
}

/** One location segment → "City, ST", or null when it names no real place. */
function resolveOnePlace(raw) {
  let text = raw
    .replace(/\([^)]*\)/g, " ")   // "(Hybrid)" and friends
    .replace(MODE_WORDS, " ")
    .replace(/[–—]/g, "-")
    .replace(/\s*-\s*/g, " ")     // "Remote - US" → "US" once the mode word is gone
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,\s]+|[,\s]+$/g, "");

  if (!text) return null;

  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  // Drop trailing country segments: "Plano, TX, United States" → "Plano, TX".
  while (parts.length && COUNTRY_ONLY.has(parts[parts.length - 1].toLowerCase())) parts.pop();
  if (!parts.length) return null;

  const city = parts[0];
  if (COUNTRY_ONLY.has(city.toLowerCase())) return null;

  // "Indiana, United States" collapses to a bare state — name it as a state,
  // since inventing a city would be a lie. "New York" is the exception: in
  // these feeds a bare "New York" is always the city, never upstate.
  if (parts.length === 1) {
    if (city.toLowerCase() === "new york") return "New York, NY";
    const code = STATE_CODES[city.toLowerCase()];
    if (code) return city.split(" ").map(titleCaseWord).join(" ");
    if (STATE_ABBREVS.has(city.toUpperCase()) && city.length === 2) return null;
    return city.length <= 40 ? city : null;
  }

  const region = parts[1];
  const code = STATE_CODES[region.toLowerCase()]
    ?? (STATE_ABBREVS.has(region.toUpperCase()) && region.length === 2 ? region.toUpperCase() : null);
  // Non-US regions ("London, United Kingdom") keep their own spelling.
  const tail = code ?? region;
  const out = `${city}, ${tail}`;
  return out.length <= 40 ? out : null;
}
