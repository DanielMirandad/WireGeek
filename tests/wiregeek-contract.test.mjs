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
      "O trailer oficial apresentou cenas inéditas e confirmou detalhes da estreia.",
      "O estúdio confirmou informações sobre lançamento, equipe e plataformas disponíveis.",
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

    image_query: "produção trailer official image",
  };
}

test("aceita uma notícia que cumpre o contrato canônico", () => {
  assert.deepEqual(
    validateCanonicalShape(validItem()),
    []
  );
});

test("aceita matéria sem quantidade fixa de parágrafos", () => {
  const item = validItem();

  item.materia =
    "Primeiro parágrafo com informação editorial válida.\n\nSegundo parágrafo complementa a notícia com contexto factual.";

  assert.deepEqual(
    validateCanonicalShape(item),
    []
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

test("rejeita highlight com menos de 8 palavras", () => {
  const item = validItem();

  item.highlights[0] = "Informação curta demais.";

  assert.ok(
    validateCanonicalShape(item).some(
      (error) =>
        error.includes(
          "highlight 1 deve possuir entre 8 e 14 palavras"
        )
    )
  );
});

test("rejeita highlight com mais de 14 palavras", () => {
  const item = validItem();

  item.highlights[0] = Array(15)
    .fill("palavra")
    .join(" ");

  assert.ok(
    validateCanonicalShape(item).some(
      (error) =>
        error.includes(
          "highlight 1 deve possuir entre 8 e 14 palavras"
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
test("rejeita links Markdown dentro da materia", () => {
  const item = validItem();

  item.materia =
    "Texto editorial válido com referência embutida ([fonte](https://example.com/noticia)).";

  assert.ok(
    validateCanonicalShape(item).includes(
      "materia nao deve conter links Markdown"
    )
  );
});

test("rejeita parametros de citacao OpenAI dentro da materia", () => {
  const item = validItem();

  item.materia =
    "Texto editorial válido com URL contaminada https://example.com/noticia?utm_source=openai";

  assert.ok(
    validateCanonicalShape(item).includes(
      "materia nao deve conter parametros de citacao OpenAI"
    )
  );
});

test("aceita materia limpa sem Markdown ou parametros artificiais", () => {
  const item = validItem();

  item.materia =
    "Texto editorial limpo, factual e sem links embutidos.";

  assert.deepEqual(
    validateCanonicalShape(item),
    []
  );
});
test("rejeita hashtag com espaco", () => {
  const item = validItem();

  item.hashtags = [
    "#kena",
    "#kenascars ofkosmora",
    "#emberlab",
    "#ps5",
    "#games",
  ];

  const errors =
    validateCanonicalShape(item);

  assert.ok(
    errors.some(error =>
      error.includes("hashtag 2")
    )
  );
});

test("aceita hashtag unicode sem espaco", () => {
  const item = validItem();

  item.hashtags = [
    "#cavaleirosdoszodíaco",
    "#anime",
    "#mangá",
    "#games",
    "#culturapop",
  ];

  const errors =
    validateCanonicalShape(item);

  assert.equal(
    errors.some(error =>
      error.includes("hashtag")
    ),
    false
  );
});

test("rejeita hashtag sem #", () => {
  const item = validItem();

  item.hashtags = [
    "kena",
    "#emberlab",
    "#ps5",
    "#pc",
    "#games",
  ];

  const errors =
    validateCanonicalShape(item);

  assert.ok(
    errors.some(error =>
      error.includes("hashtag 1")
    )
  );
});
