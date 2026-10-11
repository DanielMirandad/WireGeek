import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestCanonicalHashtagRepair } from '../lib/banner-canonical.mjs';

test('suggest replacing legacy #wiregeek only, without modifying input', () => {
  const original = ['#cinema', '#thebatman', '#dc', '#filmes', '#wiregeek'];
  const result = suggestCanonicalHashtagRepair(original);
  assert.deepEqual(result, ['#cinema', '#thebatman', '#dc', '#filmes', '#bagacastudios']);
  assert.equal(original[4], '#wiregeek');
});
test('suggest brand tag for five valid unique tags missing it', () => {
  assert.deepEqual(suggestCanonicalHashtagRepair(['#a','#b','#c','#d','#e']), ['#a','#b','#c','#d','#bagacastudios']);
});
test('invalid or already compliant data is never silently changed', () => {
  for (const tags of [[], ['#a'], ['#a','#b','#c','#d','#a'], ['#a','#b','#c','#d','#bagacastudios'], ['#Upper','#b','#c','#d','#e']]) {
    assert.equal(suggestCanonicalHashtagRepair(tags), null);
  }
});
