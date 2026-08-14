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

/*
 * ============================================================
 * NORMALIZAÇÃO
 * ============================================================
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
          .slice(0, 4)
      : [],

    hashtags: Array.isArray(
      item?.hashtags
    )
      ? item.hashtags
          .map(normalizeText)
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
 * VALIDAÇÃO
 * ============================================================
 */

function validateNews(news) {
  const errors = [];

  if (!Array.isArray(news)) {
    return ["news não é um array."];
  }

  /*
   * Quantidade total
   */

  if (news.length !== TOTAL_NEWS) {
    errors.push(
      `A edição precisa conter exatamente ${TOTAL_NEWS} notícias. Recebidas: ${news.length}.`
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
    const number = index + 1;

    if (
      !CATEGORIES.includes(
        item.categoria
      )
    ) {
      errors.push(
        `Notícia ${number}: categoria inválida "${item.categoria}".`
      );

      return;
    }

    counts[item.categoria]++;

    /*
     * Título
     */

    if (!item.titulo) {
      errors.push(
        `Notícia ${number}: título ausente.`
      );
    }

    /*
     * Data
     */

    if (!item.publicado_em) {
      errors.push(
        `Notícia ${number}: publicado_em ausente.`
      );
    }

    /*
     * Matéria
     */

    if (!item.materia) {
      errors.push(
        `Notícia ${number}: matéria ausente.`
      );
    }

    const length =
      item.materia?.length || 0;

    if (length < 2000) {
      errors.push(
        `Notícia ${number} "${item.titulo}": matéria possui ${length} caracteres. Mínimo: 2000.`
      );
    }

    if (length > 2200) {
      errors.push(
        `Notícia ${number} "${item.titulo}": matéria possui ${length} caracteres. Máximo: 2200.`
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
        `Notícia ${number}: precisa ter exatamente 4 highlights.`
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
        `Notícia ${number}: precisa ter exatamente 5 hashtags.`
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
        `Notícia ${number}: precisa ter entre 1 e 3 fontes.`
      );
    }

    /*
     * Image query
     */

    if (!item.image_query) {
      errors.push(
        `Notícia ${number}: image_query ausente.`
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
Você é o editor-chefe da WIRE/GEEK, uma publicação brasileira especializada em games, cultura geek, cinema e anime.

Sua função é produzir uma edição jornalística atual, factual e interessante.

PESQUISE A WEB ANTES DE ESCREVER.

A edição precisa conter EXATAMENTE ${TOTAL_NEWS} notícias.

DISTRIBUIÇÃO OBRIGATÓRIA:

3 notícias de GAMES.
3 notícias de GEEK.
3 notícias de CINEMA.
3 notícias de ANIME.

NÃO entregue 11.
NÃO entregue 13.
NÃO entregue quantidade diferente.

A resposta final precisa possuir exatamente 12 objetos dentro de "news".

============================================================
ATUALIDADE
============================================================

Priorize notícias publicadas hoje ou nas últimas 24 horas.

Confirme a data de publicação através das fontes.

Não utilize notícia antiga apenas porque ela é popular.

Se uma informação for uma atualização de uma notícia anterior, deixe isso claro.

============================================================
FATUALIDADE
============================================================

Não invente:

- fatos;
- datas;
- nomes;
- declarações;
- números;
- resultados;
- lançamentos;
- fontes;
- URLs.

Use somente informações encontradas nas fontes consultadas.

Não crie URLs.

Copie as URLs reais das fontes consultadas.

============================================================
CATEGORIAS
============================================================

GAMES:

Jogos, consoles, PC, PlayStation, Xbox, Nintendo, Steam, trailers, lançamentos, atualizações, desenvolvedoras, publishers, indústria e esports.

GEEK:

Quadrinhos, tecnologia geek, cultura pop, colecionáveis, eventos, ficção científica, fantasia, cultura nerd e entretenimento relacionado.

CINEMA:

Filmes, trailers, lançamentos, franquias, atores, atrizes, diretores, produções, bilheterias, adaptações, remakes, sequências e streaming cinematográfico.

ANIME:

Anime, mangá, light novels, episódios, temporadas, adaptações, dublagem, filmes, streaming, Crunchyroll e declarações de criadores.

============================================================
FONTES PRIORITÁRIAS
============================================================

Sempre que possível, priorize fontes jornalísticas e especializadas confiáveis, incluindo:

IGN Brasil
Omelete
Eurogamer
The Enemy
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

Também pode utilizar fontes oficiais de empresas, estúdios, publishers, desenvolvedores e plataformas quando forem a origem primária da informação.

============================================================
MATÉRIA
============================================================

Cada campo "materia" precisa possuir entre 2000 e 2200 caracteres.

Mínimo: 2000 caracteres.
Máximo: 2200 caracteres.

Escreva em português brasileiro.

Use estilo jornalístico de colunista:

- informativo;
- moderno;
- envolvente;
- objetivo;
- com personalidade;
- contextualizado.

Não use travessão.

Nunca utilize os caracteres:

—
–

Utilize vírgulas, pontos, dois-pontos ou parênteses.

Não fique repetindo a mesma informação apenas para atingir o tamanho.

Inclua contexto, impacto e repercussão quando houver informação factual disponível.

============================================================
HIGHLIGHTS
============================================================

Cada notícia deve possuir EXATAMENTE 4 highlights.

============================================================
HASHTAGS
============================================================

Cada notícia deve possuir EXATAMENTE 5 hashtags.

============================================================
FONTES
============================================================

Cada notícia deve possuir entre 1 e 3 fontes.

Cada fonte precisa conter:

nome
url
publicado_em

============================================================
IMAGE QUERY
============================================================

Cada notícia precisa possuir um campo image_query.

Esse campo deve ser uma consulta curta em inglês para encontrar uma imagem relacionada à notícia.

Exemplo:

"PlayStation new game announcement 2026"

============================================================
FORMATO
============================================================

Retorne SOMENTE JSON válido.

Não escreva:

"```json"

Não escreva explicações antes do JSON.

Não escreva explicações depois do JSON.

Formato:

{
  "news": [
    {
      "categoria": "games",
      "titulo": "",
      "publicado_em": "",
      "materia": "",
      "highlights": [
        "",
        "",
        "",
        ""
      ],
      "hashtags": [
        "",
        "",
        "",
        "",
        ""
      ],
      "fontes": [
        {
          "nome": "",
          "url": "",
          "publicado_em": ""
        }
      ],
      "image_query": ""
    }
  ]
}

O array news precisa possuir exatamente 12 itens:

3 games
3 geek
3 cinema
3 anime

============================================================
SOLICITAÇÃO DO USUÁRIO
============================================================

${
  prompt ||
  "Gere a edição de hoje da WIRE/GEEK com exatamente 12 notícias reais publicadas nas últimas 24 horas."
}
`;
}

/*
 * ============================================================
 * GERAÇÃO PRINCIPAL
 * ============================================================
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

  if (!response.text) {
    throw new Error(
      "Gemini não retornou texto."
    );
  }

  let parsed;

  try {
    parsed = JSON.parse(
      response.text
    );
  } catch (error) {
    console.error(
      "JSON GEMINI INVALIDO:",
      response.text?.slice(0, 2000)
    );

    throw new Error(
      "Gemini retornou JSON inválido."
    );
  }

  return parsed;
}

/*
 * ============================================================
 * EXPANSÃO DE MATÉRIAS CURTAS
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
          categoria:
            item.categoria,
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

  console.log(
    "WIRE/GEEK: expandindo matérias curtas:",
    shortItems.length
  );

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
Você é um editor responsável por corrigir o tamanho de matérias jornalísticas.

As matérias abaixo já foram produzidas com fatos pesquisados.

Sua tarefa é expandir SOMENTE as matérias que estão abaixo de 2000 caracteres.

REGRAS:

Cada matéria FINAL precisa possuir entre 2000 e 2200 caracteres.

Não altere o sentido dos fatos.

Não invente informações.

Não invente datas.

Não invente declarações.

Não invente fontes.

Não invente números.

Não invente URLs.

Não adicione acontecimentos não presentes na matéria original.

Acrescente apenas contexto editorial coerente com as informações fornecidas.

Escreva em português brasileiro.

Não utilize travessão.

Não utilize os caracteres:
—
–

Retorne SOMENTE JSON válido.

Formato:

{
  "items": [
    {
      "index": 0,
      "materia": "..."
    }
  ]
}

MATÉRIAS:

${shortItems
  .map(
    (item) => `
INDEX: ${item.index}

CATEGORIA:
${item.categoria}

TÍTULO:
${item.titulo}

MATÉRIA ORIGINAL:
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
      "Gemini não retornou a expansão."
    );
  }

  let correction;

  try {
    correction =
      JSON.parse(
        response.text
      );
  } catch {
    throw new Error(
      "Gemini retornou JSON inválido na expansão."
    );
  }

  if (
    !correction ||
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
      Number(item?.index);

    if (
      Number.isInteger(index) &&
      news[index]
    ) {
      const materia =
        normalizeText(
          item?.materia
        );

      if (materia) {
        news[index].materia =
          materia;
      }
    }
  }

  return news;
}

/*
 * ============================================================
 * HANDLER VERCEL
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
        "Método não permitido.",
    });
  }

  try {
    /*
     * ========================================================
     * API KEY
     * ========================================================
     */

    const apiKey =
      process.env.GOOGLE_GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY;

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

        keyLength:
          apiKey?.length || 0,

        model: MODEL,
      }
    );

    if (!apiKey) {
      return res.status(500).json({
        error:
          "GOOGLE_GEMINI_API_KEY não configurada na Vercel.",
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
      body.prompt ||
      "Gere a edição de hoje da WIRE/GEEK com exatamente 12 notícias reais publicadas nas últimas 24 horas.";

    console.log(
      "WIRE/GEEK: iniciando geração editorial"
    );

    /*
     * ========================================================
     * GERAÇÃO
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

      /*
       * Quota / rate limit
       */

      if (
        error?.status === 429
      ) {
        return res.status(429).json({
          error:
            "Limite ou quota do Gemini atingido.",

          details:
            error?.message ||
            String(error),
        });
      }

      return res.status(502).json({
        error:
          "Erro ao gerar notícias com Gemini.",

        details:
          error?.message ||
          String(error),
      });
    }

    /*
     * ========================================================
     * FORMATO
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
          "Gemini retornou formato de notícias inválido.",
      });
    }

    /*
     * ========================================================
     * NORMALIZAÇÃO
     * ========================================================
     */

    let news =
      normalizeNews(
        data.news
      );

    console.log(
      "WIRE/GEEK: Gemini retornou:",
      news.length,
      "notícias"
    );

    /*
     * ========================================================
     * EXPANSÃO
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

        return res.status(502).json({
          error:
            "Erro ao expandir matérias com Gemini.",

          details:
            error?.message ||
            String(error),
        });
      }
    }

    /*
     * ========================================================
     * NORMALIZAÇÃO FINAL
     * ========================================================
     */

    news =
      normalizeNews(
        news
      );

    /*
     * ========================================================
     * VALIDAÇÃO FINAL
     * ========================================================
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

      return res.status(422).json({
        error:
          "A edição não passou na validação.",

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
     * RESUMO
     * ========================================================
     */

    const summary = {
      total: news.length,

      byCategory: {
        games:
          news.filter(
            (item) =>
              item.categoria ===
              "games"
          ).length,

        geek:
          news.filter(
            (item) =>
              item.categoria ===
              "geek"
          ).length,

        cinema:
          news.filter(
            (item) =>
              item.categoria ===
              "cinema"
          ).length,

        anime:
          news.filter(
            (item) =>
              item.categoria ===
              "anime"
          ).length,
      },
    };

    console.log(
      "WIRE/GEEK: EDIÇÃO VALIDADA",
      summary
    );

    /*
     * ========================================================
     * RESPOSTA
     * ========================================================
     */

    return res.status(200).json({
      testMode: false,

      paidMode: true,

      model: MODEL,

      summary,

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

    return res.status(500).json({
      error:
        error?.message ||
        "Erro interno do servidor.",

      details:
        error?.stack || undefined,
    });
  }
}
