import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectBriefingResearch, generateCanonicalBriefingFromResearch, executeBriefing } from '../lib/briefing-executor.mjs';
import { buildBriefingResearchPackage, BRIEFING_RESEARCH_SCHEMA } from '../lib/briefing-research.mjs';
import { buildCodexResearchPackage, serializeCodexResearch } from '../lib/codex-research-export.mjs';
import { NEWS_SCHEMA, WIREGEEK_PROMPT } from '../lib/wiregeek-contract.mjs';

const collected = { candidatos: [{
  titulo: 'Atualizacao oficial', categoria: 'games', publicado_em: '2026-10-04',
  resumo: 'Conteudo anunciado', contexto: 'Novo anuncio',
  evidencias: [{ fato: 'Atualizacao anunciada', trecho: 'A atualizacao foi anunciada.',
    fonte: 'Fonte oficial', url: 'https://example.com/noticia', publicado_em: '2026-10-04' }],
}] };
const captureSource = async url => ({ final_url: url, text: 'A atualizacao foi anunciada.', publicado_em: '2026-10-04', source_hash: 'sha256:' + 'a'.repeat(64) });
const verified = structuredClone(collected);
Object.assign(verified.candidatos[0].evidencias[0], { source_verified: true, source_hash: 'sha256:' + 'a'.repeat(64) });
const history = [{ id: 8, titulo: 'Pauta anterior', fontes: [{ url: 'https://example.com/anterior' }] }];
const canonical = { news: [{
  titulo: 'Nova atualização oficial do jogo foi anunciada', titulo_curto: 'Atualização do jogo',
  categoria: 'games', materia: 'A atualização foi anunciada oficialmente e traz novos conteúdos para os jogadores.',
  highlights: [
    'A nova atualização adiciona conteúdos inéditos e mudanças importantes confirmadas oficialmente pela equipe responsável pelo jogo.',
    'Os jogadores receberão novos recursos, ajustes de balanceamento e melhorias gerais quando a atualização estiver disponível oficialmente.',
  ],
  hashtags: ['#games', '#wiregeek', '#culturageek', '#noticias', '#gaming'],
  fontes: [{ titulo: 'Fonte oficial', url: 'https://example.com/noticia', publicado_em: '2026-10-04' }],
  image_query: 'official game update image',
}] };

test('API collects, generates from the same evidence and validates/persists only canonical news', async () => {
  const events = [];
  const calls = [];
  const run = { origin: 'api', progress: async data => { events.push('progress'); assert.deepEqual(data, { researched: 1 }); } };
  const result = await executeBriefing(run, {
    captureSource,
    loadHistory: async () => { events.push('history'); return history; },
    createResponse: async request => {
      calls.push(request); events.push(request.purpose);
      return { text: JSON.stringify(request.purpose === 'briefing_research' ? collected : canonical) };
    },
    persistence: { persist: async data => {
      events.push('persist'); assert.deepEqual(data.news, canonical.news);
      assert.equal(data.execution, run); assert.equal(data.status, 'publicada');
      assert.equal(data.researchData.pesquisados, 1);
      assert.equal(Object.hasOwn(data, 'researchPackage'), false);
      return { noticiaIds: [22], retainedIndexes: [0], deduplication: {} };
    } },
  });
  assert.deepEqual(events, ['history', 'briefing_research', 'briefing', 'progress', 'persist']);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].tools, [{ type: 'web_search', search_context_size: 'high' }]);
  assert.equal(calls[0].toolChoice, 'required');
  assert.deepEqual(calls[0].text.format.schema, BRIEFING_RESEARCH_SCHEMA);
  assert.equal(calls[1].tools, undefined); assert.equal(calls[1].toolChoice, undefined);
  const passedResearch = JSON.parse(calls[1].input.split('RESEARCH_PACKAGE (dados de apuracao):\n')[1]);
  assert.deepEqual(passedResearch.candidatos, verified.candidatos);
  assert.match(passedResearch.editorial_history_context, /Pauta anterior/);
  for (const call of calls) {
    assert.ok(call.input.startsWith(WIREGEEK_PROMPT));
    assert.equal(call.maxOutputTokens, 12000); assert.deepEqual(call.reasoning, { effort: 'high' });
  }
  assert.equal(calls[0].timeoutMs + calls[1].timeoutMs, 280000);
  assert.equal(calls[1].text.format.name, 'wiregeek_briefing');
  assert.equal(calls[1].text.format.strict, true);
  assert.deepEqual(calls[1].text.format.schema.properties.news.items.properties.highlights, NEWS_SCHEMA.properties.news.items.properties.highlights);
  assert.deepEqual(calls[1].text.format.schema.properties.news.items.properties.hashtags, NEWS_SCHEMA.properties.news.items.properties.hashtags);
  assert.deepEqual(calls[1].text.format.schema.properties.news.items.required,
    ['titulo', 'titulo_curto', 'categoria', 'materia', 'highlights', 'hashtags', 'fontes', 'image_query']);
  assert.equal(result.status, 200); assert.equal(result.body.persisted, true);
  assert.deepEqual(result.body.edition.news, [{ ...canonical.news[0], id: 22 }]);
});

test('isolated collection exports directly and deterministically with no persistence or second research', async () => {
  let responseCalls = 0;
  const original = structuredClone(collected);
  const researchPackage = await collectBriefingResearch({
    captureSource,
    loadHistory: async () => history,
    createResponse: async () => { responseCalls++; return { text: JSON.stringify(collected) }; },
    persistence: { persist: () => assert.fail('isolated collection must not persist') },
  });
  const before = structuredClone(researchPackage);
  const output = serializeCodexResearch(researchPackage);
  assert.equal(output, serializeCodexResearch(researchPackage));
  assert.deepEqual(researchPackage, before); assert.deepEqual(collected, original);
  assert.equal(responseCalls, 1);
  const exported = buildCodexResearchPackage(researchPackage);
  assert.deepEqual(exported.candidatos, researchPackage.candidatos);
  assert.equal(exported.editorial_history_context, researchPackage.editorial_history_context);
  assert.equal(exported.provenance, 'wiregeek_web_research');
  assert.deepEqual(exported.editorial_contract, { prompt: WIREGEEK_PROMPT, schema: NEWS_SCHEMA });
  const directory = await mkdtemp(join(tmpdir(), 'wiregeek-w23-'));
  try {
    const file = join(directory, 'research.json');
    await writeFile(file, JSON.stringify(researchPackage));
    const cli = spawnSync(process.execPath, ['scripts/export-codex-research.mjs', file], {
      encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: '', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
    });
    assert.equal(cli.status, 0, cli.stderr); assert.equal(cli.stdout, output);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('generation accepts a collected package without loading history or persisting', async () => {
  const research = buildBriefingResearchPackage(verified, 'historico');
  let calls = 0;
  assert.deepEqual(await generateCanonicalBriefingFromResearch(research, {
    captureSource,
    loadHistory: () => assert.fail('must use package history'),
    createResponse: async request => { calls++; assert.equal(request.tools, undefined); return { text: JSON.stringify(canonical) }; },
    persistence: { persist: () => assert.fail('generation must not persist') },
  }), canonical);
  assert.equal(calls, 1);
});

test('invalid research stops before generation and persistence', async () => {
  for (const bad of [{ candidatos: [] }, { candidatos: [{ ...collected.candidatos[0], evidencias: [] }] },
    { candidatos: [{ ...collected.candidatos[0], evidencias: [{ ...collected.candidatos[0].evidencias[0], trecho: '' }] }] }]) {
    let calls = 0;
    await assert.rejects(executeBriefing({ origin: 'api' }, {
      captureSource,
    loadHistory: async () => [],
      createResponse: async () => { calls++; return { text: JSON.stringify(bad) }; },
      persistence: { persist: () => assert.fail('invalid research must not persist') },
    }), /REQUIRED|MISSING|NOT_LITERAL/);
    assert.equal(calls, 1);
  }
  await assert.rejects(generateCanonicalBriefingFromResearch(collected, {
    createResponse: () => assert.fail('reject untagged input before calling API'),
  }), /INVALID_BRIEFING_RESEARCH_PACKAGE/);
});

test('canonical validation remains before persistence; generation errors are not retried', async () => {
  for (const result of ['', 'invalid json', JSON.stringify({ news: [{ ...canonical.news[0], hashtags: [] }] })]) {
    let calls = 0;
    await assert.rejects(executeBriefing({ origin: 'api', progress: () => assert.fail('invalid payload') }, {
      captureSource,
    loadHistory: async () => [],
      createResponse: async () => ({ text: ++calls === 1 ? JSON.stringify(collected) : result }),
      persistence: { persist: () => assert.fail('invalid canonical payload must not persist') },
    }), /nao retornou|JSON invalido|invalida/);
    assert.equal(calls, 2);
  }
});

test('research projection strips operational data and rejects excess candidates', () => {
  const raw = { ...verified, token: 'private', candidatos: [{ ...verified.candidatos[0], secret: 'private' }] };
  assert.ok(!JSON.stringify(buildBriefingResearchPackage(raw, 'history')).includes('private'));
  assert.throws(() => buildBriefingResearchPackage({ candidatos: Array(13).fill(verified.candidatos[0]) }, 'history'), /LIMIT/);
});

test('independent capture failure or nonliteral model excerpt stops before writing and export', async () => {
  for (const captureSource of [async () => { throw new Error('SOURCE_HTTP_403'); },
    async url => ({ final_url: url, text: 'Texto independente que nao contem o trecho do modelo.', publicado_em: '', source_hash: 'sha256:' + 'b'.repeat(64) })]) {
    let calls = 0;
    await assert.rejects(executeBriefing({}, {
      loadHistory: async () => [], captureSource,
      createResponse: async () => { calls++; return { text: JSON.stringify(collected) }; },
      persistence: { persist: () => assert.fail('must not persist') },
    }), /SOURCE_HTTP_403|SOURCE_EXCERPT_NOT_LITERAL/);
    assert.equal(calls, 1);
  }
  assert.throws(() => serializeCodexResearch(collected), /SOURCE_VERIFICATION_REQUIRED/);
  assert.throws(() => buildBriefingResearchPackage(collected, 'history'), /SOURCE_VERIFICATION_REQUIRED/);
});
