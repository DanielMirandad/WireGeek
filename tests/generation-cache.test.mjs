import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createGenerationCache, generationKey } from '../lib/generation-cache.mjs';
import { validateVisualCandidates } from '../lib/banner-vision-briefing.mjs';
import { deriveBannerVisualTitle } from '../lib/banner-title-briefing.mjs';
import { createOpenAIResponse } from '../lib/openai-responses.mjs';

test('shares concurrent work, copies results, expires and evicts oldest entries', async () => {
  let time = 0, calls = 0;
  const cache = createGenerationCache({ name: 'test', ttlMs: 10, maxEntries: 2, now: () => time });
  const produce = async () => ({ calls: ++calls });
  const results = await Promise.all([cache.run('a', produce), cache.run('a', produce)]);
  assert.equal(calls, 1);
  results[0].calls = 99;
  assert.equal((await cache.run('a', produce)).calls, 1);
  time = 10;
  assert.equal((await cache.run('a', produce)).calls, 2);
  await cache.run('b', produce);
  await cache.run('c', produce);
  await cache.run('a', produce);
  assert.equal(calls, 5);
});

test('does not store failures; explicit concurrent refresh performs one new generation', async () => {
  const cache = createGenerationCache({ name: 'test', ttlMs: 100, maxEntries: 2 });
  let calls = 0;
  await assert.rejects(cache.run('a', async () => { throw new Error('API unavailable'); }));
  const produce = async () => ++calls;
  await cache.run('a', produce);
  assert.deepEqual(await Promise.all([cache.run('a', produce, {refresh:true}), cache.run('a', produce, {refresh:true})]), [2,2]);
  assert.equal(await cache.run('a', produce), 2);
  await cache.run('invalid', produce, {cacheIf: () => false});
  await cache.run('invalid', produce, {cacheIf: () => false});
  assert.equal(calls, 4);
});

test('cache key is stable and changes with bytes, context, model and rules', () => {
  assert.equal(generationKey({b:2,a:1}), generationKey({a:1,b:2}));
  const data = {image:Buffer.from('a'), context:'news', model:'m', version:'v1'};
  for (const change of [{image:Buffer.from('b')},{context:'other'},{model:'new'},{version:'v2'}]) {
    assert.notEqual(generationKey(data), generationKey({...data,...change}));
  }
});

async function mocked(sequence, run) {
  const oldFetch = globalThis.fetch;
  const names = ['OPENAI_API_KEY','BANNER_VISION_ENABLED','BANNER_VISION_MODEL','OPENAI_BANNER_TITLE_MODEL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];
  const env = Object.fromEntries(names.map(name => [name,process.env[name]]));
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.OPENAI_API_KEY = 'test-only';
  process.env.BANNER_VISION_ENABLED = 'true';
  process.env.BANNER_VISION_MODEL = 'vision-test';
  process.env.OPENAI_BANNER_TITLE_MODEL = 'title-test';
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const next = sequence[requests.length - 1];
    if (next instanceof Error) throw next;
    assert.ok(next, 'Unexpected paid request');
    return { ok:true, status:200, json:async () => ({output_text:JSON.stringify(next)}) };
  };
  try { await run(requests); }
  finally {
    globalThis.fetch = oldFetch;
    for (const [name,value] of Object.entries(env)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}

async function visualOptions(subject) {
  const imageBuffer = await sharp({create:{width:16,height:16,channels:3,background:'#204060'}}).png().toBuffer();
  return {images:[{imageBuffer}], subject, query:'original', highlights:['fact'], provenance:{provider:'source'}};
}
const approved = {distinct:true,images:[{index:0,approved:true,reason:'correct subject'}]};
const rejected = {distinct:true,images:[{index:0,approved:false,reason:'wrong subject'}]};

test('vision reuses accepted and rejected decisions; changing context or model revalidates', async () => {
  const options = await visualOptions('cache-integration');
  await mocked([approved,rejected,approved], async requests => {
    await Promise.all([validateVisualCandidates(options),validateVisualCandidates(options)]);
    assert.equal(requests.length,1);
    const other = {...options, query:'different'};
    for (let index=0; index<2; index++) await assert.rejects(validateVisualCandidates(other), error => error.code === 'BANNER_VISUAL_REJECTED');
    assert.equal(requests.length,2);
    process.env.BANNER_VISION_MODEL = 'vision-test-new';
    await validateVisualCandidates(options);
    assert.equal(requests.length,3);
  });
});

test('vision service errors are retried by next request; disabled vision never caches approval', async () => {
  const options = await visualOptions('vision-error-integration');
  await mocked([new Error('unavailable'),approved], async requests => {
    await assert.rejects(validateVisualCandidates(options));
    process.env.BANNER_VISION_ENABLED = 'false';
    assert.equal((await validateVisualCandidates(options)).skipped,true);
    process.env.BANNER_VISION_ENABLED = 'true';
    await validateVisualCandidates(options);
    assert.equal(requests.length,2);
  });
});

test('title falls back deterministically and caches only valid generated titles', async () => {
  const title = {
    title_main: 'TEST',
    title_theme: 'New Trailer',
  };

  await mocked(
    [
      {
        title_main: '',
        title_theme: '',
      },
      title,
      title,
    ],
    async requests => {
      const item = {
        titulo: 'Darkwing Duck ganha novo trailer',
        titulo_curto: 'Darkwing Duck Returns',
        materia: 'Disney divulga novas imagens.',
        categoria: 'cultura pop',
      };

      const fallback =
        await deriveBannerVisualTitle(item);

      assert.deepEqual(
        fallback,
        {
          title_main: 'Darkwing Duck',
          title_theme: 'ganha novo trailer',
        }
      );

      assert.equal(requests.length, 1);

      assert.deepEqual(
        await deriveBannerVisualTitle(item),
        title
      );

      assert.deepEqual(
        await deriveBannerVisualTitle(item),
        title
      );

      assert.equal(requests.length, 2);

      await deriveBannerVisualTitle({
        ...item,
        materia:
          'Disney divulga uma nova informacao confirmada.',
      });

      assert.equal(requests.length, 3);
    }
  );
});

test('usage telemetry records numeric usage without exposing input, keys or response body', async () => {
  const oldFetch = globalThis.fetch, oldLog = console.log, oldKey = process.env.OPENAI_API_KEY;
  const logs = [];
  process.env.OPENAI_API_KEY = 'secret-test-key';
  console.log = (...values) => logs.push(values);
  globalThis.fetch = async () => ({ok:true,status:200,json:async () => ({output_text:'private output',usage:{input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:30},output_tokens_details:{reasoning_tokens:5}},output:[{type:'web_search_call'}]})});
  try {
    await createOpenAIResponse({model:'test',purpose:'test-flow',input:'private prompt'});
    const metric = logs.find(([name]) => name === 'WIRE/GEEK: consumo OpenAI')[1];
    assert.equal(metric.input_tokens,100);
    assert.equal(metric.output_tokens,20);
    assert.equal(metric.cached_input_tokens,30);
    assert.equal(metric.reasoning_tokens,5);
    assert.equal(metric.web_search_calls,1);
    assert.doesNotMatch(JSON.stringify(logs),/secret-test-key|private prompt|private output/);
  } finally {
    globalThis.fetch=oldFetch;console.log=oldLog;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;
  }
});

function persistentFixture() {
  const rows = new Map();
  let reads = 0, writes = 0, time = 1000;
  const persistent = {
    async get(namespace, key) { reads++; return structuredClone(rows.get(`${namespace}:${key}`) || null); },
    async set(namespace, key, payload, created, expires) {
      writes++; rows.set(`${namespace}:${key}`, { payload: structuredClone(payload), expires_at: new Date(expires).toISOString() });
    },
  };
  const cache = (name = 'test') => createGenerationCache({ name, ttlMs: 100, maxEntries: 3, persistent, now: () => time });
  return { cache, rows, persistent, advance: amount => time += amount, counts: () => ({ reads, writes }) };
}

test('persistent hit across instances; memory is first and preserves original expiry', async () => {
  const fixture = persistentFixture();
  const first = fixture.cache(), second = fixture.cache();
  await first.run('hash', async () => ({ valid: true }));
  fixture.advance(50);
  const hit = await second.run('hash', () => { throw new Error('OpenAI must not run'); });
  assert.equal(hit.valid, true);
  hit.valid = false;
  assert.equal((await second.run('hash', () => null)).valid, true);
  assert.deepEqual(fixture.counts(), { reads: 2, writes: 1 });
  fixture.advance(50);
  assert.equal((await second.run('hash', async () => ({ renewed: true }))).renewed, true);
  assert.deepEqual(fixture.counts(), { reads: 3, writes: 2 });
});

test('force refresh bypasses memory and persistent lookup and replaces stored output', async () => {
  const fixture = persistentFixture();
  const cache = fixture.cache();
  await cache.run('hash', async () => 1);
  assert.equal(await cache.run('hash', async () => 2, { refresh: true }), 2);
  assert.deepEqual(fixture.counts(), { reads: 1, writes: 2 });
  assert.equal(await fixture.cache().run('hash', () => 3), 2);
});

test('refresh never shares an ordinary pending cache lookup', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const persistent = { get: async () => { await gate; return {payload: 1, expires_at: new Date(Date.now() + 10000).toISOString()}; }, set: async () => {} };
  const cache = createGenerationCache({ name: 'test', ttlMs: 100, maxEntries: 3, persistent });
  const normal = cache.run('hash', () => 2);
  const refresh = cache.run('hash', () => 3, { refresh: true });
  release();
  assert.equal(await normal, 1);
  assert.equal(await refresh, 3);
  assert.equal(await cache.run('hash', () => 4), 3);
});

test('errors and invalid output are not persisted; invalid persistent output is rejected', async () => {
  const fixture = persistentFixture();
  const cache = fixture.cache();
  await assert.rejects(cache.run('error', () => { throw new Error('API failure'); }));
  const options = { cacheIf: value => value?.valid === true };
  await cache.run('invalid', () => ({valid: false}), options);
  assert.equal(fixture.counts().writes, 0);
  fixture.rows.set('test:invalid', { payload: {valid:false}, expires_at: new Date(2000).toISOString() });
  assert.equal((await cache.run('invalid', () => ({valid:true}), options)).valid, true);
  assert.equal(fixture.counts().writes, 1);
});

test('persistent cache isolates namespaces and changed generation keys', async () => {
  const fixture = persistentFixture();
  const key = generationKey({model:'a',prompt:'one'});
  const otherKey = generationKey({model:'a',prompt:'two'});
  await fixture.cache('one').run(key, () => 1);
  assert.equal(await fixture.cache('one').run(otherKey, () => 2), 2);
  assert.equal(await fixture.cache('two').run(key, () => 3), 3);
  assert.equal(fixture.counts().writes, 3);
});

test('persistent read/write failures do not block generation or memory reuse', async () => {
  let calls = 0;
  const persistent = { get: async () => { throw new Error('read'); }, set: async () => { throw new Error('write'); } };
  const cache = createGenerationCache({name:'test',ttlMs:100,maxEntries:2,persistent});
  assert.equal(await cache.run('key', () => ++calls), 1);
  assert.equal(await cache.run('key', () => ++calls), 1);
});

test('Supabase adapter writes only output fields and hash, never input envelopes', async () => {
  const { createPersistentGenerationStore } = await import('../lib/persistent-generation-cache.mjs');
  let row, conflict;
  const store = createPersistentGenerationStore(() => ({from(table) {
    assert.equal(table, 'openai_generation_cache');
    return {upsert(value, options) {row=value;conflict=options;return {abortSignal:async () => ({error:null})};}};
  }}));
  await store.set('banner-title', generationKey('private prompt'), {
    title_main:'Example',title_theme:'Trailer',prompt:'private prompt',image:Buffer.from('raw image'),credentials:'secret',usage:{},
  }, 1000, 2000);
  assert.deepEqual(row.payload, {title_main:'Example',title_theme:'Trailer'});
  assert.deepEqual(conflict, {onConflict:'namespace,key_hash'});
  assert.match(row.key_hash, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(row), /private prompt|raw image|secret|credentials/);
});

function adapterFixture({ cleanupError = false, deleteError = false, stalled = false } = {}) {
  const calls = [], rows = [];
  const db = { from() {
    let operation, fields;
    const filters = [];
    const query = {
      select(value) { operation = 'select'; fields = value; return this; },
      upsert(row) { operation = 'upsert'; rows.push(row); return this; },
      delete() { operation = 'delete'; return this; },
      eq(...args) { filters.push(['eq', ...args]); return this; },
      in(...args) { filters.push(['in', ...args]); return this; },
      lt(...args) { filters.push(['lt', ...args]); return this; },
      order(...args) { filters.push(['order', ...args]); return this; },
      limit(...args) { filters.push(['limit', ...args]); return this; },
      abortSignal(signal) {
        if (fields === 'payload,expires_at') return this;
        calls.push({ operation, fields, filters, signal });
        if (fields === 'namespace,key_hash') {
          if (stalled) return new Promise(() => {});
          return Promise.resolve({ data: [{ namespace: 'banner-title', key_hash: 'expired' }], error: cleanupError ? {} : null });
        }
        return Promise.resolve({ error: operation === 'delete' && deleteError ? {} : null });
      },
      async maybeSingle() { return { data: null, error: null }; },
    };
    return query;
  }};
  return { db, calls, rows };
}

test('opportunistic cleanup is bounded, throttled and rechecks database expiry on deletion', async () => {
  const { createPersistentGenerationStore } = await import('../lib/persistent-generation-cache.mjs');
  const fixture = adapterFixture();
  let time = 0;
  const store = createPersistentGenerationStore(() => fixture.db, { now: () => time });
  await Promise.all([store.get('banner-title', 'a'), store.set('banner-title', 'b', {title_main:'B'}, 1000, 2000)]);
  await new Promise(resolve => setImmediate(resolve));
  const selection = fixture.calls.find(call => call.fields === 'namespace,key_hash');
  assert.deepEqual(selection.filters, [['lt', 'expires_at', 'now'], ['order', 'expires_at'], ['limit', 100]]);
  const deletion = fixture.calls.find(call => call.operation === 'delete');
  assert.deepEqual(deletion.filters, [['eq', 'namespace', 'banner-title'], ['in', 'key_hash', ['expired']], ['lt', 'expires_at', 'now']]);
  assert.equal(selection.signal, deletion.signal);
  time = 299999;
  await store.get('banner-title', 'a');
  assert.equal(fixture.calls.filter(call => call.fields === 'namespace,key_hash').length, 1);
  time = 300000;
  await store.get('banner-title', 'a');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.calls.filter(call => call.fields === 'namespace,key_hash').length, 2);
});

test('cleanup select/delete failures and stalled cleanup do not block generation, writes or memory hits', async () => {
  const { createPersistentGenerationStore } = await import('../lib/persistent-generation-cache.mjs');
  for (const options of [{cleanupError:true}, {deleteError:true}, {stalled:true}]) {
    const fixture = adapterFixture(options);
    const store = createPersistentGenerationStore(() => fixture.db);
    const cache = createGenerationCache({name:'banner-title',ttlMs:10000,maxEntries:2,persistent:store});
    let generations = 0;
    const produce = () => ({ title_main: String(++generations), title_theme: 'Trailer' });
    assert.equal((await cache.run('hash', produce)).title_main, '1');
    assert.equal((await cache.run('hash', produce)).title_main, '1');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fixture.rows.length, 1);
    assert.equal(generations, 1);
    assert.equal(fixture.calls.filter(call => call.fields === 'namespace,key_hash').length, 1);
  }
});
