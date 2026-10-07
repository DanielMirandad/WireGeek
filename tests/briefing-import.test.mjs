import test from "node:test";
import assert from "node:assert/strict";

import {
  parseCanonicalPayload,
  persistCanonicalBriefing,
} from "../lib/briefing-import-service.mjs";

import {
  editorialOriginForSource,
} from "../lib/editorial-execution.mjs";

import {
  assertCodexImportRun,
} from "../api/briefing-import.js";

function validPayload() {
  return {
    news: [
      {
        titulo: "Nova atualização oficial do jogo foi anunciada",
        titulo_curto: "Atualização do jogo",
        categoria: "games",
        materia:
          "A atualização foi anunciada oficialmente e traz novos conteúdos para os jogadores.",
        highlights: [
          "A atualização oficial adiciona conteúdos inéditos confirmados pela equipe do jogo.",
          "Jogadores receberão novos recursos e ajustes quando a atualização estiver disponível.",
        ],
        hashtags: [
          "#games",
          "#wiregeek",
          "#culturageek",
          "#noticias",
          "#gaming",
        ],
        fontes: [
          {
            titulo: "Fonte oficial",
            url: "https://example.com/noticia",
            publicado_em: "2026-10-04",
          },
        ],
        image_query: "official game update image",
      },
    ],
  };
}

test("source import corresponde exclusivamente à origem codex", () => {
  assert.equal(
    editorialOriginForSource("import"),
    "codex"
  );
});

test("fronteira de importação aceita somente origin codex", () => {
  assert.doesNotThrow(() =>
    assertCodexImportRun({
      source: "import",
      origin: "codex",
    })
  );

  assert.throws(
    () =>
      assertCodexImportRun({
        source: "manual",
        origin: "api",
      }),
    /CODEX_IMPORT_ORIGIN_REQUIRED/
  );

  assert.throws(
    () => assertCodexImportRun({}),
    /CODEX_IMPORT_ORIGIN_REQUIRED/
  );
});

test("parseCanonicalPayload aceita payload canônico Codex", () => {
  const parsed = parseCanonicalPayload(
    validPayload()
  );

  assert.equal(parsed.news.length, 1);
  assert.equal(
    parsed.news[0].titulo_curto,
    "Atualização do jogo"
  );
});

test("parseCanonicalPayload rejeita payload sem news", () => {
  assert.throws(
    () => parseCanonicalPayload({}),
    /deve possuir o array news/
  );
});

test("parseCanonicalPayload rejeita notícia fora do contrato canônico", () => {
  const payload = validPayload();

  payload.news[0].hashtags = [
    "#games",
  ];

  assert.throws(
    () => parseCanonicalPayload(payload),
    /hashtags deve possuir exatamente 5 itens/
  );
});

test("payload Codex preserva somente o contrato editorial esperado", () => {
  const parsed = parseCanonicalPayload(
    validPayload()
  );

  const keys = Object.keys(
    parsed.news[0]
  ).sort();

  assert.deepEqual(
    keys,
    [
      "categoria",
      "fontes",
      "hashtags",
      "highlights",
      "image_query",
      "materia",
      "titulo",
      "titulo_curto",
    ].sort()
  );
});

test("Codex percorre validação e persistência compartilhada sem acessar banco", async () => {
  const payload = validPayload();

  payload.title = "Edição Codex controlada";
  payload.generatedAt = "2026-10-04T18:30:00.000Z";

  const progressCalls = [];
  const persistenceCalls = [];

  const run = {
    id: "run-codex-test",
    source: "import",
    origin: "codex",

    async progress(values) {
      progressCalls.push(values);
    },
  };

  assertCodexImportRun(run);

  const result = await persistCanonicalBriefing(
    payload,
    run,
    {
      persist: async (input) => {
        persistenceCalls.push(input);

        return {
          editionId: 101,
          noticiaIds: [501],
          retainedIndexes: [0],
          deduplication: {
            duplicates: [],
            updates: [],
            retainedIndexes: [0],
          },
        };
      },
    }
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.persisted, true);
  assert.equal(result.body.noticia_ids_resolvidos, 1);

  assert.equal(
    result.body.edition.news[0].id,
    501
  );

  assert.deepEqual(
    progressCalls,
    [
      {
        researched: 1,
      },
    ]
  );

  assert.equal(
    persistenceCalls.length,
    1
  );

  const persisted = persistenceCalls[0];

  assert.equal(
    persisted.title,
    "Edição Codex controlada"
  );

  assert.equal(
    persisted.date,
    "2026-10-04T18:30:00.000Z"
  );

  assert.equal(
    persisted.status,
    "publicada"
  );

  assert.equal(
    persisted.execution,
    run
  );

  assert.equal(
    persisted.news,
    payload.news
  );

  assert.equal(
    persisted.researchData.pesquisados,
    1
  );

  assert.equal(
    persisted.researchData.candidatos[0].titulo,
    payload.news[0].titulo
  );

  assert.equal(
    persisted.researchData.candidatos[0].url,
    payload.news[0].fontes[0].url
  );
});

test("API e Codex usam o mesmo serviço de persistência canônica", async () => {
  const calls = [];

  const persist = async (input) => {
    calls.push(input);

    return {
      editionId: 202,
      noticiaIds: [601],
      retainedIndexes: [0],
      deduplication: {
        duplicates: [],
        updates: [],
        retainedIndexes: [0],
      },
    };
  };

  const makeRun = (source, origin) => ({
    id: `run-${origin}`,
    source,
    origin,
    async progress() {},
  });

  const codexResult =
    await persistCanonicalBriefing(
      validPayload(),
      makeRun("import", "codex"),
      { persist }
    );

  const apiResult =
    await persistCanonicalBriefing(
      validPayload(),
      makeRun("manual", "api"),
      { persist }
    );

  assert.equal(codexResult.status, 200);
  assert.equal(apiResult.status, 200);

  assert.equal(calls.length, 2);

  assert.deepEqual(
    Object.keys(calls[0]).sort(),
    Object.keys(calls[1]).sort()
  );

  assert.equal(
    calls[0].news[0].titulo,
    calls[1].news[0].titulo
  );
});

test("persistência injetada inválida é rejeitada antes de qualquer escrita", async () => {
  const run = {
    id: "run-invalid-persist",
    source: "import",
    origin: "codex",
    async progress() {},
  };

  await assert.rejects(
    () =>
      persistCanonicalBriefing(
        validPayload(),
        run,
        {
          persist: null,
        }
      ),
    /INVALID_PERSISTENCE_ADAPTER/
  );
});
