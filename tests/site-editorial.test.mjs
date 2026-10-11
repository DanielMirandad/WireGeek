import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { generateSiteEditorialPreview, validateSiteEditorialInput } from '../lib/site-editorial.mjs';
import handler from '../lib/site-publish-handler.mjs';
import { createGenerationCache } from '../lib/generation-cache.mjs';
import { issueEditorialReceipt, verifyEditorialReceipt } from '../lib/site-editorial-approval.mjs';

// Synthetic structural fixtures only; model stubs do not prove semantic entailment.
function draft(bodyLength = 1800, count = 5, excerptLength = 120) {
  const available = bodyLength - (count - 1) * 2;
  const parts = Array.from({ length: count }, (_, i) => `Fato ${i}: ` + 'a'.repeat(Math.floor(available / count) - 8));
  parts[0] += 'a'.repeat(bodyLength - parts.join('\n\n').length);
  return { materia_site: parts.join('\n\n'), resumo_site: 'Resumo: ' + 'b'.repeat(excerptLength - 8) };
}
const news = { id: 7, titulo: 'Pauta sintetica', categoria: 'Games', url: 'https://example.org/source', fontes: [{ url: 'https://example.net/second-source' }] };
const snapshot = { final_url: news.url, title: 'Fonte sintetica', publicado_em: '2026-10-01',
  text: 'Documento literal. Dados verificados.', source_hash: 'sha256:' + 'a'.repeat(64) };
function db(row = news, error = null) {
  return { from(table) {
    assert.equal(table, 'noticias');
    return { select(fields) { assert.equal(fields, 'id,titulo,categoria,url,fontes(url)'); return this; },
      eq(field, value) { assert.equal(field, 'id'); assert.equal(value, 7); return this; },
      async maybeSingle() { return { data: row, error }; } };
  } };
}
const newCache = () => createGenerationCache({ name: 'test-editorial', ttlMs: 10000, maxEntries: 4, persistent: null });
function claims(value = draft()) {
  return { unidades: value.materia_site.split('\n\n').concat(value.resumo_site).map((_, indice) => ({
    indice, cobertura_completa: true, claims: [{ claim: `Fato sintetico ${indice}`, supported: true, fonte: 0, evidencia: 0, motivo: 'Trecho confirma o fato.' }],
  })) };
}
function options({ value = draft(), verification = claims(value), onCall = () => {}, captureSource = async url => ({ ...snapshot, final_url: url, source_hash: url === snapshot.final_url ? snapshot.source_hash : 'sha256:' + 'b'.repeat(64) }),
  generationCache = newCache() } = {}) {
  return { captureSource, generationCache, async createResponse(request) {
    onCall(request);
    assert.equal(request.tools, undefined);
    assert.equal(request.text.format.strict, true);
    assert.ok(!request.input.includes('artigo canônico não é evidência'));
    return { text: JSON.stringify(request.purpose === 'site-editorial' ? value : verification) };
  } };
}
const generate = opts => generateSiteEditorialPreview({ supabase: db(), noticiaId: 7 }, opts);

test('server enforces inclusive character, paragraph and excerpt boundaries', () => {
  for (const [length, count, excerpt] of [[1500, 3, 120], [3500, 5, 280]]) {
    const d = draft(length, count, excerpt);
    assert.equal(validateSiteEditorialInput({ materiaSite: d.materia_site, resumoSite: d.resumo_site }).valid, true);
  }
  for (const [length, count, excerpt] of [[1499, 3, 120], [3501, 5, 120], [1800, 2, 120], [1800, 6, 120], [1800, 5, 119], [1800, 5, 281]]) {
    const d = draft(length, count, excerpt);
    assert.equal(validateSiteEditorialInput({ materiaSite: d.materia_site, resumoSite: d.resumo_site }).valid, false);
  }
  for (const value of [undefined, null, {}, 42]) assert.equal(validateSiteEditorialInput({ materiaSite: value, resumoSite: value }).valid, false);
  const d = draft();
  assert.equal(validateSiteEditorialInput({ materiaSite: Array(5).fill(d.materia_site.split('\n\n')[0]).join('\n\n'), resumoSite: d.resumo_site }).valid, false);
  const crlf = d.materia_site.replaceAll('\n', '\r\n');
  assert.equal(validateSiteEditorialInput({ materiaSite: crlf, resumoSite: d.resumo_site }).body, d.materia_site);
});

test('read-only canonical generation returns the panel contract and verifies summary independently', async () => {
  const calls = [];
  const result = await generate(options({ onCall: r => calls.push(r) }));
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.data.materia_site, draft().materia_site);
  assert.equal(result.json.data.diagnostico.paragrafos, 5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].purpose, 'site-editorial');
  assert.deepEqual(result.json.data.fontes_base, [{ nome: snapshot.title, url: snapshot.final_url, publicado_em: snapshot.publicado_em }, { nome: snapshot.title, url: 'https://example.net/second-source', publicado_em: snapshot.publicado_em }]);
});

test('missing news, DB failure, wrong identity and absent sources stop before inference', async () => {
  for (const [row, error, status] of [[null, null, 404], [news, { message: 'db failure' }, 502], [{ ...news, id: 8 }, null, 422], [{ ...news, url: '' }, null, 422]]) {
    const result = await generateSiteEditorialPreview({ supabase: db(row, error), noticiaId: 7 }, options({ onCall: () => assert.fail('inference') }));
    assert.equal(result.status, status);
  }
});

test('source failures or invalid snapshots fail closed without inference', async () => {
  for (const captureSource of [async () => { throw new Error('SOURCE_SSRF_BLOCKED'); }, async () => ({ ...snapshot, text: '' }), async () => ({ ...snapshot, source_hash: '' })]) {
    assert.equal((await generate(options({ captureSource, onCall: () => assert.fail('inference') }))).status, 422);
  }
});

test('unavailable secondary source blocks generation when fewer than two verified sources remain', async () => {
  const row = { ...news, fontes: [{ url: news.url }, { url: 'https://example.org/second' }] };
  const captured = [];
  const inputs = [];
  const result = await generateSiteEditorialPreview({ supabase: db(row), noticiaId: 7 }, options({ captureSource: async url => {
    captured.push(url); if (url.endsWith('second')) throw new Error('BLOCKED'); return snapshot;
  }, onCall: request => inputs.push(request.input) }));
  assert.equal(result.status, 422); assert.equal(result.json.code, 'INSUFFICIENT_SOURCE_EVIDENCE'); assert.deepEqual(captured, [news.url, row.fontes[1].url]);
  assert.equal(inputs.length, 0);
  assert.ok(inputs.every(input => !input.includes('https://example.org/second')));
});
test('all blocked sources still prevent site editorial generation', async () => {
  const row = { ...news, fontes: [{ url: 'https://example.org/second' }] };
  const result = await generateSiteEditorialPreview({ supabase: db(row), noticiaId: 7 },
    options({ captureSource: async () => { throw new Error('BLOCKED'); }, onCall: () => assert.fail('inference') }));
  assert.equal(result.status, 422);
});

test('invalid length or artificial repeated paragraphs skip the verification call', async () => {
  let count = 0;
  for (const value of [draft(999), { ...draft(), materia_site: Array(6).fill('Paragrafo repetido. '.repeat(18)).join('\n\n') }]) {
    const result = await generate(options({ value, onCall: () => count++ }));
    assert.equal(result.json.code, 'INVALID_SITE_EDITORIAL');
  }
  assert.equal(count, 2);
});

test('cache reuses structurally valid drafts; force regenerates; source changes invalidate', async () => {
  let calls = 0, source = snapshot;
  const opts = options({ onCall: () => calls++, captureSource: async () => source });
  await generate(opts); await generate(opts); assert.equal(calls, 1);
  await generateSiteEditorialPreview({ supabase: db(), noticiaId: 7, forceRegenerate: true }, opts); assert.equal(calls, 2);
  source = { ...snapshot, text: snapshot.text + ' Mais dados.' };
  await generate(opts); assert.equal(calls, 3);
  const bad = options({ value: draft(1799), onCall: () => calls++ });
  await generate(bad); await generate(bad); assert.equal(calls, 4);
});

function res() { return { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; },
  status(s) { this.statusCode = s; return this; }, json(value) { this.value = value; return this; } }; }
function request(body = {}) { return { method: 'POST', headers: { 'x-wiregeek-automation-key': 'synthetic-test-key' }, body: { noticia_id: 7, action: 'generate-editorial', ...body } }; }

test('handler preserves method/auth/ID gates before reads and inference', async () => {
  const previous = process.env.WIREGEEK_AUTOMATION_KEY;
  process.env.WIREGEEK_AUTOMATION_KEY = 'synthetic-test-key';
  try {
    for (const [req, expected] of [[{ ...request(), method: 'DELETE' }, 405], [{ ...request(), headers: {} }, 401],
      [{ ...request(), headers: { cookie: 'wiregeek_session=%ZZ' } }, 401],
      [request({ noticia_id: -1 }), 422], [request({ noticia_id: Number.MAX_SAFE_INTEGER + 1 }), 422]]) {
      const response = res();
      await handler(req, response, { supabase: { from() { assert.fail('read'); } }, editorialOptions: options({ onCall: () => assert.fail('inference') }) });
      assert.equal(response.statusCode, expected);
    }
    const response = res();
    await handler(request(), response, { supabase: db(), editorialOptions: options() });
    assert.equal(response.statusCode, 200);
    const unknown = res();
    await handler(request({ action: 'unknown' }), unknown, { supabase: { from() { assert.fail('read'); } } });
    assert.equal(unknown.statusCode, 422);
  } finally { if (previous === undefined) delete process.env.WIREGEEK_AUTOMATION_KEY; else process.env.WIREGEEK_AUTOMATION_KEY = previous; }
});

test('an empty signing key cannot authorize a forged cookie; configured signed sessions work', async () => {
  const saved = process.env.WIREGEEK_ACCESS_KEY;
  try {
    const issued = String(Math.floor(Date.now() / 1000));
    for (const key of ['', 'synthetic-session-key']) {
      process.env.WIREGEEK_ACCESS_KEY = key;
      const token = issued + '.' + createHmac('sha256', key).update(issued).digest('base64url');
      const response = res();
      await handler({ ...request(), headers: { cookie: 'wiregeek_session=' + token } }, response, { supabase: db(), editorialOptions: options() });
      assert.equal(response.statusCode, key ? 200 : 401);
    }
  } finally { if (saved === undefined) delete process.env.WIREGEEK_ACCESS_KEY; else process.env.WIREGEEK_ACCESS_KEY = saved; }
});

test('existing status and publish flows keep canonical image and upstream confirmation', async () => {
  const saved = Object.fromEntries(['WIREGEEK_AUTOMATION_KEY', 'BAGACA_SITE_PUBLISH_URL', 'BAGACA_SITE_PUBLISH_KEY'].map(k => [k, process.env[k]]));
  const previousFetch = globalThis.fetch;
  Object.assign(process.env, { WIREGEEK_AUTOMATION_KEY: 'synthetic-test-key', BAGACA_SITE_PUBLISH_URL: 'https://example.org/api/integrations/wiregeek/publish', BAGACA_SITE_PUBLISH_KEY: 'synthetic-publish-key' });
  const tables = [];
  const publication = { slug: 'pauta-sintetica', status: 'published' };
  const approved = { noticia_id: 7, ...draft(), source_hashes: [snapshot.source_hash], approved_at: '2026-10-08T12:00:00Z' };
  const supabase = { from(table) {
    tables.push(table);
    if (table === 'site_editorial_approvals') return {
      select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: {
        noticia_id: approved.noticia_id,
        materia_site: approved.materia_site, resumo_site: approved.resumo_site,
        source_hashes: approved.source_hashes, approved_at: approved.approved_at,
      }, error: null }; },
    };
    const chain = { then(resolve) { resolve({ data: table === 'publicacoes' ? [{ source_image_url: 'https://example.org/image.png' }] : [publication], error: null }); } };
    for (const method of ['select', 'eq', 'not', 'in', 'order', 'limit']) chain[method] = () => chain;
    return chain;
  } };
  try {
    globalThis.fetch = async (url, opts) => {
      assert.equal(url, process.env.BAGACA_SITE_PUBLISH_URL);
      assert.deepEqual(JSON.parse(opts.body), { noticia_id: 7, image_url: 'https://example.org/image.png' });
      return { ok: true, status: 201, json: async () => ({ action: 'published' }) };
    };
    const published = res(); await handler(request({ action: 'publish' }), published, { supabase });
    assert.equal(published.statusCode, 201); assert.deepEqual(tables, ['site_editorial_approvals', 'publicacoes', 'site_news']);
    assert.equal(published.value.data.site_url, 'https://example.org/noticias/pauta-sintetica');
    const status = res(); await handler({ ...request(), method: 'GET', query: { noticia_id: 7 } }, status, { supabase });
    assert.equal(status.value.published, true);
    assert.match(readFileSync(new URL('../api/publicacoes.js', import.meta.url), 'utf8'), /sitePublishHandler\(\s*req,\s*res\s*\)/);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});


test('corrected draft runs only verification, never the first generation call', async () => {
  const calls = [];
  const value = draft();
  const result = await generateSiteEditorialPreview({
    supabase: db(), noticiaId: 7, reviewDraft: value,
  }, options({ value, onCall: r => calls.push(r) }));
  assert.equal(result.status, 200);
  assert.equal(result.json.data.materia_site, value.materia_site);
  assert.deepEqual(calls.map(r => r.purpose), []);
});

test('correction handler rejects oversize text before source reads and never uses publish action', async () => {
  const key = process.env.WIREGEEK_AUTOMATION_KEY;
  process.env.WIREGEEK_AUTOMATION_KEY = 'synthetic-test-key';
  try {
    const invalid = res();
    await handler(request({
      action: 'verify-editorial', materia_site: 'x'.repeat(3501), resumo_site: 'Resumo',
    }), invalid, { supabase: { from() { assert.fail('database read'); } } });
    assert.equal(invalid.statusCode, 422);
    const calls = [];
    const valid = res();
    const value = draft();
    await handler(request({
      action: 'verify-editorial', materia_site: value.materia_site, resumo_site: value.resumo_site,
    }), valid, { supabase: db(), editorialOptions: options({ onCall: r => calls.push(r) }) });
    assert.equal(valid.statusCode, 200);
    assert.deepEqual(calls.map(r => r.purpose), []);
  } finally {
    if (key === undefined) delete process.env.WIREGEEK_AUTOMATION_KEY;
    else process.env.WIREGEEK_AUTOMATION_KEY = key;
  }
});

test('frontend review retains rejected text separately and blocks approval and publication', () => {
  const panel = readFileSync(new URL('../src/SitePublicationPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /setReviewDraft\(data\.review\)/);
  assert.match(panel, /action: "authorize-editorial"/);
  assert.doesNotMatch(panel, /Boolean\(reviewDraft\)\s*\|\|\s*reviewing/);
  assert.match(panel, /Rascunho anterior/);
});


test('generation-stage timeout is reported separately without entering verification', async () => {
  const calls = [];
  const response = await generate({
    ...options(),
    async createResponse(request) {
      calls.push(request.purpose);
      throw new Error('OPENAI_TIMEOUT');
    },
  });
  assert.equal(response.status, 504);
  assert.equal(response.json.code, 'EDITORIAL_INFERENCE_FAILED');
  assert.deepEqual(response.json.details, ['OPENAI_TIMEOUT']);
  assert.deepEqual(calls, ['site-editorial']);
});

test('approval receipt is signed for exact verified text, specific news and expires', () => {
  const previous = process.env.WIREGEEK_ACCESS_KEY;
  process.env.WIREGEEK_ACCESS_KEY = 'synthetic-approval-secret';
  try {
    const value = draft();
    const hashes = [snapshot.source_hash];
    const now = 1791400000000;
    const receipt = issueEditorialReceipt(7, value.materia_site, value.resumo_site, hashes, now);
    assert.ok(receipt);
    assert.deepEqual(verifyEditorialReceipt(receipt, 7, value.materia_site, value.resumo_site, now + 100), {
      version: 1, noticia_id: 7,
      body_hash: verifyEditorialReceipt(receipt, 7, value.materia_site, value.resumo_site, now + 100).body_hash,
      excerpt_hash: verifyEditorialReceipt(receipt, 7, value.materia_site, value.resumo_site, now + 100).excerpt_hash,
      source_hashes: hashes, expires_at: now + 3600000,
    });
    assert.equal(verifyEditorialReceipt(receipt, 8, value.materia_site, value.resumo_site, now + 100), null);
    assert.equal(verifyEditorialReceipt(receipt, 7, value.materia_site + 'x', value.resumo_site, now + 100), null);
    assert.equal(verifyEditorialReceipt(receipt, 7, value.materia_site, value.resumo_site + 'x', now + 100), null);
    assert.equal(verifyEditorialReceipt(receipt, 7, value.materia_site, value.resumo_site, now + 3600001), null);
    assert.equal(verifyEditorialReceipt(receipt.slice(0, -1) + (receipt.endsWith('a') ? 'b' : 'a'), 7, value.materia_site, value.resumo_site, now), null);
  } finally {
    if (previous === undefined) delete process.env.WIREGEEK_ACCESS_KEY;
    else process.env.WIREGEEK_ACCESS_KEY = previous;
  }
});

test('approval save requires proof, stores verified editorial only, and GET restores it without publishing', async () => {
  const previousKey = process.env.WIREGEEK_ACCESS_KEY;
  const previousAutomation = process.env.WIREGEEK_AUTOMATION_KEY;
  process.env.WIREGEEK_ACCESS_KEY = 'synthetic-approval-secret';
  process.env.WIREGEEK_AUTOMATION_KEY = 'synthetic-test-key';
  const value = draft();
  const sourceHashes = [snapshot.source_hash];
  const receipt = issueEditorialReceipt(7, value.materia_site, value.resumo_site, sourceHashes);
  const stored = [];
  const record = {
    noticia_id: 7, materia_site: value.materia_site, resumo_site: value.resumo_site,
    approved_at: '2026-10-08T12:00:00Z', updated_at: '2026-10-08T12:00:00Z',
  };
  const supabase = { from(table) {
    assert.equal(table, 'site_editorial_approvals');
    const chain = {
      select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: stored.length ? record : null, error: null }; },
      upsert(data, opts) {
        assert.equal(opts.onConflict, 'noticia_id');
        assert.deepEqual(data.source_hashes, sourceHashes);
        assert.equal(data.materia_site, value.materia_site);
        stored.push(data);
        return { select() { return { async single() { return { data: record, error: null }; } }; } };
      },
    };
    return chain;
  } };
  try {
    const denied = res();
    await handler(request({ action: 'approve-editorial', materia_site: value.materia_site,
      resumo_site: value.resumo_site }), denied, { supabase });
    assert.equal(denied.statusCode, 422);
    assert.deepEqual(stored, []);
    const saved = res();
    await handler(request({ action: 'approve-editorial', materia_site: value.materia_site,
      resumo_site: value.resumo_site, approval_receipt: receipt }), saved, { supabase });
    assert.equal(saved.statusCode, 200);
    assert.equal(stored.length, 1);
    const loaded = res();
    await handler({ ...request(), method: 'GET', query: {
      noticia_id: 7, action: 'approved-editorial',
    } }, loaded, { supabase });
    assert.equal(loaded.statusCode, 200);
    assert.equal(loaded.value.data.materia_site, value.materia_site);
  } finally {
    for (const [k,v] of [['WIREGEEK_ACCESS_KEY',previousKey],['WIREGEEK_AUTOMATION_KEY',previousAutomation]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('UI stores approval through API and restores without calling site publish', () => {
  const source = readFileSync(new URL('../src/SitePublicationPanel.jsx', import.meta.url), 'utf8');
  assert.match(source, /action: "approve-editorial"/);
  assert.match(source, /action=approved-editorial/);
  assert.match(source, /setSavedApproval\(result.data\)/);
  assert.match(source, /!savedApproval/);
  assert.match(source, /setApprovalReceipt\(null\)/);
});

test('existing editorial can be reverified without generation and gains a server-signed receipt', async () => {
  const previous = process.env.WIREGEEK_ACCESS_KEY;
  process.env.WIREGEEK_ACCESS_KEY = 'synthetic-approval-secret';
  try {
    const calls = [];
    const value = draft();
    const response = await generateSiteEditorialPreview({
      supabase: db(), noticiaId: 7, reviewDraft: value,
    }, options({ onCall: call => calls.push(call.purpose) }));
    assert.equal(response.status, 200);
    assert.deepEqual(calls, []);
    const receipt = response.json.data.approval_receipt;
    assert.ok(receipt);
    assert.ok(verifyEditorialReceipt(receipt, 7, value.materia_site, value.resumo_site));
  } finally {
    if (previous === undefined) delete process.env.WIREGEEK_ACCESS_KEY;
    else process.env.WIREGEEK_ACCESS_KEY = previous;
  }
});

test('panel provides verify-existing action rather than regenerating an approved draft', () => {
  const source = readFileSync(new URL('../src/SitePublicationPanel.jsx', import.meta.url), 'utf8');
  assert.match(source, /Autorizar texto existente/);
  assert.match(source, /verifyReviewDraft\(\{\s*materia_site: siteBody,/);
  assert.match(source, /const selectedDraft = override \|\| reviewDraft/);
});


test('direct publication attempts fail closed without a valid persisted approval', async () => {
  const saved = Object.fromEntries(['WIREGEEK_AUTOMATION_KEY', 'BAGACA_SITE_PUBLISH_URL', 'BAGACA_SITE_PUBLISH_KEY'].map(k => [k, process.env[k]]));
  const oldFetch = globalThis.fetch;
  Object.assign(process.env, {
    WIREGEEK_AUTOMATION_KEY: 'synthetic-test-key',
    BAGACA_SITE_PUBLISH_URL: 'https://example.org/api/integrations/wiregeek/publish',
    BAGACA_SITE_PUBLISH_KEY: 'synthetic-publish-key',
  });
  const valid = draft();
  const approval = {
    noticia_id: 7, materia_site: valid.materia_site, resumo_site: valid.resumo_site,
    approved_at: '2026-10-08T12:00:00Z', source_hashes: [snapshot.source_hash],
  };
  const cases = [
    ['missing approval', null, null, 409],
    ['wrong news ID', { ...approval, noticia_id: 8 }, null, 409],
    ['malformed editorial', { ...approval, materia_site: 'unsupported draft' }, null, 409],
    ['missing source hashes', { ...approval, source_hashes: [] }, null, 409],
    ['missing approval timestamp', { ...approval, approved_at: null }, null, 409],
    ['database inaccessible', null, { message: 'db inaccessible' }, 503],
  ];
  try {
    globalThis.fetch = () => assert.fail('Blocked request must not reach upstream publishing');
    for (const [description, row, error, expected] of cases) {
      const supabase = { from(table) {
        assert.equal(table, 'site_editorial_approvals', description);
        return { select() { return this; }, eq(field, id) {
          assert.equal(field, 'noticia_id');
          assert.equal(id, 7); return this;
        }, async maybeSingle() { return { data: row, error }; } };
      } };
      const result = res();
      await handler(request({ action: 'publish' }), result, { supabase });
      assert.equal(result.statusCode, expected, description);
      assert.equal(result.value.success, false, description);
      assert.equal(result.value.code, expected === 503 ?
        'EDITORIAL_APPROVAL_STORAGE_UNAVAILABLE' : 'EDITORIAL_APPROVAL_REQUIRED', description);
    }
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});


test('human approval does not depend on obsolete AI review and obtains a receipt without inference', () => {
  const panel = readFileSync(new URL('../src/SitePublicationPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /action: "authorize-editorial"/);
  assert.match(panel, /action: "approve-editorial"/);
  assert.match(panel, /receipt = authorized\.data\.approval_receipt/);
  assert.match(panel, /!editorialValidation\.valid/);
  assert.doesNotMatch(panel, /Boolean\(reviewDraft\)\s*\|\|\s*reviewing/);
});


test('authorize-editorial issues receipt for human-edited text without paid inference', async () => {
  const savedKey = process.env.WIREGEEK_ACCESS_KEY;
  const savedAutomation = process.env.WIREGEEK_AUTOMATION_KEY;
  process.env.WIREGEEK_ACCESS_KEY = 'synthetic-approval-secret';
  process.env.WIREGEEK_AUTOMATION_KEY = 'synthetic-test-key';
  try {
    const value = draft(1500, 3, 120);
    const calls = [];
    const response = res();
    await handler(request({ action: 'authorize-editorial', ...value }), response, {
      supabase: db(), editorialOptions: options({
        onCall: call => calls.push(call),
      }),
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(calls, []);
    assert.equal(response.value.data.materia_site, value.materia_site);
    assert.ok(verifyEditorialReceipt(response.value.data.approval_receipt, 7,
      value.materia_site, value.resumo_site));
  } finally {
    if (savedKey === undefined) delete process.env.WIREGEEK_ACCESS_KEY;
    else process.env.WIREGEEK_ACCESS_KEY = savedKey;
    if (savedAutomation === undefined) delete process.env.WIREGEEK_AUTOMATION_KEY;
    else process.env.WIREGEEK_AUTOMATION_KEY = savedAutomation;
  }
});
