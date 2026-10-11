import test from 'node:test';
import assert from 'node:assert/strict';
import { splitCanonicalVisualTitle } from '../lib/banner-canonical-title.mjs';

test('preserves canonical title with colon, without paraphrase', () => {
  assert.deepEqual(splitCanonicalVisualTitle('The Relic: First Guardian'), ['The Relic', 'First Guardian']);
});

test('preserves every word of canonical title without colon', () => {
  const title = 'Monster Hunter Rise';
  const parts = splitCanonicalVisualTitle(title);
  assert.ok(parts);
  assert.equal(parts.join(' '), title);
  assert.deepEqual(parts, ['Monster', 'Hunter Rise']);
});

test('does not invent a thematic subtitle for single-word titles', () => {
  assert.equal(splitCanonicalVisualTitle('Minecraft'), null);
});

test('oversized canonical titles fail safely rather than truncate', () => {
  assert.equal(splitCanonicalVisualTitle('ExtraordinarilyLongFranchiseName: Very Long Sequel Name'), null);
});
