```javascript
import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3.5-flash-lite";

const CATEGORY_ORDER = [
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
            enum: CATEGORY_ORDER,
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
    categoria: normalizeText(
      item?.categoria
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
              source?.url ?? ""
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

function validateNews(news) {
  const errors = [];

  if (!Array.isArray(news)) {
    return [
      "O campo news nao e um array.",
    ];
  }

  if (news.length !== TOTAL_NEWS) {
    errors.push(
      `A edicao precisa conter exatamente ${TOTAL_NEWS} noticias. Encontrado: ${news.length}.`
    );
  }

  for (const category of CATEGORY_ORDER) {
    const count = news.filter(
      (item) =>
        item?.categoria === category
    ).length;

    if (count !== NEWS_PER_CATEGORY) {
      errors.push(
        `"${category}" precisa ter ${NEWS_PER_CATEGORY} noticias. Encontrado: ${count}.`
      );
    }
  }

  news.forEach((item, index) => {
    const prefix = `Noticia ${index + 1}`;

    if (!item?.categoria) {
      errors.push(
        `${prefix}: categoria ausente.`
      );
    }

    if (
      item?.categoria &&
      !CATEGORY_ORDER.includes(
        item.categoria
      )
    ) {
      errors.push(
        `${prefix}: categoria invalida "${item.categoria}".`
      );
    }

    if (!item?.titulo) {
      errors.push(
        `${prefix}: titulo ausente.`
      );
    }

    if (!item?.materia) {
      errors.push(
        `${prefix}: materia ausente.`
      );
    }

    /*
     * Nao rejeitamos a materia por tamanho
     * aqui. O modelo pode retornar pequenos
     * desvios e o frontend pode trabalhar
     * com eles sem derrubar a API.
     */

    if (
      !Array.isArray(
        item?.highlights
      ) ||
      item.highlights.length !== 4
    ) {
      errors.push(
        `${prefix}: precisa ter exatamente 4 highlights.`
      );
    }

    if (
      !Array.isArray(
        item?.hashtags
      ) ||
      item.hashtags.length !== 5
    ) {
      errors.push(
        `${prefix}: precisa ter exatamente 5 hashtags.`
      );
    }

    if (
      !Array.isArray(
        item?.fontes
      ) ||
      item.fontes.length < 1 ||
      item.fontes.length > 3
    ) {
      errors.push(
        `${prefix}: precisa ter entre 1 e 3 fontes.`
      );
    }
  });

  return errors;
}

/*
 * ============================================================
 * EXTRACAO SEGURA DO JSON
 * ============================================================
 *
 * O erro anterior estava acontecendo durante
 * o processamento da resposta do Gemini.
 *
 * Agora tentamos primeiro response.parsed.
 *
 * Se nao existir, usamos response.text.
 *
 * O JSON.parse fica protegido.
 */

function extractGeminiData(response) {
  /*
   * SDK moderno pode fornecer parsed.
   */

  if (
    response?.parsed &&
    typeof response.parsed ===
      "object"
  ) {
    return response.parsed;
  }

  /*
   * Fallback para response.text.
   */

  const text =
    typeof response?.text ===
    "string"
      ? response.text.trim()
      : "";

  if (!text) {
    const finishReason =
      response?.candidates?.[0]
        ?.finishReason;

    throw new Error(
      `Gemini retornou resposta vazia. finishReason=${finishReason || "desconhecido"}`
    );
  }

  /*
   * Primeiro tenta o texto inteiro.
   */

  try {
    return JSON.parse(text);
  } catch (firstError) {
    /*
     * Alguns retornos podem eventualmente
     * conter markdown ao redor do JSON.
     *
     * Tentamos extrair somente o objeto.
     */

    const start =
      text.indexOf("{");

    const end =
      text.lastIndexOf("}");

    if (
      start >= 0 &&
      end > start
    ) {
      const possibleJson =
        text.slice(
          start,
          end + 1
        );

      try {
        return JSON.parse(
          possibleJson
        );
      } catch {
        throw new Error(
          `Gemini retornou JSON invalido: ${firstError.message}`
        );
      }
    }

    throw new Error(
      `Gemini retornou texto que nao e JSON valido: ${firstError.message}`
    );
  }
}

/*
 * ============================================================
 * GERACAO
 * ============================================================
 */

async function generateNews(
  ai,
  prompt
) {
  const contents = `
Voce e o editor-chefe do WIRE/GEEK.

Sua tarefa e produzir uma edicao jornalistica real sobre:

GAMES
GEEK
CINEMA
ANIME

PESQUISA:

Use obrigatoriamente o Google Search antes de escrever.

Procure noticias publicadas hoje ou nas ultimas 24 horas.

Nao invente fatos.

Nao invente fontes.

Nao invente URLs.

Nao invente datas.

Nao transforme rumor em fato.

Se uma informacao nao puder ser confirmada por uma fonte real, nao utilize.

DIVERSIDADE OBRIGATORIA:

3 noticias de games.
3 noticias de geek.
3 noticias de cinema.
3 noticias de anime.

TOTAL:

${TOTAL_NEWS} noticias.

REGRAS DE REDACAO:

1. Cada noticia deve ser factual.
2. O titulo deve ser jornalistico.
3. A materia deve explicar o acontecimento.
4. Informe contexto relevante.
5. Informe impacto ou repercussao quando houver.
6. Nunca use travessao.
7. Use virgulas, pontos, dois-pontos ou parenteses.
8. Cada noticia deve possuir exatamente 4 highlights.
9. Cada noticia deve possuir exatamente 5 hashtags.
10. Cada noticia deve possuir entre 1 e 3 fontes reais.
11. Cada fonte precisa possuir URL real.
12. image_query deve ser uma busca curta e objetiva para encontrar imagem relacionada a noticia.
13. Nao repita a mesma noticia em categorias diferentes.

CATEGORIAS:

GAMES:
jogos, consoles, PC, Xbox, PlayStation,
Nintendo, Steam, trailers, lancamentos,
atualizacoes, industria e esports.

GEEK:
quadrinhos, tecnologia geek, cultura pop,
colecionaveis, eventos, ficcao cientifica,
fantasia e cultura nerd.

CINEMA:
filmes, trailers, lancamentos, franquias,
atores, atrizes, diretores, producoes,
bilheterias, adaptacoes, remakes e sequencias.

ANIME:
animes, mangas, light novels, episodios,
temporadas, adaptacoes, dublagem, filmes,
streaming, Crunchyroll e declaracoes de criadores.

FONTES PRIORITARIAS:

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

FORMATO:

Retorne exclusivamente o objeto JSON definido pelo responseSchema.

Nao escreva explicacoes fora do JSON.

${prompt || "Gere a edicao de hoje com exatamente 12 noticias reais das ultimas 24 horas."}
`;

  const response =
    await ai.models.generateContent({
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

        /*
         * Gemini 3.x:
         * nao utilizar temperature.
         */

        maxOutputTokens: 50000,
      },
    });

  /*
   * Diagnostico controlado.
   */

  console.log(
    "GEMINI RESPONSE CHECK:",
    {
      model: MODEL,

      hasText:
        typeof response?.text ===
        "string" &&
        response.text.length > 0,

      textLength:
        response?.text?.length ||
        0,

      hasParsed:
        Boolean(response?.parsed),

      finishReason:
        response?.candidates?.[0]
          ?.finishReason,

      candidateCount:
        response?.candidates?.length ||
        0,
    }
  );

  return extractGeminiData(
    response
  );
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
   * Somente POST.
   */

  if (req.method !== "POST") {
    return res.status(405).json({
      error:
        "Metodo nao permitido.",
    });
  }

  /*
   * Headers.
   */

  res.setHeader(
    "Cache-Control",
    "no-store"
  );

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

        keyLength:
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
     * CLIENT
     * ========================================================
     */

    const ai =
      new GoogleGenAI({
        apiKey,
      });

    /*
     * ========================================================
     * BODY
     * ========================================================
     */

    const body =
      req.body &&
      typeof req.body ===
        "object"
        ? req.body
        : {};

    const prompt =
      typeof body.prompt ===
      "string"
        ? body.prompt
        : "";

    /*
     * ========================================================
     * GEMINI
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
        "GEMINI GENERATION ERROR:",
        {
          message:
            error?.message ||
            String(error),

          status:
            error?.status,

          code:
            error?.code,

          name:
            error?.name,

          details:
            error?.details,
        }
      );

      /*
       * Rate limit / quota.
       */

      if (
        error?.status === 429 ||
        error?.code === 429
      ) {
        return res.status(429).json({
          error:
            "Limite ou quota do Gemini atingido.",

          details:
            error?.message ||
            String(error),
        });
      }

      /*
       * API key / autenticacao.
       */

      if (
        error?.status === 401 ||
        error?.status === 403 ||
        error?.code === 401 ||
        error?.code === 403
      ) {
        return res.status(502).json({
          error:
            "A API do Gemini recusou a chave configurada.",

          details:
            error?.message ||
            String(error),
        });
      }

      /*
       * Qualquer erro da geracao.
       */

      return res.status(502).json({
        error:
          "Erro ao gerar noticias com Gemini.",

        details:
          error?.message ||
          String(error),
      });
    }

    /*
     * ========================================================
     * VALIDACAO DA ESTRUTURA
     * ========================================================
     */

    if (
      !data ||
      typeof data !== "object"
    ) {
      return res.status(502).json({
        error:
          "Gemini retornou dados invalidos.",
      });
    }

    if (
      !Array.isArray(
        data.news
      )
    ) {
      return res.status(502).json({
        error:
          "Gemini nao retornou o array news.",
      });
    }

    /*
     * ========================================================
     * NORMALIZACAO
     * ========================================================
     */

    const news =
      normalizeNews(
        data.news
      );

    /*
     * ========================================================
     * VALIDACAO EDITORIAL
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
                item.materia
                  ?.length || 0,
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

    return res.status(200).json({
      testMode: false,

      text: JSON.stringify({
        news,
      }),

      news,
    });
  } catch (error) {
    /*
     * ========================================================
     * ERRO FINAL
     * ========================================================
     */

    console.error(
      "WIRE/GEEK API FATAL ERROR:",
      {
        message:
          error?.message ||
          String(error),

        name:
          error?.name,

        stack:
          error?.stack,
      }
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Erro interno do servidor.",

      type:
        error?.name ||
        "InternalServerError",
    });
  }
}
```
