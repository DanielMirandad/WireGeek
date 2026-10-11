import test from 'node:test';
import assert from 'node:assert/strict';
import { shorterThematicTitle, shortenRejectedVisualTitle } from '../lib/banner-title-recovery.mjs';

test('shortens only the rejected thematic field', () => {
 const old = { title_main: 'THE BATMAN PART II', title_theme: 'FILMAGENS TEMPORARIAMENTE SUSPENSAS' };
 assert.deepEqual(shortenRejectedVisualTitle(old, 'title_theme'), {
  title_main: old.title_main, title_theme: 'FILMAGENS TEMPORARIAMENTE'
 });
 assert.equal(old.title_theme, 'FILMAGENS TEMPORARIAMENTE SUSPENSAS');
});
test('keeps identity unaltered and refuses unsafe single-word truncation', () => {
 assert.equal(shorterThematicTitle('BATMAN'), '');
 assert.equal(shortenRejectedVisualTitle({ title_main: 'BATMAN', title_theme: 'NOVO FILME' }, 'title_main'), null);
 assert.equal(shortenRejectedVisualTitle({ title_main: 'BATMAN', title_theme: 'NOVO FILME' }, 'invalid'), null);
});
test('shortens main title by complete words without changing canonical copy', () => {
 assert.deepEqual(shortenRejectedVisualTitle({ title_main: 'THE BATMAN PART II', title_theme: 'PAUSA' }, 'title_main'),
 { title_main: 'THE BATMAN PART', title_theme: 'PAUSA' });
});
