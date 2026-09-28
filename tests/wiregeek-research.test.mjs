import test from "node:test";
import assert from "node:assert/strict";

import {
  researchWireGeek,
} from "../lib/wiregeek-research.mjs";

function fakeAi(output) {
  const calls = [];

  return {
    calls,
    interactions: {
      async create(options) {
        calls.push(options);

        return {
          output_text:
            typeof output === "string"
              ? output
              : JSON.stringify(output),
        };
      },
    },
  };
}

test("exige cliente Gemini", async () => {
  await assert.rejects(
    () =>
      researchWireGeek({
        ai: null,
        model: "modelo-teste",
        history: [],
      }),
    /Cliente Gemini ausente/
  );
});

test("exige modelo Gemini", async () => {
  const ai = fakeAi({ noticias: [] });

  await assert.rejects(
    () =>
      researchWireGeek({
        ai,
        model: "",
        history: [],
      }),
    /Modelo Gemini ausente/
  );
});

test("aceita pesquisa sem notícias válidas", async () => {
  const ai = fakeAi({
    noticias: [],
  });

  const result =
    await researchWireGeek({
      ai,
      model: "modelo-teste",
      history: [],
    });

  assert.deepEqual(result, {
    noticias: [],
    pesquisadas: 0,
  });

  assert.equal(ai.calls.length, 1);
});

test("retorna dossiê factual válido sem escrever matéria editorial", async () => {
  const noticia = {
    titulo: "Anúncio oficial de teste",
    categoria: "games",
    resumo_factual:
      "O estúdio confirmou oficialmente o novo projeto.",
    publicado_em: "2026-09-28",
    fontes: [
      {
        titulo: "Estúdio oficial",
        url: "https://example.com/news",
        publicado_em: "2026-09-28",
        oficial: true,
      },
    ],
    fonte_oficial_primaria: {
      encontrada: true,
      titulo: "Estúdio oficial",
      url: "https://example.com/news",
    },
    fatos_confirmados: [
      "O projeto foi anunciado oficialmente.",
    ],
  };

  const ai = fakeAi({
    noticias: [noticia],
  });

  const result =
    await researchWireGeek({
      ai,
      model: "modelo-teste",
      history: [],
    });

  assert.equal(result.pesquisadas, 1);
  assert.deepEqual(
    result.noticias,
    [noticia]
  );

  const input = ai.calls[0].input;

  assert.match(
    input,
    /Esta etapa NAO deve escrever materia editorial/
  );

  assert.match(
    input,
    /Se nenhum acontecimento atender a essas regras/
  );
});

test("envia histórico completo para a pesquisa", async () => {
  const history = Array.from(
    { length: 20 },
    (_, index) => ({
      titulo: `Histórico ${index + 1}`,
      titulo_curto: `H${index + 1}`,
      categoria: "games",
      publicado_em: "2026-09-28",
      fontes: [
        {
          nome: `Fonte ${index + 1}`,
          url: `https://example.com/history/${index + 1}`,
        },
      ],
    })
  );

  const ai = fakeAi({
    noticias: [],
  });

  await researchWireGeek({
    ai,
    model: "modelo-teste",
    history,
  });

  const input = ai.calls[0].input;

  assert.match(input, /Histórico 1/);
  assert.match(input, /Histórico 20/);
  assert.match(
    input,
    /https:\/\/example\.com\/history\/20/
  );
});

test("configura Google Search e schema estruturado", async () => {
  const ai = fakeAi({
    noticias: [],
  });

  await researchWireGeek({
    ai,
    model: "modelo-teste",
    history: [],
  });

  const call = ai.calls[0];

  assert.equal(
    call.model,
    "modelo-teste"
  );

  assert.deepEqual(
    call.tools,
    [{ type: "google_search" }]
  );

  assert.equal(
    call.response_format[0].mime_type,
    "application/json"
  );

  assert.equal(
    call.response_format[0].schema.properties.noticias.maxItems,
    12
  );
});

test("rejeita resposta sem array noticias", async () => {
  const ai = fakeAi({
    resultado: [],
  });

  await assert.rejects(
    () =>
      researchWireGeek({
        ai,
        model: "modelo-teste",
        history: [],
      }),
    /estrutura invalida/
  );
});

test("rejeita resposta com mais de 12 notícias", async () => {
  const ai = fakeAi({
    noticias: Array.from(
      { length: 13 },
      (_, index) => ({
        titulo: `Notícia ${index + 1}`,
      })
    ),
  });

  await assert.rejects(
    () =>
      researchWireGeek({
        ai,
        model: "modelo-teste",
        history: [],
      }),
    /mais de 12 noticias/
  );
});

test("rejeita resposta vazia", async () => {
  const ai = fakeAi("");

  await assert.rejects(
    () =>
      researchWireGeek({
        ai,
        model: "modelo-teste",
        history: [],
      }),
    /resposta vazia/
  );
});
