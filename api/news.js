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
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeNews(news) {
  if (!Array.isArray(news)) {
    return [];
  }

  return news.map((item) => ({
    categoria: String(
      item?.categoria ?? "geek"
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
              source?.url ?? ""
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

  for (const category of CATEGORIES) {
    const count = news.filter(
      (item) =>
        item.categoria === category
    ).length;

    if (
      count !== NEWS_PER_CATEGORY
    ) {
      errors.push(
        `A categoria ${category} precisa ter ${NEWS_PER_CATEGORY} noticias. Encontrado: ${count}.`
      );
    }
  }

  news.forEach((item, index) => {
    const prefix = `Noticia ${index + 1}`;

    if (!CATEGORIES.includes(item.categoria)) {
      errors.push(
        `${prefix}: categoria invalida.`
      );
    }

    if (!item.titulo) {
      errors.push(
        `${prefix}: titulo ausente.`
      );
    }

    if (!item.materia) {
      errors.push(
        `${prefix}: materia ausente.`
      );
    }

    if (
      item.materia.length < 1800
    ) {
      errors.push(
        `${prefix}: materia muito curta (${item.materia.length} caracteres).`
      );
    }

    if (
      item.materia.length > 2300
    ) {
      errors.push(
        `${prefix}: materia muito longa (${item.materia.length} caracteres).`
      );
    }

    if (
      !Array.isArray(
        item.highlights
      ) ||
      item.highlights.length !== 4
    ) {
      errors.push(
        `${prefix}: precisa ter exatamente 4 highlights.`
      );
    }

    if (
      !Array.isArray(
        item.hashtags
      ) ||
      item.hashtags.length !== 5
    ) {
      errors.push(
        `${prefix}: precisa ter exatamente 5 hashtags.`
      );
    }

    if (
      !Array.isArray(item.fontes) ||
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

async function generateNews(
  ai,
  prompt
) {
  const contents = `
Voce e o editor-chefe do Wire/Geek, uma publicacao brasileira especializada em games, cultura geek, cinema e anime.

Sua tarefa e produzir uma edicao jornalistica atualizada.

PESQUISE A WEB ANTES DE ESCREVER.

DATA ATUAL:
Use a data atual fornecida pelo sistema.

OBJETIVO:

Produza exatamente ${TOTAL_NEWS} noticias reais e verificaveis.

DISTRIBUICAO OBRIGATORIA:

${NEWS_PER_CATEGORY} noticias de games.
${NEWS_PER_CATEGORY} noticias de geek.
${NEWS_PER_CATEGORY} noticias de cinema.
${NEWS_PER_CATEGORY} noticias de anime.

CATEGORIAS:

GAMES:
Jogos, PlayStation, Xbox, Nintendo, PC, Steam, trailers, lancamentos, atualizacoes, industria, desenvolvedoras, publishers e esports.

GEEK:
Quadrinhos, tecnologia geek, cultura pop, colecionaveis, eventos, ficcao cientifica, fantasia, super-herois e cultura nerd.

CINEMA:
Filmes, trailers, lancamentos, atores, atrizes, diretores, producoes, bilheterias, franquias, remakes, sequencias e adaptacoes.

ANIME:
Anime, manga, light novels, episodios, temporadas, adaptacoes, dublagem, filmes, streaming, Crunchyroll e declaracoes de criadores.

REGRAS:

1. Todas as noticias devem ser reais.
2. Pesquise a web antes de escrever.
3. Priorize acontecimentos publicados hoje ou nas ultimas 24 horas.
4. Nao invente fatos.
5. Nao invente datas.
6. Nao invente fontes.
7. Nao invente URLs.
8. Nao atribua declaracoes sem fonte.
9. Nao use travessao.
10. Use virgulas, pontos, dois-pontos ou parenteses no lugar de travessoes.
11. Cada materia deve ter aproximadamente 1800 a 2200 caracteres.
12. Cada noticia deve ter exatamente 4 highlights.
13. Cada noticia deve ter exatamente 5 hashtags.
14. Cada noticia deve possuir de 1 a 3 fontes.
15. As URLs das fontes devem ser URLs reais encontradas durante a pesquisa.
16. O campo publicado_em deve representar a data ou horario informado pela fonte.
17. O campo image_query deve ser uma consulta curta e objetiva para encontrar uma imagem relacionada a noticia.
18. Nao repita a mesma noticia em categorias diferentes.
19. Evite noticias duplicadas sobre o mesmo acontecimento.
20. Priorize fontes jornalisticas confiaveis.

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

ESTILO:

Escreva em portugues brasileiro.

A voz deve ser jornalistica, moderna, informativa e envolvente.

Nao copie textos das fontes.

Resuma e reescreva os fatos com linguagem propria.

IMPORTANTE SOBRE A RESPOSTA:

Retorne somente o objeto estruturado solicitado.

Nao inclua introducao.

Nao inclua conclusao.

Nao inclua comentarios.

Nao inclua markdown.

Nao inclua blocos de codigo.

Nao escreva a palavra JSON antes da resposta.

Nao escreva explicacoes fora do objeto estruturado.

A resposta deve conter exatamente ${TOTAL_NEWS} noticias.

A distribuicao deve ser:

3 games
3 geek
3 cinema
3 anime

Solicitacao adicional do usuario:

${
  prompt ||
  "Gere a edicao de hoje com exatamente 12 noticias reais."
}
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

        temperature: 0.3,

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
    console.error(
      "GEMINI JSON PARSE ERROR:",
      {
        message:
          error?.message ||
          String(error),

        text:
          response.text.slice(0, 2000),
      }
    );

    throw new Error(
      "Gemini retornou uma resposta que nao pode ser convertida em JSON."
    );
  }

  return parsed;
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error:
        "Metodo nao permitido.",
    });
  }

  try {
    const apiKey =
      process.env.GOOGLE_GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY;

    console.log(
      "WIRE/GEEK GEMINI CHECK:",
      {
        hasGoogleKey:
          Boolean(
            process.env
              .GOOGLE_GEMINI_API_KEY
          ),

        hasGeminiKey:
          Boolean(
            process.env.GEMINI_API_KEY
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

    const ai =
      new GoogleGenAI({
        apiKey,
      });

    const body =
      req.body || {};

    const prompt =
      typeof body.prompt ===
      "string"
        ? body.prompt.trim()
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

      const status =
        Number(
          error?.status
        );

      if (status === 429) {
        return res.status(429).json({
          error:
            "Limite ou quota do Gemini atingido.",

          details:
            error?.message ||
            String(error),
        });
      }

      if (
        status === 401 ||
        status === 403
      ) {
        return res.status(status).json({
          error:
            "A chave da API do Gemini foi recusada.",

          details:
            error?.message ||
            String(error),
        });
      }

      return res.status(502).json({
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
      return res.status(502).json({
        error:
          "Gemini retornou um formato de noticias invalido.",
      });
    }

    const news =
      normalizeNews(
        data.news
      );

    const validationErrors =
      validateNews(news);

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

        news:
          news.map((item) => ({
            categoria:
              item.categoria,

            titulo:
              item.titulo,

            caracteres:
              item.materia.length,
          })),
      });
    }

    console.log(
      "WIRE/GEEK: edicao Gemini OK",
      {
        total:
          news.length,

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
    console.error(
      "WIRE/GEEK API ERROR:",
      {
        message:
          error?.message ||
          String(error),

        stack:
          error?.stack,
      }
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Erro interno do servidor.",
    });
  }
}
```
