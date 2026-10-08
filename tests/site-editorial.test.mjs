import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { generateSiteEditorialPreview, validateSiteEditorialInput } from '../lib/site-editorial.mjs';
import handler from '../lib/site-publish-handler.mjs';
import { createGenerationCache } from '../lib/generation-cache.mjs';

// Synthetic structural fixtures only; model stubs do not prove semantic entailment.
function draft(bodyLength = 1800, count = 6, excerptLength = 120) {
  const available = bodyLength - (count - 1) * 2;
  const parts = Array.from({ length: count }, (_, i) => `Fato ${i}: ` + 'a'.repeat(Math.floor(available / count) - 8));
  parts[0] += 'a'.repeat(bodyLength - parts.join('\n\n').length);
  return { materia_site: parts.join('\n\n'), resumo_site: 'Resumo: ' + 'b'.repeat(excerptLength - 8) };
}
const news = { id: 7, titulo: 'Pauta sintetica', categoria: 'Games', url: 'https://example.org/source', fontes: [] };
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
    indice, cobertura_completa: true, claims: [{ claim: `Fato sintetico ${indice}`, supported: true, fonte: 0, trecho: 'Documento literal.', motivo: 'Trecho confirma o fato.' }],
  })) };
}
function options({ value = draft(), verification = claims(value), onCall = () => {}, captureSource = async () => snapshot,
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
  for (const [length, count, excerpt] of [[1800, 6, 120], [3500, 10, 280]]) {
    const d = draft(length, count, excerpt);
    assert.equal(validateSiteEditorialInput({ materiaSite: d.materia_site, resumoSite: d.resumo_site }).valid, true);
  }
  for (const [length, count, excerpt] of [[1799, 6, 120], [3501, 6, 120], [1800, 5, 120], [1800, 11, 120], [1800, 6, 119], [1800, 6, 281]]) {
    const d = draft(length, count, excerpt);
    assert.equal(validateSiteEditorialInput({ materiaSite: d.materia_site, resumoSite: d.resumo_site }).valid, false);
  }
  for (const value of [undefined, null, {}, 42]) assert.equal(validateSiteEditorialInput({ materiaSite: value, resumoSite: value }).valid, false);
  const d = draft();
  assert.equal(validateSiteEditorialInput({ materiaSite: Array(6).fill(d.materia_site.split('\n\n')[0]).join('\n\n'), resumoSite: d.resumo_site }).valid, false);
  const crlf = d.materia_site.replaceAll('\n', '\r\n');
  assert.equal(validateSiteEditorialInput({ materiaSite: crlf, resumoSite: d.resumo_site }).body, d.materia_site);
});

test('read-only canonical generation returns the panel contract and verifies summary independently', async () => {
  const calls = [];
  const result = await generate(options({ onCall: r => calls.push(r) }));
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.data.materia_site, draft().materia_site);
  assert.equal(result.json.data.diagnostico.paragrafos, 6);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].purpose, 'site-editorial-verification');
  assert.equal(JSON.parse(calls[1].input).unidades.length, 7);
  assert.deepEqual(result.json.data.fontes_base, [{ nome: snapshot.title, url: snapshot.final_url, publicado_em: snapshot.publicado_em }]);
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

test('all canonical URLs are captured once; any blocked source blocks the draft', async () => {
  const row = { ...news, fontes: [{ url: news.url }, { url: 'https://example.org/second' }] };
  const captured = [];
  const result = await generateSiteEditorialPreview({ supabase: db(row), noticiaId: 7 }, options({ captureSource: async url => {
    captured.push(url); if (url.endsWith('second')) throw new Error('BLOCKED'); return snapshot;
  }, onCall: () => assert.fail('inference') }));
  assert.equal(result.status, 422); assert.deepEqual(captured, [news.url, row.fontes[1].url]);
});

test('invalid length or artificial repeated paragraphs skip the verification call', async () => {
  let count = 0;
  for (const value of [draft(1799), { ...draft(), materia_site: Array(6).fill('Paragrafo repetido. '.repeat(18)).join('\n\n') }]) {
    const result = await generate(options({ value, onCall: () => count++ }));
    assert.equal(result.json.code, 'INVALID_SITE_EDITORIAL');
  }
  assert.equal(count, 2);
});

test('unsupported claims, omitted units, forged literal citations and repeated claims fail closed', async () => {
  const variants = [];
  for (const mutate of [v => v.unidades.pop(), v => v.unidades[0].cobertura_completa = false,
    v => v.unidades[6].claims[0].supported = false, v => v.unidades[0].claims[0].fonte = 99,
    v => v.unidades[0].claims[0].trecho = 'Trecho inventado', v => v.unidades[0].claims = [],
    v => v.unidades[1].claims[0].claim = v.unidades[0].claims[0].claim, v => v.unidades[1].indice = 0]) {
    const v = claims(); mutate(v); variants.push(v);
  }
  const expected = [
    'EDITORIAL_VERIFICATION_INCOMPLETE', 'EDITORIAL_VERIFICATION_INCOMPLETE',
    'EDITORIAL_UNSUPPORTED_CLAIM', 'EDITORIAL_VERIFICATION_INCOMPLETE',
    'EDITORIAL_QUOTE_MISMATCH', 'EDITORIAL_VERIFICATION_INCOMPLETE',
    'EDITORIAL_REPEATED_CLAIMS', 'EDITORIAL_VERIFICATION_INCOMPLETE',
  ];
  for (const [index, verification] of variants.entries()) {
    const result = await generate(options({ verification }));
    assert.equal(result.status, 422);
    assert.equal(result.json.code, expected[index]);
    assert.equal(result.json.data, undefined);
    assert.ok(!JSON.stringify(result.json).includes('Documento literal.'));
  }
});

test('malformed JSON, provider failure and unavailable verification never return a draft', async () => {
  for (const response of [async () => { throw new Error('SECRET_PROVIDER_ERROR'); }, async () => ({ text: 'not json' })]) {
    const result = await generate({ ...options(), createResponse: response });
    assert.equal(result.status, 502); assert.ok(!JSON.stringify(result).includes('SECRET_PROVIDER_ERROR'));
  }
  const result = await generate({ ...options(), createResponse: async request => {
    if (request.purpose.endsWith('verification')) throw new Error('unavailable');
    return { text: JSON.stringify(draft()) };
  } });
  assert.equal(result.status, 502);
  assert.equal(result.json.code, 'EDITORIAL_VERIFICATION_API_FAILED');
  assert.equal(result.json.data, undefined);
  assert.ok(!JSON.stringify(result.json).includes('unavailable'));
});

test('invalid verification JSON fails separately without leaking provider output', async () => {
  const response = await generate({
    ...options(), createResponse: async request => request.purpose === 'site-editorial'
      ? { text: JSON.stringify(draft()) }
      : { text: 'PROVIDER_SECRET_NOT_JSON' },
  });
  assert.equal(response.status, 502);
  assert.equal(response.json.code, 'EDITORIAL_VERIFICATION_RESPONSE_INVALID');
  assert.ok(!JSON.stringify(response.json).includes('PROVIDER_SECRET_NOT_JSON'));
  assert.equal(response.json.data, undefined);
});

test('cache reuses only verified drafts; force regenerates; source changes invalidate', async () => {
  let calls = 0, source = snapshot;
  const opts = options({ onCall: () => calls++, captureSource: async () => source });
  await generate(opts); await generate(opts); assert.equal(calls, 2);
  await generateSiteEditorialPreview({ supabase: db(), noticiaId: 7, forceRegenerate: true }, opts); assert.equal(calls, 4);
  source = { ...snapshot, text: snapshot.text + ' Mais dados.' };
  await generate(opts); assert.equal(calls, 6);
  const bad = options({ value: draft(1799), onCall: () => calls++ });
  await generate(bad); await generate(bad); assert.equal(calls, 8);
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
  const supabase = { from(table) {
    tables.push(table);
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
    assert.equal(published.statusCode, 201); assert.deepEqual(tables, ['publicacoes', 'site_news']);
    assert.equal(published.value.data.site_url, 'https://example.org/noticias/pauta-sintetica');
    const status = res(); await handler({ ...request(), method: 'GET', query: { noticia_id: 7 } }, status, { supabase });
    assert.equal(status.value.published, true);
    assert.match(readFileSync(new URL('../api/publicacoes.js', import.meta.url), 'utf8'), /sitePublishHandler\(\s*req,\s*res\s*\)/);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});


test('rejected draft is returned only for transient review and identifies unsupported claim', async () => {
  const verification = claims();
  verification.unidades[1].claims[0] = { claim: 'Fabricante confirmou produto inexistente', supported: false, fonte: 0, trecho: '', motivo: 'Detalhe sem suporte documental.' };
  const result = await generate(options({ verification }));
  assert.equal(result.status, 422);
  assert.equal(result.json.code, 'EDITORIAL_UNSUPPORTED_CLAIM');
  assert.equal(result.json.review.materia_site, draft().materia_site);
  assert.equal(result.json.review.resumo_site, draft().resumo_site);
  assert.equal(result.json.review.issue.unidade, 2);
  assert.match(result.json.review.issue.claim, /produto inexistente/);
  assert.equal(result.json.data, undefined);
});

test('corrected draft runs only verification, never the first generation call', async () => {
  const calls = [];
  const value = draft();
  const result = await generateSiteEditorialPreview({
    supabase: db(), noticiaId: 7, reviewDraft: value,
  }, options({ value, onCall: r => calls.push(r) }));
  assert.equal(result.status, 200);
  assert.equal(result.json.data.materia_site, value.materia_site);
  assert.deepEqual(calls.map(r => r.purpose), ['site-editorial-verification']);
});

test('failed corrected draft remains blocked and can be reviewed without publication', async () => {
  const verification = claims();
  verification.unidades[1].claims[0].supported = false;
  const result = await generateSiteEditorialPreview({
    supabase: db(), noticiaId: 7, reviewDraft: draft(),
  }, options({ verification }));
  assert.equal(result.status, 422);
  assert.equal(result.json.data, undefined);
  assert.equal(result.json.review.issue.unidade, 2);
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
    assert.deepEqual(calls.map(r => r.purpose), ['site-editorial-verification']);
  } finally {
    if (key === undefined) delete process.env.WIREGEEK_AUTOMATION_KEY;
    else process.env.WIREGEEK_AUTOMATION_KEY = key;
  }
});

test('frontend review retains rejected text separately and blocks approval and publication', () => {
  const panel = readFileSync(new URL('../src/SitePublicationPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /setReviewDraft\(data\.review\)/);
  assert.match(panel, /action: "verify-editorial"/);
  assert.match(panel, /Boolean\(reviewDraft\)/);
  assert.match(panel, /Rascunho rejeitado/);
});


test('verification prompt explicitly supports faithful bilingual paraphrase but rejects extrapolations', async () => {
  const calls = [];
  const response = await generate(options({ onCall: request => calls.push(request) }));
  assert.equal(response.status, 200);
  const verification = calls.find(call => call.purpose === 'site-editorial-verification');
  assert.ok(verification);
  const instructions = verification.instructions;
  assert.match(instructions, /equivalencia de sentido entre ingles e portugues/);
  assert.match(instructions, /parafrase ou traducao fiel pode ter supported=true/);
  assert.match(instructions, /has been quietly rolling out the past few weeks/);
  assert.match(instructions, /referencia temporal relativa pode ser ancorada na data publicada/);
  assert.match(instructions, /sem inventar dia de inicio, data exata/);
  assert.match(instructions, /precos, versoes de firmware, modelos, nomes, datas/);
  assert.match(instructions, /sujeito e modalidade/);
  assert.match(instructions, /Mudanca de modelo, valor, versao, data, sujeito, certeza/);
  assert.match(instructions, /trecho deve SEMPRE conter texto literal da fonte/);
  assert.match(instructions, /use supported=false/);
});

test('translation guidance never overrides a model rejection or a nonliteral English citation', async () => {
  const falseClaim = claims();
  falseClaim.unidades[1].claims[0] = {
    claim: 'O Bose Gen 3 recebeu firmware 10.12.13 em 27 de setembro.',
    supported: false, fonte: 0, trecho: 'Documento literal.', motivo: 'Modelo e versao divergem.',
  };
  const unsupported = await generate(options({ verification: falseClaim }));
  assert.equal(unsupported.json.code, 'EDITORIAL_UNSUPPORTED_CLAIM');
  assert.equal(unsupported.status, 422);

  const falseQuote = claims();
  falseQuote.unidades[1].claims[0] = {
    claim: 'O firmware vinha sendo distribuido nas ultimas semanas.',
    supported: true, fonte: 0,
    trecho: 'The firmware has been quietly rolling out the past few weeks.', motivo: 'Literal nao aparece na fonte.',
  };
  const invalidQuote = await generate(options({ verification: falseQuote }));
  assert.equal(invalidQuote.json.code, 'EDITORIAL_QUOTE_MISMATCH');
  assert.equal(invalidQuote.status, 422);
});


test('Bose bilingual grounding: evidence may confirm a faithful paraphrase but never bypasses unsupported verdict', async () => {
  const evidence = 'A new firmware update for the $449 Bose QuietComfort Ultra Headphones Gen 2 adds support for Bluetooth LE Audio and Auracast as beta features. The firmware update, labeled 10.12.12, has been quietly rolling out the past few weeks.';
  const newsSource = { ...snapshot, text: evidence };
  const verified = claims();
  verified.unidades[0].claims[0] = {
    claim: 'O Bose QuietComfort Ultra Headphones Gen 2 recebe Bluetooth LE Audio e Auracast beta com firmware 10.12.12.',
    supported: true, fonte: 0,
    trecho: 'A new firmware update for the $449 Bose QuietComfort Ultra Headphones Gen 2 adds support for Bluetooth LE Audio and Auracast as beta features.',
    motivo: 'A evidencia cita o modelo, os recursos e o status beta.',
  };
  const ok = await generate(options({ verification: verified, captureSource: async () => newsSource }));
  assert.equal(ok.status, 200);
  const rejected = structuredClone(verified);
  rejected.unidades[0].claims[0].supported = false;
  rejected.unidades[0].claims[0].motivo = 'O verificador discorda do suporte a data e firmware.';
  const blocked = await generate(options({ verification: rejected, captureSource: async () => newsSource }));
  assert.equal(blocked.status, 422);
  assert.equal(blocked.json.code, 'EDITORIAL_UNSUPPORTED_CLAIM');
  assert.match(blocked.json.review.issue.reason, /firmware/);
  assert.match(blocked.json.review.issue.quote, /QuietComfort Ultra/);
  assert.equal(blocked.json.data, undefined);
});

test('Bose regression: incorrect firmware, product model and precise date remain rejected', async () => {
  const cases = [
    ['Versao de firmware 10.12.13', 'A fonte somente confirma 10.12.12'],
    ['QuietComfort Ultra Headphones Gen 3', 'A fonte somente confirma Gen 2'],
    ['Firmware lancado em 20 de setembro', 'Fonte nao informa esse dia preciso'],
  ];
  for (const [claimText, reason] of cases) {
    const verification = claims();
    verification.unidades[0].claims[0] = {
      claim: claimText, supported: false, fonte: 0, trecho: 'Documento literal.', motivo: reason,
    };
    const response = await generate(options({ verification }));
    assert.equal(response.status, 422);
    assert.equal(response.json.code, 'EDITORIAL_UNSUPPORTED_CLAIM');
    assert.equal(response.json.review.issue.reason, reason);
    assert.equal(response.json.data, undefined);
  }
});

test('verification request demands specific factual reasons for every supported and unsupported claim', async () => {
  const calls = [];
  const response = await generate(options({ onCall: request => calls.push(request) }));
  assert.equal(response.status, 200);
  const request = calls.find(call => call.purpose === 'site-editorial-verification');
  assert.ok(request);
  assert.equal(request.text.format.schema.properties.unidades.items.properties.claims.items.properties.motivo.type, 'string');
  assert.match(request.instructions, /supported=false exige motivo especifico/);
  assert.match(request.instructions, /nao marque false apenas por idioma ou redacao/);
});
