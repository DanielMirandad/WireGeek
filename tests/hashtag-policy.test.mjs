import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateHashtags, WIREGEEK_PROMPT, NEWS_SCHEMA } from '../lib/wiregeek-contract.mjs';
import { buildInstagramReelCaption, buildGroupInstagramReelCaption, normalizeInstagramHashtags, INSTAGRAM_REEL_CAPTION_FOOTER } from '../lib/instagram-reel.mjs';
import { selectInstagramProfiles, selectInstagramProfilesV1 } from '../lib/instagram-profiles.mjs';

const article = 'Nintendo anuncia novidades para games e Nintendo Switch 2.';
const oldTags = ['#Cinema', '#trailer', '#estreia', '#filme', '#WireGeek'];

test('prompt e schema compartilhados orientam cinco hashtags e a marca obrigatoria', () => {
  assert.match(WIREGEEK_PROMPT, /Sempre inclua #bagacastudios/);
  assert.match(WIREGEEK_PROMPT, /Nunca use #wiregeek/);
  const schema = NEWS_SCHEMA.properties.news.items.properties.hashtags;
  assert.equal(schema.minItems, 5);
  assert.equal(schema.maxItems, 5);
  assert.match(schema.description, /#bagacastudios/);
});

test('novas legendas adaptam tags antigas, array e texto, sem modificar a origem', () => {
  for (const hashtags of [oldTags, oldTags.join(' '), ['#cinema', '#trailer', '#estreia', '#filme', '#noticias'], ['#cinema', '#trailer', '#estreia', '#filme', '#bagacastudios']]) {
    const before = structuredClone(hashtags);
    const result = buildInstagramReelCaption({ article, hashtags });
    assert.deepEqual(validateHashtags(result.hashtags), []);
    assert.equal(result.hashtags_count, 5);
    assert.equal(result.caption.match(/#[\p{L}\p{N}_]+/gu).length, 5);
    assert.doesNotMatch(result.caption, /#wiregeek/i);
    assert.deepEqual(hashtags, before);
  }
  assert.deepEqual(normalizeInstagramHashtags(oldTags), oldTags);
});

test('novas legendas bloqueiam contagem invalida, duplicatas e tags malformadas', () => {
  for (const hashtags of [oldTags.slice(1), [...oldTags, '#extra'], ['#cinema', '#CINEMA', '#filme', '#estreia', '#bagacastudios'], ['##cinema', '#trailer', '#filme', '#estreia', '#bagacastudios']]) {
    assert.throws(() => buildInstagramReelCaption({ article, hashtags }), /hashtag/);
  }
});

test('containers antigos mantem legenda, caixa e hash para ausencia de perfis, V1 e V2', () => {
  for (const profiles of [[], selectInstagramProfilesV1(article), selectInstagramProfiles(article)]) {
    // Independent reconstruction of the caption format before this change.
    const caption = [article, INSTAGRAM_REEL_CAPTION_FOOTER,
      ...(profiles.length ? [`Perfis: ${profiles.map(name => `@${name}`).join(' ')}`] : []),
      oldTags.join(' ')].join('\n\n');
    const hash = createHash('sha256').update(caption, 'utf8').digest('hex');
    const group = [{ instagram_parent_container_id: 'existing', instagram_caption_sha256: hash }];
    const before = structuredClone(group);
    const result = buildGroupInstagramReelCaption({ article, hashtags: oldTags, group });
    assert.equal(result.caption, caption);
    assert.equal(result.caption_sha256, hash);
    assert.deepEqual(group, before);
    assert.throws(() => buildGroupInstagramReelCaption({ article: article + ' Alterado.', hashtags: oldTags, group }), /Auditoria manual/);
  }
});

test('grupo sem container aplica a nova regra e preserva registros antigos', () => {
  const group = [{ hashtags: oldTags, instagram_parent_container_id: null }];
  const before = structuredClone(group);
  const result = buildGroupInstagramReelCaption({ article, hashtags: oldTags, group });
  assert.deepEqual(validateHashtags(result.hashtags), []);
  assert.deepEqual(group, before);
  // Preparing a new container does not rewrite the old publication tags.
  const prepared = [{ ...group[0], instagram_parent_container_id: 'new', instagram_caption_sha256: result.caption_sha256 }];
  const readback = buildGroupInstagramReelCaption({ article, hashtags: oldTags, group: prepared });
  assert.equal(readback.caption, result.caption);
  assert.equal(readback.caption_sha256, result.caption_sha256);
});
