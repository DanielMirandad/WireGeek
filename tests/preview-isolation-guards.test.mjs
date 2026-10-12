import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/site-publish-handler.mjs';
import { assertPreviewSupabaseIsolation, PREVIEW_SUPABASE_PROJECT } from '../lib/preview-supabase-isolation.mjs';
import { assertPreviewPublishTarget } from '../lib/preview-publish-target.mjs';

const previewUrl = `https://${PREVIEW_SUPABASE_PROJECT}.supabase.co`;
const productionUrl = 'https://bytxdmxpqsdxxcjbufnf.supabase.co';

function jwt(ref = PREVIEW_SUPABASE_PROJECT, role = 'service_role') {
  return [
    Buffer.from('{}').toString('base64url'),
    Buffer.from(JSON.stringify({ ref, role })).toString('base64url'),
    'synthetic',
  ].join('.');
}

async function withEnv(values, run) {
  const keys = Object.keys(values);
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function response() {
  return {
    status(code) { this.statusCode = code; return this; },
    json(data) { this.data = data; return this; },
    setHeader() {},
  };
}

test('Preview Supabase isolation accepts only the dedicated Preview project', () => {
  const env = {
    VERCEL_ENV: 'preview',
    SUPABASE_URL: previewUrl,
    NEXT_PUBLIC_SUPABASE_URL: previewUrl,
    SUPABASE_SERVICE_ROLE_KEY: jwt(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt(PREVIEW_SUPABASE_PROJECT, 'anon'),
  };
  assert.deepEqual(assertPreviewSupabaseIsolation(env), {
    environment: 'preview',
    project_ref: PREVIEW_SUPABASE_PROJECT,
  });
  assert.throws(
    () => assertPreviewSupabaseIsolation({ ...env, SUPABASE_URL: productionUrl }),
    error => error.code === 'PREVIEW_SUPABASE_PROJECT_MISMATCH',
  );
});

test('site handler blocks mismatched Preview database before any database access', async () => {
  await withEnv({
    VERCEL_ENV: 'preview',
    SUPABASE_URL: productionUrl,
    NEXT_PUBLIC_SUPABASE_URL: previewUrl,
    SUPABASE_SERVICE_ROLE_KEY: jwt('bytxdmxpqsdxxcjbufnf'),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt(PREVIEW_SUPABASE_PROJECT, 'anon'),
    WIREGEEK_AUTOMATION_KEY: 'test-key',
    WIREGEEK_ACCESS_KEY: '',
  }, async () => {
    let dbReads = 0;
    const supabase = {
      supabaseUrl: productionUrl,
      from() { dbReads += 1; throw new Error('must not access database'); },
    };
    const req = {
      method: 'POST',
      headers: { 'x-wiregeek-automation-key': 'test-key' },
      query: { mode: 'site-publish' },
      body: { action: 'generate-editorial', noticia_id: 1 },
    };
    const res = response();
    await handler(req, res, { supabase });
    assert.equal(res.statusCode, 503);
    assert.equal(res.data.code, 'PREVIEW_SUPABASE_PROJECT_MISMATCH');
    assert.equal(dbReads, 0);
  });
});

test('Preview publish target only allows the explicitly configured Bagaça Preview host', () => {
  const host = 'bagaca-cast-site-12345678-danielmirandads-projects.vercel.app';
  const env = { VERCEL_ENV: 'preview', BAGACA_SITE_PREVIEW_PUBLISH_HOST: host };
  assert.doesNotThrow(() =>
    assertPreviewPublishTarget(new URL(`https://${host}/api/integrations/wiregeek/publish`), env)
  );
  assert.throws(() =>
    assertPreviewPublishTarget(new URL('https://bagacastudios.com.br/api/integrations/wiregeek/publish'), env),
    /nao autorizado/,
  );
  assert.throws(() =>
    assertPreviewPublishTarget(new URL(`https://${host}.evil.test/api/integrations/wiregeek/publish`), env),
    /nao autorizado/,
  );
});

test('Production behavior is unchanged by Preview-only guards', () => {
  assert.equal(assertPreviewSupabaseIsolation({ VERCEL_ENV: 'production' }), null);
  assert.doesNotThrow(() =>
    assertPreviewPublishTarget(new URL('https://bagacastudios.com.br/api/integrations/wiregeek/publish'), {
      VERCEL_ENV: 'production',
    })
  );
});
