import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3.5-flash";

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
item?.categoria || "geek"
).toLowerCase(),

```
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
```

}));
}

function validateNews(news) {
const errors = [];

if (!Array.isArray(news)) {
return [
"news precisa ser um array.",
];
}

if (news.length !== TOTAL_NEWS) {
errors.push(
`A edicao precisa ter exatamente ${TOTAL_NEWS} noticias. Encontrado: ${news.length}.`
);
}

for (const category of CATEGORIES) {
const count = news.filter(
(item) =>
item.categoria === category
).length;

```
if (
  count !== NEWS_PER_CATEGORY
) {
  errors.push(
    `${category} precisa ter ${NEWS_PER_CATEGORY} noticias. Encontrado: ${count}.`
  );
}
```

}

news.forEach((item, index) => {
const prefix = `Noticia ${index + 1}`;

```
if (!CATEGORIES.includes(item.categoria)) {
  errors.push(
    `${prefix}: categoria invalida.`
  );
}

if (!item.titulo) {
  errors.push(
    `${prefix}: titulo vazio.`
  );
}

if (!item.materia) {
  errors.push(
    `${prefix}: materia vazia.`
  );
}

if (
  item.materia &&
  item.materia.length < 1800
) {
  errors.push(
    `${prefix}: materia muito curta (${item.materia.length} caracteres).`
  );
}

if (
  item.materia &&
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
    `${prefix}: precisa ter 4 highlights.`
  );
}

if (
  !Array.isArray(
    item.hashtags
  ) ||
  item.hashtags.length !== 5
) {
  errors.push(
    `${prefix}: precisa ter 5 hashtags.`
  );
}

if (
  !Array.isArray(
    item.fontes
  ) ||
  item.fontes.length < 1 ||
  item.fontes.length > 3
) {
  errors.push(
    `${prefix}: precisa ter entre 1 e 3 fontes.`
  );
}

if (
  /[—–]/.test(
    JSON.stringify(item)
  )
) {
  errors.push(
    `${prefix}: contem travessao.`
  );
}
```

});

return errors;
}

async function generateNews(
ai,
prompt
) {
const contents = `
Voce e o editor-chefe do WIRE/GEEK.

Sua funcao e produzir uma edicao jornalistica atualizada sobre:

GAMES
GEEK
CINEMA
ANIME

PESQUISA OBRIGATORIA:

Use a busca do Google antes de escrever.

Procure acontecimentos reais e recentes.

Considere somente noticias publicadas hoje ou nas ultimas 24 horas.

Nao invente fatos.

Nao invente datas.

Nao invente fontes.

Nao invente URLs.

Quando uma informacao nao puder ser confirmada, nao utilize essa informacao.

DISTRIBUICAO OBRIGATORIA:

3 noticias de games.
3 noticias de geek.
3 noticias de cinema.
3 noticias de anime.

TOTAL:

12 noticias.

REGRAS EDITORIAIS:

1. Cada noticia deve abordar um fato diferente.
2. Priorize acontecimentos relevantes e recentes.
3. Evite repetir a mesma noticia em fontes diferentes.
4. A materia deve ter aproximadamente 2000 caracteres.
5. A materia deve permanecer entre 1800 e 2300 caracteres.
6. Nao use travessao.
7. Use portugues brasileiro.
8. O texto deve ter tom jornalistico, moderno e envolvente.
9. Nao apresente rumores como fatos.
10. Fontes devem corresponder ao acontecimento informado.
11. URLs das fontes devem ser reais.
12. Highlights devem resumir os pontos principais.
13. Hashtags devem ser relevantes para a noticia.
14. image_query deve ser uma busca curta para encontrar uma imagem relacionada.

FONTES PREFERENCIAIS:

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

Retorne somente JSON valido.

Nao escreva markdown.

Nao escreva:

"```json"

Nao escreva explicacoes antes do JSON.

Nao escreva explicacoes depois do JSON.

O objeto deve possuir exatamente:

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

O array news deve conter exatamente 12 itens.

3 games.
3 geek.
3 cinema.
3 anime.

PEDIDO DO USUARIO:

${
prompt ||
"Gere a edicao de hoje com exatamente 12 noticias reais das ultimas 24 horas."
}
`;

const response =
await ai.models.generateContent({
model: MODEL,

```
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
```

if (!response) {
throw new Error(
"Gemini nao retornou resposta."
);
}

if (!response.text) {
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

```
    text:
      response.text.slice(
        0,
        2000
      ),
  }
);

throw new Error(
  "Gemini retornou JSON invalido."
);
```

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

```
console.log(
  "WIRE/GEEK GEMINI CHECK",
  {
    hasGoogleKey:
      Boolean(
        process.env
          .GOOGLE_GEMINI_API_KEY
      ),

    hasGeminiKey:
      Boolean(
        process.env
          .GEMINI_API_KEY
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
  typeof body.prompt === "string"
    ? body.prompt
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

  const status =
    Number(error?.status);

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
      "Gemini retornou formato de noticias invalido.",
  });
}

const news =
  normalizeNews(
    data.news
  );

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

console.log(
  "WIRE/GEEK: EDICAO GERADA COM SUCESSO",
  {
    total: news.length,
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
```

} catch (error) {
console.error(
"WIRE/GEEK API FATAL ERROR:",
error
);

```
return res.status(500).json({
  error:
    error?.message ||
    "Erro interno do servidor.",
});
```

}
}
