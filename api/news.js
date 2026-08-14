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

    titulo: normalizeText(item?.titulo),

    publicado_em: normalizeText(
      item?.publicado_em
    ),

    materia: normalizeText(item?.materia),

    highlights: Array.isArray(item?.highlights)
      ? item.highlights
          .map(normalizeText)
          .filter(Boolean)
          .slice(0, 4)
      : [],

    hashtags: Array.isArray(item?.hashtags)
      ? item.hashtags
          .map(normalizeText)
          .filter(Boolean)
          .slice(0, 5)
      : [],

    fontes: Array.isArray(item?.fontes)
      ? item.fontes
          .slice(0, 3)
          .map((source) => ({
            nome: normalizeText(source?.nome),
            url: String(source?.url || "").trim(),
            publicado_em: normalizeText(
              source?.publicado_em
            ),
          }))
      : [],

    image_query: normalizeText(
      item?.image_query || item?.titulo
    ),
  }));
}

function extractJson(text) {
  if (!text) {
    throw new Error(
      "Gemini nao retornou texto."
    );
  }

  let cleaned = String(text).trim();

  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (
    firstBrace !== -1 &&
    lastBrace !== -1 &&
    lastBrace > firstBrace
  ) {
    cleaned = cleaned.slice(
      firstBrace,
      lastBrace + 1
    );
  }

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    console.error(
      "JSON PARSE ERROR:",
      {
        message: error?.message,
        preview: cleaned.slice(0, 1000),
      }
    );

    throw new Error(
      "Gemini retornou JSON invalido."
    );
  }
}

function validateNews(news) {
  const errors = [];

  if (!Array.isArray(news)) {
    return ["news nao e um array."];
  }

  if (news.length !== TOTAL_NEWS) {
    errors.push(
      `A edicao precisa conter exatamente ${TOTAL_NEWS} noticias. Encontrado: ${news.length}.`
    );
  }

  for (const category of CATEGORIES) {
    const count = news.filter(
      (item) =>
        item?.categoria === category
    ).length;

    if (count !== NEWS_PER_CATEGORY) {
      errors.push(
        `${category} deve conter exatamente ${NEWS_PER_CATEGORY} noticias. Encontrado: ${count}.`
      );
    }
  }

  for (const item of news) {
    if (!item?.categoria) {
      errors.push(
        "Noticia sem categoria."
      );
      continue;
    }

    if (!CATEGORIES.includes(item.categoria)) {
      errors.push(
        `Categoria invalida: ${item.categoria}.`
      );
    }

    if (!item.titulo) {
      errors.push(
        "Noticia sem titulo."
      );
    }

    if (!item.materia) {
      errors.push(
        `"${item.titulo}" esta sem materia.`
      );
    }

    if (
      item.materia &&
      item.materia.length < 1800
    ) {
      errors.push(
        `"${item.titulo}" possui apenas ${item.materia.length} caracteres.`
      );
    }

    if (
      Array.isArray(item.highlights) &&
      item.highlights.length !== 4
    ) {
      errors.push(
        `"${item.titulo}" precisa ter 4 highlights.`
      );
    }

    if (
      Array.isArray(item.hashtags) &&
      item.hashtags.length !== 5
    ) {
      errors.push(
        `"${item.titulo}" precisa ter 5 hashtags.`
      );
    }

    if (
      !Array.isArray(item.fontes) ||
      item.fontes.length < 1 ||
      item.fontes.length > 3
    ) {
      errors.push(
        `"${item.titulo}" precisa ter entre 1 e 3 fontes.`
      );
    }
  }

  return errors;
}

async function generateNews(ai, prompt) {
  const contents = `
Voce e o editor-chefe do Wire/Geek, um portal brasileiro especializado em games, cultura geek, cinema e anime.

Sua tarefa e produzir uma edicao jornalistica atualizada.

Pesquise a web antes de escrever.

REQUISITOS OBRIGATORIOS:

1. Retorne exatamente 12 noticias.
2. Retorne exatamente 3 noticias de games.
3. Retorne exatamente 3 noticias de geek.
4. Retorne exatamente 3 noticias de cinema.
5. Retorne exatamente 3 noticias de anime.
6. Priorize noticias publicadas hoje ou nas ultimas 24 horas.
7. Nao invente fatos.
8. Nao invente fontes.
9. Nao invente URLs.
10. Nao invente datas.
11. Nao use travessao.
12. Use virgulas, pontos, dois-pontos ou parenteses no lugar de travessoes.
13. Cada noticia deve possuir 4 highlights.
14. Cada noticia deve possuir 5 hashtags.
15. Cada noticia deve possuir entre 1 e 3 fontes.
16. A materia deve ser jornalistica, clara e informativa.
17. O campo image_query deve descrever uma busca adequada para encontrar imagem relacionada a noticia.

CATEGORIAS:

GAMES:
jogos, consoles, PC, PlayStation, Xbox, Nintendo, Steam, trailers, lancamentos, atualizacoes, industria e esports.

GEEK:
quadrinhos, tecnologia geek, cultura pop, colecionaveis, eventos, ficcao cientifica, fantasia e cultura nerd.

CINEMA:
filmes, trailers, lancamentos, franquias, atores, atrizes, diretores, producoes, bilheterias, adaptacoes, remakes e sequencias.

ANIME:
anime, manga, light novels, episodios, temporadas, adaptacoes, dublagem, filmes, streaming, Crunchyroll e noticias relacionadas a criadores.

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

Retorne somente um objeto JSON.

Nao utilize blocos Markdown.

Nao escreva explicacoes antes do JSON.

Nao escreva explicacoes depois do JSON.

O objeto precisa seguir exatamente o schema fornecido pela API.

PEDIDO DO USUARIO:

${
  prompt ||
  "Gere a edicao de hoje com exatamente 12 noticias reais das ultimas 24 horas."
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

  return extractJson(response.text);
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Metodo nao permitido.",
    });
  }

  try {
    const apiKey =
      process.env.GOOGLE_GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY;

    console.log(
      "WIRE/GEEK GEMINI CHECK:",
      {
        hasGoogleKey: Boolean(
          process.env.GOOGLE_GEMINI_API_KEY
        ),
        hasGeminiKey: Boolean(
          process.env.GEMINI_API_KEY
        ),
        hasApiKey: Boolean(apiKey),
        model: MODEL,
      }
    );

    if (!apiKey) {
      return res.status(500).json({
        error:
          "GOOGLE_GEMINI_API_KEY nao configurada na Vercel.",
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
    });

    const body =
      req.body || {};

    const data =
      await generateNews(
        ai,
        body.prompt
      );

    if (
      !data ||
      !Array.isArray(data.news)
    ) {
      return res.status(502).json({
        error:
          "Gemini retornou formato de noticias invalido.",
      });
    }

    const news =
      normalizeNews(data.news);

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
      "WIRE/GEEK GEMINI OK:",
      {
        total: news.length,
        games: news.filter(
          (item) =>
            item.categoria === "games"
        ).length,
        geek: news.filter(
          (item) =>
            item.categoria === "geek"
        ).length,
        cinema: news.filter(
          (item) =>
            item.categoria === "cinema"
        ).length,
        anime: news.filter(
          (item) =>
            item.categoria === "anime"
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
      "WIRE/GEEK GEMINI ERROR:",
      {
        message:
          error?.message ||
          String(error),

        status:
          error?.status,

        code:
          error?.code,

        stack:
          error?.stack,
      }
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Erro interno do servidor.",

      details:
        error?.status ||
        error?.code ||
        undefined,
    });
  }
}
