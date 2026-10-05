import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifySiteEditorialGrounding } from '../lib/site-editorial-grounding.mjs';
import { reapurarSiteEditorial } from '../lib/site-editorial-research.mjs';
import siteHandler from '../lib/site-publish-handler.mjs';
import { persistEdition } from '../api/persistence.js';
import { mapResearchToNews } from '../lib/verified-research.mjs';
import { generateSiteEditorialPreview, validateSiteEditorialInput } from '../lib/site-editorial.mjs';

const evidence = (fato = 'Anuncio oficial confirmado', url = 'https://example.com/new') => ({ fato, trecho: 'Official announcement confirmed.', fonte: 'Oficial', url, publicado_em: '2026-10-04', source_verified: true, source_hash: 'sha256:' + 'a'.repeat(64) });
const candidate = (url = 'https://example.com/new') => ({ titulo: 'Anuncio oficial', categoria: 'games', resumo: 'Apurado', contexto: 'Contexto nao verificado NAO USAR', evidencias: [evidence('Anuncio oficial confirmado', url)] });
const news = (url, titulo) => ({ titulo, titulo_curto: titulo, categoria: 'games', materia: 'O anuncio oficial apresenta novos conteudos confirmados para os jogadores.', highlights: ['O anuncio oficial confirma novos conteudos para os jogadores interessados nesta novidade apresentada pela equipe responsavel.', 'A equipe responsavel apresentou oficialmente as informacoes detalhadas sobre os novos conteudos que estarao disponiveis aos jogadores.'], hashtags: ['#games', '#wiregeek', '#geek', '#gaming', '#noticias'], fontes: [{ titulo: 'Oficial', url, publicado_em: '2026-10-04' }], image_query: 'official announcement' });
const cache = { run: async (_key, fn) => fn() };
function editorialDb(raw, error = null) {
  const calls = [];
  return { calls, from(table) {
    assert.ok(['noticias', 'research_candidates'].includes(table)); calls.push(table);
    const q = { select: () => q, eq: (field, id) => { assert.equal(field, table === 'noticias' ? 'id' : 'noticia_id'); assert.equal(id, 77); return q; }, order: () => q, limit: () => q,
      maybeSingle: async () => table === 'noticias' ? { data: { id: 77, titulo: 'Anuncio', artigo: 'CANONICAL_EXTRA_DO_NOT_USE', url: 'https://fake.invalid' } } : { data: raw === undefined ? null : { dados_json: raw }, error } };
    return q;
  } };
}

test('site uses only persisted verified evidence and exposes no tools or new research sources', async () => {
  for (const raw of [candidate(), JSON.stringify(candidate())]) {
    const db = editorialDb(raw); let count = 0;
    const result = await generateSiteEditorialPreview({ supabase: db, noticiaId: 77 }, { cache, createResponse: async request => {
      count++; assert.equal(request.tools, undefined); assert.equal(request.toolChoice, undefined);
      if (request.purpose === 'site-editorial-verification') {
        assert.equal(request.text.format.strict, true);
        assert.ok(!request.input.includes('CANONICAL_EXTRA_DO_NOT_USE'));
        return { text: JSON.stringify({ unidades: [0, 1].map(indice => ({ indice, cobertura_completa: true, claims: [{ claim: 'Anuncio confirmado', supported: true, evidencias: [0] }] })) }) };
      }
      assert.ok(!request.input.includes('CANONICAL_EXTRA_DO_NOT_USE')); assert.ok(!request.input.includes('Contexto nao verificado'));
      assert.ok(request.input.includes('Official announcement confirmed.')); assert.ok(request.input.includes('1500 a 3500'));
      return { text: JSON.stringify({ materia_site: 'O anuncio foi confirmado oficialmente.', resumo_site: 'Anuncio confirmado.', evidencias_por_paragrafo: [[0]] }), response: { output: [{ type: 'url_citation', url: 'https://fake.invalid' }] } };
    } });
    assert.equal(count, 2); assert.equal(result.status, 200); assert.deepEqual(result.json.data.fontes_pesquisa, []);
    assert.equal(result.json.data.fontes_base[0].url, evidence().url);
  }
  assert.ok(!readFileSync(new URL('../lib/site-editorial.mjs', import.meta.url), 'utf8').includes('web_search'));
});

test('missing, malformed, unverified or invalid hashes fail closed before OpenAI/cache', async () => {
  for (const raw of [undefined, '{bad', { ...candidate(), evidencias: [] }, { ...candidate(), evidencias: [{ ...evidence(), source_verified: false }] }, { ...candidate(), evidencias: [{ ...evidence(), source_hash: 'fake' }] }]) {
    const result = await generateSiteEditorialPreview({ supabase: editorialDb(raw), noticiaId: 77 }, { cache: { run: () => assert.fail('no cache access') }, createResponse: () => assert.fail('no OpenAI') });
    assert.equal(result.status, 422); assert.equal(result.json.code, 'INSUFFICIENT_VERIFIED_EVIDENCE');
  }
  await assert.rejects(generateSiteEditorialPreview({ supabase: editorialDb(candidate(), { message: 'column missing' }), noticiaId: 77 }), /column missing/);
});

test('paragraph evidence references must be valid and add a new fact; short copy is accepted', async () => {
  for (const refs of [undefined, [[9]], [[0], [0]]]) {
    const result = await generateSiteEditorialPreview({ supabase: editorialDb(candidate()), noticiaId: 77 }, { cache, createResponse: async () => ({ text: JSON.stringify({ materia_site: refs?.length === 2 ? 'Primeiro fato.\n\nMesmo fato reescrito.' : 'Primeiro fato.', resumo_site: 'Resumo.', evidencias_por_paragrafo: refs }) }) });
    assert.equal(result.status, 422);
  }
  assert.equal(validateSiteEditorialInput({ materiaSite: 'Um fato sustentado.', resumoSite: 'Resumo.' }).valid, true);
  assert.equal(validateSiteEditorialInput({ materiaSite: 'Repetido.\n\nRepetido.', resumoSite: 'Resumo.' }).valid, false);
});

test('mapping is source based, independent of order and rejects ambiguity or missing match', () => {
  const items = [news('https://example.com/a', 'Alpha'), news('https://example.com/b', 'Beta')];
  assert.deepEqual(mapResearchToNews(items, { verified: true, candidatos: [candidate(items[1].fontes[0].url), candidate(items[0].fontes[0].url)] }), [1, 0]);
  for (const candidatos of [[candidate()], [candidate(items[0].fontes[0].url), candidate(items[0].fontes[0].url)]]) assert.throws(() => mapResearchToNews(items, { verified: true, candidatos }), /AMBIGUOUS_OR_MISSING/);
});

function persistenceDb({ conflict = false, failLink = false } = {}) {
  const writes = []; let nextId = 100;
  const old = news('https://example.com/old', 'Pauta antiga encerrada');
  const db = { writes, from(table) {
    let op = 'select', value, filters = {};
    const q = { select: () => q, gt: () => q, order: () => q, limit: () => q, eq: (key, val) => { filters[key] = val; return q; }, is: (key, val) => { filters[key] = val; return q; },
      insert: val => { op = 'insert'; value = val; return q; }, update: val => { op = 'update'; value = val; return q; },
      single: () => execute(), maybeSingle: () => execute(), then: (ok, bad) => execute().then(ok, bad) };
    async function execute() {
      if (op === 'select') return { data: filters.dedup_key ? { id: 8, titulo: 'Pauta nova dois', artigo: 'Sem novo acontecimento', url: 'https://example.com/two' } : table === 'noticias' ? [{ id: 1, ...old, url: old.fontes[0].url }] : [] };
      writes.push({ table, op, value: structuredClone(value), filters });
      if (table === 'noticias' && conflict && value.url.endsWith('/two')) return { error: { code: '23505', message: 'noticias_dedup_key_unique' } };
      if (table === 'research_candidates' && op === 'insert') return { data: [...value].reverse().map(row => ({ ...row, dados_json: Object.fromEntries(Object.entries(JSON.parse(row.dados_json)).reverse()), id: nextId++ })) };
      if (table === 'research_candidates' && op === 'update') return { data: failLink ? [] : [{ id: filters.id }] };
      return { data: { id: nextId++ } };
    }
    return q;
  } };
  return db;
}

test('real persistence links original retained indexes, with reordered returned candidates and atomic dedup conflict', async () => {
  for (const conflict of [false, true]) {
    const db = persistenceDb({ conflict });
    const items = [news('https://example.com/old', 'Pauta antiga encerrada'), news('https://example.com/one', 'Produto lunar revelado oficialmente'), news('https://example.com/two', 'Pauta nova dois')];
    const candidatos = [candidate(items[2].fontes[0].url), candidate(items[0].fontes[0].url), candidate(items[1].fontes[0].url)];
    const result = await persistEdition({ news: items, researchData: { verified: true, candidatos } }, { supabase: db });
    assert.deepEqual(result.retainedIndexes, conflict ? [1] : [1, 2]);
    const saved = db.writes.find(w => w.table === 'research_candidates' && w.op === 'insert').value;
    assert.deepEqual(saved.map(row => JSON.parse(row.dados_json)), candidatos);
    const links = db.writes.filter(w => w.table === 'research_candidates' && w.op === 'update');
    assert.equal(links.length, result.noticiaIds.length);
    // Returned rows were reversed: original candidate index 2 gets the first id (103).
    assert.equal(links[0].filters.id, 103); assert.equal(links[0].value.noticia_id, result.noticiaIds[0]);
    for (const row of db.writes.filter(w => w.table === 'noticias' && w.op === 'insert')) assert.ok(!Object.hasOwn(row.value, 'evidencias') && !Object.hasOwn(row.value, 'researchPackage'));
  }
});

test('persistence rejects missing evidence before writes and fails on zero-row link', async () => {
  const db = persistenceDb();
  await assert.rejects(persistEdition({ news: [news('https://example.com/new', 'Anuncio oficial novo')], researchData: { verified: true, candidatos: [{ ...candidate(), evidencias: [] }] } }, { supabase: db }), /EVIDENCE_REQUIRED/);
  assert.equal(db.writes.length, 0);
  await assert.rejects(persistEdition({ news: [news('https://example.com/new', 'Anuncio oficial novo')], researchData: { verified: true, candidatos: [candidate()] } }, { supabase: persistenceDb({ failLink: true }) }), /Erro ao vincular apuracao/);
});

test('generate-editorial action remains wired to verified flow', () => {
  const handler = readFileSync(new URL('../lib/site-publish-handler.mjs', import.meta.url), 'utf8');
  assert.match(handler, /"generate-editorial"/); assert.match(handler, /await generateSiteEditorialPreview\(/);
});

test('migration adds only a nullable cascading foreign key and lookup index, without modifying existing data', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261005190136_link_verified_research_to_noticias.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, '');
  assert.match(sql, /ADD COLUMN noticia_id bigint REFERENCES public\.noticias\(id\) ON DELETE CASCADE/i);
  assert.match(sql, /ON public\.research_candidates \(noticia_id, id DESC\)/i);
  assert.ok(!/\b(UPDATE|DELETE FROM|INSERT INTO|DROP|SET NOT NULL)\b/i.test(sql));
});


const verifiedUnits = (texts, mutate = unit => unit) => ({ unidades: texts.map((texto, indice) => mutate({ indice, cobertura_completa: true, claims: [{ claim: texto, supported: true, evidencias: [0] }] })) });
test('invented battery, price and specification fail despite valid writer references', async () => {
  for (const detail of ['bateria de 40 horas', 'preco de US$ 199', 'Bluetooth 6.0']) {
    const body = 'O anuncio foi confirmado com ' + detail + '.';
    let calls = 0;
    const result = await generateSiteEditorialPreview({ supabase: editorialDb(candidate()), noticiaId: 77 }, { cache, createResponse: async request => {
      calls++;
      assert.equal(request.tools, undefined); assert.equal(request.toolChoice, undefined);
      if (request.purpose === 'site-editorial') return { text: JSON.stringify({ materia_site: body, resumo_site: 'Anuncio confirmado.', evidencias_por_paragrafo: [[0]] }) };
      const data = JSON.parse(request.input);
      assert.equal(data.unidades[0].texto, body);
      assert.ok(!request.input.includes('evidencias_por_paragrafo'));
      return { text: JSON.stringify({ unidades: [{ indice: 0, cobertura_completa: true, claims: [
        { claim: 'Anuncio confirmado', supported: true, evidencias: [0] },
        { claim: detail, supported: false, evidencias: [] },
      ] }, { indice: 1, cobertura_completa: true, claims: [{ claim: 'Anuncio confirmado', supported: true, evidencias: [0] }] }] }) };
    } });
    assert.equal(calls, 2); assert.equal(result.status, 422); assert.equal(result.json.code, 'INVALID_SITE_EDITORIAL_GROUNDING');
  }
});

test('verification fails closed on malformed, incomplete, unsupported or unreferenced claims and exceptions', async () => {
  const valid = verifiedUnits(['Anuncio confirmado.', 'Resumo confirmado.']);
  const cases = [
    {}, { unidades: [] }, { unidades: valid.unidades.slice(0, 1) },
    verifiedUnits(['a', 'b'], u => ({ ...u, cobertura_completa: false })),
    verifiedUnits(['a', 'b'], u => ({ ...u, claims: [] })),
    ...[[], [9], [-1], [0.5], ['0']].map(evidencias => verifiedUnits(['a', 'b'], u => ({ ...u, claims: [{ claim: 'Fato', supported: true, evidencias }] }))),
    verifiedUnits(['a', 'b'], u => ({ ...u, indice: 8 })),
  ];
  for (const value of cases) await assert.rejects(verifySiteEditorialGrounding({ body: 'Anuncio confirmado.', excerpt: 'Resumo confirmado.', evidencias: [evidence()] }, { createResponse: async () => ({ text: JSON.stringify(value) }) }), /INVALID_SITE_EDITORIAL_GROUNDING/);
  for (const response of [async () => { throw new Error('timeout'); }, async () => ({ text: '{invalid' })]) {
    const result = await generateSiteEditorialPreview({ supabase: editorialDb(candidate()), noticiaId: 77 }, { cache, createResponse: async request => request.purpose === 'site-editorial' ? { text: JSON.stringify({ materia_site: 'Anuncio confirmado.', resumo_site: 'Resumo confirmado.', evidencias_por_paragrafo: [[0]] }) } : response() });
    assert.equal(result.status, 422); assert.equal(result.json.code, 'INVALID_SITE_EDITORIAL_GROUNDING');
  }
});

function reResearchDb({ failCandidate = false, missing = false } = {}) {
  let linked;
  const writes = [];
  const canonical = { id: 77, titulo: 'Anuncio oficial', categoria: 'games', artigo: 'CANONICAL_EXTRA_DO_NOT_USE', fontes: [{ titulo: 'Oficial', url: 'https://example.com/new', publicado_em: '2026-10-04' }] };
  return { writes, canonical, from(table) {
    let value;
    const q = { select: () => q, eq: () => q, order: () => q, limit: () => q,
      insert: row => { value = row; return q; }, single: () => execute(), maybeSingle: () => execute() };
    async function execute() {
      if (!value) return { data: table === 'noticias' ? missing ? null : structuredClone(canonical) : linked ? { id: 102, dados_json: linked } : null };
      assert.ok(['research_runs', 'research_candidates'].includes(table));
      writes.push({ table, value: structuredClone(value) });
      if (table === 'research_candidates') {
        if (failCandidate) return { error: { message: 'insert failed' } };
        assert.equal(value.noticia_id, 77); linked = value.dados_json;
      }
      return { data: { id: table === 'research_runs' ? 101 : 102 } };
    }
    return q;
  } };
}
const collectedResponse = () => ({ text: JSON.stringify({ candidatos: [{ ...candidate(), publicado_em: '2026-10-04' }] }) });
const snapshot = async url => ({ final_url: url, text: 'Official announcement confirmed.', publicado_em: '2026-10-04', source_hash: 'sha256:' + 'a'.repeat(64) });

test('old news explicit re-research uses shared source verification and enables evidence-only editorial', async () => {
  const db = reResearchDb(); const original = structuredClone(db.canonical);
  const unavailable = await generateSiteEditorialPreview({ supabase: db, noticiaId: 77 }, { cache, createResponse: () => assert.fail('no evidence, no generation') });
  assert.equal(unavailable.json.code, 'INSUFFICIENT_VERIFIED_EVIDENCE');
  const researched = await reapurarSiteEditorial({ supabase: db, noticiaId: 77 }, { createResponse: async request => {
    assert.equal(request.tools[0].type, 'web_search'); assert.equal(request.toolChoice, 'required');
    assert.ok(request.input.includes('REAPURACAO UNITARIA')); assert.ok(request.input.includes('https://example.com/new'));
    assert.ok(!request.input.includes('CANONICAL_EXTRA_DO_NOT_USE'));
    return collectedResponse();
  }, captureSource: snapshot });
  assert.equal(researched.status, 200); assert.equal(db.writes.length, 2);
  const persisted = JSON.parse(db.writes[1].value.dados_json);
  assert.equal(persisted.evidencias[0].source_verified, true); assert.deepEqual(db.canonical, original);
  const result = await generateSiteEditorialPreview({ supabase: db, noticiaId: 77 }, { cache, createResponse: async request => {
    assert.equal(request.tools, undefined); assert.equal(request.toolChoice, undefined);
    assert.ok(!request.input.includes('CANONICAL_EXTRA_DO_NOT_USE'));
    if (request.purpose === 'site-editorial') return { text: JSON.stringify({ materia_site: 'Anuncio confirmado.', resumo_site: 'Anuncio confirmado.', evidencias_por_paragrafo: [[0]] }) };
    return { text: JSON.stringify(verifiedUnits(['Anuncio confirmado.', 'Anuncio confirmado.'])) };
  } });
  assert.equal(result.status, 200);
});

test('re-research failures do not modify canonical news or create partial candidate links', async () => {
  const options = [
    { createResponse: async () => { throw new Error('network'); }, captureSource: snapshot },
    { createResponse: collectedResponse, captureSource: async () => { throw new Error('blocked source'); } },
    { createResponse: collectedResponse, captureSource: async url => ({ ...await snapshot(url), text: 'No such excerpt' }) },
    { createResponse: async () => ({ text: JSON.stringify({ candidatos: [{ ...candidate(), titulo: 'Outra pauta' }] }) }), captureSource: snapshot },
    { createResponse: async () => ({ text: JSON.stringify({ candidatos: [candidate(), candidate()] }) }), captureSource: snapshot },
    { createResponse: async () => ({ text: JSON.stringify({ candidatos: [candidate('https://example.com/unrelated')] }) }), captureSource: snapshot },
  ];
  for (const option of options) {
    const db = reResearchDb(); const original = structuredClone(db.canonical);
    const result = await reapurarSiteEditorial({ supabase: db, noticiaId: 77 }, option);
    assert.equal(result.status, 422); assert.equal(db.writes.length, 0); assert.deepEqual(db.canonical, original);
  }
  const db = reResearchDb({ failCandidate: true });
  const result = await reapurarSiteEditorial({ supabase: db, noticiaId: 77 }, { createResponse: collectedResponse, captureSource: snapshot });
  assert.equal(result.status, 422);
  const unavailable = await generateSiteEditorialPreview({ supabase: db, noticiaId: 77 }, { cache, createResponse: () => assert.fail('no partial link') });
  assert.equal(unavailable.json.code, 'INSUFFICIENT_VERIFIED_EVIDENCE');
  assert.equal((await reapurarSiteEditorial({ supabase: reResearchDb({ missing: true }), noticiaId: 77 }, { createResponse: () => assert.fail('missing news') })).status, 404);
});

test('explicit backend action returns before publication', () => {
  const handler = readFileSync(new URL('../lib/site-publish-handler.mjs', import.meta.url), 'utf8');
  assert.match(handler, /action === "reapurar-editorial"/);
  assert.match(handler, /await reapurarSiteEditorial\(\{ supabase, noticiaId \}, researchOptions\)/);
});


test('authenticated backend actions execute old-news re-research then grounded generation, without publication', async () => {
  const previousKey = process.env.WIREGEEK_AUTOMATION_KEY;
  process.env.WIREGEEK_AUTOMATION_KEY = 'w28-local-test-key';
  try {
    const db = reResearchDb();
    const researchOptions = { createResponse: collectedResponse, captureSource: snapshot };
    const editorialOptions = { cache, createResponse: async request => {
      assert.equal(request.tools, undefined); assert.equal(request.toolChoice, undefined);
      if (request.purpose === 'site-editorial') return { text: JSON.stringify({ materia_site: 'Anuncio confirmado.', resumo_site: 'Anuncio confirmado.', evidencias_por_paragrafo: [[0]] }) };
      return { text: JSON.stringify(verifiedUnits(['Anuncio confirmado.', 'Anuncio confirmado.'])) };
    } };
    const call = async (action, authenticated = true) => {
      const res = { statusCode: null, result: null, status(code) { this.statusCode = code; return this; }, json(value) { this.result = value; return this; } };
      await siteHandler({ method: 'POST', headers: authenticated ? { 'x-wiregeek-automation-key': 'w28-local-test-key' } : {}, body: { action, noticia_id: 77 } }, res, { supabase: db, researchOptions, editorialOptions });
      return res;
    };
    assert.equal((await call('reapurar-editorial', false)).statusCode, 401);
    assert.equal(db.writes.length, 0);
    assert.equal((await call('generate-editorial')).result.code, 'INSUFFICIENT_VERIFIED_EVIDENCE');
    assert.equal((await call('reapurar-editorial')).statusCode, 200);
    assert.equal((await call('generate-editorial')).statusCode, 200);
    assert.deepEqual(db.writes.map(w => w.table), ['research_runs', 'research_candidates']);
  } finally {
    if (previousKey === undefined) delete process.env.WIREGEEK_AUTOMATION_KEY;
    else process.env.WIREGEEK_AUTOMATION_KEY = previousKey;
  }
});
