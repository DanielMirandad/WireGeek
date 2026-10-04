import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLatestEdition, createEditionSync, savePreparedEdition, readPreparedEdition, PREPARED_CACHE_KEY, LATEST_CACHE_KEY } from '../src/latest-edition.mjs';

const news = (id = 12) => ({ id, titulo: 'Servidor', highlights: ['Novo destaque'], hashtags: [], fontes: [], materia: 'Texto novo', image_url: 'https://example.com/server.jpg' });
const banner = { type: 'editorial', noticia_id: 12, publication_id: null, banner_url: 'https://example.com/manual.png' };
const local = () => ({ id: 'old-edition', news: [{ ...news(), titulo: 'Texto antigo', materia: 'Antigo', image_url: 'https://example.com/local.jpg', briefing_generated_banners: [banner, { type: 'cta', banner_url: 'https://example.com/cta.png' }] }] });
const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};

test('reload on another day preserves pending manual banner while latest sync refreshes server cache', async () => {
  const storage = memoryStorage();
  savePreparedEdition(storage, local(), 'wire-geek:v3:2026-10-03');
  const serverNews = { ...news(), briefing_generated_banners: [{ ...banner, publication_id: 99, banner_url: 'https://example.com/published.png' }] };
  const payload = { pending: false, edicoes: [{ id: 'new-edition', criado_em: '2026-10-04T12:00:00Z', news: [serverNews] }] };
  let received;
  const sync = createEditionSync({ storage, fetcher: async (_url, options) => {
    assert.equal(options.method, 'GET');
    return { ok: true, status: 200, json: async () => payload };
  }, onChange: update => { received = update.edition; }, onUnauthorized: () => assert.fail('Unexpected unauthorized'), setTimer: () => 1, clearTimer: () => {} });
  await sync.refresh();
  sync.stop();
  const prepared = readPreparedEdition(storage, 'wire-geek:v3:2026-10-04');
  const result = mergeLatestEdition(prepared, received);
  assert.deepEqual(result.news[0].briefing_generated_banners, local().news[0].briefing_generated_banners);
  assert.equal(result.id, 'new-edition');
  for (const field of ['titulo', 'materia', 'highlights', 'hashtags', 'fontes', 'image_url']) assert.deepEqual(result.news[0][field], serverNews[field]);
  assert.deepEqual(JSON.parse(storage.getItem(LATEST_CACHE_KEY)), payload);
  assert.deepEqual(JSON.parse(storage.getItem(PREPARED_CACHE_KEY)), local());
  assert.deepEqual(mergeLatestEdition(result, received), result);
});

test('pending banners match news ID rather than order and never transfer to another news', () => {
  const next = { id: 'new', news: [news(13), news('12')] };
  const result = mergeLatestEdition(local(), next);
  assert.equal(result.news[0].briefing_generated_banners, undefined);
  assert.equal(result.news[1].briefing_generated_banners[0].banner_url, banner.banner_url);
  assert.equal(mergeLatestEdition(local(), null), null);
  assert.deepEqual(mergeLatestEdition(null, next), next);
});

test('published, mismatched and invalid local banners cannot override server previews', () => {
  const next = { id: 'new', news: [{ ...news(), briefing_generated_banners: [{ ...banner, publication_id: 99 }] }] };
  for (const change of [{ publication_id: 7 }, { noticia_id: 13 }, { banner_url: 'javascript:alert(1)' }, { banner_url: '' }]) {
    const previous = local();
    previous.news[0].briefing_generated_banners = [{ ...banner, ...change }];
    assert.deepEqual(mergeLatestEdition(previous, next), next);
  }
});

test('legacy daily preparation cache remains readable and optional storage failures are tolerated', () => {
  const storage = memoryStorage();
  storage.setItem('daily', JSON.stringify(local()));
  storage.setItem(PREPARED_CACHE_KEY, '{invalid');
  assert.deepEqual(readPreparedEdition(storage, 'daily'), local());
  const disabled = { getItem() { throw Error('disabled'); }, setItem() { throw Error('disabled'); } };
  assert.equal(readPreparedEdition(disabled, 'daily'), null);
  assert.doesNotThrow(() => savePreparedEdition(disabled, local(), 'daily'));
});

test('ordinary visuals still require same edition/editorial identity and do not replace server fields', () => {
  const previous = { id: 'same', news: [{ ...news(), banners: ['local'] }] };
  const next = { id: 'same', news: [news()] };
  assert.deepEqual(mergeLatestEdition(previous, next).news[0].banners, ['local']);
  assert.equal(mergeLatestEdition(previous, { ...next, id: 'other' }).news[0].banners, undefined);
  assert.equal(mergeLatestEdition(previous, { ...next, news: [{ ...news(), titulo: 'Changed' }] }).news[0].banners, undefined);
  assert.deepEqual(mergeLatestEdition(previous, { ...next, news: [{ ...news(), banners: ['server'] }] }).news[0].banners, ['server']);
});

test('mixed local slides preserve only pending editorials and matching CTA', () => {
  const previous = local();
  previous.news[0].briefing_generated_banners.push({ ...banner, publication_id: 9 }, { ...banner, noticia_id: 13 });
  const result = mergeLatestEdition(previous, { id: 'new', news: [news()] });
  assert.deepEqual(result.news[0].briefing_generated_banners, local().news[0].briefing_generated_banners);
});

test('application reload restores pending banners on the second server snapshot', async () => {
  const storage = memoryStorage();
  savePreparedEdition(storage, local(), 'yesterday');
  const preparedBytes = storage.getItem(PREPARED_CACHE_KEY);
  const payloads = [
    { pending: false, edicoes: [{ id: 'first', criado_em: '2026-10-04T12:00:00Z', news: [news(13)] }] },
    { pending: false, edicoes: [{ id: 'second', criado_em: '2026-10-04T12:01:00Z', news: [news(13), news('12')] }] },
    { pending: false, edicoes: [{ id: 'third', criado_em: '2026-10-04T12:02:00Z', news: [{ ...news('12'), titulo: 'Atualizado', materia: 'Nova matéria' }] }] },
  ];
  let current = null, calls = 0;
  const sync = createEditionSync({ storage,
    fetcher: async () => ({ ok: true, status: 200, json: async () => payloads[calls++] }),
    onChange: update => {
      current = mergeLatestEdition(current, update.edition, readPreparedEdition(storage, 'today'));
    },
    onUnauthorized: () => assert.fail('Unexpected unauthorized'),
    setTimer: () => 1, clearTimer: () => {},
  });
  try {
    await sync.refresh();
    assert.equal(current.news[0].briefing_generated_banners, undefined);
    await sync.refresh();
    assert.deepEqual(current.news[1].briefing_generated_banners, local().news[0].briefing_generated_banners);
    assert.equal(current.news[0].briefing_generated_banners, undefined);
    await sync.refresh();
    assert.deepEqual(current.news[0].briefing_generated_banners, local().news[0].briefing_generated_banners);
    for (const field of ['titulo', 'materia', 'highlights', 'hashtags', 'fontes', 'image_url'])
      assert.deepEqual(current.news[0][field], payloads[2].edicoes[0].news[0][field]);
    assert.equal(storage.getItem(PREPARED_CACHE_KEY), preparedBytes);
    assert.deepEqual(JSON.parse(storage.getItem(LATEST_CACHE_KEY)), payloads[2]);
  } finally { sync.stop(); }
});
