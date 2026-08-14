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
            enum: [
              "games",
              "geek",
              "cinema",
              "anime",
            ],
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
 * ============================================================
 * NORMALIZACAO
 * ============================================================
 */

function normalizeText(value) {
  return String(value || "")
    .replace(/[—–]/g, ",")
    .replace(/\u00a0/g, " ")
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
            .filter(
              (source) =>
                source.nome &&
                source.url
            )
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

function validateNews(news) {
  const errors = [];

  if (!Array.isArray(news)) {
    return ["O campo news nao e um array."];
  }

  /*
   * Quantidade total
   */

  if (news.length !== TOTAL_NEWS) {
    errors.push(
      `A edicao precisa conter exatamente ${TOTAL_NEWS} noticias. Recebidas: ${news.length}.`
    );
  }

  /*
   * Contagem por categoria
   */

  const counts = {
    games: 0,
    geek: 0,
    cinema: 0,
    anime: 0,
  };

  news.forEach((item, index) => {
    const position = index + 1;

    if (!CATEGORIES.includes(item.categoria)) {
      errors.push(
        `Noticia ${position}: categoria invalida "${item.categoria}".`
      );
      return;
    }

    counts[item.categoria]++;

    if (!item.titulo) {
      errors.push(
        `Noticia ${position}: titulo ausente.`
      );
    }

    if (!item.publicado_em) {
      errors.push(
        `Noticia ${position}: publicado_em ausente.`
      );
    }

    if (!item.materia) {
      errors.push(
        `Noticia ${position}: materia ausente.`
      );
    }

    const characters =
      item.materia?.length || 0;

    if (characters < 2000) {
      errors.push(
        `Noticia ${position} "${item.titulo}": materia possui ${characters} caracteres. Minimo: 2000.`
      );
    }

    if (characters > 2200) {
      errors.push(
        `Noticia ${position} "${item.titulo}": materia possui ${characters} caracteres. Maximo: 2200.`
      );
    }

    if (
      !Array.isArray(
        item.highlights
      ) ||
      item.highlights.length !== 4
    ) {
      errors.push(
        `Noticia ${position} "${item.titulo}": precisa ter exatamente 4 highlights.`
      );
    }

    if (
      !Array.isArray(
        item.hashtags
      ) ||
      item.hashtags.length !== 5
    ) {
      errors.push(
        `Noticia ${position} "${item.titulo}": precisa ter exatamente 5 hashtags.`
      );
    }

    if (
      !Array.isArray(item.fontes) ||
      item.fontes.length < 1 ||
      item.fontes.length > 3
    ) {
      errors.push(
        `Noticia ${position} "${item.titulo}": precisa ter entre 1 e 3 fontes.`
      );
    }

    if (!item.image_query) {
      errors.push(
        `Noticia ${position} "${item.titulo}": image_query ausente.`
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
        `${category}: esperadas ${NEWS_PER_CATEGORY}, recebidas ${counts[category]}.`
      );
    }
  }

  return errors;
}

/*
 * ============================================================
 * PROMPT EDITORIAL
 * ============================================================
 */

function buildPrompt(prompt) {
  return `
Voce e o editor-chefe do WIRE/GEEK, um portal brasileiro especializado em Games, Cultura Geek, Cinema e Anime.

Sua tarefa e produzir uma edicao jornalistica atualizada.

PESQUISA:

Use obrigatoriamente a busca na web antes de escrever.

Pesquise noticias publicadas HOJE ou, no maximo, nas ultimas 24 horas.

Nao use conhecimento antigo quando houver necessidade de informacao atual.

Nao invente fatos.

Nao invente datas.

Nao invente URLs.

Nao invente fontes.

Nao atribua declaracoes que nao estejam presentes nas fontes.

Cada noticia deve ser baseada em informacoes verificaveis encontradas durante a pesquisa.

QUANTIDADE OBRIGATORIA:

A resposta precisa conter EXATAMENTE ${TOTAL_NEWS} noticias.

Distribuicao obrigatoria:

${NEWS_PER_CATEGORY} noticias de GAMES.
${NEWS_PER_CATEGORY} noticias de GEEK.
${NEWS_PER_CATEGORY} noticias de CINEMA.
${NEWS_PER_CATEGORY} noticias de ANIME.

Nao produza 11.

Nao produza 13.

Nao produza quantidade diferente de ${TOTAL_NEWS}.

A distribuicao precisa ser exatamente 3 + 3 + 3 + 3.

REGRAS DE CADA NOTICIA:

1. categoria:
Deve ser exatamente um destes valores:

games
geek
cinema
anime

2. titulo:
Crie um titulo jornalistico claro, forte e informativo.

3. publicado_em:
Informe a data ou referencia temporal encontrada na fonte.

4. materia:
A materia deve ter entre 2000 e 2200 caracteres.

O limite e de caracteres, nao de palavras.

A materia deve apresentar os fatos principais, contexto, impacto e repercussao quando houver informacao suficiente.

Nao invente informacoes para preencher tamanho.

5. highlights:
Exatamente 4 itens.

Cada highlight deve resumir um ponto importante da materia.

6. hashtags:
Exatamente 5 hashtags relevantes.

7. fontes:
Entre 1 e 3 fontes reais.

Cada fonte deve conter:

nome
url
publicado_em

Use URLs reais encontradas na pesquisa.

8. image_query:
Crie uma consulta curta para localizar uma imagem relacionada a noticia.

TRAVESSAO:

Nunca utilize os caracteres "—" ou "–".

Use virgulas, pontos, dois-pontos, parenteses ou outros sinais adequados.

FONTES PREFERENCIAIS:

Games:
IGN Brasil, IGN, Eurogamer, The Enemy, GameSpot, Polygon, Nintendo Life, PlayStation Blog, Xbox Wire, Steam e sites oficiais.

Geek:
Omelete, Jovem Nerd, Canaltech, Adrenaline, IGN, Variety, The Hollywood Reporter e fontes oficiais.

Cinema:
Variety, Deadline, The Hollywood Reporter, IMDb News, IGN, Omelete, Collider e fontes oficiais.

Anime:
Crunchyroll News, Anime News Network, MyAnimeList News, ComicBook, fontes oficiais de estúdios e distribuidores.

DIVERSIDADE:

Nao repita a mesma noticia em categorias diferentes.

Nao use varias noticias sobre o mesmo acontecimento para preencher a edicao.

Priorize assuntos diferentes dentro de cada categoria.

ORDEM:

Retorne preferencialmente nesta ordem:

1. games
2. games
3. games
4. geek
5. geek
6. geek
7. cinema
8. cinema
9. cinema
10. anime
11. anime
12. anime

FORMATO:

Retorne SOMENTE o JSON definido pelo schema.

Nenhum texto antes do JSON.

Nenhum texto depois do JSON.

${prompt || "Gere a edicao atual do WIRE/GEEK com exatamente 12 noticias reais das ultimas 24 horas."}
`;
}

/*
 * ============================================================
 * GERACAO PRINCIPAL
 * ============================================================
 */

async function generateNews(ai, prompt) {
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

        temperature: 0.2,

        maxOutputTokens: 30000,
      },
    });

  if (!response?.text) {
    throw new Error(
      "Gemini nao retornou texto."
    );
  }

  let parsed;

  try {
    parsed = JSON.parse(
      response.text
    );
  } catch (error) {
    throw new Error(
      `Gemini retornou JSON invalido: ${
        error?.message ||
        String(error)
      }`
    );
  }

  return parsed;
}

/*
 * ============================================================
 * EXPANSAO DAS MATERIAS CURTAS
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
          titulo:
            item.titulo,
          materia:
            item.materia,
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

As materias abaixo possuem menos de 2000 caracteres.

Expanda cada materia para ficar obrigatoriamente entre 2000 e 2200 caracteres.

Mantenha os fatos originais.

Nao invente fatos.

Nao invente datas.

Nao invente declaracoes.

Nao invente fontes.

Nao altere o titulo.

Acrescente somente contexto, explicacoes, impacto e repercussao que possam ser sustentados pelo conteudo fornecido.

Nao use travessao.

Retorne somente JSON.

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

        temperature: 0.1,

        maxOutputTokens: 18000,
      },
    });

  if (!response?.text) {
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
    const index =
      Number(item?.index);

    if (
      Number.isInteger(index) &&
      news[index] &&
      typeof item?.materia ===
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
 * CORTE SE A MATERIA PASSAR DE 2200
 * ============================================================
 */

function trimToLimit(text, max = 2200) {
  const value =
    normalizeText(text);

  if (value.length <= max) {
    return value;
  }

  const shortened =
    value.slice(0, max);

  const lastSpace =
    shortened.lastIndexOf(" ");

  if (lastSpace > 1900) {
    return shortened
      .slice(0, lastSpace)
      .trim();
  }

  return shortened.trim();
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
   * Somente POST
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
      process.env.GEMINI_API_KEY;

    console.log(
      "WIRE/GEEK GEMINI ENV CHECK",
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
          "GOOGLE_GEMINI_API_KEY nao configurada na Vercel.",
      });
    }

    /*
     * ========================================================
     * CLIENT GEMINI
     * ========================================================
     */

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
        "WIRE/GEEK GEMINI GENERATION ERROR",
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
     * VALIDACAO DA RESPOSTA GEMINI
     * ========================================================
     */

    if (
      !data ||
      !Array.isArray(
        data.news
      )
    ) {
      return res.status(502).json({
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
     * PRIMEIRA VALIDACAO
     * ========================================================
     */

    let validationErrors =
      validateNews(news);

    /*
     * ========================================================
     * EXPANDIR MATERIAS CURTAS
     * ========================================================
     */

    const hasShortNews =
      news.some(
        (item) =>
          item.materia.length <
          2000
      );

    if (hasShortNews) {
      try {
        news =
          await expandShortNews(
            ai,
            news
          );
      } catch (error) {
        console.error(
          "WIRE/GEEK GEMINI EXPANSION ERROR",
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
     * Nao cortar materias antes da validacao.
     *
     * Se uma materia ultrapassar 2200 caracteres,
     * retornamos erro para nao destruir o texto
     * jornalistico.
     */

    validationErrors =
      validateNews(
        news
      );

    /*
     * ========================================================
     * RESPOSTA DE ERRO EDITORIAL
     * ========================================================
     */

    if (
      validationErrors.length >
      0
    ) {
      console.error(
        "WIRE/GEEK EDITION VALIDATION ERROR",
        validationErrors
      );

      return res
        .status(422)
        .json({
          error:
            "A edicao nao passou na validacao.",

          details:
            validationErrors,

          summary:
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
     * ========================================================
     * SUCESSO
     * ========================================================
     */

    console.log(
      "WIRE/GEEK EDITION OK",
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

        paidMode: true,

        model: MODEL,

        text: JSON.stringify({
          news,
        }),

        news,
      });
  } catch (error) {
    /*
     * ========================================================
     * ERRO GERAL
     * ========================================================
     */

    console.error(
      "WIRE/GEEK GEMINI API ERROR",
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
