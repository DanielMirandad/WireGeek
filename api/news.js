import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3.5-flash-lite";

const CATEGORIES = ["games", "geek", "cinema", "anime"];

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
  return String(value ?? "")
    .replace(/[—–]/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNews(news) {
  if (!Array.isArray(news)) {
    return [];
  }

  return news.map((item) => ({
    categoria: String(
      item?.categoria || "geek"
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

function validateNews(news) {
  const errors = [];

  if (!Array.isArray(news)) {
    return [
      "Resposta de noticias invalida.",
    ];
  }

  if (news.length !== TOTAL_NEWS) {
    errors.push(
      `A edicao precisa conter exatamente ${TOTAL_NEWS} noticias. Encontrado: ${news.length}.`
    );
  }

  for (const category of CATEGORIES) {
    const count = news.filter(
      (item) =>
        item.categoria === category
    ).length;

    if (
      count !== NEWS_PER_CATEGORY
    ) {
      errors.push(
        `${category}: esperado ${NEWS_PER_CATEGORY}, encontrado ${count}.`
      );
    }
  }

  news.forEach((item, index) => {
    const label =
      item.titulo ||
      `noticia ${index + 1}`;

    if (
      !CATEGORIES.includes(
        item.categoria
      )
    ) {
      errors.push(
        `"${label}" possui categoria invalida: ${item.categoria}.`
      );
    }

    if (!item.titulo) {
      errors.push(
        `"${label}" esta sem titulo.`
      );
    }

    if (!item.materia) {
      errors.push(
        `"${label}" esta sem materia.`
      );
    }

    /*
     * Mantemos uma margem razoavel para a materia.
     * A interface pode aplicar regras mais especificas.
     */
    if (
      item.materia &&
      item.materia.length < 1500
    ) {
      errors.push(
        `"${label}" possui materia muito curta: ${item.materia.length} caracteres.`
      );
    }

    if (
      !Array.isArray(
        item.highlights
      ) ||
      item.highlights.length !== 4
    ) {
      errors.push(
        `"${label}" precisa de exatamente 4 highlights.`
      );
    }

    if (
      !Array.isArray(
        item.hashtags
      ) ||
      item.hashtags.length !== 5
    ) {
      errors.push(
        `"${label}" precisa de exatamente 5 hashtags.`
      );
    }

    if (
      !Array.isArray(item.fontes) ||
      item.fontes.length < 1 ||
      item.fontes.length > 3
    ) {
      errors.push(
        `"${label}" precisa ter entre 1 e 3 fontes.`
      );
    }

    for (
      const source of item.fontes || []
    ) {
      if (!source.nome) {
        errors.push(
          `"${label}" possui uma fonte sem nome.`
        );
      }

      if (!source.url) {
        errors.push(
          `"${label}" possui uma fonte sem URL.`
        );
      }
    }
  });

  return errors;
}

function extractGeminiText(response) {
  if (
    response &&
    typeof response.text ===
      "string"
  ) {
    return response.text.trim();
  }

  if (
    response &&
    response.candidates
  ) {
    const parts =
      response.candidates?.[0]
        ?.content?.parts || [];

    return parts
      .filter(
        (part) =>
          typeof part.text ===
          "string"
      )
      .map(
        (part) => part.text
      )
      .join("")
      .trim();
  }

  return "";
}

function cleanJsonText(text) {
  let value =
    String(text || "").trim();

  /*
   * Remove possiveis blocos Markdown
   * caso o modelo os tenha produzido,
   * mesmo com responseMimeType JSON.
   */

  if (
    value.startsWith(
      "```json"
    )
  ) {
    value = value
      .replace(
        /^```json\s*/i,
        ""
      )
      .replace(
        /\s*```$/,
        ""
      )
      .trim();
  }

  if (
    value.startsWith("```")
  ) {
    value = value
      .replace(
        /^```\s*/i,
        ""
      )
      .replace(
        /\s*```$/,
        ""
      )
      .trim();
  }

  return value;
}

async function generateNews(
  ai,
  prompt
) {
  const contents = `
Voce e o editor-chefe do Wire/Geek, um portal brasileiro especializado em games, cultura geek, cinema e anime.

TAREFA:

Produza uma edicao jornalistica com exatamente ${TOTAL_NEWS} noticias reais.

DISTRIBUICAO OBRIGATORIA:

3 noticias de games.
3 noticias de geek.
3 noticias de cinema.
3 noticias de anime.

PESQUISA:

Use obrigatoriamente a busca na web antes de escrever.

Priorize informacoes publicadas hoje ou nas ultimas 24 horas.

Nunca invente fatos.

Nunca invente datas.

Nunca invente declaracoes.

Nunca invente fontes.

Nunca invente URLs.

Se uma informacao nao puder ser confirmada, nao utilize a informacao.

FONTES PREFERENCIAIS:

IGN Brasil.
Omelete.
Eurogamer.
The Enemy.
Jovem Nerd.
Adrenaline.
Canaltech.
GameSpot.
IGN.
Polygon.
Variety.
Deadline.
The Hollywood Reporter.
Crunchyroll News.
Anime News Network.
MyAnimeList News.

CATEGORIAS:

GAMES:
jogos, consoles, PC, Xbox, PlayStation, Nintendo, Steam, trailers, lancamentos, atualizacoes, industria e esports.

GEEK:
quadrinhos, tecnologia geek, cultura pop, colecionaveis, eventos, ficcao cientifica, fantasia e cultura nerd.

CINEMA:
filmes, lancamentos, trailers, franquias, atores, atrizes, diretores, producoes, bilheterias, adaptacoes, remakes e sequencias.

ANIME:
animes, mangas, light novels, episodios, temporadas, adaptacoes, dublagem, filmes, streaming, Crunchyroll e declaracoes de criadores.

REGRAS EDITORIAIS:

Nao use travessao.

Use virgulas, pontos, dois-pontos ou parenteses.

Cada noticia deve possuir:

categoria
titulo
publicado_em
materia
highlights
hashtags
fontes
image_query

Cada noticia precisa possuir exatamente 4 highlights.

Cada noticia precisa possuir exatamente 5 hashtags.

Cada noticia precisa possuir entre 1 e 3 fontes.

A materia deve ser jornalistica, contextualizada e informativa.

Evite repetir a mesma noticia ou o mesmo fato em categorias diferentes.

Nao produza noticias antigas apenas para completar a quantidade.

FORMATO:

O objeto final precisa possuir somente a propriedade "news".

O array "news" precisa conter exatamente ${TOTAL_NEWS} objetos.

Nao escreva comentarios.

Nao escreva Markdown.

Nao escreva explicacoes.

Retorne somente JSON valido.

${prompt || "Gere a edicao de hoje com exatamente 12 noticias reais das ultimas 24 horas."}
`;

  const response =
    await ai.models.generateContent(
      {
        model: MODEL,

        contents,

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

          temperature: 0.3,

          maxOutputTokens: 30000,
        },
      }
    );

  const text =
    extractGeminiText(
      response
    );

  if (!text) {
    throw new Error(
      "Gemini nao retornou texto."
    );
  }

  const cleaned =
    cleanJsonText(text);

  try {
    return JSON.parse(
      cleaned
    );
  } catch (error) {
    console.error(
      "GEMINI JSON PARSE ERROR:",
      {
        message:
          error?.message ||
          String(error),

        preview:
          cleaned.slice(0, 2000),
      }
    );

    throw new Error(
      "Gemini retornou JSON invalido."
    );
  }
}

export default async function handler(
  req,
  res
) {
  if (
    req.method !== "POST"
  ) {
    return res.status(405).json({
      error:
        "Metodo nao permitido.",
    });
  }

  try {
    const apiKey =
      process.env
        .GOOGLE_GEMINI_API_KEY ||
      process.env
        .GEMINI_API_KEY;

    console.log(
      "WIRE/GEEK GEMINI ENV:",
      {
        configured:
          Boolean(apiKey),

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

        model: MODEL,
      }
    );

    if (!apiKey) {
      return res.status(500).json({
        error:
          "GOOGLE_GEMINI_API_KEY nao configurada na Vercel.",
      });
    }

    const ai =
      new GoogleGenAI({
        apiKey,
      });

    const body =
      req.body || {};

    const prompt =
      typeof body.prompt ===
      "string"
        ? body.prompt
        : "";

    console.log(
      "WIRE/GEEK: iniciando geracao Gemini"
    );

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

      if (
        error?.status === 401 ||
        error?.status === 403
      ) {
        return res
          .status(error.status)
          .json({
            error:
              "A chave do Gemini foi rejeitada.",

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

    const news =
      normalizeNews(
        data.news
      );

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
            "A edicao nao passou na validacao.",

          details:
            validationErrors,

          news:
            news.map(
              (item) => ({
                categoria:
                  item.categoria,

                titulo:
                  item.titulo,

                caracteres:
                  item.materia
                    .length,
              })
            ),
        });
    }

    console.log(
      "WIRE/GEEK: edicao gerada com sucesso",
      {
        total: news.length,

        categorias:
          CATEGORIES.reduce(
            (
              result,
              category
            ) => {
              result[category] =
                news.filter(
                  (item) =>
                    item.categoria ===
                    category
                ).length;

              return result;
            },
            {}
          ),
      }
    );

    return res
      .status(200)
      .json({
        testMode: false,

        text: JSON.stringify({
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
````
