import { correctionSnapshot, correctedEditorials, reelAssetPrefix } from "../lib/manual-reel-correction.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import * as reel from '../lib/instagram-reel.mjs';

const source = readFileSync(new URL('../api/publicar.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '')
  .replace('export default async function handler', 'async function handler')
  .replace('await import("./auth.js")', '({ hasValidSession: () => true })');

function fixture(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1, noticia_id: 10, carousel_position: index + 1,
    status: 'APROVADO', published_at: null,
    banner_url: `https://example.com/editorial-${index + 1}.jpg`,
    cta_url: 'https://example.com/cta.jpg', caption: 'Texto editorial.',
    hashtags: ['#cinema', '#trailer', '#estreia', '#filme', '#wiregeek'],
    instagram_child_container_ids: [],
  }));
}

function harness(rows, { incompleteRestore = false } = {}) {
  const calls = [];
  const supabase = {
    from(table) {
      let update = false;
      const query = {
        select() { return query; }, eq() { return query; }, is() { return query; },
        update() { update = true; calls.push('restore'); return query; },
        maybeSingle: async () => ({ data: table === 'noticias'
          ? { id: 10, artigo: 'Artigo completo confirmado para teste.' }
          : { id: 1, publication_group_id: 'group' }, error: null }),
        order: async () => ({ data: rows, error: null }),
        then(resolve) { return Promise.resolve({ data: update && incompleteRestore
          ? rows.slice(1) : rows, error: null }).then(resolve); },
      };
      return query;
    },
    rpc: async () => { calls.push('reserve'); return { data: rows, error: null }; },
  };
  const context = vm.createContext({
    correctionSnapshot, correctedEditorials, reelAssetPrefix, ...reel, URL, Buffer, process: { env: {} }, console: { log() {}, error() {} },
    mockSupabase: supabase, calls,
  });
  vm.runInContext(source + `
    getSupabase = () => mockSupabase;
    createInstagramJpeg = async (_db, url) => { calls.push(url); return url; };
    resolveApprovedInstagramReelAsset = async () => ({
      storagePath: 'instagram-reels/group-hash.mp4', videoUrl: 'https://example.com/reel.mp4',
      sha256: 'a'.repeat(64), bytes: 100,
    });
    globalThis.invoke = handler;
    globalThis.loadPayload = loadInstagramReelPayload;
  `, context);
  async function invoke(body = {}) {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; },
      json(data) { this.data = JSON.parse(JSON.stringify(data)); return this; } };
    await context.invoke({ method: 'POST', body: { id: 1, ...body } }, response);
    return response;
  }
  return { invoke, calls, payload: () => context.loadPayload(supabase, rows, 1, 'group') };
}

for (const count of [1, 2]) {
  test(`dry-run com ${count} editorial(is) preserva ordem e reserva/restaura o grupo inteiro`, async () => {
    const rows = fixture(count);
    const { invoke, calls } = harness(rows);
    const response = await invoke();
    assert.equal(response.statusCode, 200);
    assert.equal(response.data.dry_run, true);
    assert.deepEqual(response.data.reel.frames, [...rows.map(row => row.banner_url), rows[0].cta_url]);
    assert.deepEqual(response.data.reel.publication_ids, rows.map(row => row.id));
    assert.deepEqual(calls.slice(-2), ['reserve', 'restore']);
  });
  test(`asset e payload Reel com ${count} editorial(is) usam somente os banners materializados`, async () => {
    const rows = fixture(count);
    const h = harness(rows);
    const payload = await h.payload();
    assert.deepEqual(Array.from(payload.bannerUrls), [...rows.map(row => row.banner_url), rows[0].cta_url]);
    const response = await h.invoke({ instagram_reel_asset: true });
    assert.equal(response.statusCode, 200);
    assert.equal(response.data.reel.duration_seconds, count * 12 + 6);
    assert.deepEqual(response.data.reel.frame_seconds, [...rows.map(() => 12), 6]);
    assert.equal(response.data.publish_called, false);
    assert.deepEqual(h.calls, []);
  });
  test(`restauração incompleta de ${count} editorial(is) falha`, async () => {
    const response = await harness(fixture(count), { incompleteRestore: true }).invoke();
    assert.notEqual(response.statusCode, 200);
  });
}

test('bloqueia grupos vazios, excessivos, sem posição 1 e posições repetidas antes de reservar', async () => {
  for (const rows of [[], fixture(3), [{ ...fixture(1)[0], carousel_position: 2 }],
    fixture(2).map(row => ({ ...row, carousel_position: 1 }))]) {
    const { invoke, calls } = harness(rows);
    assert.equal((await invoke()).statusCode, 409);
    assert.deepEqual(calls, []);
  }
});

test('bloqueia CTA divergente, banner vazio e hashtags divergentes', async () => {
  for (const patch of [{ cta_url: 'https://example.com/outro.jpg' }, { banner_url: '' },
    { hashtags: ['#cinema', '#outro', '#estreia', '#filme', '#wiregeek'] }]) {
    const rows = fixture(2);
    Object.assign(rows[1], patch);
    await assert.rejects(harness(rows).payload());
    assert.equal((await harness(rows).invoke({ instagram_reel_asset: true })).statusCode, 409);
  }
});

test('montagem do MP4 usa 12s por editorial e CTA final de 6s, sem repetir downloads', async () => {
  const videoSource = readFileSync(new URL('../lib/instagram-reel.mjs', import.meta.url), 'utf8');
  const fn = videoSource.slice(videoSource.indexOf('export async function buildInstagramReelVideo'),
    videoSource.indexOf('export async function uploadInstagramReelVideo')).replace('export ', '');
  for (const count of [1, 2]) {
    const downloads = [], durations = [];
    const context = vm.createContext({
      INSTAGRAM_REEL_SLIDE_COUNT: 3, INSTAGRAM_REEL_WIDTH: 1080, INSTAGRAM_REEL_HEIGHT: 1920,
      path, os: { tmpdir: () => '/tmp' }, mkdtemp: async () => '/tmp/test',
      downloadImage: async url => { downloads.push(url); return Buffer.from('image'); },
      prepareVerticalFrame: async () => {}, writeFile: async () => {},
      readFile: async () => Buffer.from('mock-mp4'), rm: async () => {},
      runFfmpeg: async args => { const index = args.indexOf('-t'); if (index >= 0) durations.push(Number(args[index + 1])); },
    });
    vm.runInContext(fn + '\nglobalThis.build = buildInstagramReelVideo;', context);
    const urls = [...fixture(count).map(row => row.banner_url), 'https://example.com/cta.jpg'];
    const result = await context.build({ bannerUrls: urls });
    assert.deepEqual(downloads, urls);
    assert.deepEqual(durations, [...Array(count).fill(12), 6]);
    assert.equal(result.slides, count + 1);
    assert.equal(result.duration_seconds, count * 12 + 6);
    await assert.rejects(context.build({ bannerUrls: [] }));
    await assert.rejects(context.build({ bannerUrls: [...urls, ...urls] }));
  }
});
