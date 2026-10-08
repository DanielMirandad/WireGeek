import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { assertPreviewSupabaseIsolation, PREVIEW_SUPABASE_PROJECT as ref } from '../lib/preview-supabase-isolation.mjs';
import handler from '../lib/site-publish-handler.mjs';
import { generateSiteEditorialPreview } from '../lib/site-editorial.mjs';
import { createGenerationCache } from '../lib/generation-cache.mjs';

const url = `https://${ref}.supabase.co`;
const other = 'https://bytxdmxpqsdxxcjbufnf.supabase.co';
const jwt = (project = ref, role = 'service_role') =>
  Buffer.from('{}').toString('base64url') + '.' +
  Buffer.from(JSON.stringify({ ref: project, role })).toString('base64url') + '.synthetic';
const config = () => ({ VERCEL_ENV: 'preview', SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: jwt(),
  SUPABASE_SECRET_KEY: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt(ref, 'anon'),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '', WIREGEEK_AUTOMATION_KEY: 'synthetic-auth' });
async function withEnv(env, run) {
  const keys = Object.keys(config());
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try { for (const k of keys) { delete process.env[k]; }
    Object.assign(process.env, env); return await run();
  } finally { for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  } }
}
const response = () => ({ status(code) { this.statusCode = code; return this; },
  json(data) { this.data = data; return this; }, setHeader() {} });
const req = action => ({ method: 'POST', headers: { 'x-wiregeek-automation-key': 'synthetic-auth' },
  body: { action, noticia_id: 1, supabase_url: url }, query: { mode: 'site-publish' } });

test('matching server-owned Preview URLs and credentials accept only the allowed test project', () => {
  assert.deepEqual(assertPreviewSupabaseIsolation(config()), { environment: 'preview', project_ref: ref });
  const env = { ...config(), SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_SECRET_KEY: 'sb_secret_synthetic' };
  assert.equal(assertPreviewSupabaseIsolation(env).project_ref, ref);
  const client = createClient(url, jwt(), { auth: { persistSession: false, autoRefreshToken: false } });
  assert.equal(assertPreviewSupabaseIsolation(config(), client).project_ref, ref);
});

const cases = [
  ['private/public divergence', { SUPABASE_URL: other }, 'PROJECT_MISMATCH'],
  ['frontend divergence', { NEXT_PUBLIC_SUPABASE_URL: other }, 'PROJECT_MISMATCH'],
  ['matching Production is forbidden', { SUPABASE_URL: other, NEXT_PUBLIC_SUPABASE_URL: other }, 'PROJECT_MISMATCH'],
  ['missing private URL', { SUPABASE_URL: '' }, 'CONFIG_MISSING'],
  ['missing trusted frontend URL', { NEXT_PUBLIC_SUPABASE_URL: '' }, 'CONFIG_MISSING'],
  ['missing private credential', { SUPABASE_SERVICE_ROLE_KEY: '' }, 'CONFIG_MISSING'],
  ['private credential from another project', { SUPABASE_SERVICE_ROLE_KEY: jwt('bytxdmxpqsdxxcjbufnf') }, 'KEY_MISMATCH'],
  ['conflicting unused private credential', { SUPABASE_SECRET_KEY: jwt('bytxdmxpqsdxxcjbufnf') }, 'KEY_MISMATCH'],
  ['public credential from another project', { NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('bytxdmxpqsdxxcjbufnf', 'anon') }, 'KEY_MISMATCH'],
  ['anon cannot replace private credential', { SUPABASE_SERVICE_ROLE_KEY: jwt(ref, 'anon') }, 'KEY_MISMATCH'],
  ['malformed credential', { SUPABASE_SERVICE_ROLE_KEY: 'invalid' }, 'KEY_MISMATCH'],
  ['untrusted hostname', { SUPABASE_URL: url + '.attacker.example' }, 'CONFIG_INVALID'],
  ['URL credentials', { SUPABASE_URL: `https://user:password@${ref}.supabase.co` }, 'CONFIG_INVALID'],
  ['URL path', { NEXT_PUBLIC_SUPABASE_URL: url + '/rest/v1' }, 'CONFIG_INVALID'],
  ['HTTP', { SUPABASE_URL: url.replace('https:', 'http:') }, 'CONFIG_INVALID'],
];
for (const [name, change, code] of cases) test(`${name}: blocks every editorial action before DB, source, cache or paid call`, async () => {
  await withEnv({ ...config(), ...change }, async () => {
    const counts = { db: 0, source: 0, cache: 0, paid: 0, network: 0 };
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => { counts.network++; throw new Error('network forbidden'); };
    const supabase = { supabaseUrl: url, from() { counts.db++; throw new Error('DB forbidden'); } };
    const opts = { createResponse() { counts.paid++; throw new Error('inference forbidden'); },
      captureSource() { counts.source++; throw new Error('source forbidden'); },
      generationCache: { async get() { counts.cache++; throw new Error('cache forbidden'); } } };
    try {
      for (const action of ['generate-editorial', 'verify-editorial', 'approve-editorial', 'publish']) {
        const res = response(); await handler(req(action), res, { supabase, editorialOptions: opts });
        assert.equal(res.statusCode, 503);
        assert.equal(res.data.code, `PREVIEW_SUPABASE_${code}`);
        assert.doesNotMatch(JSON.stringify(res.data), /password|synthetic|bytxdmxp|lftqhpo/);
      }
      // A direct module call and cache hit cannot bypass the same gate.
      const result = await generateSiteEditorialPreview({ supabase, noticiaId: 1 }, opts);
      assert.equal(result.json.code, `PREVIEW_SUPABASE_${code}`);
      assert.deepEqual(counts, { db: 0, source: 0, cache: 0, paid: 0, network: 0 });
    } finally { globalThis.fetch = previousFetch; }
  });
});

test('actual injected client must match trusted backend, even with matching deployment config', async () => {
  await withEnv(config(), async () => {
    const supabase = { supabaseUrl: other, from() { assert.fail('DB'); } };
    const res = response(); await handler(req('generate-editorial'), res, { supabase });
    assert.equal(res.data.code, 'PREVIEW_SUPABASE_CLIENT_MISMATCH');
    const result = await generateSiteEditorialPreview({ supabase, noticiaId: 1 });
    assert.equal(result.json.code, 'PREVIEW_SUPABASE_CLIENT_MISMATCH');
  });
});

test('missing client URL fails closed; opaque credentials require a successful news read before inference', async () => {
  await withEnv({ ...config(), SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_synthetic' }, async () => {
    const supabase = { from() { assert.fail('DB'); } };
    assert.equal((await generateSiteEditorialPreview({ supabase, noticiaId: 1 })).json.code, 'PREVIEW_SUPABASE_CONFIG_MISSING');
    supabase.supabaseUrl = url;
    supabase.from = () => ({ select() { return this; }, eq() { return this; },
      async maybeSingle() { return { error: { message: 'credential rejected' } }; } });
    const result = await generateSiteEditorialPreview({ supabase, noticiaId: 1 }, {
      createResponse() { assert.fail('inference'); }, captureSource() { assert.fail('source'); },
    });
    assert.equal(result.json.code, 'EDITORIAL_CONTEXT_UNAVAILABLE');
  });
});

test('matching config reaches one simulated generation only after news identity and source checks', async () => {
  await withEnv(config(), async () => {
    const events = [];
    const source = { text: 'Documento literal. Dados verificados.', final_url: 'https://example.org/news',
      title: 'Fonte sintetica', source_hash: 'sha256:' + 'a'.repeat(64) };
    const body = Array.from({ length: 6 }, (_, i) => `Fato ${i}: ` + 'a'.repeat(300)).join('\n\n');
    const excerpt = 'Resumo: ' + 'b'.repeat(120);
    const supabase = { supabaseUrl: url, from() { events.push('db'); return {
      select() { return this; }, eq(_field, id) { assert.equal(id, 1); return this; },
      async maybeSingle() { return { data: { id: 1, titulo: 'Pauta sintetica', url: source.final_url, fontes: [] } }; },
    }; } };
    const res = response(); await handler(req('generate-editorial'), res, { supabase, editorialOptions: {
      generationCache: createGenerationCache({ name: 'isolation-test', ttlMs: 1000, maxEntries: 2, persistent: null }),
      async captureSource() { events.push('source'); return source; },
      async createResponse(request) {
        events.push(request.purpose);
        return { text: JSON.stringify(request.purpose === 'site-editorial' ?
          { materia_site: body, resumo_site: excerpt } : { unidades: Array.from({ length: 7 }, (_, indice) => ({
            indice, cobertura_completa: true, claims: [{ claim: `Fato ${indice}`, supported: true,
              fonte: 0, evidencia: 0, motivo: 'Suporte sintetico' }],
          })) }) };
      },
    } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(events, ['db', 'source', 'site-editorial', 'site-editorial-verification']);
  });
});

test('authenticated preflight confirms noticia #1 with no capture or inference', async () => {
  await withEnv(config(), async () => {
    const supabase = { supabaseUrl: url, from(table) { assert.equal(table, 'noticias'); return {
      select() { return this; }, eq(_field, id) { assert.equal(id, 1); return this; },
      async maybeSingle() { return { data: { id: 1, titulo: 'Pauta sintetica' } }; },
    }; } };
    const res = response(); await handler({ ...req(), method: 'GET',
      query: { noticia_id: 1, action: 'editorial-preflight' } }, res, { supabase });
    assert.equal(res.statusCode, 200); assert.equal(res.data.data.id, 1);
    assert.equal(res.data.isolation.project_ref, ref);
  });
});

test('Production and ordinary local execution retain existing behavior', () => {
  for (const VERCEL_ENV of ['production', 'development', undefined]) {
    assert.equal(assertPreviewSupabaseIsolation({ VERCEL_ENV }), null);
  }
});

test('restricted diagnostic identifies only variable, reason and actual backend selection', async () => {
  const scenarios = [
    [{ SUPABASE_SERVICE_ROLE_KEY: 'unusable-synthetic' }, 'SUPABASE_SERVICE_ROLE_KEY', 'INVALID_FORMAT', true],
    [{ SUPABASE_SECRET_KEY: 'unusable-synthetic' }, 'SUPABASE_SECRET_KEY', 'INVALID_FORMAT', false],
    [{ SUPABASE_SERVICE_ROLE_KEY: 'e30.bm90LWpzb24.synthetic' }, 'SUPABASE_SERVICE_ROLE_KEY', 'INVALID_STRUCTURE', true],
    [{ SUPABASE_SERVICE_ROLE_KEY: jwt('bytxdmxpqsdxxcjbufnf') }, 'SUPABASE_SERVICE_ROLE_KEY', 'PROJECT_MISMATCH', true],
    [{ SUPABASE_SERVICE_ROLE_KEY: jwt(ref, 'anon') }, 'SUPABASE_SERVICE_ROLE_KEY', 'ROLE_MISMATCH', true],
    [{ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('bytxdmxpqsdxxcjbufnf', 'anon') }, 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'PROJECT_MISMATCH', false],
    [{ SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_SECRET_KEY: 'invalid' }, 'SUPABASE_SECRET_KEY', 'INVALID_FORMAT', true],
    [{ SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_SECRET_KEY: '' }, 'SUPABASE_SECRET_KEY', 'MISSING_PRIVATE_KEY', true],
  ];
  for (const [change, variable, reason, selected] of scenarios) await withEnv({ ...config(), ...change }, async () => {
    const res = response();
    await handler({ ...req(), method: 'GET', query: { noticia_id: 1, action: 'isolation-diagnostic' } }, res,
      { supabase: { from() { assert.fail('database'); } } });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.data.diagnostic, { variable, reason, used_by_backend: selected });
    assert.equal(res.data.connection_confirmed, false);
    assert.doesNotMatch(JSON.stringify(res.data), /synthetic|sb_secret|sb_publishable|bytxdmxp|lftqhpo|e30/);
  });
});

test('diagnostic requires authentication and Preview and never returns database errors', async () => {
  const request = { ...req(), method: 'GET', query: { noticia_id: 1, action: 'isolation-diagnostic' } };
  await withEnv(config(), async () => {
    const unauth = response(); await handler({ ...request, headers: {} }, unauth);
    assert.equal(unauth.statusCode, 401); assert.equal(unauth.data.diagnostic, undefined);
    for (const success of [true, false]) {
      const res = response();
      const supabase = { supabaseUrl: url, from() { return { select() { return this; }, eq() { return this; },
        async maybeSingle() { if (!success) throw new Error('sensitive credential and URL'); return { data: { id: 1 } }; } }; } };
      await handler(request, res, { supabase });
      assert.equal(res.statusCode, success ? 200 : 503);
      assert.equal(res.data.connection_confirmed, success);
      assert.doesNotMatch(JSON.stringify(res.data), /sensitive|credential|supabase.co/);
    }
  });
  await withEnv({ ...config(), VERCEL_ENV: 'production' }, async () => {
    const res = response(); await handler(request, res); assert.equal(res.statusCode, 404);
  });
});
