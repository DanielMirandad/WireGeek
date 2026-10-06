import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchExportHandler } from '../api/briefing-executor.js';
import { persistCanonicalBriefing } from '../lib/briefing-import-service.mjs';

const collected = { candidatos: [{ titulo: 'Atualizacao oficial', categoria: 'games', publicado_em: '2026-10-05', resumo: 'Anuncio confirmado', contexto: 'Atualizacao', evidencias: [{ fato: 'Atualizacao anunciada', trecho: 'A atualizacao foi anunciada.', fonte: 'Fonte oficial', url: 'https://example.com/noticia', publicado_em: '2026-10-05', source_verified: true, source_hash: 'sha256:' + 'a'.repeat(64) }] }] };
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }

test('economic endpoint researches once, exports verified evidence, does not generate or persist', async () => {
  let calls = 0;
  const handler = createResearchExportHandler({ authenticate: () => true,
    collect: async ({ createResponse }) => { await createResponse({ purpose: 'briefing_research', model: 'test' }); return { ...collected, format: 'wiregeek-briefing-research-v1', provenance: 'wiregeek_web_research', editorial_history_context: 'Historico vazio' }; },
    createResponse: async () => { calls++; return { response: { usage: { input_tokens: 100, output_tokens: 50 } } }; },
  });
  const res = response();
  await handler({ method: 'POST' }, res);
  assert.equal(res.statusCode, 200); assert.equal(calls, 1);
  assert.equal(res.body.persisted, false); assert.equal(res.body.researchPackage.format, 'wiregeek-codex-research-v1');
  assert.deepEqual(res.body.researchPackage.candidatos, collected.candidatos);
  assert.deepEqual(res.body.api_usage.requests[0].usage, { input_tokens: 100, output_tokens: 50 });
});

test('scheduled and unauthorized requests stop before any paid call', async () => {
  const handler = createResearchExportHandler({ authenticate: () => false, collect: () => assert.fail('must not research') });
  for (const [method, status] of [['GET', 405], ['POST', 401]]) { const res = response(); await handler({ method }, res); assert.equal(res.statusCode, status); }
});

test('failed research is observable and never retried', async () => {
  let calls = 0;
  const handler = createResearchExportHandler({ authenticate: () => true, collect: ({ createResponse }) => createResponse({ purpose: 'briefing_research' }), createResponse: () => { calls++; throw new Error('SOURCE_FAILED'); } });
  const res = response(); await handler({ method: 'POST' }, res);
  assert.equal(res.statusCode, 500); assert.equal(calls, 1); assert.equal(res.body.api_usage.calls, 1);
});

test('Codex canonical output passes the shared importer with codex origin and no API calls', async () => {
  const news = { titulo: 'Nova atualização oficial do jogo foi anunciada', titulo_curto: 'Atualização do jogo', categoria: 'games', materia: 'A atualização foi anunciada oficialmente e traz novos conteúdos para os jogadores.',
    highlights: ['A nova atualização adiciona conteúdos inéditos e mudanças importantes confirmadas oficialmente pela equipe responsável pelo jogo.', 'Os jogadores receberão novos recursos, ajustes de balanceamento e melhorias gerais quando a atualização estiver disponível oficialmente.'],
    hashtags: ['#games', '#wiregeek', '#culturageek', '#noticias', '#gaming'], fontes: [{ titulo: 'Fonte oficial', url: collected.candidatos[0].evidencias[0].url, publicado_em: '2026-10-05' }], image_query: 'official game update image' };
  let persisted = 0;
  const run = { origin: 'codex', progress: async () => {} };
  const result = await persistCanonicalBriefing({ news: [news] }, run, { persist: async data => {
    persisted++; assert.equal(data.execution.origin, 'codex'); assert.deepEqual(data.news, [news]);
    return { noticiaIds: [22], retainedIndexes: [0], deduplication: {} };
  } });
  assert.equal(persisted, 1); assert.equal(result.status, 200); assert.equal(result.body.edition.news[0].id, 22);
});
