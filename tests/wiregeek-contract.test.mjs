import test from "node:test";
import assert from "node:assert/strict";

import {
  validateCanonicalShape,
  validateHighlights,
} from "../lib/wiregeek-contract.mjs";

function validItem() {
  return {
    titulo: "Novo trailer oficial confirma a estreia da produção",
    titulo_curto: "Produção",
    categoria: "cinema",
    materia:
      "Primeiro parágrafo com a informação principal confirmada pela apuração.\n\n" +
      "Segundo parágrafo desenvolve o contexto factual da notícia sem especulação.\n\n" +
      "Terceiro parágrafo encerra a matéria com informações confirmadas pelas fontes.",
    highlights: [
      "O novo trailer oficial apresentou cenas inéditas e confirmou detalhes importantes da produção antes de sua estreia ao público.",
      "A produção recebeu novas informações oficiais sobre lançamento, equipe responsável e disponibilidade nas plataformas anunciadas pelo estúdio responsável.",
    ],
    hashtags: [
      "#cinema",
      "#culturapop",
      "#trailer",
      "#streaming",
      "#wiregeek",
    ],
    fontes: [
      {
        titulo: "Fonte oficial",
        url: "https://example.com/oficial",
        publicado_em: "2026-09-28",
      },
    ],
    fonte_oficial_primaria: {
      encontrada: true,
      titulo: "Fonte oficial",
      url: "https://example.com/oficial",
    },
    image_query: "produção trailer official image",
  };
}

test("aceita uma notícia que cumpre o contrato canônico", () => {
  assert.deepEqual(
    validateCanonicalShape(validItem()),
    []
  );
});

test("rejeita matéria que não possui exatamente 3 parágrafos", () => {
  const item = validItem();

  item.materia =
    "Primeiro parágrafo.\n\nSegundo parágrafo.";

  assert.ok(
    validateCanonicalShape(item).includes(
      "materia deve possuir exatamente 3 paragrafos"
    )
  );
});

test("rejeita quantidade diferente de 2 highlights", () => {
  const item = validItem();

  item.highlights = [item.highlights[0]];

  assert.ok(
    validateCanonicalShape(item).includes(
      "highlights deve possuir exatamente 2 itens"
    )
  );
});

test("rejeita highlight com menos de 15 palavras", () => {
  const item = validItem();

  item.highlights[0] = "Informação curta demais.";

  assert.ok(
    validateCanonicalShape(item).some(
      (error) =>
        error.includes(
          "highlight 1 deve possuir entre 15 e 25 palavras"
        )
    )
  );
});

test("rejeita highlight com mais de 25 palavras", () => {
  const item = validItem();

  item.highlights[0] = Array(26)
    .fill("palavra")
    .join(" ");

  assert.ok(
    validateCanonicalShape(item).some(
      (error) =>
        error.includes(
          "highlight 1 deve possuir entre 15 e 25 palavras"
        )
    )
  );
});

test("validateHighlights aplica quantidade e faixa de palavras", () => {
  assert.deepEqual(
    validateHighlights(validItem().highlights),
    []
  );

  assert.ok(
    validateHighlights(["curto"]).length > 0
  );
});

test("rejeita quantidade diferente de 5 hashtags", () => {
  const item = validItem();

  item.hashtags = ["#cinema"];

  assert.ok(
    validateCanonicalShape(item).includes(
      "hashtags deve possuir exatamente 5 itens"
    )
  );
});

test("rejeita hashtag com letras maiúsculas", () => {
  const item = validItem();

  item.hashtags[2] = "#Trailer";

  assert.ok(
    validateCanonicalShape(item).some(
      (error) =>
        error.includes(
          "hashtag 3 deve existir e estar em letras minusculas"
        )
    )
  );
});

test("aceita entre 1 e 3 fontes", () => {
  for (const count of [1, 2, 3]) {
    const item = validItem();

    item.fontes = Array.from(
      { length: count },
      (_, index) => ({
        titulo: `Fonte ${index + 1}`,
        url: `https://example.com/${index + 1}`,
      })
    );

    assert.deepEqual(
      validateCanonicalShape(item),
      []
    );
  }
});

test("rejeita zero fontes e mais de 3 fontes", () => {
  const withoutSources = validItem();
  withoutSources.fontes = [];

  assert.ok(
    validateCanonicalShape(withoutSources).includes(
      "fontes deve possuir entre 1 e 3 itens"
    )
  );

  const tooManySources = validItem();

  tooManySources.fontes = Array.from(
    { length: 4 },
    (_, index) => ({
      titulo: `Fonte ${index + 1}`,
      url: `https://example.com/${index + 1}`,
    })
  );

  assert.ok(
    validateCanonicalShape(tooManySources).includes(
      "fontes deve possuir entre 1 e 3 itens"
    )
  );
});

test("aceita ausência declarada de fonte oficial primária", () => {
  const item = validItem();

  item.fonte_oficial_primaria = {
    encontrada: false,
  };

  assert.deepEqual(
    validateCanonicalShape(item),
    []
  );
});

test("exige título e URL quando fonte oficial foi encontrada", () => {
  const item = validItem();

  item.fonte_oficial_primaria = {
    encontrada: true,
  };

  assert.ok(
    validateCanonicalShape(item).includes(
      "fonte oficial primaria encontrada deve possuir titulo e url"
    )
  );
});
