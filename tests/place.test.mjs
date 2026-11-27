import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { statesIn, remoteOrUs, placeRank, normalizePlace, parsePlace, placeQuery, placeFromQuery, stateAt, stateName, DEFAULT_PLACE } from '../scripts/place.mjs';

const borders = JSON.parse(fs.readFileSync(new URL('../src/data/us-states.json', import.meta.url)));

const states = (l) => [...statesIn(l)].sort();

test('reads the state from every location format the feeds use', () => {
  for (const [input, expected] of [
    ['Seattle, WA, USA', ['WA']], ['Chicago, IL', ['IL']], ['Ann Arbor, Michigan, United States', ['MI']],
    ['IL - Chicago', ['IL']], ['NY New York', ['NY']], ['CA - Remote Location', ['CA']],
    ['Washington', ['WA']], ['Washington, DC, USA', ['DC']], ['Washington, D.C.', ['DC']],
    ['New Jersey, USA', ['NJ']], ['New York, USA', ['NY']],
    ['Greater Seattle Area', ['WA']], ['Detroit Metropolitan Area', ['MI']], ['New York City Metropolitan Area', ['NY']],
    ['Portland, Oregon Metropolitan Area', ['OR']], ['Irving, Texas, 75063', ['TX']],
    ['Austin, Texas, United States; San Jose, California, United States', ['CA', 'TX']], ['Austin, TX / Dallas, TX', ['TX']],
    ['Hybrid (Silver Spring, MD)', ['MD']],
    ['Toronto, ON, Canada', []], ['London', []], ['Dublin, Ireland', []], ['Remote', []], ['', []], [null, []],
  ]) assert.deepEqual(states(input), expected, String(input));
});

test('Wilmington is the state it says, not North Carolina', () => {
  assert.deepEqual(states('Wilmington, DE'), ['DE']);
  assert.deepEqual(states('Wilmington, MA'), ['MA']);
  assert.deepEqual(states('Wilmington, NC'), ['NC']);
});

test('remote or US-wide: within the US only', () => {
  for (const yes of ['Remote', 'REMOTE', 'USA', 'United States', 'Remote: United States', 'Remote, US', 'Nationwide Remote', 'Remote - Seattle, WA', 'Remote with travel, US; remote from the US or canada, US'])
    assert.equal(remoteOrUs(yes), true, yes);
  for (const no of ['Remote - Singapore', 'Remote - Canada', 'Remote - EMEA', 'Ireland (Remote-First)', 'Anywhere in France', 'Seattle, WA', 'London', '', null])
    assert.equal(remoteOrUs(no), false, String(no));
});

test('rank: your states, then remote / US-wide (when on), then everywhere else', () => {
  const place = { states: ['WA', 'IL', 'MI'], remote: true };
  assert.equal(placeRank('Seattle, WA', place), 2);
  assert.equal(placeRank('Detroit Metropolitan Area', place), 2);
  assert.equal(placeRank('Remote', place), 1);
  assert.equal(placeRank('United States', place), 1);
  assert.equal(placeRank('Raleigh, NC', place), 0);
  assert.equal(placeRank('Remote', { ...place, remote: false }), 0);
  assert.equal(placeRank('Raleigh, NC', { states: ['NC'], remote: false }), 2);
  assert.equal(placeRank('Chicago, IL'), 2, 'the default is WA, IL, MI');
});

test('saved and submitted places are cleaned; unknown states are refused', () => {
  assert.deepEqual(normalizePlace(undefined), { states: [...DEFAULT_PLACE.states], remote: true });
  assert.deepEqual(normalizePlace({ states: ['wa', 'WA', 'XX', 7], remote: false }), { states: ['WA'], remote: false });
  assert.deepEqual(parsePlace({ states: ['NY', 'il'], remote: true }), { states: ['NY', 'IL'], remote: true });
  assert.deepEqual(parsePlace({ states: [] }), { states: [], remote: true });
  assert.equal(parsePlace({ states: ['XX'] }), null);
  assert.equal(parsePlace({ remote: 'yes' }), null);
  assert.equal(parsePlace([]), null);
});

test('the Staffing query carries the place both ways; no near= means no location order', () => {
  const q = placeQuery({ states: ['WA', 'IL'], remote: true });
  assert.equal(q, 'near=WA,IL&remote=1');
  assert.deepEqual(placeFromQuery(new URLSearchParams(q)), { states: ['WA', 'IL'], remote: true });
  assert.deepEqual(placeFromQuery(new URLSearchParams('near=&remote=0')), { states: [], remote: false });
  assert.deepEqual(placeFromQuery(new URLSearchParams('near=wa,XX,WA')), { states: ['WA'], remote: false });
  assert.equal(placeFromQuery(new URLSearchParams('view=recommended')), null);
});

test('where you are now ranks above your saved states', () => {
  const place = { states: ['WA', 'IL', 'MI'], remote: true, here: 'IL' };
  assert.equal(placeRank('Chicago, IL', place), 3);
  assert.equal(placeRank('Seattle, WA', place), 2);
  assert.equal(placeRank('Remote', place), 1);
  assert.equal(placeRank('Austin, TX', { ...place, here: 'TX' }), 3, 'the state you are in counts even if it is not saved');
  assert.equal(placeRank('Austin, TX', { ...place, here: null }), 0);
  assert.equal(placeQuery(place), 'near=WA,IL,MI&remote=1&here=IL');
  assert.equal(placeQuery({ ...place, here: null }), 'near=WA,IL,MI&remote=1');
  assert.deepEqual(placeFromQuery(new URLSearchParams('near=WA&remote=1&here=il')), { states: ['WA'], remote: true, here: 'IL' });
  assert.deepEqual(placeFromQuery(new URLSearchParams('near=WA&remote=1&here=XX')), { states: ['WA'], remote: true });
  assert.deepEqual(normalizePlace({ states: ['WA'], remote: true, here: 'IL' }), { states: ['WA'], remote: true }, 'the server never keeps where you are');
  assert.equal(stateName('MI'), 'Michigan');
});

test('a position is turned into the state it is in, borders and shores included; outside the US is none', () => {
  for (const [name, lat, lon, want] of [
    ['Seattle', 47.6062, -122.3321, 'WA'], ['Vancouver, WA', 45.6387, -122.6615, 'WA'], ['Portland, OR', 45.5152, -122.6784, 'OR'],
    ['Chicago', 41.8781, -87.6298, 'IL'], ['Navy Pier', 41.8917, -87.6086, 'IL'], ['Gary, IN', 41.5934, -87.3465, 'IN'],
    ['Detroit', 42.3314, -83.0458, 'MI'], ['Ann Arbor', 42.2808, -83.743, 'MI'], ['Mackinac Island', 45.8492, -84.6189, 'MI'],
    ['Washington, DC', 38.8977, -77.0365, 'DC'], ['Arlington, VA', 38.8816, -77.091, 'VA'],
    ['Kansas City, MO', 39.0997, -94.5786, 'MO'], ['Kansas City, KS', 39.1141, -94.6275, 'KS'],
    ['Honolulu', 21.3069, -157.8583, 'HI'], ['Anchorage', 61.2181, -149.9003, 'AK'], ['Key West', 24.5551, -81.78, 'FL'],
    ['Manhattan', 40.7033, -74.017, 'NY'], ['Miami Beach', 25.7907, -80.13, 'FL'],
    ['Windsor, ON', 42.3149, -83.0364, null], ['Tijuana', 32.5149, -117.0382, null], ['Toronto', 43.6532, -79.3832, null],
    ['Vancouver, BC', 49.2827, -123.1207, null], ['London', 51.5072, -0.1276, null], ['Lake Michigan', 43.5, -87.0, null],
  ]) assert.equal(stateAt(lat, lon, borders), want, name);
  assert.equal(stateAt(NaN, 0, borders), null);
  assert.equal(Object.keys(borders).length, 51, 'the 50 states and DC');
});
