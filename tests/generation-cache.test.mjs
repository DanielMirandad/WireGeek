import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createGenerationCache, generationKey } from '../lib/generation-cache.mjs';
import { validateVisualCandidates } from '../lib/banner-vision-briefing.mjs';
import { deriveBannerVisualTitle } from '../lib/banner-title-briefing.mjs';
import { generateSiteEditorialPreview } from '../lib/site-editorial.mjs';
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
  const names = ['OPENAI_API_KEY','BANNER_VISION_ENABLED','BANNER_VISION_MODEL','OPENAI_BANNER_TITLE_MODEL'];
  const env = Object.fromEntries(names.map(name => [name,process.env[name]]));
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

test('title caches only valid titles; changed story generates again', async () => {
  const title = {title_main:'TEST',title_theme:'New Trailer'};
  await mocked([{title_main:'',title_theme:''}, title, title], async requests => {
    const item = {titulo:'cache-title-test', materia:'verified fact'};
    await assert.rejects(deriveBannerVisualTitle(item));
    await deriveBannerVisualTitle(item);
    await deriveBannerVisualTitle(item);
    assert.equal(requests.length,2);
    await deriveBannerVisualTitle({...item,materia:'new verified fact'});
    assert.equal(requests.length,3);
  });
});

test('site preview shares requests, invalidates changed sources and honors explicit regeneration', async () => {
  const draft = {materia_site:Array(8).fill('a'.repeat(310)+'.').join('\n\n'),resumo_site:'r'.repeat(200)};
  let source = 'https://example.com/cache-first';
  const supabase = { from(table) {
    return {select(){return this;},eq(){return this;},async maybeSingle(){return {data:{id:9781,titulo:'cache-site-test'}};},async order(){return {data:[{nome:'Official',url:source}]};}};
  }};
  await mocked([draft,draft,draft], async requests => {
    const options = {supabase,noticiaId:9781};
    const results = await Promise.all([generateSiteEditorialPreview(options),generateSiteEditorialPreview(options)]);
    assert.equal(results[0].status,200);
    await generateSiteEditorialPreview(options);
    assert.equal(requests.length,1);
    source = 'https://example.com/cache-updated';
    await generateSiteEditorialPreview(options);
    assert.equal(requests.length,2);
    await generateSiteEditorialPreview({...options,forceRegenerate:true});
    assert.equal(requests.length,3);
    assert.equal(requests[2].max_output_tokens,7000);
    assert.equal(requests[2].tools[0].type,'web_search');
  });
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
