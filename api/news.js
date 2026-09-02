import { GoogleGenAI } from "@google/genai";
import { XMLParser } from "fast-xml-parser";
import { persistEdition } from "./persistence.js";

const MODEL =
  process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

const CATEGORIES = [
  "games",
  "geek",
  "cinema",
  "anime",
];


const MIN_ARTICLE_CHARS = 700;
const MAX_ARTICLE_CHARS = 2000;
const MIN_HIGHLIGHT_WORDS = 10;
const MAX_HIGHLIGHT_WORDS = 20;
const RESEARCH_WINDOW_HOURS = 48;

const MIN_NEWS = 6;
const MAX_NEWS = 12;

const CATEGORY_LABELS = {
  games: "Games",
  geek: "Geek / Tecnologia",
  cinema: "Cinema",
  anime: "Anime",
};
/*
 * ============================================================
 * RESEARCH SCHEMA
 * ============================================================
 */

const RESEARCH_SCHEMA = {
  type: "object",

  properties: {
    candidatos: {
      type: "array",

      items: {
        type: "object",

        properties: {
          titulo: {
            type: "string",
          },

         categoria: {
  type: "string",
  enum: CATEGORIES,
},

          publicado_em: {
            type: "string",
          },

          resumo: {
            type: "string",
          },

          url: {
            type: "string",
          },

          fonte: {
            type: "string",
          },

          pessoas_envolvidas: {
            type: "array",
            items: {
              type: "string",
            },
          },

          empresas_envolvidas: {
            type: "array",
            items: {
              type: "string",
            },
          },

          fatos_confirmados: {
            type: "array",
            items: {
              type: "string",
            },
          },

          datas_mencionadas: {
            type: "array",
            items: {
              type: "string",
            },
          },

          numeros_mencionados: {
            type: "array",
            items: {
              type: "string",
            },
          },

          declaracoes: {
            type: "array",
            items: {
              type: "string",
            },
          },

          contexto: {
            type: "string",
          },

          consequencias: {
            type: "string",
          },

          relevancia: {
            type: "string",
          },
        },

        required: [
          "titulo",
          "categoria",
          "publicado_em",
          "resumo",
          "url",
          "fonte",
          "fatos_confirmados",
        ],
      },
    },
  },

  required: [
    "candidatos",
  ],
};

/*
 * ============================================================
 * NEWS SCHEMA
 * ============================================================
 */

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

  required: [
    "news",
  ],
};

/*
 * ============================================================
 * UTILITARIOS
 * ============================================================
 */

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function countWords(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function isValidUrl(url) {
  try {
    const parsed = new URL(url);

    return (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:"
    );
  } catch {
    return false;
  }
}

function hasTime(value) {
  if (!value) {
    return false;
  }

  const text = String(value).trim();

  /*
   * Aceita:
   *
   * 2026-08-17T18:30:00-06:00
   * 2026-08-17T18:30:00Z
   * 2026-08-17 18:30:00 -06:00
   *
   * NÃ£o aceita somente:
   *
   * 2026-08-17
   * August 17, 2026
   */

  return (
    /T\d{2}:\d{2}/.test(text) ||
    /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(text)
  );
}

function parsePublicationDate(value) {
  if (!value) {
    return null;
  }

  const text = String(value).trim();

  if (!hasTime(text)) {
    return null;
  }

  const date = new Date(text);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function isWithinResearchWindow(value) {
  const date = parsePublicationDate(value);

  if (!date) {
    return false;
  }

  const now = Date.now();
  const published = date.getTime();

  const futureTolerance = 5 * 60 * 1000;

  if (
    published >
    now + futureTolerance
  ) {
    return false;
  }

  const age =
    now - published;

  return (
    age >= 0 &&
    age <=
      RESEARCH_WINDOW_HOURS *
        60 *
        60 *
        1000
  );
}
function isFuture(value) {
  const date = parsePublicationDate(value);

  if (!date) {
    return false;
  }

  return (
    date.getTime() >
    Date.now() + 5 * 60 * 1000
  );
}

function extractJson(text) {
  if (!text) {
    return null;
  }

  let cleaned = String(text).trim();

  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```javascript\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
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

function sanitizeArticleText(text) {
  return String(text || "")
    .replace(/â€”/g, ",")
    .replace(/â€“/g, ",")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .replace(/[ \t]+/g, " ")
        .trim()
    )
    .filter(Boolean)
    .join("\n\n");
}

function getArticleParagraphs(text) {
  return String(text || "")
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function normalizeParagraphForComparison(text) {
  return normalizeText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function hasRepeatedArticleContent(text) {
  const paragraphs =
    getArticleParagraphs(text);

  if (paragraphs.length < 2) {
    return false;
  }

  const normalized =
    paragraphs.map(
      normalizeParagraphForComparison
    );

  /*
   * Paragrafos praticamente iguais.
   */
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const a = normalized[i];
      const b = normalized[j];

      if (!a || !b) {
        continue;
      }

      if (a === b) {
        return true;
      }

      /*
       * Detecta repeticao de um bloco grande.
       *
       * Exemplo:
       * inicio da materia + desenvolvimento
       * ...
       * inicio da materia + desenvolvimento novamente
       */
      const shorter =
        a.length <= b.length
          ? a
          : b;

      const longer =
        a.length <= b.length
          ? b
          : a;

      if (
        shorter.length >= 180 &&
        longer.includes(shorter)
      ) {
        return true;
      }
    }
  }

  /*
   * Detecta repeticao de blocos consecutivos
   * ou praticamente consecutivos.
   */
  for (let size = 1; size <= 2; size++) {
    for (
      let i = 0;
      i + size * 2 <= normalized.length;
      i++
    ) {
      const firstBlock =
        normalized
          .slice(i, i + size)
          .join(" ");

      const secondBlock =
        normalized
          .slice(i + size, i + size * 2)
          .join(" ");

      if (
        firstBlock.length >= 220 &&
        firstBlock === secondBlock
      ) {
        return true;
      }
    }
  }

  return false;
}

function isArticleStructurallyValid(text) {
  const article =
    sanitizeArticleText(text);

  const chars =
    article.length;

  if (
    chars < MIN_ARTICLE_CHARS ||
    chars > MAX_ARTICLE_CHARS
  ) {
    return false;
  }

  const paragraphs =
    getArticleParagraphs(article);

  if (
    paragraphs.length < 2 ||
    paragraphs.length > 6
  ) {
    return false;
  }

  if (
    paragraphs.some(
      (paragraph) =>
        paragraph.length < 80
    )
  ) {
    return false;
  }

  if (
    hasRepeatedArticleContent(article)
  ) {
    return false;
  }

  return true;
}

function titleLooksEnglish(title) {
  const original = String(title || "").trim();

  if (!original) {
    return false;
  }

  const text = normalizeText(original);

  /*
   * A funcao deve detectar titulos realmente escritos em ingles.
   *
   * IMPORTANTE:
   * Nomes de filmes, series, animes, jogos, personagens,
   * empresas, franquias e produtos podem permanecer em ingles
   * dentro de uma frase jornalistica em portugues.
   */

  const words = text
    .split(/\s+/)
    .map((word) =>
      word
        .replace(/^[^a-z0-9áéíóúàâêôãõçü]+/i, "")
        .replace(/[^a-z0-9áéíóúàâêôãõçü]+$/i, "")
    )
    .filter(Boolean);

  if (!words.length) {
    return false;
  }

  /*
   * Palavras funcionais inglesas.
   * Palavras isoladas NAO sao suficientes para reprovar.
   */
  const englishFunctionWords = new Set([
    "the",
    "and",
    "or",
    "of",
    "to",
    "for",
    "with",
    "from",
    "after",
    "before",
    "into",
    "over",
    "under",
    "on",
    "in",
    "at",
    "by",
    "as",
    "is",
    "are",
    "was",
    "were",
    "has",
    "have",
    "had",
    "will",
    "would",
    "can",
    "could",
    "should",
    "does",
    "do",
    "did",
    "new",
    "first",
    "latest",
    "next",
    "more",
    "about",
    "what",
    "why",
    "how",
    "this",
    "that",
    "these",
    "those",
  ]);

  /*
   * Estrutura funcional portuguesa.
   */
  const portugueseFunctionWords = new Set([
    "de",
    "da",
    "do",
    "das",
    "dos",
    "e",
    "ou",
    "para",
    "com",
    "sem",
    "em",
    "no",
    "na",
    "nos",
    "nas",
    "por",
    "apos",
    "antes",
    "entre",
    "sobre",
    "como",
    "que",
    "se",
    "um",
    "uma",
    "uns",
    "umas",
    "o",
    "a",
    "os",
    "as",
  ]);

  let englishScore = 0;
  let portugueseScore = 0;

  for (const word of words) {
    if (englishFunctionWords.has(word)) {
      englishScore += 2;
    }

    if (portugueseFunctionWords.has(word)) {
      portugueseScore += 2;
    }

    /*
     * Sufixos comuns do portugues.
     * Evidencia auxiliar, nunca decisiva.
     */
    if (
      /(?:cao|coes|mente|dade|idades|eiro|eira|ismo|ista|istas|ando|endo|indo|aram|eram|iram)$/.test(
        word
      )
    ) {
      portugueseScore += 1;
    }
  }

  /*
   * Verbos e construcoes que indicam que a frase jornalistica
   * esta efetivamente em ingles.
   */
  const strongEnglishPatterns = [
    /\bthe\s+\w+\s+(is|are|was|were|has|have|will|can|could)\b/,
    /\b\w+\s+(announces|reveals|confirms|launches|returns|becomes|gets|joins)\b/,
    /\b(what|why|how)\s+\w+\s+(is|are|does|do|will|can)\b/,
    /\b(everything|all)\s+(announced|revealed)\b/,
    /\bplayers\s+(can|will|are)\b/,
    /\bdevelopers\s+(announce|reveal|confirm)\b/,
    /\bcoming\s+to\s+\w+\b/,
    /\bset\s+to\s+\w+\b/,
    /\bis\s+set\s+to\b/,
    /\bwill\s+be\b/,
    /\bhas\s+been\b/,
    /\bare\s+being\b/,
    /\bwas\s+announced\b/,
    /\bhas\s+announced\b/,
    /\bwill\s+launch\b/,
    /\bwill\s+release\b/,
  ];

  const hasStrongEnglishPattern =
    strongEnglishPatterns.some(
      (pattern) => pattern.test(text)
    );

  /*
   * Construcoes jornalisticas portuguesas muito claras.
   *
   * Se uma dessas estruturas existir, o titulo deve ser tratado
   * como portugues, mesmo contendo nomes oficiais em ingles.
   */
  const strongPortuguesePatterns = [
    /\b(lanca|lancou|revela|revelou|anuncia|anunciou|confirma|confirmou)\b/,
    /\b(encerra|encerrou|assina|assinou|estreia|estreara)\b/,
    /\b(divulga|divulgou|apresenta|apresentou)\b/,
    /\b(ganha|recebe|recebera|tera|tem|conta|mostra)\b/,
    /\b(e|é|foi|sera|será)\b/,
    /\b(primeiro|novo|nova|novos|novas)\b/,
    /\b(filme|anime|jogo|serie|série|trailer|videoclipe|musica|música)\b/,
  ];

  const hasStrongPortuguesePattern =
    strongPortuguesePatterns.some(
      (pattern) => pattern.test(text)
    );

  /*
   * Regra principal:
   *
   * Uma frase com estrutura jornalistica portuguesa clara
   * nunca deve ser rejeitada apenas por conter um nome oficial
   * em ingles.
   */
  if (
    hasStrongPortuguesePattern &&
    portugueseScore >= 2
  ) {
    return false;
  }

  /*
   * Se houver uma construcao gramatical inglesa forte e nenhuma
   * evidencia portuguesa equivalente, rejeita.
   */
  if (
    hasStrongEnglishPattern &&
    englishScore > portugueseScore
  ) {
    return true;
  }

  /*
   * Verbos jornalisticos ingleses muito fortes.
   *
   * Uma construcao como:
   * "Sony announces a new PlayStation game"
   *
   * pode ter poucas palavras funcionais, mas ainda assim
   * e inequivocamente uma frase em ingles.
   */
  const strongEnglishNewsVerbPattern =
    /\b(announces|reveals|confirms|launches|returns|becomes|joins)\b/;

  if (
    strongEnglishNewsVerbPattern.test(text) &&
    !hasStrongPortuguesePattern
  ) {
    return true;
  }

  /*
   * Regra final conservadora.
   *
   * Exigimos uma vantagem relevante do ingles.
   */
  return (
    englishScore >= 6 &&
    englishScore > portugueseScore + 3
  );
}
function sameStory(a, b) {
  const aTitle =
    normalizeText(a?.titulo);

  const bTitle =
    normalizeText(b?.titulo);

  if (!aTitle || !bTitle) {
    return false;
  }

  if (aTitle === bTitle) {
    return true;
  }

  const aWords = new Set(
    aTitle
      .split(/\s+/)
      .filter(
        (word) =>
          word.length >= 5
      )
  );

  const bWords =
    bTitle
      .split(/\s+/)
      .filter(
        (word) =>
          word.length >= 5
      );

  if (!aWords.size || !bWords.length) {
    return false;
  }

  const common =
    bWords.filter(
      (word) =>
        aWords.has(word)
    ).length;

  const ratio =
    common /
    Math.max(
      aWords.size,
      bWords.length
    );

  return ratio >= 0.72;
}
function isLowValueContent(title, article) {
  const text =
    normalizeText(
      `${title} ${article}`
    );

  const blockedTerms = [
    "crossword",
    "palavra cruzada",
    "wordle",
    "jumble",
    "7 little words",
    "quiz",
    "horoscopo",
    "horoscopo",
    "rankings sem acontecimento",
    "ranking semanal",
    "lista dos melhores",
    "5 animes",
    "10 melhores",
    "top 10",
    "top 5",
    "gallery",
    "galeria",
    "passatempo",
    "puzzle",
  ];

  return blockedTerms.some(
    (term) =>
      text.includes(term)
  );

  function sameStory(a, b) {
  const aTitle =
    normalizeText(a?.titulo);

  const bTitle =
    normalizeText(b?.titulo);

  if (!aTitle || !bTitle) {
    return false;
  }

  if (aTitle === bTitle) {
    return true;
  }

  const aWords = new Set(
    aTitle
      .split(/\s+/)
      .filter(
        (word) =>
          word.length >= 5
      )
  );

  const bWords =
    bTitle
      .split(/\s+/)
      .filter(
        (word) =>
          word.length >= 5
      );

  if (!aWords.size || !bWords.length) {
    return false;
  }

  const common =
    bWords.filter(
      (word) =>
        aWords.has(word)
    ).length;

  const ratio =
    common /
    Math.max(
      aWords.size,
      bWords.length
    );

  return ratio >= 0.72;
}

}

function normalizeHashtag(value) {
  const text = String(value || "").trim();

  if (!text) {
    return "";
  }

  const cleaned = text
    .replace(/^#+/, "")
    .replace(/\s+/g, "");

  return cleaned
    ? `#${cleaned}`
    : "";
}

function normalizeHashtags(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map(normalizeHashtag)
    .filter(Boolean)
    .slice(0, 5);
}

function findMatchingCandidate(newsItem, candidates) {
  if (!newsItem || !Array.isArray(candidates)) {
    return null;
  }

  const newsUrl = String(
    newsItem?.fontes?.[0]?.url || ""
  ).trim();

  if (newsUrl) {
    const byUrl = candidates.find(
      (candidate) =>
        String(candidate?.url || "").trim() === newsUrl
    );

    if (byUrl) {
      return byUrl;
    }
  }

  const byTitle = candidates.find((candidate) =>
    sameStory(
      {
        titulo: newsItem?.titulo,
      },
      candidate
    )
  );

  return byTitle || null;
}

function lockCandidateFields(news, candidates) {
  if (!Array.isArray(news)) {
    return [];
  }

  return news.map((item) => {
    const candidate =
      findMatchingCandidate(
        item,
        candidates
      );

    if (!candidate) {
      return item;
    }

    return {
      ...item,

      categoria:
        candidate.categoria,

      publicado_em:
        candidate.publicado_em,

      fontes: [
        {
          nome:
            candidate.fonte,

          url:
            candidate.url,

          publicado_em:
            candidate.publicado_em,
        },
      ],

      hashtags:
        normalizeHashtags(
          item.hashtags
        ),
    };
  });
}

function validateNewsAgainstCandidates(
  news,
  candidates
) {
  const errors = [];

  if (
    !Array.isArray(news) ||
    !Array.isArray(candidates)
  ) {
    return errors;
  }

  for (const item of news) {
    const title =
      item?.titulo ||
      "Noticia sem titulo";

    const candidate =
      findMatchingCandidate(
        item,
        candidates
      );

    if (!candidate) {
      errors.push(
        `"${title}" nao corresponde a nenhum candidato pesquisado.`
      );

      continue;
    }

    if (
      item.publicado_em !==
      candidate.publicado_em
    ) {
      errors.push(
        `"${title}" alterou publicado_em em relacao ao candidato pesquisado.`
      );
    }

    const itemSource =
      item?.fontes?.[0];

    if (
      !itemSource ||
      itemSource.url !== candidate.url
    ) {
      errors.push(
        `"${title}" alterou a URL da fonte pesquisada.`
      );
    }

    if (
      !itemSource ||
      itemSource.nome !== candidate.fonte
    ) {
      errors.push(
        `"${title}" alterou o nome da fonte pesquisada.`
      );
    }

    if (
      isFuture(item.publicado_em)
    ) {
      errors.push(
        `"${title}" possui publicado_em no futuro.`
      );
    }

    if (
      !isWithinResearchWindow(
        item.publicado_em
      )
    ) {
      errors.push(
        `"${title}" possui publicado_em fora da janela de ${RESEARCH_WINDOW_HOURS} horas.`
      );
    }
  }

  return errors;
}

/*
 * ============================================================
 * RESEARCH VALIDATION
 * ============================================================
 */

function validateResearchCandidates(
  candidates
) {
  const errors = [];

  if (!Array.isArray(candidates)) {
    return [
      "Pesquisa nao retornou uma lista de candidatos.",
    ];
  }

  for (const item of candidates) {
    if (!item) {
      continue;
    }
    const title =
      item?.titulo ||
      "Candidato sem titulo";


    if (!CATEGORIES.includes(item.categoria)) {
      errors.push(
        `"${title}" possui categoria invalida. Esperado: ${CATEGORIES.join(", ")}.`
      );
    }
    if (!item.titulo) {
      errors.push(
        "Candidato sem titulo."
      );
    }

    if (!item.url) {
      errors.push(
        `"${item.titulo || "Candidato"}" nao possui URL.`
      );
    } else if (!isValidUrl(item.url)) {
      errors.push(
        `"${item.titulo || "Candidato"}" possui URL invalida.`
      );
    }

    if (!item.fonte) {
      errors.push(
        `"${item.titulo || "Candidato"}" nao possui fonte.`
      );
    }

    if (!item.publicado_em) {
      errors.push(
        `"${item.titulo || "Candidato"}" nao possui data de publicacao.`
      );
    } else if (!hasTime(item.publicado_em)) {
      errors.push(
        `"${item.titulo || "Candidato"}" nao possui horario de publicacao verificavel: "${item.publicado_em}".`
      );
    } else if (isFuture(item.publicado_em)) {
      errors.push(
        `"${item.titulo || "Candidato"}" foi publicado no futuro: "${item.publicado_em}".`
      );
    } else if (!isWithinResearchWindow(item.publicado_em)) {
      errors.push(
        `"${item.titulo || "Candidato"}" foi publicado fora das ultimas ${RESEARCH_WINDOW_HOURS} horas: "${item.publicado_em}".`
      );
    }

    if (
      !Array.isArray(item.fatos_confirmados) ||
      !item.fatos_confirmados.length
    ) {
      errors.push(
        `"${item.titulo || "Candidato"}" nao possui fatos confirmados.`
      );
    }
  }

  return errors;
}

function filterValidCandidates(
  candidates
) {
  if (!Array.isArray(candidates)) {
    return [];
  }

  const valid = [];

  for (const item of candidates) {
    if (!item) {
      continue;
    }

    if (!CATEGORIES.includes(item.categoria)) {
      continue;
    }

    if (!item.titulo) {
      continue;
    }

    if (!item.url || !isValidUrl(item.url)) {
      continue;
    }

    if (!item.fonte) {
      continue;
    }

    if (!item.publicado_em) {
      continue;
    }

    if (!hasTime(item.publicado_em)) {
      continue;
    }

    if (isFuture(item.publicado_em)) {
      continue;
    }

    if (!isWithinResearchWindow(item.publicado_em)) {
      continue;
    }

    if (
      !Array.isArray(item.fatos_confirmados) ||
      !item.fatos_confirmados.length
    ) {
      continue;
    }

    valid.push(item);
  }

  return valid;
}
/*
 * ============================================================
 * EDITORIAL PROMPT
 * ============================================================
 */

function buildFormatPrompt(
  candidates
) {
  const researchText =
    JSON.stringify(
      candidates,
      null,
      2
    );

  return `
Voce e o editor-chefe do Wire/Geek.

Receba abaixo uma lista de candidatos que ja foi pesquisada
na web e filtrada pelo sistema.

Sua tarefa e transformar SOMENTE candidatos existentes no
material em uma edicao jornalistica com as noticias validas disponiveis.

QUANTIDADE DA EDICAO:

A edicao deve possuir NO MAXIMO 12 noticias.

REGRAS DE SELECAO:

- Se houver 12 ou mais candidatos validos, selecione EXATAMENTE as 12 melhores noticias.
- Se houver entre 6 e 11 candidatos validos, utilize todas as noticias validas disponiveis.
- Se houver menos de 6 candidatos validos, NAO finalize a edicao.
- A distribuicao entre categorias e LIVRE.
- NAO altere a categoria original de nenhum candidato.
- NAO mova candidatos entre categorias.
- A categoria "series" NAO pode aparecer.
- NAO invente noticias.
- NAO repita noticias.
- NAO duplique acontecimentos.
- NAO crie noticias para completar quantidade.

Na selecao das melhores noticias, priorize:

1. relevancia jornalistica;
2. atualidade;
3. diversidade de assuntos;
4. confiabilidade das fontes;
5. interesse para o publico geek.

As noticias podem ser organizadas por categoria apenas para facilitar
a edicao e a geracao dos banners, sem exigir quantidade minima ou fixa
por categoria.

Os candidatos abaixo ja foram pesquisados.

USE SOMENTE OS CANDIDATOS ABAIXO.

REGRAS DA MATERIA:

Cada campo "materia" DEVE possuir entre
${MIN_ARTICLE_CHARS} e ${MAX_ARTICLE_CHARS} caracteres.

Conte SOMENTE o campo materia.

Nao conte:

- titulo;
- highlights;
- hashtags;
- fontes;
- image_query.

FORMATO EDITORIAL OBRIGATORIO:

A materia deve parecer uma noticia publicada por um
veiculo especializado em cultura geek.

Escreva em portugues brasileiro natural, direto e profissional.

Cada paragrafo deve desenvolver uma informacao diferente.

IMPORTANTE SOBRE A FORMATACAO DA MATERIA:

A materia DEVE possuir exatamente 3 paragrafos.

Cada paragrafo DEVE ser separado do seguinte por uma linha em branco,
utilizando duas quebras de linha (\n\n) dentro da string JSON.

NAO escreva todos os paragrafos como um unico bloco de texto.

NAO substitua as quebras de paragrafo por espacos.

A resposta deve preservar explicitamente a separacao entre os 3 paragrafos.

ESTRUTURA OBRIGATORIA:

PARAGRAFO 1 — LEAD:

Apresente imediatamente o fato principal da noticia.

O leitor deve entender logo no primeiro paragrafo
o que aconteceu, quem esta envolvido e por que o assunto
e relevante.

PARAGRAFO 2 — CONTEXTO E DETALHES:

Explique o contexto necessario para compreender a noticia.

Inclua os principais detalhes confirmados presentes no candidato,
como datas, numeros, nomes, declaracoes, caracteristicas,
informacoes de producao, plataformas, valores ou outros dados factuais.

PARAGRAFO 3 — DESDOBRAMENTO:

Apresente os principais detalhes restantes, consequencias,
proximos passos ou informacoes adicionais somente quando
esses dados estiverem presentes no candidato.

Se nao houver um proximo passo confirmado, finalize com
os detalhes factuais restantes.

NAO invente um desdobramento.

NAO repita a mesma informacao em paragrafos diferentes.

NAO reformule o mesmo fato apenas para aumentar o tamanho.

NAO use frases de preenchimento.

EVITE CONSTRUCOES ARTIFICIAIS como:

- "Como consequencia direta..."
- "O cenario atual evidencia..."
- "A iniciativa consolida..."
- "Os proximos passos operacionais preveem..."
- "A repercussao demonstra..."
- "Esse movimento representa..."
- "O contexto reforca..."
- "A relevancia do acontecimento..."
- "A industria acompanha de perto..."

Essas construcoes somente podem ser utilizadas quando
expressarem um fato especifico realmente presente no candidato.

REGRA DE TAMANHO:

Antes de finalizar cada materia, estime o tamanho.

Nunca entregue abaixo de ${MIN_ARTICLE_CHARS} caracteres.

Nunca ultrapasse ${MAX_ARTICLE_CHARS} caracteres.

O tamanho deve ser alcancado por meio de informacao jornalistica
realmente presente no candidato, nunca por preenchimento artificial.

PRIORIDADE EDITORIAL:

A qualidade e a naturalidade da materia sao mais importantes
que aumentar artificialmente o numero de caracteres.

Se houver poucos fatos no candidato, desenvolva o contexto
somente com informacoes que ja estejam presentes nele.

NAO invente informacoes para atingir o limite minimo.

NAO INVENTE:

- contexto;
- declaracoes;
- numeros;
- datas;
- consequencias;
- nomes;
- reacoes do publico;
- expectativas de mercado;
- informacoes de bastidores;
- proximos passos;
- informacoes sobre vendas;
- informacoes sobre audiencia;
- informacoes sobre redes sociais.

Use SOMENTE fatos presentes no candidato selecionado.

Se houver varios fatos no candidato, combine-os de maneira
coerente e sem repeticao.

REGRA DE TAMANHO:

Antes de finalizar cada materia, estime o tamanho.

Nunca entregue abaixo de ${MIN_ARTICLE_CHARS} caracteres.

Nunca ultrapasse ${MAX_ARTICLE_CHARS} caracteres.

O tamanho deve ser alcancado por meio de informacao jornalistica
realmente presente no candidato, nunca por preenchimento artificial.

PRIORIDADE EDITORIAL:

A qualidade e a naturalidade da materia sao mais importantes
que aumentar artificialmente o numero de caracteres.

Se houver poucos fatos no candidato, desenvolva o contexto
somente com informacoes que ja estejam presentes nele.

NAO invente informacoes para atingir o limite minimo.
TITULO:

O titulo deve estar em portugues brasileiro.

Nao escreva titulo em ingles.

Pode manter nomes proprios, marcas, franquias e produtos
em sua grafia oficial.

PUBLICACAO:

Copie exatamente o publicado_em do candidato selecionado.

NAO invente horario.

NAO altere horario.

NAO converta para outra data.

FONTES:

Copie as fontes do candidato.

NAO invente URL.

NAO altere URL.

NAO substitua uma URL por outra.

HIGHLIGHTS:

Exatamente 1.

O highlight deve ter entre 10 e 20 palavras.

O highlight deve estar em portugues brasileiro natural.

O highlight deve ser uma frase jornalistica curta, completa e informativa.

O highlight deve apresentar um fato especifico, relevante e verificavel da materia.

NAO repita simplesmente o titulo.

O highlight deve acrescentar uma informacao factual relevante que nao esteja apenas repetindo o titulo.

O highlight pode ser impactante, provocativo e sensacionalista na medida certa, buscando despertar curiosidade e interesse do leitor.

O tom deve permanecer rigorosamente baseado nos fatos reais apresentados na materia e nas fontes.

NAO invente acontecimentos.

NAO exagere fatos.

NAO transforme rumores, teorias, possibilidades ou especulacoes em fatos confirmados.

NAO use frases genericas.

Use somente informacoes presentes no candidato selecionado.

PROIBIDO:

- markdown;
- blocos de codigo;
- explicacoes fora do JSON;
- texto antes do JSON;
- texto depois do JSON;
- travessao.

Use virgulas, pontos, dois-pontos ou parenteses.

FORMATO EXATO:

{
  "news": [
    {
      "categoria": "games",
      "titulo": "Titulo em portugues",
      "publicado_em": "2026-08-17T18:30:00-06:00",
      "materia": "Materia entre 700 e 2000 caracteres.",
      "highlights": [
        "Destaque factual entre 10 e 20 palavras"
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
          "publicado_em": "2026-08-17T18:30:00-06:00"
        }
      ],
      "image_query": "consulta curta para imagem"
    }
  ]
}

MATERIAL PESQUISADO:

${researchText}
`;
}

/*
 * ============================================================
 * RESEARCH
 * ============================================================
 */

function createAIBudget(maxCalls = 5) {
  return {
    calls: 0,
    maxCalls,
    exhausted: false,
  };
}

function isAIQuotaError(error) {
  const message =
    error?.message ||
    String(error);

  return (
    message.includes("429") ||
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("prepayment credits are depleted") ||
    message.includes("quota")
  );
}

async function generateWithBudget(
  ai,
  budget,
  options
) {
  if (!budget) {
    return ai.models.generateContent(
      options
    );
  }

  if (budget.exhausted) {
    throw new Error(
      "WIRE/GEEK: novas chamadas Gemini bloqueadas pelo controle de custo."
    );
  }

  if (budget.calls >= budget.maxCalls) {
    budget.exhausted = true;

    throw new Error(
      `WIRE/GEEK: limite de ${budget.maxCalls} chamadas Gemini atingido.`
    );
  }

  budget.calls++;

  console.log(
    "WIRE/GEEK: chamada Gemini autorizada:",
    {
      chamada: budget.calls,
      limite: budget.maxCalls,
    }
  );

  try {
    return await ai.models.generateContent(
      options
    );
  } catch (error) {
    if (isAIQuotaError(error)) {
      budget.exhausted = true;

      console.error(
        "WIRE/GEEK: quota/credito Gemini atingido. Novas chamadas bloqueadas."
      );
    }

    throw error;
  }
}
async function fetchRssFeed(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `RSS HTTP ${response.status}: ${url}`
    );
  }

  const xml = await response.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
  });

  return parser.parse(xml);
}


const RSS_FEEDS = {
  geek: [
    "https://www.theverge.com/rss/index.xml",
  ],
};
async function collectRssCandidates() {
  const candidates = [];

  for (const [category, feeds] of Object.entries(RSS_FEEDS)) {
    for (const feedUrl of feeds) {
      try {
        const data = await fetchRssFeed(feedUrl);

        const entries = Array.isArray(data?.feed?.entry)
          ? data.feed.entry
          : data?.feed?.entry
            ? [data.feed.entry]
            : [];

        for (const item of entries) {
          const title =
            typeof item?.title === "object"
              ? item.title?.["#text"]
              : item?.title;

          const url = item?.link?.["@_href"];
          const published = item?.published;

          if (!title || !url || !published) {
            continue;
          }

          if (!hasTime(published)) {
            continue;
          }

          if (isFuture(published)) {
            continue;
          }

          if (!isWithinResearchWindow(published)) {
            continue;
          }

          candidates.push({
            titulo: String(title).trim(),
            categoria: category,
            publicado_em: published,
            resumo: "",
            url,
            fonte: new URL(feedUrl).hostname,
            pessoas_envolvidas: [],
            empresas_envolvidas: [],
            fatos_confirmados: [],
            datas_mencionadas: [],
            numeros_mencionados: [],
            declaracoes: [],
            contexto: "",
            consequencias: "",
            relevancia: "",
          });
        }
      } catch (error) {
        console.error(
          "WIRE/GEEK: erro ao consultar RSS:",
          feedUrl,
          error?.message || String(error)
        );
      }
    }
  }

  return candidates;
}


async function searchNews(
  ai,
  prompt,
  aiBudget
) {
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoffIso = new Date(
    now.getTime() - RESEARCH_WINDOW_HOURS * 60 * 60 * 1000
  ).toISOString();

  console.log(
    "WIRE/GEEK: janela temporal da pesquisa:",
    {
      agora: nowIso,
      limite: cutoffIso,
    }
  );

  const categoryInstructions = {
    games: `
PESQUISE EXCLUSIVAMENTE GAMES.

Procure acontecimentos reais sobre:
- videogames;
- jogos para PC;
- PlayStation;
- Xbox;
- Nintendo;
- Steam;
- Epic Games;
- desenvolvedoras;
- publishers;
- lanÃ§amentos;
- atualizaÃ§Ãµes relevantes;
- anÃºncios oficiais;
- trailers oficiais quando representarem um acontecimento novo;
- vendas, aquisiÃ§Ãµes ou mudanÃ§as importantes;
- eventos de games que tenham produzido um anÃºncio novo.

NAO pesquise anime, cinema ou cultura geek genÃ©rica.
`,

    geek: `
PESQUISE EXCLUSIVAMENTE GEEK.

Procure acontecimentos reais sobre:
- tecnologia de consumo;
- hardware;
- gadgets;
- IA;
- internet;
- plataformas digitais;
- empresas de tecnologia;
- quadrinhos quando houver acontecimento jornalÃ­stico;
- cultura pop tecnolÃ³gica;
- produtos relevantes;
- anÃºncios oficiais;
- aquisiÃ§Ãµes;
- lanÃ§amentos;
- mudanÃ§as importantes de serviÃ§os.

NAO pesquise videogames como assunto principal.
NAO pesquise cinema ou anime como assunto principal.
`,

    cinema: `
PESQUISE EXCLUSIVAMENTE CINEMA.

Procure acontecimentos reais sobre:
- filmes;
- estÃºdios;
- diretores;
- atores;
- elenco;
- produÃ§Ãµes cinematogrÃ¡ficas;
- lanÃ§amentos;
- trailers oficiais;
- anÃºncios oficiais;
- bilheteria quando houver acontecimento novo;
- aquisiÃ§Ãµes ou mudanÃ§as relevantes;
- produÃ§Ã£o ou distribuiÃ§Ã£o de filmes.

NAO use notÃ­cias antigas apenas porque receberam atualizaÃ§Ã£o.
NAO transforme uma data futura de lanÃ§amento em notÃ­cia nova.
`,

    anime: `
PESQUISE EXCLUSIVAMENTE ANIME.

Procure acontecimentos reais sobre:
- anime;
- mangÃ¡ quando relacionado diretamente a uma adaptaÃ§Ã£o ou anÃºncio relevante;
- estÃºdios de animaÃ§Ã£o;
- produÃ§Ãµes de anime;
- novos anÃºncios;
- trailers oficiais;
- novos projetos;
- elenco de voz;
      - datas de estreia quando o anúncio tiver sido publicado nas ${RESEARCH_WINDOW_HOURS} horas;
- plataformas de streaming quando houver anÃºncio novo;
- eventos de anime quando houver anÃºncio novo.

NAO use listas de animes.
NAO use rankings.
NAO use guias.
NAO use calendÃ¡rios antigos.
NAO use notÃ­cias antigas sobre estreias jÃ¡ anunciadas.
`,

  };

  const candidates = [];
  const allErrors = [];
  let totalPesquisados = 0;

  const MAX_RESEARCH_ATTEMPTS = 4;
  const TARGET_CANDIDATES = 20;

  try {
    const rssCandidates =
      await collectRssCandidates();

    console.log(
      "WIRE/GEEK: candidatos encontrados via RSS:",
      rssCandidates.length
    );

    console.log(
      "WIRE/GEEK: RSS usado como contexto de pesquisa."
    );
  } catch (error) {
    console.error(
      "WIRE/GEEK: erro na coleta RSS:",
      error?.message || String(error)
    );
  }

  const researchStrategies = {
    games: [
      "Pesquise primeiro fontes oficiais: Nintendo, PlayStation, Xbox, Steam, Epic Games, publishers e desenvolvedoras.",
      "Depois pesquise veiculos especializados como IGN, GameSpot, VGC e Eurogamer.",
      "Priorize anuncios, atualizacoes relevantes, lancamentos, adiamentos, aquisicoes, vendas, trailers e eventos com anuncio novo."
    ],

    geek: [
      "Pesquise primeiro fontes oficiais de empresas e fabricantes de tecnologia.",
      "Depois pesquise The Verge, TechCrunch, Ars Technica, Wired e outros veiculos especializados confiaveis.",
      "Priorize IA, hardware, gadgets, plataformas, internet, semicondutores, dispositivos e anuncios de produtos ou servicos."
    ],

    cinema: [
      "Pesquise primeiro estudios, distribuidores e fontes oficiais de filmes.",
      "Depois pesquise Variety, Deadline, The Hollywood Reporter e veiculos especializados confiaveis.",
      "Priorize anuncios, trailers novos, producao, elenco, diretores, distribuicao, festivais, bilheteria com acontecimento novo e aquisicoes."
    ],

    anime: [
      "Pesquise primeiro fontes oficiais de estudios, produtoras, distribuidores, plataformas e eventos.",
      "Depois pesquise Anime News Network e outros veiculos especializados confiaveis.",
      "Priorize novos anuncios, trailers, producoes, adaptacoes, elenco de voz, projetos, plataformas e eventos com anuncio novo."
    ],};

  const sourcePools = {
    games: [
      "fontes oficiais de Nintendo, PlayStation, Xbox, Steam e Epic Games",
      "publishers e desenvolvedoras",
      "IGN.com, GameSpot, VGC e Eurogamer"
    ],

    geek: [
      "sites oficiais de fabricantes e empresas de tecnologia",
      "The Verge, TechCrunch, Ars Technica e Wired",
      "fontes primarias de produtos, plataformas e servicos"
    ],

    cinema: [
      "sites oficiais de estudios e distribuidores",
      "Variety, Deadline e The Hollywood Reporter",
      "fontes oficiais de producao e festivais"
    ],

    anime: [
      "sites oficiais de estudios e produtoras",
      "Anime News Network",
      "Crunchyroll e fontes oficiais de distribuidores e eventos"
    ],};

  const researchFocus = {
    games: researchStrategies.games,
    geek: researchStrategies.geek,
    cinema: researchStrategies.cinema,
    anime: researchStrategies.anime,};


  for (
    let attempt = 1;
    attempt <= MAX_RESEARCH_ATTEMPTS;
    attempt++
  ) {

    console.log(
      `WIRE/GEEK: pesquisa geral: tentativa ${attempt}/${MAX_RESEARCH_ATTEMPTS}.`
    );

    const strategyIndex = (attempt - 1) % CATEGORIES.length;
    const strategyCategory = CATEGORIES[strategyIndex];

    const activeStrategy =
      researchStrategies[strategyCategory] || [];

    const activeSources =
      sourcePools[strategyCategory] || [];


    console.log(
      "WIRE/GEEK: estrategia ativa:",
      {
        tentativa: attempt,
        categoria: strategyCategory,
        fontes: activeSources,
      }
    );
    const rssResearchContext =
      candidates.length
        ? `
CANDIDATOS DESCOBERTOS POR RSS:

${candidates
  .map(
    (item) =>
      `- ${item.titulo} | ${item.publicado_em} | ${item.url}`
  )
  .join("\n")}

Use esses itens como pontos de partida para investigação.
Verifique os fatos antes de transformar qualquer item em notícia.
`
        : "";
    const researchPrompt = `Voce e o pesquisador-chefe do Wire/Geek.

DATA E HORA ATUAL DO SERVIDOR:
${nowIso}

INICIO EXATO DA JANELA DE ${RESEARCH_WINDOW_HOURS} HORAS:
${cutoffIso}

${rssResearchContext}
OBJETIVO:

Pesquise noticias REAIS sobre cultura Geek publicadas originalmente
nas ultimas ${RESEARCH_WINDOW_HOURS} horas.

A pesquisa deve considerar livremente acontecimentos relevantes
envolvendo os seguintes temas:

${CATEGORIES.join(", ")}


ESTRATEGIA DE PESQUISA ATIVA DESTA TENTATIVA:

${activeStrategy.join("\n- ")}

FONTES PRIORITARIAS DESTA TENTATIVA:

${activeSources.join("\n- ")}

REGRAS DA ESTRATEGIA:

- Siga prioritariamente a estrategia ativa acima.
- Pesquise primeiro nas fontes prioritarias indicadas.
- Depois amplie para outras fontes confiaveis quando necessario.
- Nao limite a pesquisa exclusivamente a essas fontes.
- Continue respeitando integralmente a janela temporal.
- Nao invente acontecimentos para preencher a estrategia.
- Se uma fonte prioritaria nao possuir acontecimento valido, procure outra.
- A estrategia serve para DIVERSIFICAR a pesquisa entre tentativas.
- Nao force uma noticia a pertencer a categoria da estrategia.
- Classifique cada acontecimento pela categoria que realmente representa.

IMPORTANTE:

As categorias acima sao APENAS SUGESTOES DE TEMAS.

NAO existe quantidade minima ou maxima de noticias por categoria.

NAO tente equilibrar a quantidade de noticias entre categorias.

NAO pesquise uma categoria por vez.

NAO reserve vagas para nenhuma categoria.

NAO force uma noticia a pertencer a determinada categoria.

Para cada acontecimento encontrado, classifique a noticia na categoria
que MELHOR representar o assunto.

A distribuicao final entre categorias pode ser completamente desigual.

Uma edicao pode, por exemplo, possuir varias noticias de games,
poucas de cinema e nenhuma de anime, desde que isso reflita os
acontecimentos reais encontrados.

NAO INVENTE noticias para preencher categorias.

NAO invente acontecimentos para equilibrar a edicao.

NAO mova um acontecimento para outra categoria apenas para equilibrar
a quantidade.

REGRA TEMPORAL ABSOLUTA:

A noticia precisa ter sido originalmente publicada nas ultimas ${RESEARCH_WINDOW_HOURS} horas.

publicado_em >= ${cutoffIso}

E:

publicado_em <= ${nowIso}

A data e o horario precisam representar o MOMENTO ORIGINAL DA
PUBLICACAO DA PAGINA.

NAO use:

- data de atualizacao;
- data de modificacao;
- data de indexacao;
- data de republicacao;
- data de evento;
- data mencionada dentro da materia;
- data futura;
- data de atualizacao de materia antiga.

Se a pagina nao permitir verificar a data E o horario original
da publicacao, descarte o candidato.

NAO INVENTE HORARIO.

NAO ESTIME HORARIO.

NAO CONVERTA uma data sem horario em um horario ficticio.

USE OBRIGATORIAMENTE A BUSCA NA WEB.

Pesquise deliberadamente varias fontes.

Procure diferentes acontecimentos independentes.

Se varias fontes noticiarem o mesmo acontecimento,
retorne apenas uma delas.

PRIORIDADE DAS FONTES:

1. fonte primaria;
2. anuncio oficial;
3. comunicado oficial;
4. documento oficial;
5. entrevista original;
6. veiculo jornalistico reconhecido;
7. veiculo especializado confiavel.

ELIMINE:

- rumores;
- especulacoes;
- listas;
- rankings;
- quizzes;
- puzzles;
- crossword;
- Wordle;
- Jumble;
- horoscopos;
- galerias;
- guias;
- artigos de opiniao sem acontecimento novo;
- conteudo promocional sem fato jornalistico;
- noticias recicladas;
- materias antigas atualizadas;
- republicacoes;
- duplicatas;
- acontecimentos futuros.

PESQUISA AMPLA:

A pesquisa deve procurar uma quantidade AMPLA de acontecimentos reais
para fornecer material suficiente ao editor.

Quando houver acontecimentos reais suficientes dentro da janela de
${RESEARCH_WINDOW_HOURS} horas, procure preferencialmente ENTRE 15 E 20 CANDIDATOS VALIDOS.

NAO distribua essa quantidade entre categorias.

NAO reserve vagas para categorias.

NAO force equilibrio entre categorias.

A quantidade de candidatos deve refletir SOMENTE os acontecimentos
reais encontrados.

Se existirem menos de 15 acontecimentos realmente validos, retorne
todos os candidatos validos encontrados.

NAO invente candidatos para atingir qualquer quantidade.

O objetivo e fornecer material suficiente para que o editor possa
selecionar noticias validas sem inventar, duplicar ou alterar
acontecimentos.

PARA CADA CANDIDATO RETORNE:

- titulo;
- categoria;
- publicado_em;
- resumo;
- url;
- fonte;
- pessoas_envolvidas;
- empresas_envolvidas;
- fatos_confirmados;
- datas_mencionadas;
- numeros_mencionados;
- declaracoes;
- contexto;
- consequencias;
- relevancia.

CATEGORIA:

A categoria deve ser escolhida entre:

${CATEGORIES.join(", ")}


ESTRATEGIA DE PESQUISA ATIVA DESTA TENTATIVA:

${activeStrategy.join("\n- ")}

FONTES PRIORITARIAS DESTA TENTATIVA:

${activeSources.join("\n- ")}

REGRAS DA ESTRATEGIA:

- Siga prioritariamente a estrategia ativa acima.
- Pesquise primeiro nas fontes prioritarias indicadas.
- Depois amplie para outras fontes confiaveis quando necessario.
- Nao limite a pesquisa exclusivamente a essas fontes.
- Continue respeitando integralmente a janela temporal.
- Nao invente acontecimentos para preencher a estrategia.
- Se uma fonte prioritaria nao possuir acontecimento valido, procure outra.
- A estrategia serve para DIVERSIFICAR a pesquisa entre tentativas.
- Nao force uma noticia a pertencer a categoria da estrategia.
- Classifique cada acontecimento pela categoria que realmente representa.

A categoria representa SOMENTE o tema predominante da noticia.

Escolha a categoria que melhor descreve o acontecimento.

NAO altere o acontecimento para encaixa-lo em uma categoria.

NAO force distribuicao equilibrada.

TITULOS:

Escreva o titulo em portugues brasileiro.

Nao copie titulos em ingles.

Pode preservar nomes oficiais de:

- pessoas;
- empresas;
- franquias;
- produtos;
- jogos;
- filmes;
- animes.

A URL precisa ser exatamente a pagina utilizada.

Nao invente URLs.

Nao altere URLs.

Nao use URL de busca como fonte.

EVITE A TODO CUSTO REPETIR ACONTECIMENTOS
QUE JA TENHAM SIDO ENCONTRADOS EM TENTATIVAS ANTERIORES.

Solicitacao adicional:

${
  prompt ||
  "Gere a edicao de hoje com noticias reais."
}
`;

    try {
      const response =
        await generateWithBudget(
          ai,
          aiBudget,
          {
            model: MODEL,

            contents:
              researchPrompt,

            config: {
              tools: [
                {
                  googleSearch: {},
                },
              ],

              responseMimeType:
                "application/json",

              responseSchema:
                RESEARCH_SCHEMA,

              maxOutputTokens:
                10000,
            },
          }
        );
      if (!response?.text) {
        console.log(
          `WIRE/GEEK: pesquisa geral: tentativa ${attempt}: Gemini nao retornou texto.`
        );

        continue;
      }

      const parsed =
        extractJson(
          response.text
        );

      if (
        !parsed ||
        !Array.isArray(
          parsed.candidatos
        )
      ) {
        console.log(
          `WIRE/GEEK: pesquisa geral: tentativa ${attempt}: JSON sem candidatos.`
        );

        continue;
      }

      totalPesquisados += parsed.candidatos.length;

      console.log(
        `WIRE/GEEK: pesquisa geral: tentativa ${attempt}: candidatos pesquisados:`,
        parsed.candidatos.length
      );

      const validationErrors =
        validateResearchCandidates(
          parsed.candidatos
        );

      if (validationErrors.length) {
        console.log(
          `WIRE/GEEK: pesquisa geral: tentativa ${attempt}: erros de validacao:`,
          validationErrors
        );

        allErrors.push(
          ...validationErrors
        );
      }

      const validCandidates =
        filterValidCandidates(
          parsed.candidatos
        );

      console.log(
        `WIRE/GEEK: pesquisa geral: tentativa ${attempt}: candidatos validos:`,
        validCandidates.length
      );

      for (
        const candidate
        of validCandidates
      ) {

        const duplicate =
          candidates.some(
            (existing) =>
              sameStory(
                existing,
                candidate
              )
          );

        if (!duplicate) {
          candidates.push(
            candidate
          );
        }
      }

      console.log(
        `WIRE/GEEK: pesquisa geral: total acumulado apos tentativa ${attempt}:`,
        candidates.length
      );

      if (candidates.length >= TARGET_CANDIDATES) {
        console.log(
          `WIRE/GEEK: alvo de ${TARGET_CANDIDATES} candidatos atingido. Pesquisa interrompida.`
        );

        break;
      }


    } catch (error) {
      const errorMessage =
        error?.message ||
        String(error);

      console.error(
        `WIRE/GEEK: erro na pesquisa geral, tentativa ${attempt}:`,
        errorMessage
      );

      const isQuotaError =
        errorMessage.includes("429") ||
        errorMessage.includes("RESOURCE_EXHAUSTED") ||
        errorMessage.includes("prepayment credits are depleted");

      if (isQuotaError) {
        console.error(
          "WIRE/GEEK: limite ou saldo do Gemini atingido. Pesquisa interrompida para evitar novas chamadas."
        );

        break;
      }
    }
  }

  console.log(
    "WIRE/GEEK: pesquisa geral concluida.",
    {
      encontrados:
        candidates.length,
    }
  );

  const finalCounts =
    CATEGORIES.reduce(
      (result, category) => {
        result[category] =
          candidates.filter(
            (item) =>
              item.categoria ===
              category
          ).length;

        return result;
      },
      {}
    );

  console.log(
    "WIRE/GEEK: candidatos vÃ¡lidos finais:",
    candidates.length
  );

  console.log(
    "WIRE/GEEK: candidatos finais por categoria:",
    finalCounts
  );

  console.log(
    "WIRE/GEEK: erros de validaÃ§Ã£o acumulados:",
    allErrors.length
  );

  return {
    candidatos:
      candidates,

    pesquisados:
      totalPesquisados,

    candidatosPorCategoria:
      finalCounts,

    errosValidacao:
      allErrors,
  };
}

/*
 * ============================================================
 * EDITORIAL PROMPT
 * ============================================================
 */


/*
 * ============================================================
 * FORMAT NEWS
 * ============================================================
 */

async function formatNews(
  ai,
  researchData,
  aiBudget
) {
  const candidates =
    Array.isArray(
      researchData?.candidatos
    )
      ? researchData.candidatos
      : [];

  if (!candidates.length) {
    throw new Error(
      "Nenhum candidato valido de pesquisa foi recebido pelo editor."
    );
  }

  const validCandidates = filterValidCandidates(candidates);


  const formatPrompt =
    buildFormatPrompt(
      validCandidates
    );

  const response =
    await generateWithBudget(
      ai,
      aiBudget,
      {
      model: MODEL,

      contents:
        formatPrompt,

      config: {
        responseMimeType:
          "application/json",

        responseSchema:
          NEWS_SCHEMA,

        maxOutputTokens:
          18000,
      },
        }
  );
  if (!response?.text) {
    throw new Error(
      "Gemini nao retornou o JSON editorial."
    );
  }

  const parsed =
    extractJson(
      response.text
    );

  if (!parsed) {
    throw new Error(
      "Gemini retornou JSON editorial invalido."
    );
  }

  return parsed;
}

/*
 * ============================================================
 * VALIDACAO DA EDICAO
 * ============================================================
 */

function validateNews(
  news
) {
  const errors = [];

  if (!Array.isArray(news)) {
    return [
      "A propriedade news nao e uma lista.",
    ];
  }


  if (
    news.length < MIN_NEWS ||
    news.length > MAX_NEWS
  ) {
    errors.push(
      `A edicao precisa possuir entre ${MIN_NEWS} e ${MAX_NEWS} noticias. Encontrado: ${news.length}.`
    );
  }



  const categoryCounts =
    CATEGORIES.reduce(
      (result, category) => {
        result[category] =
          news.filter(
            (item) =>
              item?.categoria === category
          ).length;

        return result;
      },
      {}
    );

  const titles = [];

  for (const item of news) {
    if (!item) {
      errors.push(
        "Existe uma noticia vazia."
      );

      continue;
    }

    const title =
      item.titulo ||
      "Noticia sem titulo";

    if (!CATEGORIES.includes(item.categoria)) {
      errors.push(
        `"${title}" possui categoria invalida. Esperado: ${CATEGORIES.join(", ")}.`
      );
    }

    if (!item.titulo) {
      errors.push(
        "Existe noticia sem titulo."
      );
    }

    if (
      titleLooksEnglish(
        item.titulo
      )
    ) {
      errors.push(
        `"${title}" possui titulo aparentemente em ingles.`
      );
    }

    if (!item.publicado_em) {
      errors.push(
        `"${title}" nao possui data de publicacao.`
      );
    } else if (!hasTime(item.publicado_em)) {
      errors.push(
        `"${title}" nao possui horario de publicacao verificavel.`
      );
    }

    if (!item.materia) {
      errors.push(
        `"${title}" nao possui materia.`
      );
    } else {
      const articleText =
        String(item.materia).trim();

      const articleLength =
        articleText.length;

      if (
        articleLength <
        MIN_ARTICLE_CHARS
      ) {
        errors.push(
          `"${title}" possui materia curta: ${articleLength} caracteres. Minimo: ${MIN_ARTICLE_CHARS}.`
        );
      }

      if (
        articleLength >
        MAX_ARTICLE_CHARS
      ) {
        errors.push(
          `"${title}" possui materia longa: ${articleLength} caracteres. Maximo: ${MAX_ARTICLE_CHARS}.`
        );
      }

      const paragraphs =
        articleText
          .split(/\r?\n\s*\r?\n/)
          .map(
            paragraph =>
              paragraph.trim()
          )
          .filter(Boolean);

      if (
        paragraphs.length !== 3
      ) {
        errors.push(
          `"${title}" deve possuir exatamente 3 paragrafos. Encontrado: ${paragraphs.length}.`
        );
      }

      if (
        paragraphs.some(
          paragraph =>
            paragraph.length < 80
        )
      ) {
        errors.push(
          `"${title}" possui paragrafo excessivamente curto.`
        );
      }
    }

    if (
      !Array.isArray(
        item.highlights
      )
    ) {
      errors.push(
        `"${title}" nao possui highlights validos.`
      );
    } else {
      if (
        item.highlights.length !== 1
      ) {
        errors.push(
          `"${title}" deve possuir exatamente 1 highlight.`
        );
      }

      for (
        const highlight
        of item.highlights
      ) {
        const words =
          countWords(
            highlight
          );

        if (
          words < MIN_HIGHLIGHT_WORDS ||
          words > MAX_HIGHLIGHT_WORDS
        ) {
          errors.push(
            `"${title}" possui highlight fora do limite de ${MAX_HIGHLIGHT_WORDS} palavras.`
          );
        }
      }
    }

    if (
      !Array.isArray(
        item.hashtags
      )
    ) {
      errors.push(
        `"${title}" nao possui hashtags validas.`
      );
    } else if (
      item.hashtags.length !== 5
    ) {
      errors.push(
        `"${title}" deve possuir exatamente 5 hashtags.`
      );
    }

    if (
      !Array.isArray(
        item.fontes
      )
    ) {
      errors.push(
        `"${title}" nao possui fontes validas.`
      );
    } else if (
      item.fontes.length < 1 ||
      item.fontes.length > 3
    ) {
      errors.push(
        `"${title}" deve possuir entre 1 e 3 fontes.`
      );
    }

    if (
      !item.image_query ||
      !String(
        item.image_query
      ).trim()
    ) {
      errors.push(
        `"${title}" nao possui image_query.`
      );
    }

    const normalizedTitle =
      normalizeText(
        item.titulo
      );

    if (
      normalizedTitle &&
      titles.some(
        (existing) =>
          sameStory(
            existing,
            item
          )
      )
    ) {
      errors.push(
        `"${title}" parece duplicar outra noticia da edicao.`
      );
    }

    titles.push(item);
  }

  return errors;
}
/*
 * ============================================================
 * REPARO DAS MATERIAS
 * ============================================================
 */

const REPAIR_SCHEMA = {
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

  required: [
    "news",
  ],
};

async function repairNews(
  ai,
  news,
  errors,
  aiBudget
) {
  if (
    !Array.isArray(news) ||
    !news.length
  ) {
    return news;
  }

  console.log(
    "WIRE/GEEK: iniciando reparo automatico.",
    {
      erros: errors.length,
    }
  );

  const repairPrompt = `
Voce e o revisor final do Wire/Geek.

Recebeu uma edicao jornalistica que possui erros de validacao.

Sua tarefa e CORRIGIR somente os problemas necessarios.

NAO crie novos acontecimentos.

NAO crie novas fontes.

NAO crie novas URLs.

NAO invente datas.

NAO invente horarios.

NAO altere o acontecimento.

NAO altere a categoria.

NAO altere a fonte.

NAO substitua URLs.

NAO crie fatos.

Use somente o conteudo presente na edicao recebida.

PRINCIPAL REGRA:

Cada materia precisa possuir entre
${MIN_ARTICLE_CHARS} e ${MAX_ARTICLE_CHARS} caracteres.

Se a materia estiver abaixo de ${MIN_ARTICLE_CHARS},
expanda utilizando somente:

- fatos ja presentes;
- contexto ja presente;
- numeros ja presentes;
- datas ja presentes;
- declaracoes ja presentes;
- consequencias ja presentes;
- informacoes ja presentes na propria materia.

NAO invente fatos para aumentar o tamanho.

NAO repita a mesma frase.

NAO use preenchimento artificial.

Se a materia estiver acima de ${MAX_ARTICLE_CHARS},
reduza mantendo os fatos mais importantes.

Tambem corrija:

- exatamente 1 highlight;
- maximo de 20 palavras por highlight;
- exatamente 5 hashtags;
- 1 a 3 fontes;
- image_query;
- ausencia de travessao.

IMPORTANTE SOBRE PUBLICACAO:

NAO altere publicado_em.

NAO invente horario.

NAO transforme uma data sem horario em horario.

Se o publicado_em original nao possuir horario,
preserve-o para que o sistema possa rejeitar a noticia.

TITULOS:

Nao traduza nomes proprios.

Se o titulo estiver em ingles, traduza para portugues
brasileiro sem alterar o acontecimento.

NAO escreva explicacoes.

RETORNE SOMENTE O JSON.

ERROS ENCONTRADOS:

${JSON.stringify(
  errors,
  null,
  2
)}

EDICAO:

${JSON.stringify(
  news,
  null,
  2
)}
`;

  const response =
    await generateWithBudget(
      ai,
      aiBudget,
      {
      model: MODEL,

      contents:
        repairPrompt,

      config: {
        responseMimeType:
          "application/json",

        responseSchema:
          REPAIR_SCHEMA,

        maxOutputTokens:
          18000,
      },
        }
  );
  if (!response?.text) {
    console.log(
      "WIRE/GEEK: reparo nao retornou resposta."
    );

    return news;
  }

  const parsed =
    extractJson(
      response.text
    );

  if (
    !parsed ||
    !Array.isArray(
      parsed.news
    )
  ) {
    console.log(
      "WIRE/GEEK: reparo retornou JSON invalido."
    );

    return news;
  }

  return parsed.news;
}

/*
 * ============================================================
 * SEGUNDO REPARO ESPECIFICO PARA MATERIAS CURTAS
 * ============================================================
 */

async function repairShortArticles(
  ai,
  news,
  aiBudget
) {
  const repairedNews = [...news];

  const shortIndexes = repairedNews
    .map((item, index) => ({
      item,
      index,
    }))
    .filter(
      ({ item }) =>
        String(item?.materia || "").length <
        MIN_ARTICLE_CHARS
    )
    .map(
      ({ index }) => index
    );

  if (!shortIndexes.length) {
    return repairedNews;
  }

  console.log(
    "WIRE/GEEK: existem materias abaixo do minimo:",
    shortIndexes.length
  );

  /*
   * IMPORTANTE:
   * Todas as materias curtas sao reparadas em UMA unica
   * chamada Gemini para reduzir consumo de credito.
   */

  const shortNews = shortIndexes.map(
    (index) => ({
      index,
      noticia: repairedNews[index],
    })
  );

  const repairPrompt = `
Voce e o editor de fechamento do Wire/Geek.

Recebeu noticias que ja foram pesquisadas e possuem fatos
e fontes validados.

Sua tarefa e corrigir SOMENTE o campo "materia" das noticias
que estao abaixo do tamanho minimo.

OBJETIVO:

Cada materia retornada DEVE possuir entre
700 e 2000 caracteres.

O limite absoluto do sistema e:

MINIMO: ${MIN_ARTICLE_CHARS} caracteres.
MAXIMO: ${MAX_ARTICLE_CHARS} caracteres.

Conte SOMENTE os caracteres do campo "materia".

REGRAS ABSOLUTAS:

1. NAO altere o titulo.

2. NAO altere a categoria.

3. NAO altere publicado_em.

4. NAO altere as fontes.

5. NAO altere URLs.

6. NAO altere highlights.

7. NAO altere hashtags.

8. NAO altere image_query.

9. NAO crie novos acontecimentos.

10. NAO invente fatos.

11. NAO invente numeros.

12. NAO invente datas.

13. NAO invente horarios.

14. NAO invente declaracoes.

15. NAO adicione informacoes externas.

16. Use SOMENTE informacoes que ja estejam presentes
na materia recebida.

17. Preserve todos os fatos importantes existentes.

18. Desenvolva melhor o contexto ja presente.

19. Explique melhor as consequencias ja mencionadas.

20. Utilize datas, nomes, numeros e acontecimentos
ja presentes quando isso ajudar a desenvolver o texto.

21. NAO repita frases.

22. NAO use frases genericas apenas para aumentar
a quantidade de caracteres.

23. NAO utilize preenchimento artificial.

24. Escreva em portugues brasileiro natural,
jornalistico e profissional.

25. Mantenha exatamente 3 paragrafos.

26. Cada paragrafo deve desenvolver uma informacao
diferente presente no material original.

IMPORTANTE:

O objetivo e EXPANDIR jornalisticamente o que ja existe,
e nao criar informacoes novas.

Se uma materia original tiver poucos fatos, desenvolva
somente o contexto que ja estiver explicitamente presente
na propria materia.

RETORNE SOMENTE JSON.

FORMATO OBRIGATORIO:

{
  "reparos": [
    {
      "index": 0,
      "materia": "..."
    }
  ]
}

Os indices correspondem exatamente aos indices fornecidos
abaixo.

MATERIAS PARA REPARO:

${JSON.stringify(
  shortNews,
  null,
  2
)}
`;

  let parsed = null;

  try {
    console.log(
      "WIRE/GEEK: reparo agrupado das materias curtas iniciado.",
      {
        quantidade: shortIndexes.length,
      }
    );

    const response =
      await generateWithBudget(
        ai,
        aiBudget,
        {
          model: MODEL,

          contents:
            repairPrompt,

          config: {
            responseMimeType:
              "application/json",

            responseSchema: {
              type: "object",

              properties: {
                reparos: {
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

              required: [
                "reparos",
              ],
            },

            maxOutputTokens:
              8000,
          },
        }
      );

    parsed =
      extractJson(
        response?.text
      );

  } catch (error) {
    console.error(
      "WIRE/GEEK: erro no reparo agrupado das materias:",
      error?.message ||
        String(error)
    );

    return repairedNews;
  }

  if (
    !parsed ||
    !Array.isArray(
      parsed.reparos
    )
  ) {
    console.log(
      "WIRE/GEEK: reparo agrupado retornou JSON invalido."
    );

    return repairedNews;
  }

  for (const repair of parsed.reparos) {
    const index =
      Number(
        repair?.index
      );

    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= repairedNews.length
    ) {
      console.log(
        "WIRE/GEEK: reparo ignorado por indice invalido:",
        repair?.index
      );

      continue;
    }

    const materia =
      sanitizeArticleText(
        repair?.materia
      );

    const chars =
      materia.length;

    console.log(
      `WIRE/GEEK: materia ${index + 1}: reparo agrupado retornou ${chars} caracteres.`
    );

    if (
      chars >= MIN_ARTICLE_CHARS &&
      chars <= MAX_ARTICLE_CHARS
    ) {
      repairedNews[index] = {
        ...repairedNews[index],
        materia,
      };

      console.log(
        `WIRE/GEEK: materia ${index + 1}: tamanho validado com sucesso.`
      );

      continue;
    }

    console.log(
      `WIRE/GEEK: materia ${index + 1}: reparo rejeitado por tamanho invalido (${chars}).`
    );
  }

  return repairedNews;
}

/*
 * ============================================================
 * SELECAO FINAL
 * ============================================================
 */

/*
 * ============================================================
 * VALIDACAO FINAL DOS 3 BLOCOS
 * ============================================================
 */


function deduplicateNews(
  news
) {
  const result = [];

  for (const item of news) {
    if (!item) {
      continue;
    }

    const duplicate =
      result.some(
        (existing) =>
          sameStory(
            {
              titulo:
                existing.titulo,
            },
            {
              titulo:
                item.titulo,
            }
          )
      );

    if (!duplicate) {
      result.push(item);
    }
  }

  return result;
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
  const sessionModule = await import("./auth.js");

  if (process.env.WIREGEEK_DISABLE_GEMINI === "true") {
    console.warn(
      "WIRE/GEEK: Gemini temporariamente desativado por configuração."
    );

    return res.status(503).json({
      error: "Gemini temporariamente desativado.",
    });
  }

  if (!sessionModule.hasValidSession(req)) {
    console.warn("WIRE/GEEK: tentativa de acesso não autorizado.");
    return res.status(401).json({
      error: "Acesso não autorizado.",
    });
  }

  if (
    req.method !== "POST"
  ) {
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
          "GOOGLE_GEMINI_API_KEY nao configurada.",
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
      "Gere a edicao de hoje com as noticias reais disponiveis na pesquisa.";

    console.log(
      "WIRE/GEEK: POST /api/news recebido."
    );

    console.log(
      "WIRE/GEEK: body:",
      body
    );

    /*
     * ========================================================
     * PESQUISA
     * ========================================================
     */

    const researchBudget =
      createAIBudget(5);

    const editorialBudget =
      createAIBudget(4);

    console.log(
      "WIRE/GEEK: orçamento Gemini criado:",
      {
        pesquisa: researchBudget.maxCalls,
        editorial: editorialBudget.maxCalls,
      }
    );

    console.log(
      "WIRE/GEEK: iniciando pesquisa Gemini."
    );

    const researchData =
      await searchNews(
        ai,
        prompt,
        researchBudget
      );

    console.log(
      "WIRE/GEEK: pesquisa Gemini concluida.",
      {
        candidatos:
          Array.isArray(
            researchData?.candidatos
          )
            ? researchData.candidatos.length
            : 0,
      }
    );

    /*
     * ========================================================
     * GARANTIA DE CANDIDATOS
     * ========================================================
     */

    const validCandidatesForEdition =
  filterValidCandidates(
    researchData?.candidatos
  );

const candidateCounts =
  CATEGORIES.reduce(
    (result, category) => {
      result[category] =
        validCandidatesForEdition.filter(
          (item) =>
            item?.categoria === category
        ).length;

      return result;
    },
    {}
  );const validCandidateCount =
  validCandidatesForEdition.length;

if (validCandidateCount < MIN_NEWS) {
  return res.status(422).json({
    error:
      "Nao existem candidatos validos suficientes para montar uma edicao. O minimo e de 6 noticias.",

    candidatos_validos:
      validCandidateCount,

    minimo_necessario:
      MIN_NEWS,

    categorias:
      candidateCounts,

    janela:
      "ultimas " + RESEARCH_WINDOW_HOURS + " horas",
  });
}

let editorial =
  await formatNews(
    ai,
    researchData,
    editorialBudget
  );

    let news =
      Array.isArray(
        editorial?.news
      )
        ? editorial.news
        : [];

    console.log(
      "WIRE/GEEK: edicao inicial recebida.",
      {
        noticias:
          news.length,
      }
    );

    /*
     * ========================================================
     * VALIDACAO INICIAL
     * ========================================================
     */

   let errors = [
  ...validateNews(
    news
  ),

  ...validateNewsAgainstCandidates(
    news,
    researchData.candidatos
  ),
];

    console.log(
      "WIRE/GEEK: validacao inicial:",
      errors.length,
      "erros."
    );

    /*
     * ========================================================
     * REPARO GERAL
     * ========================================================
     */

    const hasShortArticlesInitial =
      news.some(
        (item) =>
          String(
            item?.materia || ""
          ).length <
          MIN_ARTICLE_CHARS
      );

    const onlyShortArticleErrors =
      errors.length > 0 &&
      errors.every(
        (error) =>
          String(error).includes(
            "possui materia curta:"
          )
      );

    if (
      errors.length &&
      !(
        hasShortArticlesInitial &&
        onlyShortArticleErrors
      )
    ) {

      console.log(
        "WIRE/GEEK: reparo geral necessario.",
        {
          erros: errors.length,
          somenteMateriasCurtas:
            onlyShortArticleErrors,
        }
      );

      news =
        await repairNews(
          ai,
          news,
          errors,
          editorialBudget
        );

      news =
        lockCandidateFields(
          news,
          researchData.candidatos
        );

      errors = [
        ...validateNews(
          news
        ),

        ...validateNewsAgainstCandidates(
          news,
          researchData.candidatos
        ),
      ];

      console.log(
        "WIRE/GEEK: validacao apos reparo:",
        errors.length,
        "erros."
      );
    } else if (
      hasShortArticlesInitial &&
      onlyShortArticleErrors
    ) {
      console.log(
        "WIRE/GEEK: reparo geral ignorado; somente materias curtas."
      );
    }

    /*
     * ========================================================
     * REPARO ESPECIFICO DE MATERIAS CURTAS
     * ========================================================
     */

    const hasShortArticles =
      news.some(
        (item) =>
          String(
            item?.materia || ""
          ).length <
          MIN_ARTICLE_CHARS
      );

    if (
  hasShortArticles
) {
  news =
    await repairShortArticles(
      ai,
      news,
      editorialBudget
    );

  news =
    lockCandidateFields(
      news,
      researchData.candidatos
    );

  errors = [
    ...validateNews(
      news
    ),

    ...validateNewsAgainstCandidates(
      news,
      researchData.candidatos
    ),
  ];

  console.log(
    "WIRE/GEEK: validacao apos reparo de tamanho:",
    errors.length,
    "erros."
  );
}

    /*
     * ========================================================
     * NORMALIZACAO
     * ========================================================
     */

    news =
      news.map(
        (item) => ({
          ...item,

          materia:
            sanitizeArticleText(
              item.materia
            ),

          titulo:
            String(
              item.titulo || ""
            ).trim(),

          image_query:
            String(
              item.image_query ||
                ""
            ).trim(),

          highlights:
            Array.isArray(
              item.highlights
            )
              ? item.highlights.map(
                  (value) =>
                    String(
                      value || ""
                    ).trim()
                )
              : [],

                    hashtags:
            normalizeHashtags(
              item.hashtags
            ),
        })
      );

    /*
     * ========================================================
     * VALIDACAO FINAL
     * ========================================================
     */

    news =
  deduplicateNews(
    news
  );

news =
  lockCandidateFields(
    news,
    researchData.candidatos
  );

errors = [
  ...validateNews(
    news
  ),

  ...validateNewsAgainstCandidates(
    news,
    researchData.candidatos
  ),
];

    if (errors.length) {
      console.log(
        "WIRE/GEEK: validacao final falhou.",
        errors
      );

      return res.status(422).json({
        error:
          "Gemini retornou uma edicao fora do formato esperado.",
        details:
          errors,

        diagnostico: {
          total:
            news.length,

          categorias:
            CATEGORIES.reduce(
              (
                result,
                category
              ) => {
                result[category] =
                  news.filter(
                    (item) =>
                      item?.categoria ===
                      category
                  ).length;

                return result;
              },
              {}
            ),

          regras: {
            materias:
              `${MIN_ARTICLE_CHARS}-${MAX_ARTICLE_CHARS} caracteres`,

            highlights:
              "exatamente 1",

            hashtags:
              "exatamente 5",

            fontes:
              "1 a 3",

            janela:
              "ultimas " + RESEARCH_WINDOW_HOURS + " horas",

            horario:
              "obrigatorio",

            categorias:
              "distribuicao livre",
          },
        },

        partial: {
          news,
        },
      });
    }

    /*
     * ========================================================
     * SUCESSO
     * ========================================================
     */

    console.log(
      "WIRE/GEEK: EDICAO VALIDADA COM SUCESSO."
    );

    console.log(
      "WIRE/GEEK: total:",
      news.length
    );

    console.log(
      "WIRE/GEEK: categorias:",
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
      )
    );

    console.log(
      "WIRE/GEEK: persistindo edicao no SQLite."
    );

    const persistedEdition =
  await persistEdition({
        title: "Edição Wire/Geek",
        date: new Date().toISOString(),
        status: "publicada",
        news,
        researchData,
      });

    console.log(
      "WIRE/GEEK: edicao persistida:",
      persistedEdition
    );
    return res.status(200).json({
      success: true,

      model: MODEL,

      generated_at:
        new Date().toISOString(),

      quantidade:
        news.length,

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

      news,
        researchData,
    });
  } catch (error) {
    console.error(
      "WIRE/GEEK: ERRO:",
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Erro interno ao gerar edicao.",
    });
  }
}











































































































































































































