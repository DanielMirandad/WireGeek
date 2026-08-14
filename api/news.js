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
            enum: ["games", "geek", "cinema", "anime"],
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
              required: ["nome", "url", "publicado_em"],
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
  return news.map((item) => ({
    ...item,
    titulo: normalizeText(item.titulo),
    publicado_em: normalizeText(item.publicado_em),
    materia: normalizeText(item.materia),
    highlights: Array.isArray(item.highlights)
      ? item.highlights.map(normalizeText)
      : [],
    hashtags: Array.isArray(item.hashtags)
      ? item.hashtags.map(normalizeText)
      : [],
    fontes: Array.isArray(item.fontes)
      ? item.fontes.map((source) => ({
          nome: normalizeText(source.nome),
          url: String(source.url || "").trim(),
          publicado_em: normalizeText(source.publicado_em),
        }))
      : [],
    image_query: normalizeText(item.image_query),
  }));
}

function validateNews(news) {
  const errors = [];

  if (!Array.isArray(news)) {
    return ["news nao e um array"];
  }

  if (news.length !== 12) {
    errors.push(`Esperadas 12 noticias, recebidas ${news.length}`);
  }

  const counts = {
    games: 0,
    geek: 0,
    cinema: 0,
    anime: 0,
  };

  news.forEach((item, index) => {
    const category = item.categoria;

    if (counts[category] !== undefined) {
      counts[category]++;
    } else {
      errors.push(
        `Noticia ${index + 1}: categoria invalida`
      );
    }

    const length = item.materia.length;

    if (length < 2000 || length > 2200) {
      errors.push(
        `Noticia ${index + 1} "${item.titulo}": ${length} caracteres`
      );
    }

    if (item.highlights.length !== 4) {
      errors.push(
        `Noticia ${index + 1}: highlights != 4`
      );
    }

    if (item.hashtags.length !== 5) {
      errors.push(
        `Noticia ${index + 1}: hashtags != 5`
      );
    }

    if (
      !Array.isArray(item.fontes) ||
      item.fontes.length < 1 ||
      item.fontes.length > 3
    ) {
      errors.push(
        `Noticia ${index + 1}: fontes invalidas`
      );
    }
  });

  for (const category of CATEGORIES) {
    if (counts[category] !== 3) {
      errors.push(
        `${category}: esperadas 3, recebidas ${counts[category]}`
      );
    }
  }

  return errors;
}

async function generateNews(ai, prompt) {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: `
${prompt || "Gere a edicao de hoje com exatamente 12 noticias reais."}

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
      responseMimeType: "application/json",
      responseSchema: NEWS_SCHEMA,
      temperature: 0.4,
      maxOutputTokens: 30000,
    },
  });

  if (!response.text) {
    throw new Error("Gemini nao retornou texto.");
  }

  return JSON.parse(response.text);
}

async function expandShortNews(ai, news) {
  const shortItems = news
    .map((item, index) => ({
      index,
      titulo: item.titulo,
      materia: item.materia,
    }))
    .filter(
      (item) =>
        item.materia.length < 2000
    );

  if (shortItems.length === 0) {
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
          required: ["index", "materia"],
        },
      },
    },
    required: ["items"],
  };

  const response = await ai.models.generateContent({
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
TITULO: ${item.titulo}

MATERIA:
${item.materia}
`
  )
  .join("\n")}
`,
    config: {
      responseMimeType: "application/json",
      responseSchema: correctionSchema,
      temperature: 0.3,
      maxOutputTokens: 18000,
    },
  });

  if (!response.text) {
    throw new Error(
      "Gemini nao retornou a expansao."
    );
  }

  const correction = JSON.parse(response.text);

  if (!Array.isArray(correction.items)) {
    throw new Error(
      "Formato de expansao invalido."
    );
  }

  for (const item of correction.items) {
    const index = Number(item.index);

    if (
      Number.isInteger(index) &&
      news[index]
    ) {
      news[index].materia =
        normalizeText(item.materia);
    }
  }

  return news;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Metodo nao permitido",
    });
  }

  try {
    const apiKey =
  process.env.GOOGLE_GEMINI_API_KEY ||
  process.env.GEMINI_API_KEY;

console.log("GEMINI ENV CHECK:", {
  google: Boolean(process.env.GOOGLE_GEMINI_API_KEY),
  gemini: Boolean(process.env.GEMINI_API_KEY),
  length: apiKey?.length || 0,
});

if (!apiKey) {
  return res.status(500).json({
    error: "GOOGLE_GEMINI_API_KEY nao configurada na Vercel.",
  });
}

    const ai = new GoogleGenAI({
      apiKey,
    });

    const { prompt } = req.body || {};

    let data;

    try {
      data = await generateNews(
        ai,
        prompt
      );
console.error("GEMINI ERROR:", {
  message: error?.message,
  status: error?.status,
  code: error?.code,
  details: error?.details,
});

    if (!data || !Array.isArray(data.news)) {
      return res.status(502).json({
        error:
          "Gemini retornou formato de noticias invalido.",
      });
    }

    let news = normalizeNews(data.news);

    /*
     * Expande todas as materias curtas
     * em uma unica chamada adicional.
     */
    const shortNews = news.filter(
      (item) =>
        item.materia.length < 2000
    );

    if (shortNews.length > 0) {
      try {
        news = await expandShortNews(
          ai,
          news
        );
      } catch (error) {
   console.error("GEMINI GENERATION ERROR:", error?.message || String(error));

        return res.status(502).json({
  error: "Erro ao gerar noticias com Gemini.",
  details: error?.message || String(error),
});
      }
    }

    news = normalizeNews(news);

    const validationErrors =
      validateNews(news);

    if (validationErrors.length > 0) {
      return res.status(422).json({
        error:
          "A edicao nao passou na validacao.",
        details: validationErrors,
        news: news.map((item) => ({
          titulo: item.titulo,
          caracteres:
            item.materia.length,
        })),
      });
    }

    return res.status(200).json({
      text: JSON.stringify({
        news,
      }),
    });
  } catch (error) {
    console.error(
      "WIRE/GEEK GEMINI ERROR:",
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Erro interno do servidor.",
    });
  }
}
