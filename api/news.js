import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3.5-flash-lite";

const TEST_MODE = true;

const TEST_SCHEMA = {
  type: "object",
  properties: {
    news: {
      type: "array",
      minItems: 1,
      maxItems: 1,
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
            maxItems: 1,
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
          publicado_em: normalizeText(
            source.publicado_em
          ),
        }))
      : [],
    image_query: normalizeText(item.image_query),
  }));
}

async function generateTestNews(ai) {
  const response = await ai.models.generateContent({
    model: MODEL,

    contents: `
Voce e o editor do Wire/Geek.

Gere APENAS UMA noticia curta sobre GAMES, GEEK, CINEMA ou ANIME.

IMPORTANTE:

Esta e uma requisicao de TESTE.

Nao use busca na web nesta etapa.

Nao invente uma noticia apresentada como fato real.

Use um tema conhecido apenas para testar a resposta da API.

A materia deve ter aproximadamente 500 caracteres.

Nao use travessao.

Retorne somente JSON valido.
`,

    config: {
      responseMimeType: "application/json",
      responseSchema: TEST_SCHEMA,

      temperature: 0.2,

      maxOutputTokens: 1200,
    },
  });

  if (!response.text) {
    throw new Error(
      "Gemini nao retornou texto."
    );
  }

  return JSON.parse(response.text);
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

    console.log(
      "GEMINI TEST ENV CHECK:",
      {
        google: Boolean(
          process.env.GOOGLE_GEMINI_API_KEY
        ),
        gemini: Boolean(
          process.env.GEMINI_API_KEY
        ),
        length: apiKey?.length || 0,
        model: MODEL,
        testMode: TEST_MODE,
      }
    );

    if (!apiKey) {
      return res.status(500).json({
        error:
          "GEMINI_API_KEY nao configurada na Vercel.",
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
    });

    if (TEST_MODE) {
      console.log(
        "WIRE/GEEK: TESTE GRATUITO GEMINI"
      );

      try {
        const data =
          await generateTestNews(ai);

        if (
          !data ||
          !Array.isArray(data.news)
        ) {
          return res.status(502).json({
            error:
              "Gemini retornou formato invalido.",
          });
        }

        const news =
          normalizeNews(data.news);

        console.log(
          "WIRE/GEEK: TESTE GEMINI OK",
          {
            quantidade: news.length,
            caracteres:
              news[0]?.materia?.length || 0,
          }
        );

        return res.status(200).json({
          test: true,
          message:
            "Teste Gemini executado com sucesso.",
          text: JSON.stringify({
            news,
          }),
        });
      } catch (error) {
        console.error(
          "GEMINI TEST ERROR:",
          error?.message ||
            String(error)
        );

        return res.status(502).json({
          error:
            "Erro no teste do Gemini.",
          details:
            error?.message ||
            String(error),
        });
      }
    }

    return res.status(500).json({
      error:
        "Modo de teste desativado incorretamente.",
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
