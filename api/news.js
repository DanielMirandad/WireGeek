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
categoria: String(item?.categoria || "geek")
.toLowerCase()
.trim(),

titulo: normalizeText(item?.titulo),

publicado_em: normalizeText(item?.publicado_em),

materia: normalizeText(item?.materia),

highlights: Array.isArray(item?.highlights)
  ? item.highlights
      .map(normalizeText)
      .slice(0, 4)
  : [],

hashtags: Array.isArray(item?.hashtags)
  ? item.hashtags
      .map(normalizeText)
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

function validateNews(news) {
const errors = [];

if (!Array.isArray(news)) {
return ["Resposta nao contem um array news."];
}

if (news.length !== TOTAL_NEWS) {
errors.push(
A edicao precisa conter exatamente ${TOTAL_NEWS} noticias. Encontrado: ${news.length}.
);
}

for (const category of CATEGORIES) {
const count = news.filter(
(item) => item?.categoria === category
).length;

if (count !== NEWS_PER_CATEGORY) {
  errors.push(
    `"${category}" deve ter ${NEWS_PER_CATEGORY} noticias. Encontrado: ${count}.`
  );
}

}

for (const item of news) {
if (!item?.titulo) {
errors.push("Existe noticia sem titulo.");
continue;
}

if (!item?.materia) {
  errors.push(
    `"${item.titulo}" esta sem materia.`
  );
}

if (
  !Array.isArray(item.highlights) ||
  item.highlights.length !== 4
) {
  errors.push(
    `"${item.titulo}" precisa ter exatamente 4 highlights.`
  );
}

if (
  !Array.isArray(item.hashtags) ||
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
  item.materia.length < 1800
) {
  errors.push(
    `"${item.titulo}" possui apenas ${item.materia.length} caracteres.`
  );
}

if (
  item.materia &&
  item.materia.length > 2400
) {
  errors.push(
    `"${item.titulo}" possui ${item.materia.length} caracteres.`
  );
}

}

return errors;
}

async function generateNews(ai, prompt) {
const contents = `
Voce e o editor-chefe do Wire/Geek, uma redacao brasileira especializada em games, cultura geek, cinema e anime.

OBJETIVO:

Produza exatamente ${TOTAL_NEWS} noticias reais e atuais.

DISTRIBUICAO OBRIGATORIA:

${NEWS_PER_CATEGORY} noticias de games.
${NEWS_PER_CATEGORY} noticias de geek.
${NEWS_PER_CATEGORY} noticias de cinema.
${NEWS_PER_CATEGORY} noticias de anime.

ATUALIDADE:

Pesquise a web antes de escrever.

Priorize noticias publicadas hoje ou nas ultimas 24 horas.

Nao invente fatos.

Nao invente datas.

Nao invente declaracoes.

Nao invente fontes.

Nao invente URLs.

Use somente informacoes que possam ser verificadas nas fontes encontradas.

ESTILO:

Escreva em portugues brasileiro.

O texto deve ter estilo jornalistico moderno, claro e envolvente.

Pode ter personalidade editorial, mas os fatos precisam permanecer verificaveis.

Nao use travessao.

Use virgulas, pontos, dois-pontos e parenteses quando necessario.

ESTRUTURA:

Cada noticia deve conter:

categoria
titulo
publicado_em
materia
highlights
hashtags
fontes
image_query

A materia deve ter aproximadamente entre 1800 e 2200 caracteres.

Cada noticia deve possuir exatamente 4 highlights.

Cada noticia deve possuir exatamente 5 hashtags.

Cada noticia deve possuir entre 1 e 3 fontes.

Cada fonte deve possuir:

nome
url
publicado_em

CATEGORIAS:

GAMES:
jogos, consoles, PC, Xbox, PlayStation, Nintendo, Steam, trailers, lancamentos, atualizacoes, industria e esports.

GEEK:
quadrinhos, tecnologia geek, cultura pop, colecionaveis, eventos, ficcao cientifica, fantasia e cultura nerd.

CINEMA:
filmes, trailers, lancamentos, franquias, atores, atrizes, diretores, producoes, bilheterias, adaptacoes, remakes e sequencias.

ANIME:
animes, mangas, light novels, episodios, temporadas, adaptacoes, dublagem, filmes, streaming, Crunchyroll e declaracoes de criadores.

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

IMPORTANTE:

Retorne somente o objeto JSON solicitado.

Nao inclua Markdown.

Nao inclua blocos de codigo.

Nao inclua comentarios.

Nao inclua texto antes do JSON.

Nao inclua texto depois do JSON.

A resposta deve ser um JSON valido.
`;

const response = await ai.models.generateContent({
model: MODEL,

contents: `

${prompt || "Gere a edicao de hoje com exatamente 12 noticias reais."}

${contents}
`,

config: {
  tools: [
    {
      googleSearch: {},
    },
  ],

  responseMimeType: "application/json",

  responseSchema: NEWS_SCHEMA,

  temperature: 0.3,

  maxOutputTokens: 30000,
},

});

if (!response.text) {
throw new Error(
"Gemini nao retornou texto."
);
}

let data;

try {
data = JSON.parse(response.text);
} catch (error) {
console.error(
"GEMINI JSON PARSE ERROR:",
response.text.slice(0, 2000)
);

throw new Error(
  "Gemini retornou JSON invalido."
);

}

return data;
}

export default async function handler(req, res) {
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
    configured: Boolean(apiKey),
    googleConfigured: Boolean(
      process.env.GOOGLE_GEMINI_API_KEY
    ),
    geminiConfigured: Boolean(
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

const ai = new GoogleGenAI({
  apiKey,
});

const body = req.body || {};

const prompt =
  typeof body.prompt === "string"
    ? body.prompt.trim()
    : "";

console.log(
  "WIRE/GEEK: iniciando geracao Gemini"
);

const data = await generateNews(
  ai,
  prompt
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

const news = normalizeNews(
  data.news
);

const validationErrors =
  validateNews(news);

if (validationErrors.length > 0) {
  console.error(
    "WIRE/GEEK VALIDATION ERROR:",
    validationErrors
  );

  return res.status(422).json({
    error:
      "A edicao nao passou na validacao.",

    details: validationErrors,

    news: news.map((item) => ({
      categoria: item.categoria,
      titulo: item.titulo,
      caracteres:
        item.materia.length,
    })),
  });
}

console.log(
  "WIRE/GEEK: GEMINI OK",
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

if (error?.status === 429) {
  return res.status(429).json({
    error:
      "Limite ou quota do Gemini atingido.",
    details:
      error?.message ||
      String(error),
  });
}

return res.status(500).json({
  error:
    error?.message ||
    "Erro interno do servidor.",
});

}
}
