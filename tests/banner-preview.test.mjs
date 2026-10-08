import test from 'node:test';
import { createPreviewZip } from '../lib/briefing-preview-zip.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createGenerationCache, withoutGenerationCache } from '../lib/generation-cache.mjs';
import sharp from 'sharp';
import { loadPreviewFixture403 as realFixture403 } from '../lib/briefing-preview-fixture-403.mjs';
import { resolveBriefingBannerImages as realResolveImages } from '../lib/banner-images-briefing.mjs';
import { normalizeBanner, renderBanner, APPROVED_BANNER_MODEL } from '../lib/banner-renderer-briefing.mjs';

const source = readFileSync(new URL('../api/banner-briefing.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '')
  .replace('export default async function handler', 'async function handler');

function harness({ auth = true, count = 2, bytes = 20, renderError = false, widthRetry = false, realImage, vercelEnv = 'preview', fixture = false } = {}) {
  const calls = [];
  const originals = [];
  const fail = name => () => { calls.push(name); throw new Error('Forbidden: ' + name); };
  const cache = createGenerationCache({ name: 'banner-title', ttlMs: 1000, maxEntries: 4,
    persistent: { get: fail('cache read/cleanup'), set: fail('cache write') } });
  const context = vm.createContext({ Buffer, Uint8Array, withoutGenerationCache, createPreviewZip,
    process: { env: { VERCEL_ENV: vercelEnv, WIREGEEK_AUTO_PUBLISH: 'true', WIREGEEK_AUTO_MEDIA_PUBLISH: 'true' } },
    console: { log() {}, warn() {}, error() {} }, WIDTH: 1080, HEIGHT: 1350,
    hasValidWireGeekAuth: () => auth,
    inputError: message => Object.assign(new Error(message), { statusCode: 400 }),
    canonicalNewsId: value => { if (!/^[1-9]\d*$/.test(String(value))) throw Object.assign(new Error('ID'), { statusCode: 400 }); return Number(value); },
    createClient: () => ({ from: fail('database access outside canonical read'), rpc: fail('rpc'), storage: new Proxy({}, { get: fail('storage') }) }),
    loadPreviewFixture403: () => {
      calls.push('canonical:403');
      if (fixture) return realFixture403();
      return { visual_title: { title_main: 'OPENAI', title_theme: 'NOVA FASE' }, canonical_source: true, categoria: 'GEEK', titulo: 'OPENAI', titulo_curto: 'OPENAI',
        highlights: ['A', 'B'], banners: [{ type: 'editorial', banner_title: 'OPENAI', highlight: 'UMA NOVA ERA.', editorial_copy: 'UMA NOVA ERA.' }, { type: 'editorial', banner_title: 'OPENAI', highlight: 'B', editorial_copy: 'UMA NOVA ERA.' }, { type: 'cta' }] };
    },
    loadCanonicalBannerRequest: async (_client, id) => {
      calls.push('canonical:' + id);
      return { canonical_source: true, categoria: 'GEEK', titulo: 'OPENAI', titulo_curto: 'OPENAI',
        highlights: ['A', 'B'], banners: [{ type: 'editorial', banner_title: 'OPENAI', highlight: 'UMA NOVA ERA.', editorial_copy: 'UMA NOVA ERA.' }, { type: 'editorial', banner_title: 'OPENAI', highlight: 'B', editorial_copy: 'UMA NOVA ERA.' }, { type: 'cta' }] };
    },
    resolveBriefingBannerImages: async (...args) => {
      calls.push('images');

      return Array.from({ length: count }, () => ({
        url: 'https://example.com/image.png',
        imageBuffer: realImage || Buffer.from('image')
      }));
    },
    deriveBannerVisualTitle: async () => cache.run('title', async () => { calls.push('title'); return { title_main: 'OPENAI', title_theme: 'NOVA FASE' }; }),
    normalizeBanner: realImage || fixture ? normalizeBanner : value => value,
    renderBanner: async value => {
      assert.equal(value.title_main || value.titleMain, fixture ? 'ENDFIELD' : 'OPENAI');
      assert.equal(value.title_theme || value.titleTheme, fixture ? 'ESTREIA NO STEAM' : 'NOVA FASE');
      calls.push('render');
      if (renderError) throw new Error('render failed');
      if (widthRetry && calls.filter(x => x === 'render').length === 1) throw Object.assign(new Error('width'), { code: 'TITLE_MAIN_TOO_WIDE' });
      if (fixture) {
        const result = await renderBanner(value);
        originals.push(result.png);

        return result;
      }

      const result = realImage ? await renderBanner(value) : { png: Buffer.alloc(bytes, 1) };
      originals.push(result.png);
      return result;
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
  return { calls, originals, async invoke(body = { mode: 'briefing-preview', noticia_id: 403 }, method = 'POST') {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; }, send(data) { this.data = data; return this; } };
    await context.invoke({ body, method }, res);
    return res;
  } };
}

for (const count of [2]) test(`preview ${count} editorial(s) never reaches side effects, even with auto flags`, async () => {
  const h = harness({ count }); const res = await h.invoke();
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assertOriginalZip(res, h.originals);
  assert.deepEqual(h.calls, ['canonical:403', 'images', ...Array(count).fill('render')]);
});

test('preview rejects incomplete editorial images without side effects', async () => {
  const h = harness({ count: 1 });
  const res = await h.invoke();
  assert.equal(res.statusCode, 422);
  assert.deepEqual(h.calls, ['canonical:403', 'images']);
});

test('preview returns a real PNG from the unchanged approved thematic renderer', async () => {
  const realImage = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#646080' } }).png().toBuffer();
  const h = harness({ count: 2, realImage }); const res = await h.invoke();
  assert.equal(res.statusCode, 200);
  const [png] = assertOriginalZip(res, h.originals);
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, APPROVED_BANNER_MODEL.width);
  assert.equal(metadata.height, APPROVED_BANNER_MODEL.height);
  assert.deepEqual(h.calls, ['canonical:403', 'images', 'render', 'render']);
});

test('editorial fixture renders Unicode copy without title mocks', async () => {
  const realImage = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#646080' } }).png().toBuffer();
  const h = harness({ fixture: true, realImage });
  const res = await h.invoke();

  assert.equal(
    res.statusCode,
    200,
    JSON.stringify(res.data)
  );

  for (const png of assertOriginalZip(res, h.originals)) {

    const metadata = await sharp(png).metadata();

    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, APPROVED_BANNER_MODEL.width);
    assert.equal(metadata.height, APPROVED_BANNER_MODEL.height);
    assert.ok(png.length > 0);
  }

  assert.deepEqual(
    h.calls,
    ['canonical:403', 'images', 'render', 'render']
  );
});
test('preview width failure never invokes title generation', async () => {
  const h = harness({ widthRetry: true }); const res = await h.invoke();
  assert.equal(res.statusCode, 500);
  assert.deepEqual(h.calls, ['canonical:403', 'images', 'render']);
});

test('preview fixture is blocked in production before external work', async () => {
  for (const vercelEnv of ['production', 'development', '']) {
    const h = harness({ vercelEnv });
    const res = await h.invoke();
    assert.equal(res.statusCode, 403);
    assert.deepEqual(h.calls, []);
  }
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
  for (const [options, code] of [[{ renderError: true }, 500], [{ bytes: 8 * 1024 * 1024 + 1 }, 413], [{ bytes: 0 }, 413]]) {
    const h = harness(options); assert.equal((await h.invoke()).statusCode, code);
    assert.ok(h.calls.every(x => ['canonical:403', 'images', 'render'].includes(x)));
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

function assertOriginalZip(res, originals) {
  assert.equal(res.headers['Content-Type'], 'application/zip');
  assert.equal(res.headers['Content-Disposition'], 'attachment; filename="wiregeek-403-preview.zip"');
  assert.equal(res.headers['Content-Length'], res.data.length);
  const zip = res.data;
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  assert.equal(zip.readUInt16LE(end + 10), 2);
  let central = zip.readUInt32LE(end + 16);
  const pngs = [];
  for (let i = 0; i < 2; i++) {
    assert.equal(zip.readUInt32LE(central), 0x02014b50);
    const offset = zip.readUInt32LE(central + 42);
    assert.equal(zip.readUInt32LE(offset), 0x04034b50);
    assert.equal(zip.readUInt16LE(offset + 8), 0);
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString();
    assert.equal(name, `wiregeek-403-editorial-${i + 1}.png`);
    const png = zip.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size);
    assert.deepEqual(png, originals[i]);
    let crc = 0xffffffff;
    for (const byte of png) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    assert.equal(zip.readUInt32LE(offset + 14), (crc ^ 0xffffffff) >>> 0);
    assert.equal(zip.readUInt32LE(central + 16), zip.readUInt32LE(offset + 14));
    pngs.push(png);
    central += 46 + zip.readUInt16LE(central + 28);
  }
  assert.equal(central, end);
  return pngs;
}

test('ZIP accepts original PNG payloads above the previous JSON limits', async () => {
  const h = harness({ bytes: 3 * 1024 * 1024 });
  const res = await h.invoke();
  assert.equal(res.statusCode, 200);
  assertOriginalZip(res, h.originals);
});

test('ZIP requires exactly two nonempty buffers within the total limit', () => {
  for (const files of [[], [{ png: Buffer.from('a') }], [{ png: Buffer.alloc(0) }, { png: Buffer.from('b') }], [{ png: 'a' }, { png: Buffer.from('b') }]]) {
    assert.throws(() => createPreviewZip(files));
  }
});
