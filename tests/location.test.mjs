import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLocation } from '../src/utils/location.ts';

test('normalizes the location formats used by job feeds', () => {
  for (const [input, expected] of [
    ['NY - New York', 'New York, NY'], ['NY New York', 'New York, NY'],
    ['TX – Austin', 'Austin, TX'], ['VA - McLean', 'McLean, VA'],
    ['Charlotte, North Carolina, United States', 'Charlotte, NC'],
    ['New York, NY, USA', 'New York, NY'], ['Raleigh, NC', 'Raleigh, NC'],
    ['North Carolina', 'NC'], ['REMOTE', 'Remote'], [null, ''],
    ['London, United Kingdom', 'London, United Kingdom'],
    ['Toronto, ON, Canada', 'Toronto, ON, Canada'],
    ['New York, NY (Hybrid)', 'New York, NY (Hybrid)'],
    ['Austin, TX / Dallas, TX', 'Austin, TX / Dallas, TX'],
    ['Remote - United States', 'Remote - United States'],
  ]) assert.equal(formatLocation(input), expected, String(input));
});
