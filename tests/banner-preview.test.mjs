import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createGenerationCache, withoutGenerationCache } from '../lib/generation-cache.mjs';
import sharp from 'sharp';
import { normalizeBanner, renderBanner, APPROVED_BANNER_MODEL } from '../lib/banner-renderer-briefing.mjs';

const source = readFileSync(new URL('../api/banner-briefing.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '')
  .replace('export default async function handler', 'async function handler');

function harness({ auth = true, count = 2, bytes = 20, renderError = false, widthRetry = false, realImage } = {}) {
  const calls = [];
  const fail = name => () => { calls.push(name); throw new Error('Forbidden: ' + name); };
  const cache = createGenerationCache({ name: 'banner-title', ttlMs: 1000, maxEntries: 4,
    persistent: { get: fail('cache read/cleanup'), set: fail('cache write') } });
  const context = vm.createContext({ Buffer, Uint8Array, withoutGenerationCache,
    process: { env: { WIREGEEK_AUTO_PUBLISH: 'true', WIREGEEK_AUTO_MEDIA_PUBLISH: 'true' } },
    console: { log() {}, warn() {}, error() {} }, WIDTH: 1080, HEIGHT: 1350,
    hasValidWireGeekAuth: () => auth,
    inputError: message => Object.assign(new Error(message), { statusCode: 400 }),
    canonicalNewsId: value => { if (!/^[1-9]\d*$/.test(String(value))) throw Object.assign(new Error('ID'), { statusCode: 400 }); return Number(value); },
    createClient: () => ({ from: fail('database access outside canonical read'), rpc: fail('rpc'), storage: new Proxy({}, { get: fail('storage') }) }),
    loadCanonicalBannerRequest: async (_client, id) => {
      calls.push('canonical:' + id);
      return { canonical_source: true, categoria: 'GEEK', titulo: 'OPENAI', titulo_curto: 'OPENAI',
        highlights: ['A', 'B'], banners: [{ type: 'editorial', banner_title: 'OPENAI', highlight: 'UMA NOVA ERA.', editorial_copy: 'UMA NOVA ERA.' }, { type: 'editorial', highlight: 'B' }, { type: 'cta' }] };
    },
    resolveBriefingBannerImages: async () => { calls.push('images'); return Array.from({ length: count }, () => ({ url: 'https://example.com/image.png', imageBuffer: realImage || Buffer.from('image') })); },
    deriveBannerVisualTitle: async () => cache.run('title', async () => { calls.push('title'); return { title_main: 'OPENAI', title_theme: 'NOVA FASE' }; }),
    normalizeBanner: realImage ? normalizeBanner : value => value,
    renderBanner: async value => {
      assert.equal(value.title_main || value.titleMain, 'OPENAI');
      calls.push('render');
      if (renderError) throw new Error('render failed');
      if (widthRetry && calls.filter(x => x === 'render').length === 1) throw Object.assign(new Error('width'), { code: 'TITLE_MAIN_TOO_WIDE' });
      return realImage ? renderBanner(value) : { png: Buffer.alloc(bytes, 1) };
    },
    renderCtaBanner: fail('CTA'), randomUUID: fail('UUID'),
    fetch: fail('Meta/MP4/publication network'), calls, fail,
  });
  vm.runInContext(source + `
    uploadBanner = fail('uploadBanner');
    createPublication = fail('createPublication');
    autoApprovePublicationGroup = fail('autoApproval');
    findActivePublicationGroup = fail('duplicate guard');
    globalThis.invoke = handler;
  `, context);
  return { calls, async invoke(body = { mode: 'briefing-preview', noticia_id: 403 }, method = 'POST') {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } };
    await context.invoke({ body, method }, res);
    return res;
  } };
}

for (const count of [1, 2]) test(`preview ${count} editorial(s) never reaches side effects, even with auto flags`, async () => {
  const h = harness({ count }); const res = await h.invoke();
  assert.equal(res.statusCode, 200); assert.equal(res.data.persisted, false);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.data.banners.length, count);
  for (const banner of res.data.banners) assert.equal(Buffer.from(banner.data_url.split(',')[1], 'base64').length, 20);
  assert.deepEqual(h.calls, ['canonical:403', 'images', 'title', ...Array(count).fill('render')]);
});

test('preview returns a real PNG from the unchanged approved thematic renderer', async () => {
  const realImage = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#646080' } }).png().toBuffer();
  const h = harness({ count: 1, realImage }); const res = await h.invoke();
  assert.equal(res.statusCode, 200);
  const png = Buffer.from(res.data.banners[0].data_url.split(',')[1], 'base64');
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, APPROVED_BANNER_MODEL.width);
  assert.equal(metadata.height, APPROVED_BANNER_MODEL.height);
  assert.deepEqual(h.calls, ['canonical:403', 'images', 'title', 'render']);
});

test('preview width retry remains isolated from persistent cache', async () => {
  const h = harness({ widthRetry: true }); const res = await h.invoke();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(h.calls, ['canonical:403', 'images', 'title', 'render', 'title', 'render', 'render']);
});

test('authentication and method checks run before work', async () => {
  for (const [options, method, code] of [[{ auth: false }, 'POST', 401], [{}, 'GET', 405]]) {
    const h = harness(options); assert.equal((await h.invoke(undefined, method)).statusCode, code); assert.deepEqual(h.calls, []);
  }
});

test('invalid modes, flags, overrides and other news fail closed before work', async () => {
  for (const body of [null, [], { mode: 'preview', noticia_id: 403 },
    ...[404, 405, 406].map(noticia_id => ({ mode: 'briefing-preview', noticia_id })),
    ...['preview', 'dry_run', 'persist', 'manual_image_override', 'banners'].map(key => ({ mode: 'briefing-preview', noticia_id: 403, [key]: true }))]) {
    const h = harness(); assert.equal((await h.invoke(body)).statusCode, 400); assert.deepEqual(h.calls, []);
  }
});

test('render failure and response limits never fall through to persistence', async () => {
  for (const [options, code] of [[{ renderError: true }, 500], [{ bytes: 2 * 1024 * 1024 + 1 }, 413], [{ bytes: 1600 * 1024 }, 413]]) {
    const h = harness(options); assert.equal((await h.invoke()).statusCode, code);
    assert.ok(h.calls.every(x => ['canonical:403', 'images', 'title', 'render'].includes(x)));
  }
});

test('normal generation still checks duplicate guard first', async () => {
  const h = harness(); assert.equal((await h.invoke({ mode: 'briefing', noticia_id: 403 })).statusCode, 500);
  assert.deepEqual(h.calls, ['duplicate guard']);
});

test('concurrent normal cache work persists; preview does not share or mutate it', async () => {
  const calls = []; let release;
  const cache = createGenerationCache({ name: 'test', ttlMs: 1000, maxEntries: 4,
    persistent: { get: async () => null, set: async () => calls.push('set') } });
  const normal = cache.run('same', () => new Promise(resolve => { release = resolve; }));
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal(await withoutGenerationCache(() => cache.run('same', async () => 'preview', { refresh: true })), 'preview');
  assert.deepEqual(calls, []); release('normal'); assert.equal(await normal, 'normal');
  assert.deepEqual(calls, ['set']);
  assert.equal(await cache.run('same', () => assert.fail('cached normal lost')), 'normal');
});
