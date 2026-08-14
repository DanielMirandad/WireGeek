javascript
import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3.5-flash-lite";

const CATEGORIES = ["games", "geek", "cinema", "anime"];

const NEWS_SCHEMA = {
  type: "object",
  properties: {
    news: {
      type: "array",
      minItems: 12,
      maxItems: 12,
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
      item?.categoria || "geek"
    ).toLowerCase(),

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
            .slice(0, 4)
        : [],

    hashtags:
      Array.isArray(item?.hashtags)
        ? item.hashtags
            .map(normalizeText)
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
 * ============================================================
 * VALIDACAO
 * ============================================================
 */

function validateEdition(news, isTestMode = false) {
  if (!Array.isArray(news)) {
    return "Noticias invalidas.";
  }

  // MODO DE TESTE
  if (isTestMode) {
    if (news.length !== 1) {
      return "O modo de teste precisa retornar exatamente 1 noticia.";
    }

    const item = news[0];

    if (!item) {
      return "Noticia de teste inexistente.";
    }

    if (!CATEGORY_ORDER.includes(item.categoria)) {
      return `Categoria invalida: ${item.categoria}.`;
    }

    if (!item.titulo || !item.materia) {
      return "Noticia de teste sem titulo ou materia.";
    }

    if (!Array.isArray(item.highlights) || item.highlights.length !== 4) {
      return "A noticia de teste precisa ter exatamente 4 highlights.";
    }

    if (!Array.isArray(item.hashtags) || item.hashtags.length !== 5) {
      return "A noticia de teste precisa ter exatamente 5 hashtags.";
    }

    if (!Array.isArray(item.fontes) || item.fontes.length < 1) {
      return "A noticia de teste precisa ter pelo menos 1 fonte.";
    }

    return null;
  }

  // MODO NORMAL
  const expectedTotal =
    CATEGORY_ORDER.length * NEWS_PER_CATEGORY;

  if (news.length !== expectedTotal) {
    return `A edicao precisa conter exatamente ${expectedTotal} noticias.`;
  }

  for (const cat of CATEGORY_ORDER) {
    const count = news.filter(
      (item) => item.categoria === cat
    ).length;

    if (count !== NEWS_PER_CATEGORY) {
      return `"${cat}" deve ter ${NEWS_PER_CATEGORY} noticias (encontrado: ${count}).`;
    }
  }

  for (const item of news) {
    if (!item.titulo || !item.materia) {
      return "Noticia sem titulo ou materia.";
    }

    if (item.materia.length < 2000) {
      return `"${item.titulo}" precisa ter pelo menos 2000 caracteres. Encontrado: ${item.materia.length}.`;
    }

    if (item.materia.length > 2200) {
      return `"${item.titulo}" ultrapassa o limite de 2200 caracteres. Encontrado: ${item.materia.length}.`;
    }

    if (
      !Array.isArray(item.highlights) ||
      item.highlights.length !== 4
    ) {
      return `"${item.titulo}" precisa de 4 highlights.`;
    }

    if (
      !Array.isArray(item.hashtags) ||
      item.hashtags.length !== 5
    ) {
      return `"${item.titulo}" precisa de 5 hashtags.`;
    }

    if (
      !Array.isArray(item.fontes) ||
      item.fontes.length < 1 ||
      item.fontes.length > 3
    ) {
      return `"${item.titulo}" precisa ter entre 1 e 3 fontes.`;
    }
  }

  return null;
}

/*
 * ============================================================
 * NOTICIA LOCAL DE TESTE
 * ============================================================
 *
 * IMPORTANTE:
 *
 * Esta funcao NAO chama Gemini.
 * Esta funcao NAO acessa API KEY.
 * Esta funcao NAO consulta Google.
 * Esta funcao NAO consome quota.
 */

function createTestEdition() {
  const news = [
    {
      categoria: "geek",

      titulo:
        "WIRE/GEEK EM MODO DE TESTE GRATUITO",

      publicado_em:
        "Modo de teste",

      materia:
        "Esta e uma noticia de teste do sistema Wire/Geek. O objetivo deste conteudo e verificar se a comunicacao entre a interface React e o backend esta funcionando corretamente sem depender do Gemini ou de qualquer credito de API. Neste modo, o servidor cria uma noticia localmente e devolve o mesmo formato de dados utilizado pela edicao completa. Isso permite testar a renderizacao dos cards, os filtros por categoria, a exibicao da materia, os highlights, as hashtags, as fontes e a integracao visual dos banners. O modo de teste tambem serve para confirmar que o endpoint /api/news esta acessivel na Vercel e que a aplicacao consegue interpretar corretamente a resposta JSON. Nenhuma chamada externa de inteligencia artificial e realizada durante este processo. Portanto, este teste nao deve consumir a quota do Gemini nem depender de uma conta de faturamento ativa. Quando o teste estiver funcionando, o sistema pode voltar ao modo editorial normal, no qual o backend consulta o modelo configurado e produz a edicao completa com doze noticias divididas entre games, geek, cinema e anime. Enquanto isso, esta resposta permite identificar problemas de integracao antes de gastar qualquer credito. Se esta noticia aparecer corretamente na tela, significa que o caminho principal entre o navegador, a funcao serverless e o processamento do JSON esta operacional. O proximo passo sera conectar novamente a geracao real de noticias, mantendo este modo de teste como uma alternativa segura para diagnostico.",

      highlights: [
        "Wire/Geek esta funcionando em modo de teste gratuito.",
        "Nenhuma chamada ao Gemini foi realizada.",
        "O backend respondeu com uma noticia local.",
        "O sistema esta pronto para o proximo teste.",
      ],

      hashtags: [
        "#WireGeek",
        "#BagacaStudios",
        "#Geek",
        "#News",
        "#Teste",
      ],

      fontes: [
        {
          nome:
            "Wire/Geek Teste Local",

          url:
            "https://github.com/DanielMirandad/WireGeek",

          publicado_em:
            "Modo de teste",
        },
      ],

      image_query:
        "geek technology newsroom gaming entertainment",
    },
  ];

  return {
    news,
  };
}

/*
 * ============================================================
 * GEMINI
 * ============================================================
 */

async function generateNews(
  ai,
  prompt
) {
  const response =
    await ai.models.generateContent({
      model: MODEL,

      contents: `
${
  prompt ||
  "Gere a edicao de hoje com exatamente 12 noticias reais."
}

IMPORTANTE:

Pesquise a web antes de escrever.

A edicao precisa conter:

3 games
3 geek
3 cinema
3 anime

Cada materia deve ter entre 2000 e 2200 caracteres.

Nao use travessao.

Nao invente fatos, datas, fontes ou URLs.

Retorne somente o objeto JSON solicitado.
`,

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

  return JSON.parse(
    response.text
  );
}

/*
 * ============================================================
 * EXPANSAO
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
          item.materia.length < 2000
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
Expanda as materias abaixo.

Cada materia FINAL precisa ter obrigatoriamente entre 2000 e 2200 caracteres.

Nao altere o sentido dos fatos.

Nao invente informacoes.

Nao invente datas.

Nao invente declaracoes.

Nao invente fontes.

Acrescente contexto, impacto, repercussao e analise jornalistica quando necessario.

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

        temperature: 0.3,

        maxOutputTokens: 18000,
      },
    });

  if (!response.text) {
    throw new Error(
      "Gemini nao retornou a expansao."
    );
  }

  const correction =
    JSON.parse(
      response.text
    );

  if (
    !Array.isArray(
      correction.items
    )
  ) {
    throw new Error(
      "Formato de expansao invalido."
    );
  }

  for (
    const item of correction.items
  ) {
    const index =
      Number(item.index);

    if (
      Number.isInteger(index) &&
      news[index]
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
 * API HANDLER
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

  /*
   * ==========================================================
   * TEST MODE
   * ==========================================================
   *
   * ATENCAO:
   *
   * Este bloco vem ANTES de qualquer acesso ao Gemini.
   *
   * Portanto:
   *
   * testMode=true
   *       |
   *       +--> cria noticia local
   *       |
   *       +--> valida
   *       |
   *       +--> responde
   *
   * Gemini nao participa.
   */

  const body =
    req.body || {};

  const testMode =
    body.testMode === true;

  if (testMode) {
    console.log(
      "WIRE/GEEK: TEST MODE ATIVO"
    );

    try {
      const data =
        createTestEdition();

      const news =
        normalizeNews(
          data.news
        );

      const validationErrors =
        validateNews(
          news,
          true
        );

      if (
        validationErrors.length > 0
      ) {
        console.error(
          "TEST MODE VALIDATION ERROR:",
          validationErrors
        );

        return res
          .status(500)
          .json({
            testMode: true,

            error:
              "Edicao de teste invalida.",

            details:
              validationErrors,
          });
      }

      console.log(
        "WIRE/GEEK: TEST MODE OK"
      );

      return res
        .status(200)
        .json({
          testMode: true,

          text: JSON.stringify({
            news,
          }),

          news,
        });
    } catch (error) {
      console.error(
        "WIRE/GEEK TEST MODE ERROR:",
        error
      );

      return res
        .status(500)
        .json({
          testMode: true,

          error:
            "Erro no modo de teste.",

          details:
            error?.message ||
            String(error),
        });
    }
  }

  /*
   * ==========================================================
   * MODO NORMAL
   * ==========================================================
   *
   * Somente daqui para baixo o Gemini pode ser utilizado.
   */

  try {
    const apiKey =
      process.env
        .GOOGLE_GEMINI_API_KEY ||
      process.env
        .GEMINI_API_KEY;

    console.log(
      "GEMINI ENV CHECK:",
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
      }
    );

    if (!apiKey) {
      return res
        .status(500)
        .json({
          error:
            "GEMINI_API_KEY nao configurada na Vercel.",
        });
    }

    const ai =
      new GoogleGenAI({
        apiKey,
      });

    const {
      prompt,
    } = body;

    let data;

    /*
     * Geracao principal
     */

    try {
      data =
        await generateNews(
          ai,
          prompt
        );
    } catch (error) {
      console.error(
        "GEMINI GENERATION ERROR:",
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
       * 429 = quota/rate limit
       */

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

            testModeAvailable:
              true,
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
     * Verificacao da resposta
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
     * Expansao das materias curtas
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
          "GEMINI EXPANSION ERROR:",
          error
        );

        return res
          .status(502)
          .json({
            error:
              "Erro ao expandir noticias com Gemini.",

            details:
              error?.message ||
              String(error),
          });
      }
    }

    /*
     * Normalizacao final
     */

    news =
      normalizeNews(
        news
      );

    /*
     * Validacao final
     */

    const validationErrors =
      validateNews(
        news,
        false
      );

    if (
      validationErrors.length > 0
    ) {
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
                titulo:
                  item.titulo,

                categoria:
                  item.categoria,

                caracteres:
                  item.materia.length,
              })
            ),
        });
    }

    /*
     * Sucesso
     */

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
      "WIRE/GEEK GEMINI ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        error:
          error?.message ||
          "Erro interno do servidor.",

        details:
          error?.stack || undefined,
      });
  }
}
```
