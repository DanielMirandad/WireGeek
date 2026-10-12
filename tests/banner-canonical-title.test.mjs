import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverCanonicalVisualTitle, splitCanonicalVisualTitle } from '../lib/banner-canonical-title.mjs';

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

test('reparticiona identidade longa com dois-pontos sem perder palavras', () => {
  const parts = splitCanonicalVisualTitle('Dragon Ball Super: Beerus');
  assert.deepEqual(parts, ['Dragon Ball', 'Super: Beerus']);
  assert.equal(parts.join(' '), 'Dragon Ball Super: Beerus');
});

test('recupera overflow de title_main movendo uma palavra para o tema', () => {
  assert.deepEqual(
    recoverCanonicalVisualTitle(
      'Dragon Ball Super: Beerus',
      { title_main: 'Dragon Ball Super:', title_theme: 'Beerus' },
      'title_main'
    ),
    { title_main: 'Dragon Ball', title_theme: 'Super: Beerus' }
  );
});

test('recupera overflow de title_theme movendo uma palavra para title_main', () => {
  assert.deepEqual(
    recoverCanonicalVisualTitle(
      'The Relic First Guardian',
      { title_main: 'The', title_theme: 'Relic First Guardian' },
      'title_theme'
    ),
    { title_main: 'The Relic', title_theme: 'First Guardian' }
  );
});
