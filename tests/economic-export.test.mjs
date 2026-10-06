import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchExportHandler } from '../api/briefing-executor.js';
import { persistCanonicalBriefing } from '../lib/briefing-import-service.mjs';

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const history = [{
  id: 7,
  titulo: 'Historia anterior',
  titulo_curto: 'Historia anterior',
  publicado_em: '2026-10-05',
  criado_em: '2026-10-05T12:00:00Z',
  fontes: [{ titulo: 'Fonte oficial', url: 'https://example.com/anterior' }],
}];

test('economic endpoint exports Codex package with zero OpenAI calls and zero persistence', async () => {
  let historyCalls = 0;
  let paidCalls = 0;
  const handler = createResearchExportHandler({
    authenticate: () => true,
    loadHistory: async () => { historyCalls++; return history; },
    createResponse: async () => { paidCalls++; throw new Error('must not call OpenAI'); },
  });

  const res = response();
  await handler({ method: 'POST' }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(historyCalls, 1);
  assert.equal(paidCalls, 0);
  assert.equal(res.body.success, true);
  assert.equal(res.body.persisted, false);
  assert.equal(res.body.api_usage.calls, 0);
  assert.deepEqual(res.body.api_usage.requests, []);

  const pkg = res.body.researchPackage;
  assert.equal(pkg.format, 'wiregeek-codex-editorial-v1');
  assert.equal(pkg.mode, 'codex_external_research_and_writing');
  assert.equal(pkg.provenance, 'wiregeek_editorial_context');
  assert.equal(pkg.api_usage.calls, 0);
  assert.deepEqual(pkg.research_brief.publication_categories, ['games', 'geek', 'cinema', 'anime']);
  assert.equal(pkg.research_brief.freshness_hours, 48);
  assert.equal(pkg.research_brief.min_news, 1);
  assert.equal(pkg.research_brief.max_news, 12);
  assert.equal(pkg.editorial_history.length, 1);
  assert.equal(pkg.editorial_history[0].titulo, 'Historia anterior');
  assert.ok(pkg.editorial_contract.prompt.includes('Pesquise notícias atuais'));
  assert.equal(pkg.editorial_contract.schema.required[0], 'news');
  assert.equal(pkg.next_step.endpoint, '/api/briefing-import');
});

test('scheduled and unauthorized requests stop before history lookup or paid work', async () => {
  let historyCalls = 0;
  const handler = createResearchExportHandler({
    authenticate: () => false,
    loadHistory: async () => { historyCalls++; return history; },
    createResponse: async () => assert.fail('must not call OpenAI'),
  });

  for (const [method, status] of [['GET', 405], ['POST', 401]]) {
    const res = response();
    await handler({ method }, res);
    assert.equal(res.statusCode, status);
  }

  assert.equal(historyCalls, 0);
});

test('history failure is observable and still reports zero API calls', async () => {
  const handler = createResearchExportHandler({
    authenticate: () => true,
    loadHistory: async () => { throw new Error('HISTORY_FAILED'); },
    createResponse: async () => assert.fail('must not call OpenAI'),
  });

  const res = response();
  await handler({ method: 'POST' }, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.details, 'HISTORY_FAILED');
  assert.equal(res.body.api_usage.calls, 0);
  assert.deepEqual(res.body.api_usage.requests, []);
});

test('Codex canonical output passes the shared importer with codex origin and no API calls', async () => {
  const news = {
    titulo: 'Nova atualização oficial do jogo foi anunciada',
    titulo_curto: 'Atualização do jogo',
    categoria: 'games',
    materia: 'A atualização foi anunciada oficialmente e traz novos conteúdos para os jogadores.',
    highlights: [
      'A nova atualização adiciona conteúdos inéditos e mudanças importantes confirmadas oficialmente pela equipe responsável pelo jogo.',
      'Os jogadores receberão novos recursos, ajustes de balanceamento e melhorias gerais quando a atualização estiver disponível oficialmente.',
    ],
    hashtags: ['#games', '#wiregeek', '#culturageek', '#noticias', '#gaming'],
    fontes: [{
      titulo: 'Fonte oficial',
      url: 'https://example.com/noticia',
      publicado_em: '2026-10-05',
    }],
    image_query: 'official game update image',
  };

  let persisted = 0;
  const run = { origin: 'codex', progress: async () => {} };
  const result = await persistCanonicalBriefing({ news: [news] }, run, {
    persist: async data => {
      persisted++;
      assert.equal(data.execution.origin, 'codex');
      assert.deepEqual(data.news, [news]);
      return { noticiaIds: [22], retainedIndexes: [0], deduplication: {} };
    },
  });

  assert.equal(persisted, 1);
  assert.equal(result.status, 200);
  assert.equal(result.body.edition.news[0].id, 22);
});
