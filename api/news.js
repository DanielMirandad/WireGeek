# api/news.js

```javascript
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

const MIN_ARTICLE_LENGTH = 2000;
const MAX_ARTICLE_LENGTH = 2200;

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

/*
============================================================
NORMALIZAÇÃO
============================================================
*/

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

    highlights:
      Array.isArray(item?.highlights)
        ? item.highlights
            .map(normalizeText)
            .filter(Boolean)
            .slice(0, 4)
        : [],

    hashtags:
      Array.isArray(item?.hashtags)
        ? item.hashtags
            .map(normalizeText)
            .filter(Boolean)
            .slice(0, 5)
        : [],

    fontes:
      Array.isArray(item?.fontes)
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
============================================================
VALIDAÇÃO
============================================================
*/

function validateNews(news) {
  const errors = [];

  if (!Array.isArray(news)) {
    return [
      "news precisa ser um array.",
    ];
  }

  if (news.length !== TOTAL_NEWS) {
    errors.push(
      `A edição precisa conter exatamente ${TOTAL_NEWS} notícias. Recebidas: ${news.length}.`
    );
  }

  const counts = {
    games: 0,
    geek: 0,
    cinema: 0,
    anime: 0,
  };

  news.forEach((item, index) => {
    const number = index + 1;

    if (
      !CATEGORIES.includes(
        item.categoria
      )
    ) {
      errors.push(
        `Notícia ${number}: categoria inválida "${item.categoria}".`
      );
    } else {
      counts[item.categoria]++;
    }

    if (!item.titulo) {
      errors.push(
        `Notícia ${number}: título ausente.`
      );
    }

    if (!item.publicado_em) {
      errors.push(
        `Notícia ${number}: publicado_em ausente.`
      );
    }

    if (!item.materia) {
      errors.push(
        `Notícia ${number}: matéria ausente.`
      );
    }

    const articleLength =
      item.materia?.length || 0;

    if (
      articleLength <
      MIN_ARTICLE_LENGTH
    ) {
      errors.push(
        `Notícia ${number}: matéria possui ${articleLength} caracteres. Mínimo: ${MIN_ARTICLE_LENGTH}.`
      );
    }

    if (
      articleLength >
      MAX_ARTICLE_LENGTH
    ) {
      errors.push(
        `Notícia ${number}: matéria possui ${articleLength} caracteres. Máximo: ${MAX_ARTICLE_LENGTH}.`
      );
    }

    if (
      !Array.isArray(
        item.highlights
      ) ||
      item.highlights.length !== 4
    ) {
      errors.push(
        `Notícia ${number}: precisa ter exatamente 4 highlights.`
      );
    }

    if (
      !Array.isArray(
        item.hashtags
      ) ||
      item.hashtags.length !== 5
    ) {
      errors.push(
        `Notícia ${number}: precisa ter exatamente 5 hashtags.`
      );
    }

    if (
      !Array.isArray(item.fontes) ||
      item.fontes.length < 1 ||
      item.fontes.length > 3
    ) {
      errors.push(
        `Notícia ${number}: precisa ter entre 1 e 3 fontes.`
      );
    }

    if (
      !item.image_query
    ) {
      errors.push(
        `Notícia ${number}: image_query ausente.`
      );
    }
  });

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
============================================================
PROMPT PRINCIPAL
============================================================
*/

function buildPrompt(prompt) {
  return `
Você é o editor-chefe do WIRE/GEEK, uma publicação brasileira especializada em games, cultura geek, cinema e anime.

Sua missão é produzir uma edição jornalística real e atualizada.

IMPORTANTE:

Pesquise a web ANTES de escrever.

Use somente fatos verificáveis.

A edição precisa conter EXATAMENTE ${TOTAL_NEWS} notícias.

DISTRIBUIÇÃO OBRIGATÓRIA:

${NEWS_PER_CATEGORY} notícias de GAMES.
${NEWS_PER_CATEGORY} notícias de GEEK.
${NEWS_PER_CATEGORY} notícias de CINEMA.
${NEWS_PER_CATEGORY} notícias de ANIME.

TOTAL: ${TOTAL_NEWS} notícias.

============================================================
ATUALIDADE
============================================================

Priorize notícias publicadas HOJE ou nas últimas 24 horas.

Não utilize notícias antigas apenas para preencher quantidade.

Caso uma categoria tenha poucas notícias relevantes, procure fontes adicionais.

Não invente fatos para completar a quantidade.

============================================================
CATEGORIAS
============================================================

GAMES:

Jogos, consoles, PC, Xbox, PlayStation, Nintendo, Steam, trailers, lançamentos, atualizações, indústria, esports e mercado de games.

GEEK:

Quadrinhos, tecnologia geek, cultura pop, colecionáveis, eventos, ficção científica, fantasia, super-heróis e cultura nerd.

CINEMA:

Filmes, trailers, lançamentos, franquias, atores, atrizes, diretores, produções, bilheterias, adaptações, remakes e sequências.

ANIME:

Animes, mangás, light novels, episódios, temporadas, adaptações, dublagem, filmes, streaming, Crunchyroll e declarações de criadores.

============================================================
REGRAS EDITORIAIS
============================================================

1. Exatamente ${TOTAL_NEWS} notícias.

2. Exatamente ${NEWS_PER_CATEGORY} notícias de cada categoria.

3. Cada matéria deve possuir entre ${MIN_ARTICLE_LENGTH} e ${MAX_ARTICLE_LENGTH} caracteres.

4. Não utilize travessão.

5. Não utilize o caractere "—".

6. Não utilize o caractere "–".

7. Use vírgulas, pontos, dois-pontos ou parênteses.

8. Não invente fatos.

9. Não invente datas.

10. Não invente declarações.

11. Não invente fontes.

12. Não invente URLs.

13. As URLs das fontes devem ser URLs reais encontradas durante a pesquisa.

14. Highlights: exatamente 4.

15. Hashtags: exatamente 5.

16. Fontes: entre 1 e 3.

17. Cada notícia precisa possuir image_query.

18. Evite repetir a mesma notícia em categorias diferentes.

19. Evite repetir a mesma fonte quando houver outras fontes confiáveis disponíveis.

20. A matéria deve ter estilo jornalístico brasileiro, claro, envolvente e informativo.

21. Não escreva introdução fora do JSON.

22. Não escreva comentários fora do JSON.

23. Retorne SOMENTE o objeto JSON solicitado.

============================================================
FONTES PRIORITÁRIAS
============================================================

Considere fontes como:

IGN Brasil
Omelete
The Enemy
Eurogamer
Jovem Nerd
Adrenaline
Canaltech
GameSpot
IGN
Polygon
Variety
Deadline
The Hollywood Reporter
Crunchyroll News
Anime News Network
MyAnimeList News

Use outras fontes confiáveis quando necessário.

============================================================
FORMATO
============================================================

{
  "news": [
    {
      "categoria": "games",
      "titulo": "Título",
      "publicado_em": "Data e horário",
      "materia": "Matéria entre 2000 e 2200 caracteres",
      "highlights": [
        "Highlight 1",
        "Highlight 2",
        "Highlight 3",
        "Highlight 4"
      ],
      "hashtags": [
        "#Games",
        "#Gaming",
        "#WireGeek",
        "#News",
        "#Tecnologia"
      ],
      "fontes": [
        {
          "nome": "Nome da fonte",
          "url": "https://url-real-da-fonte",
          "publicado_em": "Data"
        }
      ],
      "image_query": "termos para buscar imagem relacionada"
    }
  ]
}

O array news DEVE possuir exatamente ${TOTAL_NEWS} objetos.

Distribuição obrigatória:

3 games
3 geek
3 cinema
3 anime

${prompt || "Gere a edição atual do WIRE/GEEK com exatamente 12 notícias reais das últimas 24 horas."}
`;
}

/*
============================================================
GERAÇÃO PRINCIPAL
============================================================
*/

async function generateNews(
  ai,
  prompt
) {
  const response =
    await ai.models.generateContent({
      model: MODEL,

      contents:
        buildPrompt(prompt),

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

        temperature: 0.35,

        maxOutputTokens: 30000,
      },
    });

  if (!response?.text) {
    throw new Error(
      "Gemini não retornou conteúdo."
    );
  }

  let parsed;

  try {
    parsed = JSON.parse(
      response.text
    );
  } catch (error) {
    throw new Error(
      "Gemini retornou JSON inválido."
    );
  }

  return parsed;
}

/*
============================================================
EXPANSÃO DE MATÉRIAS CURTAS
============================================================
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
          MIN_ARTICLE_LENGTH
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
Você é um editor responsável por expandir matérias jornalísticas.

Expanda SOMENTE as matérias abaixo.

Cada matéria final precisa possuir entre ${MIN_ARTICLE_LENGTH} e ${MAX_ARTICLE_LENGTH} caracteres.

REGRAS:

Não altere os fatos originais.

Não invente fatos.

Não invente datas.

Não invente declarações.

Não invente fontes.

Não invente URLs.

Acrescente apenas contexto jornalístico coerente com os fatos apresentados.

Não use travessão.

Não use "—".

Não use "–".

Retorne somente JSON.

MATÉRIAS:

${shortItems
  .map(
    (item) => `
INDEX: ${item.index}

TÍTULO:
${item.titulo}

MATÉRIA:
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

  if (!response?.text) {
    throw new Error(
      "Gemini não retornou a expansão."
    );
  }

  let correction;

  try {
    correction = JSON.parse(
      response.text
    );
  } catch {
    throw new Error(
      "Gemini retornou JSON inválido na expansão."
    );
  }

  if (
    !Array.isArray(
      correction.items
    )
  ) {
    throw new Error(
      "Formato de expansão inválido."
    );
  }

  for (
    const item of correction.items
  ) {
    const index =
      Number(item.index);

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
============================================================
HANDLER VERCEL
============================================================
*/

export default async function handler(
  req,
  res
) {
  /*
  Apenas POST
  */

  if (
    req.method !== "POST"
  ) {
    return res
      .status(405)
      .json({
        error:
          "Método não permitido.",
      });
  }

  /*
  ============================================================
  GEMINI
  ============================================================
  */

  try {
    const apiKey =
      process.env.GOOGLE_GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY;

    console.log(
      "WIRE/GEEK GEMINI ENV:",
      {
        googleGemini:
          Boolean(
            process.env
              .GOOGLE_GEMINI_API_KEY
          ),

        gemini:
          Boolean(
            process.env
              .GEMINI_API_KEY
          ),

        keyLength:
          apiKey?.length || 0,

        model: MODEL,
      }
    );

    if (!apiKey) {
      return res
        .status(500)
        .json({
          error:
            "GOOGLE_GEMINI_API_KEY não configurada na Vercel.",
        });
    }

    const ai =
      new GoogleGenAI({
        apiKey,
      });

    const body =
      req.body || {};

    const prompt =
      body.prompt;

    /*
    ==========================================================
    GERAÇÃO
    ==========================================================
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
        "WIRE/GEEK GEMINI GENERATION ERROR:",
        {
          message:
            error?.message ||
            String(error),

          status:
            error?.status,

          code:
            error?.code,
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
            "Erro ao gerar notícias com Gemini.",

          details:
            error?.message ||
            String(error),
        });
    }

    /*
    ==========================================================
    VERIFICAÇÃO
    ==========================================================
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
            "Gemini retornou formato inválido.",
        });
    }

    let news =
      normalizeNews(
        data.news
      );

    /*
    ==========================================================
    GARANTIR EXATAMENTE 12
    ==========================================================
    */

    if (
      news.length !== TOTAL_NEWS
    ) {
      return res
        .status(422)
        .json({
          error:
            `Gemini retornou ${news.length} notícias. Eram necessárias exatamente ${TOTAL_NEWS}.`,

          quantidade:
            news.length,

          esperado:
            TOTAL_NEWS,
        });
    }

    /*
    ==========================================================
    EXPANSÃO
    ==========================================================
    */

    const shortNews =
      news.filter(
        (item) =>
          item.materia.length <
          MIN_ARTICLE_LENGTH
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
          "WIRE/GEEK GEMINI EXPANSION ERROR:",
          error
        );

        return res
          .status(502)
          .json({
            error:
              "Erro ao expandir matérias com Gemini.",

            details:
              error?.message ||
              String(error),
          });
      }
    }

    /*
    ==========================================================
    NORMALIZAÇÃO FINAL
    ==========================================================
    */

    news =
      normalizeNews(
        news
      );

    /*
    ==========================================================
    VALIDAÇÃO FINAL
    ==========================================================
    */

    const validationErrors =
      validateNews(
        news
      );

    if (
      validationErrors.length > 0
    ) {
      console.error(
        "WIRE/GEEK VALIDATION ERROR:",
        validationErrors
      );

      return res
        .status(422)
        .json({
          error:
            "A edição não passou na validação.",

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
                  item.highlights.length,

                hashtags:
                  item.hashtags.length,

                fontes:
                  item.fontes.length,
              })
            ),
        });
    }

    /*
    ==========================================================
    SUCESSO
    ==========================================================
    */

    console.log(
      "WIRE/GEEK EDITION OK:",
      {
        total:
          news.length,

        games:
          news.filter(
            (n) =>
              n.categoria ===
              "games"
          ).length,

        geek:
          news.filter(
            (n) =>
              n.categoria ===
              "geek"
          ).length,

        cinema:
          news.filter(
            (n) =>
              n.categoria ===
              "cinema"
          ).length,

        anime:
          news.filter(
            (n) =>
              n.categoria ===
              "anime"
          ).length,
      }
    );

    return res
      .status(200)
      .json({
        testMode: false,

        total: news.length,

        text:
          JSON.stringify({
            news,
          }),

        news,
      });
  } catch (error) {
    console.error(
      "WIRE/GEEK API ERROR:",
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
```
