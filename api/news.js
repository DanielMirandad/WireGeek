import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3.5-flash-lite";

const CATEGORIES = [
  "games",
  "geek",
  "cinema",
  "anime",
];

const NEWS_PER_CATEGORY = 3;
const TOTAL_NEWS = 12;

const NEWS_SCHEMA = {
  type: "object",
  properties: {
    news: {
      type: "array",
      minItems: TOTAL_NEWS,
      maxItems: TOTAL_NEWS,

      items: {
        type: "object",

        properties: {
          categoria: {
            type: "string",
            enum: CATEGORIES,
          },

          titulo: {
            type: "string",
          },

          publicado_em: {
            type: "string",
          },

          materia: {
            type: "string",
          },

          highlights: {
            type: "array",
            minItems: 4,
            maxItems: 4,

            items: {
              type: "string",
            },
          },

          hashtags: {
            type: "array",
            minItems: 5,
            maxItems: 5,

            items: {
              type: "string",
            },
          },

          fontes: {
            type: "array",
            minItems: 1,
            maxItems: 3,

            items: {
              type: "object",

              properties: {
                nome: {
                  type: "string",
                },

                url: {
                  type: "string",
                },

                publicado_em: {
                  type: "string",
                },
              },

              required: [
                "nome",
                "url",
                "publicado_em",
              ],
            },
          },

          image_query: {
            type: "string",
          },
        },

        required: [
          "categoria",
          "titulo",
          "publicado_em",
          "materia",
          "highlights",
          "hashtags",
          "fontes",
          "image_query",
        ],
      },
    },
  },

  required: ["news"],
};

function normalizeText(value) {
  return String(value || "")
    .replace(/[—–]/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeNews(news) {
  if (!Array.isArray(news)) {
    return [];
  }

  return news.map((item) => ({
    categoria: String(
      item?.categoria || ""
    )
      .toLowerCase()
      .trim(),

    titulo: normalizeText(
      item?.titulo
    ),

    publicado_em: normalizeText(
      item?.publicado_em
    ),

    materia: normalizeText(
      item?.materia
    ),

    highlights: Array.isArray(
      item?.highlights
    )
      ? item.highlights
          .map(normalizeText)
          .filter(Boolean)
          .slice(0, 4)
      : [],

    hashtags: Array.isArray(
      item?.hashtags
    )
      ? item.hashtags
          .map(normalizeText)
          .filter(Boolean)
          .slice(0, 5)
      : [],

    fontes: Array.isArray(
      item?.fontes
    )
      ? item.fontes
          .slice(0, 3)
          .map((source) => ({
            nome: normalizeText(
              source?.nome
            ),

            url: String(
              source?.url || ""
            ).trim(),

            publicado_em:
              normalizeText(
                source?.publicado_em
              ),
          }))
      : [],

    image_query: normalizeText(
      item?.image_query ||
        item?.titulo
    ),
  }));
}

/*
 * ============================================================
 * VALIDACAO DA EDICAO
 * ============================================================
 */

function validateEdition(news) {
  const errors = [];

  if (!Array.isArray(news)) {
    return [
      "news precisa ser um array.",
    ];
  }

  /*
   * TOTAL
   */

  if (news.length !== TOTAL_NEWS) {
    errors.push(
      `A edicao precisa conter exatamente ${TOTAL_NEWS} noticias. Recebidas: ${news.length}.`
    );
  }

  /*
   * CATEGORIAS
   */

  const counts = {
    games: 0,
    geek: 0,
    cinema: 0,
    anime: 0,
  };

  news.forEach((item, index) => {
    const number = index + 1;

    /*
     * Categoria
     */

    if (
      !CATEGORIES.includes(
        item.categoria
      )
    ) {
      errors.push(
        `Noticia ${number}: categoria invalida "${item.categoria}".`
      );
    } else {
      counts[item.categoria]++;
    }

    /*
     * Titulo
     */

    if (!item.titulo) {
      errors.push(
        `Noticia ${number}: titulo ausente.`
      );
    }

    /*
     * Materia
     */

    if (!item.materia) {
      errors.push(
        `Noticia ${number}: materia ausente.`
      );
    }

    /*
     * Tamanho
     */

    if (
      item.materia.length < 2000
    ) {
      errors.push(
        `Noticia ${number}: materia possui ${item.materia.length} caracteres. Minimo: 2000.`
      );
    }

    if (
      item.materia.length > 2200
    ) {
      errors.push(
        `Noticia ${number}: materia possui ${item.materia.length} caracteres. Maximo: 2200.`
      );
    }

    /*
     * Highlights
     */

    if (
      !Array.isArray(
        item.highlights
      ) ||
      item.highlights.length !== 4
    ) {
      errors.push(
        `Noticia ${number}: precisa ter exatamente 4 highlights.`
      );
    }

    /*
     * Hashtags
     */

    if (
      !Array.isArray(
        item.hashtags
      ) ||
      item.hashtags.length !== 5
    ) {
      errors.push(
        `Noticia ${number}: precisa ter exatamente 5 hashtags.`
      );
    }

    /*
     * Fontes
     */

    if (
      !Array.isArray(
        item.fontes
      ) ||
      item.fontes.length < 1 ||
      item.fontes.length > 3
    ) {
      errors.push(
        `Noticia ${number}: precisa ter entre 1 e 3 fontes.`
      );
    }

    /*
     * Image query
     */

    if (!item.image_query) {
      errors.push(
        `Noticia ${number}: image_query ausente.`
      );
    }
  });

  /*
   * Exatamente 3 por categoria
   */

  for (const category of CATEGORIES) {
    if (
      counts[category] !==
      NEWS_PER_CATEGORY
    ) {
      errors.push(
        `${category}: esperado ${NEWS_PER_CATEGORY}, recebido ${counts[category]}.`
      );
    }
  }

  return errors;
}

/*
 * ============================================================
 * GERACAO PRINCIPAL
 * ============================================================
 */

async function generateNews(
  ai,
  prompt
) {
  const editorialPrompt = `
Voce e o editor-chefe do Wire/Geek.

Crie a edicao jornalistica completa de hoje.

A resposta precisa conter EXATAMENTE 12 noticias.

DISTRIBUICAO OBRIGATORIA:

3 noticias de GAMES
3 noticias de GEEK
3 noticias de CINEMA
3 noticias de ANIME

TOTAL ABSOLUTO: 12 noticias.

REGRAS EDITORIAIS:

1. Pesquise informacoes atuais antes de escrever.

2. Priorize noticias recentes e relevantes.

3. Nao invente fatos.

4. Nao invente datas.

5. Nao invente declaracoes.

6. Nao invente fontes.

7. Nao invente URLs.

8. Cada noticia deve possuir fontes reais.

9. Cada materia deve possuir entre 2000 e 2200 caracteres.

10. Cada noticia deve possuir exatamente 4 highlights.

11. Cada noticia deve possuir exatamente 5 hashtags.

12. Cada noticia deve possuir de 1 a 3 fontes.

13. Cada noticia deve possuir image_query.

14. Nao use travessao.

15. Escreva em portugues brasileiro.

16. Nao repita a mesma noticia.

17. Nao coloque duas noticias essencialmente iguais.

18. Mantenha as categorias exatamente como:

games
geek
cinema
anime

19. O campo categoria deve ser exatamente uma dessas quatro palavras.

20. Retorne SOMENTE JSON.

IMPORTANTE:

Nao retorne explicacoes.

Nao retorne Markdown.

Nao retorne blocos de codigo.

Nao retorne texto antes ou depois do JSON.

A estrutura deve ser:

{
  "news": [
    {
      "categoria": "...",
      "titulo": "...",
      "publicado_em": "...",
      "materia": "...",
      "highlights": [
        "...",
        "...",
        "...",
        "..."
      ],
      "hashtags": [
        "#...",
        "#...",
        "#...",
        "#...",
        "#..."
      ],
      "fontes": [
        {
          "nome": "...",
          "url": "...",
          "publicado_em": "..."
        }
      ],
      "image_query": "..."
    }
  ]
}

${
  prompt
    ? `
ORIENTACAO ADICIONAL DO USUARIO:

${prompt}
`
    : ""
}
`;

  const response =
    await ai.models.generateContent({
      model: MODEL,

      contents:
        editorialPrompt,

      config: {
        tools: [
          {
            googleSearch: {},
          },
        ],

        responseMimeType:
          "application/json",

        responseSchema:
          NEWS_SCHEMA,

        temperature: 0.4,

        maxOutputTokens: 30000,
      },
    });

  if (!response.text) {
    throw new Error(
      "Gemini nao retornou texto."
    );
  }

  try {
    return JSON.parse(
      response.text
    );
  } catch (error) {
    throw new Error(
      `Resposta do Gemini nao e um JSON valido: ${
        error?.message ||
        String(error)
      }`
    );
  }
}

/*
 * ============================================================
 * EXPANSAO DE MATERIAS CURTAS
 * ============================================================
 */

async function expandShortNews(
  ai,
  news
) {
  const shortItems =
    news
      .map(
        (item, index) => ({
          index,
          titulo: item.titulo,
          materia: item.materia,
        })
      )
      .filter(
        (item) =>
          item.materia.length <
          2000
      );

  if (
    shortItems.length === 0
  ) {
    return news;
  }

  const correctionSchema = {
    type: "object",

    properties: {
      items: {
        type: "array",

        items: {
          type: "object",

          properties: {
            index: {
              type: "integer",
            },

            materia: {
              type: "string",
            },
          },

          required: [
            "index",
            "materia",
          ],
        },
      },
    },

    required: ["items"],
  };

  const response =
    await ai.models.generateContent({
      model: MODEL,

      contents: `
Voce e um editor jornalistico.

As materias abaixo ficaram abaixo do limite minimo.

Expanda cada uma.

REGRAS:

Cada materia FINAL precisa possuir entre 2000 e 2200 caracteres.

Nao altere os fatos.

Nao invente informacoes.

Nao invente datas.

Nao invente declaracoes.

Nao invente fontes.

Nao invente URLs.

Acrescente apenas contexto jornalistico coerente.

Nao use travessao.

Mantenha o idioma portugues brasileiro.

Retorne SOMENTE JSON.

MATERIAS:

${shortItems
  .map(
    (item) => `
INDEX: ${item.index}

TITULO:
${item.titulo}

MATERIA:
${item.materia}
`
  )
  .join("\n")}
`,

      config: {
        responseMimeType:
          "application/json",

        responseSchema:
          correctionSchema,

        temperature: 0.2,

        maxOutputTokens: 18000,
      },
    });

  if (!response.text) {
    throw new Error(
      "Gemini nao retornou a expansao."
    );
  }

  let correction;

  try {
    correction =
      JSON.parse(
        response.text
      );
  } catch (error) {
    throw new Error(
      `JSON de expansao invalido: ${
        error?.message ||
        String(error)
      }`
    );
  }

  if (
    !correction ||
    !Array.isArray(
      correction.items
    )
  ) {
    throw new Error(
      "Formato de expansao invalido."
    );
  }

  for (const item of correction.items) {
    const index = Number(
      item.index
    );

    if (
      Number.isInteger(index) &&
      news[index] &&
      typeof item.materia ===
        "string"
    ) {
      news[index].materia =
        normalizeText(
          item.materia
        );
    }
  }

  return news;
}

/*
 * ============================================================
 * HANDLER
 * ============================================================
 */

export default async function handler(
  req,
  res
) {
  /*
   * Apenas POST
   */

  if (req.method !== "POST") {
    return res.status(405).json({
      error:
        "Metodo nao permitido.",
    });
  }

  try {
    /*
     * ========================================================
     * API KEY
     * ========================================================
     */

    const apiKey =
      process.env
        .GOOGLE_GEMINI_API_KEY ||
      process.env
        .GEMINI_API_KEY;

    console.log(
      "WIRE/GEEK GEMINI ENV CHECK:",
      {
        google:
          Boolean(
            process.env
              .GOOGLE_GEMINI_API_KEY
          ),

        gemini:
          Boolean(
            process.env
              .GEMINI_API_KEY
          ),

        length:
          apiKey?.length || 0,

        model: MODEL,
      }
    );

    if (!apiKey) {
      return res.status(500).json({
        error:
          "GOOGLE_GEMINI_API_KEY ou GEMINI_API_KEY nao configurada na Vercel.",
      });
    }

    /*
     * ========================================================
     * GEMINI
     * ========================================================
     */

    const ai =
      new GoogleGenAI({
        apiKey,
      });

    const body =
      req.body || {};

    const prompt =
      body.prompt || "";

    /*
     * ========================================================
     * GERACAO
     * ========================================================
     */

    let data;

    try {
      data =
        await generateNews(
          ai,
          prompt
        );
    } catch (error) {
      console.error(
        "WIRE/GEEK GENERATION ERROR:",
        {
          message:
            error?.message ||
            String(error),

          status:
            error?.status,

          code:
            error?.code,

          details:
            error?.details,
        }
      );

      if (
        error?.status === 429
      ) {
        return res
          .status(429)
          .json({
            error:
              "Limite ou quota do Gemini atingido.",

            details:
              error?.message ||
              String(error),
          });
      }

      return res
        .status(502)
        .json({
          error:
            "Erro ao gerar noticias com Gemini.",

          details:
            error?.message ||
            String(error),
        });
    }

    /*
     * ========================================================
     * VALIDACAO DO JSON
     * ========================================================
     */

    if (
      !data ||
      !Array.isArray(
        data.news
      )
    ) {
      return res
        .status(502)
        .json({
          error:
            "Gemini retornou formato de noticias invalido.",
        });
    }

    let news =
      normalizeNews(
        data.news
      );

    /*
     * ========================================================
     * EXPANSAO
     * ========================================================
     */

    const shortNews =
      news.filter(
        (item) =>
          item.materia.length <
          2000
      );

    if (
      shortNews.length > 0
    ) {
      try {
        news =
          await expandShortNews(
            ai,
            news
          );
      } catch (error) {
        console.error(
          "WIRE/GEEK EXPANSION ERROR:",
          error
        );

        return res
          .status(502)
          .json({
            error:
              "Erro ao expandir materias com Gemini.",

            details:
              error?.message ||
              String(error),
          });
      }
    }

    /*
     * ========================================================
     * NORMALIZACAO FINAL
     * ========================================================
     */

    news =
      normalizeNews(
        news
      );

    /*
     * ========================================================
     * VALIDACAO FINAL
     * ========================================================
     */

    const validationErrors =
      validateEdition(
        news
      );

    if (
      validationErrors.length >
      0
    ) {
      console.error(
        "WIRE/GEEK EDITION VALIDATION ERROR:",
        validationErrors
      );

      return res
        .status(422)
        .json({
          error:
            "A edicao nao passou na validacao.",

          details:
            validationErrors,

          resumo:
            news.map(
              (item) => ({
                categoria:
                  item.categoria,

                titulo:
                  item.titulo,

                caracteres:
                  item.materia.length,

                highlights:
                  item.highlights
                    .length,

                hashtags:
                  item.hashtags
                    .length,

                fontes:
                  item.fontes.length,
              })
            ),
        });
    }

    /*
     * ========================================================
     * SUCESSO
     * ========================================================
     */

    console.log(
      "WIRE/GEEK: EDICAO GERADA COM SUCESSO",
      {
        total: news.length,

        games: news.filter(
          (item) =>
            item.categoria ===
            "games"
        ).length,

        geek: news.filter(
          (item) =>
            item.categoria ===
            "geek"
        ).length,

        cinema: news.filter(
          (item) =>
            item.categoria ===
            "cinema"
        ).length,

        anime: news.filter(
          (item) =>
            item.categoria ===
            "anime"
        ).length,
      }
    );

    return res
      .status(200)
      .json({
        testMode: false,

        total: news.length,

        text: JSON.stringify({
          news,
        }),

        news,
      });
  } catch (error) {
    console.error(
      "WIRE/GEEK INTERNAL ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        error:
          error?.message ||
          "Erro interno do servidor.",
      });
  }
}
