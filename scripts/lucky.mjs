// Lucky hours (docs/lucky.md): the day's Vedic muhurta timings for where you are, and one lucky window a day to apply in.
// Pure functions, no dependencies. The sun comes from NOAA's solar position formulas, the moon from Meeus' lunar theory
// (the larger periodic terms, good to well under a tenth of a degree), sidereal by the Lahiri ayanamsa.
//
//   Choghadiya  the day (sunrise to sunset) and the night in eight equal parts each; Amrit, Shubh and Labh are good to start things
//   Hora        planetary hours, twelve by day and twelve by night, starting with the weekday's lord
//   Rahu Kaal   one eighth of the day to avoid, fixed by the weekday
//   Abhijit     the 8th of 15 day muhurtas, around local noon (not counted on Wednesdays)
//   Lucky hour  a good Choghadiya overlapping a Jupiter, Venus or Mercury hora, outside Rahu Kaal, inside your working hours,
//               the longest such stretch, trimmed to 50 minutes around its middle
//   Tara Bala / Chandra Bala  today's moon counted from your birth nakshatra / birth moon sign: rates the day for you

const RAD = Math.PI / 180, DAY = 86_400_000, MIN = 60_000;
const norm = (deg) => ((deg % 360) + 360) % 360;

export const NAKSHATRAS = ["Ashwini", "Bharani", "Krittika", "Rohini", "Mrigashira", "Ardra", "Punarvasu", "Pushya", "Ashlesha", "Magha", "Purva Phalguni", "Uttara Phalguni", "Hasta", "Chitra", "Swati", "Vishakha", "Anuradha", "Jyeshtha", "Mula", "Purva Ashadha", "Uttara Ashadha", "Shravana", "Dhanishta", "Shatabhisha", "Purva Bhadrapada", "Uttara Bhadrapada", "Revati"];
export const RASHIS = ["Mesha", "Vrishabha", "Mithuna", "Karka", "Simha", "Kanya", "Tula", "Vrischika", "Dhanu", "Makara", "Kumbha", "Meena"];
const TARAS = ["Janma", "Sampat", "Vipat", "Kshema", "Pratyak", "Sadhana", "Naidhana", "Mitra", "Param Mitra"];
const TARA_GOOD = new Set([2, 4, 6, 8, 9]), TARA_BAD = new Set([3, 5, 7]);
const CHANDRA_GOOD = new Set([1, 3, 6, 7, 10, 11]), CHANDRA_BAD = new Set([4, 8, 12]);

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_CYCLE = ["Udveg", "Chal", "Labh", "Amrit", "Kaal", "Shubh", "Rog"];
const DAY_START = { Sun: "Udveg", Mon: "Amrit", Tue: "Rog", Wed: "Labh", Thu: "Shubh", Fri: "Chal", Sat: "Kaal" };
const NIGHT_CYCLE = ["Shubh", "Amrit", "Chal", "Rog", "Kaal", "Labh", "Udveg"];
const NIGHT_START = { Sun: "Shubh", Mon: "Chal", Tue: "Kaal", Wed: "Udveg", Thu: "Amrit", Fri: "Rog", Sat: "Labh" };
const HORA = ["Sun", "Venus", "Mercury", "Moon", "Saturn", "Jupiter", "Mars"];
const LORD = { Sun: "Sun", Mon: "Moon", Tue: "Mars", Wed: "Mercury", Thu: "Jupiter", Fri: "Venus", Sat: "Saturn" };
const RAHU_PART = { Mon: 1, Sat: 2, Fri: 3, Wed: 4, Thu: 5, Tue: 6, Sun: 7 };
export const GOOD_CHOGHADIYA = new Set(["Amrit", "Shubh", "Labh"]);
export const GOOD_HORA = new Set(["Jupiter", "Venus", "Mercury"]);

export const DEFAULT_LOCATION = { name: "New York", lat: 40.7128, lon: -74.006, tz: "America/New_York" };

// ---------- calendar days in a time zone ----------
const partsFmt = new Map();
function zoneParts(ms, tz) {
  let f = partsFmt.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23" }); partsFmt.set(tz, f); }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month - 1, d: +p.day, hour: +p.hour % 24, minute: +p.minute, weekday: p.weekday };
}
/** The calendar day (YYYY-MM-DD) an instant falls on in a time zone. */
export const dayKey = (ms, tz) => { const p = zoneParts(ms, tz); return `${p.y}-${String(p.m + 1).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`; };
const keyParts = (key) => { const [y, m, d] = key.split("-").map(Number); return { y, m: m - 1, d }; };
/** The instant of a wall-clock time (hour, minute) on a calendar day in a time zone. */
export function wallClock(key, hour, minute, tz) {
  const { y, m, d } = keyParts(key);
  let guess = Date.UTC(y, m, d, hour, minute);
  for (let i = 0; i < 2; i++) { const p = zoneParts(guess, tz); guess += (Date.UTC(y, m, d, hour, minute) - Date.UTC(p.y, p.m, p.d, p.hour, p.minute)); }
  return guess;
}
const shiftKey = (key, n) => { const { y, m, d } = keyParts(key); const t = new Date(Date.UTC(y, m, d + n)); return t.toISOString().slice(0, 10); };

// ---------- the sun ----------
/** Sunrise and sunset (UTC ms) for a calendar date at a place, by NOAA's general solar position formulas, refined once. */
export function sunTimes(key, lat, lon) {
  const { y, m, d } = keyParts(key), base = Date.UTC(y, m, d);
  const doy = Math.round((base - Date.UTC(y, 0, 0)) / DAY);
  const at = (minutesUtc, rising) => {
    const g = (2 * Math.PI / 365) * (doy - 1 + (minutesUtc / 60 - 12) / 24);
    const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const cosH = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) - Math.tan(lat * RAD) * Math.tan(decl);
    const ha = Math.acos(Math.max(-1, Math.min(1, cosH))) / RAD;
    return 720 - 4 * (lon + (rising ? ha : -ha)) - eq;
  };
  let rise = at(720 - 4 * lon - 180, true), set = at(720 - 4 * lon + 180, false);
  rise = at(rise, true); set = at(set, false);
  return { rise: base + rise * MIN, set: base + set * MIN };
}

// ---------- the moon ----------
// Meeus, Astronomical Algorithms, table 47.A (longitude terms): D, M, M', F, coefficient in 1e-6 degrees.
const MOON_L = [
  [0, 0, 1, 0, 6288774], [2, 0, -1, 0, 1274027], [2, 0, 0, 0, 658314], [0, 0, 2, 0, 213618], [0, 1, 0, 0, -185116], [0, 0, 0, 2, -114332],
  [2, 0, -2, 0, 58793], [2, -1, -1, 0, 57066], [2, 0, 1, 0, 53322], [2, -1, 0, 0, 45758], [0, 1, -1, 0, -40923], [1, 0, 0, 0, -34720],
  [0, 1, 1, 0, -30383], [2, 0, 0, -2, 15327], [0, 0, 1, 2, -12528], [0, 0, 1, -2, 10980], [4, 0, -1, 0, 10675], [0, 0, 3, 0, 10034],
  [4, 0, -2, 0, 8548], [2, 1, -1, 0, -7888], [2, 1, 0, 0, -6766], [1, 0, -1, 0, -5163], [1, 1, 0, 0, 4987], [2, -1, 1, 0, 4036],
  [2, 0, 2, 0, 3994], [4, 0, 0, 0, 3861], [2, 0, -3, 0, 3665], [0, 1, -2, 0, -2689], [2, 0, -1, 2, -2602], [2, -1, -2, 0, 2390],
  [1, 0, 1, 0, -2348], [2, -2, 0, 0, 2236], [0, 1, 2, 0, -2120], [0, 2, 0, 0, -2069], [2, -2, -1, 0, 2048], [2, 0, 1, -2, -1773],
  [2, 0, 0, 2, -1595], [4, -1, -1, 0, 1215], [0, 0, 2, 2, -1110], [3, 0, -1, 0, -892], [2, 1, 1, 0, -810], [4, -1, -2, 0, 759],
  [0, 2, -1, 0, -713], [2, 2, -1, 0, -700], [2, 1, -2, 0, 691], [2, -1, 0, -2, 596], [4, 0, 1, 0, 549], [0, 0, 4, 0, 537],
  [4, -1, 0, 0, 520], [1, 0, -2, 0, -487], [2, 1, 0, -2, -399], [0, 0, 2, -2, -381], [1, 1, 1, 0, 351], [3, 0, -2, 0, -340],
  [4, 0, -3, 0, 330], [2, -1, 2, 0, 327], [0, 2, 1, 0, -323], [1, 1, -1, 0, 299], [2, 0, 3, 0, 294],
];
/** The moon's geocentric tropical longitude (degrees, mean equinox of date) at an instant. */
export function moonLongitude(ms) {
  const T = (ms / DAY + 2440587.5 - 2451545.0 + 69 / 86400) / 36525; // TT, near enough with a fixed 69 s
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T;
  const F = 93.272095 + 483202.0175233 * T - 0.0036539 * T * T;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  let sum = 0;
  for (const [d, m, mp, f, c] of MOON_L) sum += c * Math.sin((d * D + m * M + mp * Mp + f * F) * RAD) * (m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E);
  const A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.29 * T;
  sum += 3958 * Math.sin(A1 * RAD) + 1962 * Math.sin((Lp - F) * RAD) + 318 * Math.sin(A2 * RAD);
  return norm(Lp + sum / 1e6);
}
/** Lahiri (Chitrapaksha) ayanamsa in degrees: 23°51'11" at J2000, precessing 50.29" a year. */
export const lahiri = (ms) => 23.853 + 1.3969 * ((ms / DAY + 2440587.5 - 2451545.0) / 36525);
export const siderealMoon = (ms) => norm(moonLongitude(ms) - lahiri(ms));
/** Nakshatra (0-26), its pada (1-4) and the moon sign (0-11) at an instant. */
export function moonPlace(ms) {
  const lon = siderealMoon(ms), span = 360 / 27;
  return { longitude: lon, nakshatra: Math.floor(lon / span), pada: Math.floor((lon % span) / (span / 4)) + 1, rashi: Math.floor(lon / 30) };
}
export function birthChart(birthUtc) {
  const ms = Date.parse(birthUtc);
  if (!Number.isFinite(ms)) return null;
  const p = moonPlace(ms);
  return { ...p, nakshatraName: NAKSHATRAS[p.nakshatra], rashiName: RASHIS[p.rashi] };
}
/** How the moon at `ms` sits for someone born with this chart: Tara Bala (from the birth nakshatra) and Chandra Bala (from the birth sign). */
export function dayStrength(chart, ms) {
  if (!chart) return null;
  const now = moonPlace(ms);
  const count = ((now.nakshatra - chart.nakshatra + 27) % 27) + 1, tara = ((count - 1) % 9) + 1;
  const house = ((now.rashi - chart.rashi + 12) % 12) + 1;
  const taraTone = TARA_GOOD.has(tara) ? "good" : TARA_BAD.has(tara) ? "avoid" : "mixed";
  const chandraTone = CHANDRA_GOOD.has(house) ? "good" : CHANDRA_BAD.has(house) ? "avoid" : "mixed";
  const score = (taraTone === "good" ? 1 : taraTone === "avoid" ? -1 : 0) + (chandraTone === "good" ? 1 : chandraTone === "avoid" ? -1 : 0);
  return { moonNakshatra: NAKSHATRAS[now.nakshatra], tara: TARAS[tara - 1], taraTone, chandraHouse: house, chandraTone, verdict: score > 0 ? "good" : score < 0 ? "avoid" : "mixed" };
}

// ---------- one day ----------
/** Everything for one calendar day at a place: Choghadiya, Hora, Rahu Kaal, Abhijit and the lucky window. Times are UTC ms. */
export function planDay(key, { location = DEFAULT_LOCATION, workStart = 9, workEnd = 21, chart = null } = {}) {
  const { lat, lon, tz } = location;
  const { rise, set } = sunTimes(key, lat, lon), next = sunTimes(shiftKey(key, 1), lat, lon).rise;
  const wd = WD[new Date(Date.UTC(...Object.values(keyParts(key)))).getUTCDay()];
  const dl = (set - rise) / 8, nl = (next - set) / 8;
  const choghadiya = [];
  let i = DAY_CYCLE.indexOf(DAY_START[wd]);
  for (let k = 0; k < 8; k++) choghadiya.push({ name: DAY_CYCLE[(i + k) % 7], start: rise + k * dl, end: rise + (k + 1) * dl, night: false });
  i = NIGHT_CYCLE.indexOf(NIGHT_START[wd]);
  for (let k = 0; k < 8; k++) choghadiya.push({ name: NIGHT_CYCLE[(i + k) % 7], start: set + k * nl, end: set + (k + 1) * nl, night: true });
  const hora = [], h0 = HORA.indexOf(LORD[wd]);
  for (let k = 0; k < 24; k++) { const len = k < 12 ? (set - rise) / 12 : (next - set) / 12, start = k < 12 ? rise + k * len : set + (k - 12) * len; hora.push({ name: HORA[(h0 + k) % 7], start, end: start + len }); }
  const rahu = { start: rise + RAHU_PART[wd] * dl, end: rise + (RAHU_PART[wd] + 1) * dl };
  const noon = (rise + set) / 2, abhijit = wd === "Wed" ? null : { start: noon - (set - rise) / 30, end: noon + (set - rise) / 30 };
  const work = { start: wallClock(key, workStart, 0, tz), end: wallClock(key, workEnd, 0, tz) };
  let best = null;
  for (const c of choghadiya.filter((x) => GOOD_CHOGHADIYA.has(x.name))) for (const h of hora.filter((x) => GOOD_HORA.has(x.name))) {
    let s = Math.max(c.start, h.start, work.start), e = Math.min(c.end, h.end, work.end);
    if (e - s <= 0) continue;
    if (rahu.start < e && rahu.end > s) { if (rahu.start - s > e - rahu.end) e = rahu.start; else s = rahu.end; }
    if (e - s >= 20 * MIN && (!best || e - s > best.end - best.start)) best = { start: s, end: e, choghadiya: c.name, hora: h.name };
  }
  if (best && best.end - best.start > 50 * MIN) { const mid = (best.start + best.end) / 2; best.start = Math.round(mid - 25 * MIN); best.end = Math.round(mid + 25 * MIN); }
  const strength = dayStrength(chart, best ? (best.start + best.end) / 2 : noon);
  return { day: key, weekday: wd, sunrise: rise, sunset: set, nextSunrise: next, choghadiya, hora, rahu, abhijit, lucky: best, strength };
}

/** The next `days` days from today (at the location), as plain JSON (ISO times). */
export function luckyPlan({ now = Date.now(), days = 14, location = DEFAULT_LOCATION, workStart = 9, workEnd = 21, birthUtc = null } = {}) {
  const chart = birthUtc ? birthChart(birthUtc) : null, today = dayKey(now, location.tz);
  const iso = (ms) => new Date(ms).toISOString(), span = (x) => x && ({ ...x, start: iso(x.start), end: iso(x.end) });
  const list = Array.from({ length: days }, (_, k) => {
    const p = planDay(shiftKey(today, k), { location, workStart, workEnd, chart });
    return { ...p, sunrise: iso(p.sunrise), sunset: iso(p.sunset), nextSunrise: iso(p.nextSunrise), choghadiya: p.choghadiya.map(span), hora: p.hora.map(span), rahu: span(p.rahu), abhijit: span(p.abhijit), lucky: span(p.lucky) };
  });
  return { location, today, chart, days: list };
}

/** The reminders for one lucky window: 15 minutes before, the start, 15 minutes left, and the end. */
export function windowStages(lucky) {
  const s = Date.parse(lucky.start), e = Date.parse(lucky.end);
  return [{ stage: "soon", at: s - 15 * MIN }, { stage: "start", at: s }, { stage: "last15", at: e - 15 * MIN }, { stage: "end", at: e }];
}

// ---------- calendar feed ----------
const icsTime = (iso) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
/** An iCalendar feed of the plan: each lucky hour (with a 15-minute alarm) and each Rahu Kaal. */
export function luckyIcs(plan, { now = Date.now(), url = "" } = {}) {
  const stamp = icsTime(new Date(now).toISOString()), lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Atriveo//Lucky hours//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Atriveo lucky hours", "X-PUBLISHED-TTL:PT6H", "REFRESH-INTERVAL;VALUE=DURATION:PT6H"];
  for (const d of plan.days) {
    if (d.lucky) {
      const tone = d.strength ? ` Day for you: ${d.strength.verdict} (Tara ${d.strength.tara}, Chandra ${d.strength.chandraTone}).` : "";
      lines.push("BEGIN:VEVENT", `UID:lucky-${d.day}@atriveo`, `DTSTAMP:${stamp}`, `DTSTART:${icsTime(d.lucky.start)}`, `DTEND:${icsTime(d.lucky.end)}`,
        `SUMMARY:${icsText("Lucky hour · apply on Matching")}`, `DESCRIPTION:${icsText(`${d.lucky.choghadiya} Choghadiya with a ${d.lucky.hora} hora.${tone}`)}`,
        ...(url ? [`URL:${url}`] : []), "TRANSP:TRANSPARENT", "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Lucky hour in 15 minutes", "TRIGGER:-PT15M", "END:VALARM", "END:VEVENT");
    }
    lines.push("BEGIN:VEVENT", `UID:rahu-${d.day}@atriveo`, `DTSTAMP:${stamp}`, `DTSTART:${icsTime(d.rahu.start)}`, `DTEND:${icsTime(d.rahu.end)}`, `SUMMARY:${icsText("Rahu Kaal")}`, "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map((l) => (l.length > 74 ? l.match(/.{1,74}/g).join("\r\n ") : l)).join("\r\n") + "\r\n";
}
