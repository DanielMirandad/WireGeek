import { buildCodexResearchPackage } from '../lib/codex-research-export.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { serializeCodexResearch } from '../lib/codex-research-export.mjs';

const research = { candidatos: [{ titulo: 'Exemplo', categoria: 'Games', resumo: 'Resumo coletado', evidencias: [{ fato: 'Fato coletado', trecho: 'Trecho literal coletado', fonte: 'Fonte publica', url: 'https://example.org/noticia', publicado_em: '2026-10-04', source_verified: true, source_hash: 'sha256:' + 'a'.repeat(64) }] }] };

test('deterministic projection preserves evidence and does not mutate input', () => {
  const before = structuredClone(research);
  const output = serializeCodexResearch(research);
  assert.equal(output, serializeCodexResearch(research));
  assert.deepEqual(research, before);
  assert.deepEqual(JSON.parse(output).candidatos[0].evidencias, research.candidatos[0].evidencias);
  assert.equal(JSON.parse(output).next_step.endpoint, '/api/briefing-import');
  assert.ok(JSON.parse(output).editorial_contract.schema);
});
test('rejects empty discovery and metadata without collected evidence', () => {
  for (const input of [null, {}, { candidatos: [] }, { candidatos: [{ titulo: 'Metadata' }] }]) {
    assert.throws(() => serializeCodexResearch(input), /REQUIRED/);
  }
});
test('allowlist drops operational fields and rejects sensitive source URLs', () => {
  const input = structuredClone(research);
  input.token = 'secret-marker';
  input.candidatos[0].dados_json = 'secret-marker';
  assert.ok(!serializeCodexResearch(input).includes('secret-marker'));
  for (const url of ['https://user:pass@example.org/a', 'https://example.org/a?token=secret', 'file:///a']) {
    input.candidatos[0].evidencias[0].url = url;
    assert.throws(() => serializeCodexResearch(input));
  }
});
test('CLI refuses missing input without starting API or persistence', () => {
  const result = spawnSync(process.execPath, ['scripts/export-codex-research.mjs'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Usage:/);
});

test('Animate Times canonical query estrutural e aceita', () => {
  const research = {
    candidatos: [
      {
        titulo: 'Teste',
        categoria: 'anime e mangá',
        publicado_em: '2026-10-04',
        evidencias: [
          {
            fato: 'Anime anunciado oficialmente.',
            trecho: 'Anime anunciado oficialmente.',
            fonte: 'Animate Times',
            url: 'https://www.animatetimes.com/news/details.php?id=1791119239',
            publicado_em: '2026-10-04',
            source_verified: true,
            source_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
          }
        ]
      }
    ]
  };

  const output =
    buildCodexResearchPackage(
      research
    );

  assert.equal(
    output.candidatos[0].evidencias[0].url,
    'https://www.animatetimes.com/news/details.php?id=1791119239'
  );
});

test('query estrutural pode coexistir com multiplos parametros publicos', () => {
  const research = {
    candidatos: [
      {
        titulo: 'Teste',
        categoria: 'games',
        publicado_em: '2026-10-04',
        evidencias: [
          {
            fato: 'Fato confirmado.',
            trecho: 'Fato confirmado.',
            fonte: 'Fonte',
            url: 'https://example.com/noticia?id=123&page=2',
            publicado_em: '2026-10-04',
            source_verified: true,
            source_hash: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
          }
        ]
      }
    ]
  };

  const output =
    buildCodexResearchPackage(
      research
    );

  assert.equal(
    output.candidatos[0].evidencias[0].url,
    'https://example.com/noticia?id=123&page=2'
  );
});

test('query de tracking continua rejeitada', () => {
  const research = {
    candidatos: [
      {
        titulo: 'Teste',
        categoria: 'games',
        publicado_em: '2026-10-04',
        evidencias: [
          {
            fato: 'Fato confirmado.',
            trecho: 'Fato confirmado.',
            fonte: 'Fonte',
            url: 'https://example.com/noticia?id=123&utm_source=openai',
            publicado_em: '2026-10-04',
            source_verified: true,
            source_hash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
          }
        ]
      }
    ]
  };

  assert.throws(
    () =>
      buildCodexResearchPackage(
        research
      ),
    /SOURCE_URL_CONTAINS_SENSITIVE_OR_TRACKING_QUERY/
  );
});

test('query sensivel continua rejeitada', () => {
  const research = {
    candidatos: [
      {
        titulo: 'Teste',
        categoria: 'games',
        publicado_em: '2026-10-04',
        evidencias: [
          {
            fato: 'Fato confirmado.',
            trecho: 'Fato confirmado.',
            fonte: 'Fonte',
            url: 'https://example.com/noticia?id=123&access_token=segredo',
            publicado_em: '2026-10-04',
            source_verified: true,
            source_hash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
          }
        ]
      }
    ]
  };

  assert.throws(
    () =>
      buildCodexResearchPackage(
        research
      ),
    /SOURCE_URL_CONTAINS_SENSITIVE_OR_TRACKING_QUERY/
  );
});
