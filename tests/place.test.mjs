import test from 'node:test';
import assert from 'node:assert/strict';
import { statesIn, remoteOrUs, placeRank, normalizePlace, parsePlace, placeQuery, placeFromQuery, DEFAULT_PLACE } from '../scripts/place.mjs';

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
