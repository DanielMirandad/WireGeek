import { GoogleGenAI } from "@google/genai";

const MODEL =
  process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

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
            items: {
              type: "string",
            },
          },

          hashtags: {
            type: "array",
            items: {
              type: "string",
            },
          },

          fontes: {
            type: "array",
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
    .replace(/[â€”â€“]/g, ",")
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

    fontes: Array.isArray(item?.fontes)
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

function validateNews(news) {
  const errors = [];

  if (!Array.isArray(news)) {
    return [
      "Resposta nao contem um array news.",
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
        item?.categoria === category
    ).length;

    if (count !== NEWS_PER_CATEGORY) {
      errors.push(
        `"${category}" deve ter ${NEWS_PER_CATEGORY} noticias. Encontrado: ${count}.`
      );
    }
  }

  for (const item of news) {
    if (!item?.titulo) {
      errors.push(
        "Existe noticia sem titulo."
      );
      continue;
    }

    if (!item?.materia) {
      errors.push(
        `"${item.titulo}" esta sem materia.`
      );
    }

    if (
      !Array.isArray(
        item.highlights
      ) ||
      item.highlights.length !== 4
    ) {
      errors.push(
        `"${item.titulo}" precisa ter exatamente 4 highlights.`
      );
    }

    if (
      !Array.isArray(
        item.hashtags
      ) ||
      item.hashtags.length !== 5
    ) {
      errors.push(
        `"${item.titulo}" precisa ter exatamente 5 hashtags.`
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

    if (
      item.materia &&
      item.materia.length < 1000
    ) {
      errors.push(
        `"${item.titulo}" possui materia muito curta (${item.materia.length} caracteres).`
      );
    }

    if (
      item.materia &&
      item.materia.length > 2200
    ) {
      errors.push(
        `"${item.titulo}" possui materia muito longa (${item.materia.length} caracteres).`
      );
    }

    for (const source of item.fontes || []) {
      if (!source.nome) {
        errors.push(
          `"${item.titulo}" possui fonte sem nome.`
        );
      }

      if (!source.url) {
        errors.push(
          `"${item.titulo}" possui fonte sem URL.`
        );
      }
    }
  }

  return errors;
}

function extractJson(text) {
  if (!text) {
    return null;
  }

  let cleaned = String(text)
    .replace(/JSON/gi, "")
    .replace(/JavaScript/gi, "")
    .replace(/```(?:json|javascript|js)?/gi, "")
    .trim();

  const firstBrace =
    cleaned.indexOf("{");

  const lastBrace =
    cleaned.lastIndexOf("}");

  if (
    firstBrace >= 0 &&
    lastBrace > firstBrace
  ) {
    cleaned = cleaned.slice(
      firstBrace,
      lastBrace + 1
    );
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function searchNews(ai, prompt) {
  const researchPrompt = `
Voce e o pesquisador-chefe do Wire/Geek.

Sua tarefa e pesquisar noticias REAIS publicadas HOJE ou nas ULTIMAS 24 HORAS.

Use obrigatoriamente a busca na web.

Pesquise exatamente:

3 noticias de GAMES
3 noticias de GEEK
3 noticias de CINEMA
3 noticias de ANIME

Total: 12 noticias.

Priorize fontes confiaveis e recentes.

Fontes preferenciais:

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

Nao invente fatos.

Nao invente datas.

Nao invente URLs.

Nao transforme rumor em fato.

Para cada noticia encontre:

- titulo
- categoria
- data e hora de publicacao
- resumo factual
- URL da fonte
- nome da fonte
- data de publicacao
- informacoes relevantes para uma materia jornalistica

IMPORTANTE:

A noticia precisa ter sido publicada nas ultimas 24 horas.

Se uma fonte estiver fora desse periodo, nao use a noticia.

Nao use travessao.

Use virgulas, pontos, dois-pontos ou parenteses.

O objetivo desta etapa e fornecer material factual para outro modelo redigir a edicao.

Solicitacao adicional do usuario:

${prompt || "Gere a edicao de hoje com exatamente 12 noticias reais."}
`;

  const response =
    await ai.models.generateContent({
      model: MODEL,

      contents: researchPrompt,

      config: {
        tools: [
          {
            googleSearch: {},
          },
        ],


        maxOutputTokens: 12000,
      },
    });

  if (!response?.text) {
    throw new Error(
      "Gemini nao retornou resultado da pesquisa."
    );
  }

  return response.text;
}

async function formatNews(ai, researchText) {
  const formatPrompt = `
Voce e o editor-chefe do Wire/Geek.

Receba abaixo material pesquisado na web.

Transforme esse material em uma edicao jornalistica com exatamente 12 noticias.

DISTRIBUICAO OBRIGATORIA:

3 games
3 geek
3 cinema
3 anime

TOTAL: 12 noticias.

REGRAS:

1. Use somente informacoes presentes no material pesquisado.
2. Nao invente fatos.
3. Nao invente URLs.
4. Nao invente datas.
5. Nao invente fontes.
6. Preserve as URLs encontradas na pesquisa.
7. Nao use travessao.
8. Use virgulas, pontos, dois-pontos ou parenteses.
9. ATENCAO: cada materia DEVE ter entre 1500 e 2100 caracteres. Nunca produza materia com menos de 1500 caracteres. Conte os caracteres da materia antes de finalizar cada noticia. Se a materia estiver abaixo de 1500 caracteres, desenvolva mais o contexto, os fatos, os detalhes e as consequencias presentes no material pesquisado. Nao invente informacoes e nao repita frases artificialmente. O sistema aceita somente materias entre 1000 e 2200 caracteres.Nunca produza uma materia com menos de 1200 caracteres. Nunca ultrapasse 2100 caracteres. O limite de 1000 caracteres e uma regra absoluta de validacao do sistema, portanto mantenha uma margem de seguranca significativa acima dele. Desenvolva a noticia com contexto, fatos principais, detalhes relevantes, contexto adicional e consequencias quando presentes no material pesquisado. Nao preencha artificialmente o texto e nao repita informacoes apenas para atingir o tamanho. Desenvolva a noticia com contexto, fatos principais, detalhes relevantes, contexto adicional e consequencias quando presentes no material pesquisado. Nao preencha artificialmente o texto e nao repita informacoes apenas para atingir o tamanho.
10. Cada noticia deve possuir exatamente 4 highlights. Cada highlight deve ter no maximo 20 palavras e deve ser escrito em portugues brasileiro.
11. Cada noticia deve possuir exatamente 5 hashtags.
12. Cada noticia deve possuir entre 1 e 3 fontes.
13. image_query deve ser uma consulta curta para encontrar uma imagem relacionada ao assunto.
14. Todos os titulos, subtitulos e highlights devem estar em portugues brasileiro. Nunca responda titulo ou subtitulo em ingles.`n15. Responda somente JSON.
15. Nao coloque markdown.
16. Nao coloque json.
17. Nao escreva explicacoes fora do JSON.

FORMATO EXATO:

{
  "news": [
    {
      "categoria": "games",
      "titulo": "Titulo",
      "publicado_em": "Data e hora",
      "materia": "Materia jornalistica",
      "highlights": [
        "Destaque 1",
        "Destaque 2",
        "Destaque 3",
        "Destaque 4"
      ],
      "hashtags": [
        "#Games",
        "#Gaming",
        "#WireGeek",
        "#Noticias",
        "#Tecnologia"
      ],
      "fontes": [
        {
          "nome": "Nome da fonte",
          "url": "https://...",
          "publicado_em": "Data e hora"
        }
      ],
      "image_query": "consulta para imagem"
    }
  ]
}

MATERIAL PESQUISADO:

${researchText}
`;

  const response =
    await ai.models.generateContent({
      model: MODEL,

      contents: formatPrompt,

      config: {
        responseMimeType:
          "application/json",

        responseSchema:
          NEWS_SCHEMA,


        maxOutputTokens: 20000,
      },
    });

  if (!response?.text) {
    throw new Error(
      "Gemini nao retornou o JSON editorial."
    );
  }

  const parsed =
    extractJson(response.text);

  if (!parsed) {
    throw new Error(
      "Gemini retornou JSON invalido."
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
      error: "Metodo nao permitido.",
    });
  }

  try {
    const apiKey =
      process.env.GOOGLE_GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY;

    console.log(
      "WIRE/GEEK GEMINI ENV:",
      {
        google:
          Boolean(
            process.env
              .GOOGLE_GEMINI_API_KEY
          ),

        gemini:
          Boolean(
            process.env.GEMINI_API_KEY
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
      body.prompt ||
      "Gere a edicao de hoje com exatamente 12 noticias reais.";

    console.log(
      "WIRE/GEEK: iniciando pesquisa Gemini."
    );

    const researchText =
      await searchNews(
        ai,
        prompt
      );

    console.log(
      "WIRE/GEEK: pesquisa Gemini concluida.",
      {
        caracteres:
          researchText.length,
      }
    );

    const formatted =
      await formatNews(
        ai,
        researchText
      );

    const news =
      normalizeNews(
        formatted.news
      );

    const validationErrors =
      validateNews(news);

    if (validationErrors.length) {
      console.error(
        "WIRE/GEEK: validacao falhou.",
        validationErrors
      );

      return res.status(502).json({
        error:
          "Gemini retornou uma edicao fora do formato esperado.",
        details:
          validationErrors,
        partial:
          news.length
            ? {
                news,
              }
            : undefined,
      });
    }

    console.log(
      "WIRE/GEEK: edicao Gemini OK.",
      {
        quantidade: news.length,

        categorias:
          CATEGORIES.reduce(
            (result, category) => {
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

    return res.status(200).json({
      success: true,

      model: MODEL,

      text: JSON.stringify(
        {
          news,
        }
      ),
    });
  } catch (error) {
    console.error(
      "WIRE/GEEK GEMINI ERROR:",
      {
        name: error?.name,
        message:
          error?.message ||
          String(error),
        stack: error?.stack,
      }
    );

    const message =
      error?.message ||
      String(error);

    if (
      message.includes("429") ||
      message
        .toLowerCase()
        .includes("quota") ||
      message
        .toLowerCase()
        .includes("resource_exhausted") ||
      message
        .toLowerCase()
        .includes("prepayment")
    ) {
      return res.status(429).json({
        error:
          "Limite ou quota do Gemini atingido.",
        details: message,
      });
    }

    if (
      message.includes("400") ||
      message
        .toLowerCase()
        .includes(
          "invalid argument"
        )
    ) {
      return res.status(500).json({
        error:
          "Gemini rejeitou os parametros da requisicao.",
        details: message,
        model: MODEL,
      });
    }

    return res.status(500).json({
      error:
        "Erro interno ao executar o Gemini.",
      details: message,
    });
  }
}







