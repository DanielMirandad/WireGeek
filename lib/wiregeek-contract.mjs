export const HIGHLIGHT_COUNT = 2;
export const MIN_HIGHLIGHT_WORDS = 15;
export const MAX_HIGHLIGHT_WORDS = 25;
export const HASHTAG_COUNT = 5;
export const SOURCE_MIN_COUNT = 1;
export const SOURCE_MAX_COUNT = 3;

export function cleanEditorialText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

export function validateHighlights(highlights) {
  const errors = [];

  if (!Array.isArray(highlights)) {
    return ["highlights deve ser um array"];
  }

  if (highlights.length !== HIGHLIGHT_COUNT) {
    errors.push(
      `highlights deve conter exatamente ${HIGHLIGHT_COUNT} itens`
    );
  }

  highlights.forEach((highlight, index) => {
    const text = cleanEditorialText(highlight);
    const words = text
      .split(/\s+/)
      .filter(Boolean)
      .length;

    if (!text) {
      errors.push(
        `highlight ${index + 1} esta vazio`
      );
      return;
    }

    if (
      words < MIN_HIGHLIGHT_WORDS ||
      words > MAX_HIGHLIGHT_WORDS
    ) {
      errors.push(
        `highlight ${index + 1} deve possuir entre ${MIN_HIGHLIGHT_WORDS} e ${MAX_HIGHLIGHT_WORDS} palavras`
      );
    }
  });

  return errors;
}

export const WIREGEEK_PROMPT = `Pesquise notícias atuais e prepare no minimo 1 e maximo de 12 notícias em português do Brasil para o wiregeek.

Priorize:

- cultura geek e cultura pop;
- cinema;
- séries e streaming;
- games;
- anime e mangá;
- tecnologia e inteligência artificial.

Dê mais peso a:

- trailers;
- anúncios oficiais;
- lançamentos;
- novidades de produções;
- assuntos viralizando;
- grandes acontecimentos;
- novos jogos, filmes, séries e animes;
- anúncios de elenco, datas, plataformas e novos projetos.

FRESCOR E NÃO REPETIÇÃO

Priorize desenvolvimentos realmente novos desde a execução anterior.

Evite repetir uma notícia já utilizada anteriormente quando não existir um fato novo relevante.

Uma história anterior só deve reaparecer quando houver desenvolvimento concreto, como:

- novo trailer;
- nova data;
- lançamento;
- novo elenco;
- nova plataforma;
- gameplay;
- novo episódio ou temporada;
- comunicado oficial;
- mudança relevante na produção.

FONTES

Use uma combinação ampla de fontes confiáveis e atuais.

Inclua Omelete e IGN Brasil (br.ign.com) quando forem relevantes, mas não dê prioridade fixa a essas duas fontes.

Sempre que possível, confirme fatos, datas, trailers, lançamentos, plataformas, elenco e declarações em uma fonte oficial primária, como:

- estúdio;
- publisher;
- plataforma;
- produtora;
- fabricante;
- site oficial;
- newsroom;
- conta oficial;
- canal oficial no YouTube.

Não invente fatos, datas, URLs, declarações ou fontes.

Não inclua rumores, vazamentos não confirmados, listas ou rankings.

FORMATO

Pesquise notícias atuais e prepare no minimo 1 e maximo de 12 notícias.

Para cada notícia, entregue:

Título:
Título completo e editorial da notícia.

Título curto:
Identidade curta e direta da notícia.

Categoria:
Use a categoria editorial mais adequada.

Matéria:
Texto editorial em português do Brasil, natural e informativo.


Evite linguagem artificial, exageradamente promocional ou com aparência de texto gerado por IA.

Highlight:
Exatamente 2 highlight declarativo com 15 a 25 palavras.

O highlight deve apresentar uma informação factual concreta da notícia.

Hashtags:
Exatamente 5 hashtags relevantes.

Todas as hashtags devem obrigatoriamente estar em letras minúsculas.

Fontes:
Inclua de 1 a 3 fontes reais utilizadas na apuração.

Para cada fonte, informe:

- título;
- URL;
- data de publicação, quando disponível.


image_query:
Crie uma consulta específica destinada a localizar uma imagem real e oficial diretamente relacionada à notícia.

Priorize imagens provenientes da produção, estúdio, publisher, plataforma, fabricante ou canal oficial relacionado ao assunto.

REGRAS EDITORIAIS

- Escreva em português do Brasil.
- Não invente informações.
- Não use rumores como notícia.
- Não produza listas ou rankings.
- Não repita histórias anteriores sem desenvolvimento relevante.
- Diferencie claramente fatos confirmados de informações ainda não anunciadas.
- Não transforme ausência de informação em especulação.
- Prefira acontecimentos recentes e concretos.
- Dê preferência a fontes oficiais primárias para informações essenciais.
- Minimo 1 e maximo de 12 notícias
- Exatamente 2 highlight por notícia.
- Highlight entre 15 e 25 palavras.
- Exatamente 5 hashtags por notícia.
- Hashtags sempre em letras minúsculas.`;

export const NEWS_SCHEMA = {
  type: "object",
  properties: {
    news: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          titulo: { type: "string" },
          titulo_curto: { type: "string" },
          categoria: { type: "string" },
          materia: { type: "string" },
          highlights: {
            type: "array",
            items: { type: "string" },
          },
          hashtags: {
            type: "array",
            items: { type: "string" },
          },
          fontes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                titulo: { type: "string" },
                url: { type: "string" },
                publicado_em: { type: "string" },
              },
              required: ["titulo", "url"],
            },
          },

          image_query: { type: "string" },
        },
        required: [
          "titulo",
          "titulo_curto",
          "categoria",
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

function wordCount(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

export function validateCanonicalShape(item) {
  const errors = [];

  if (!item || typeof item !== "object") {
    return ["noticia ausente ou invalida"];
  }

  for (const field of [
    "titulo",
    "titulo_curto",
    "categoria",
    "materia",
    "image_query",
  ]) {
    if (typeof item[field] !== "string" || !item[field].trim()) {
      errors.push(`${field} ausente ou vazio`);
    }
  }


  const materia =
    String(
      item.materia || ""
    );

  if (
    /\[[^\]]+\]\([^)]+\)/.test(
      materia
    )
  ) {
    errors.push(
      "materia nao deve conter links Markdown"
    );
  }

  if (
    /utm_source=openai/i.test(
      materia
    )
  ) {
    errors.push(
      "materia nao deve conter parametros de citacao OpenAI"
    );
  }
  if (!Array.isArray(item.highlights) || item.highlights.length !== 2) {
    errors.push("highlights deve possuir exatamente 2 itens");
  } else {
    item.highlights.forEach((highlight, index) => {
      const words = wordCount(highlight);

      if (words < 15 || words > 25) {
        errors.push(
          `highlight ${index + 1} deve possuir entre 15 e 25 palavras`
        );
      }
    });
  }

  if (!Array.isArray(item.hashtags) || item.hashtags.length !== 5) {
    errors.push("hashtags deve possuir exatamente 5 itens");
  } else {
    item.hashtags.forEach((hashtag, index) => {
      if (
        typeof hashtag !== "string" ||
        !hashtag.trim() ||
        hashtag !== hashtag.toLowerCase()
      ) {
        errors.push(
          `hashtag ${index + 1} deve existir e estar em letras minusculas`
        );
      }
    });
  }

  if (
    !Array.isArray(item.fontes) ||
    item.fontes.length < 1 ||
    item.fontes.length > 3
  ) {
    errors.push("fontes deve possuir entre 1 e 3 itens");
  } else {
    item.fontes.forEach((fonte, index) => {
      if (
        !fonte ||
        typeof fonte !== "object" ||
        typeof fonte.titulo !== "string" ||
        !fonte.titulo.trim() ||
        typeof fonte.url !== "string" ||
        !fonte.url.trim()
      ) {
        errors.push(`fonte ${index + 1} invalida`);
      }
    });
  }


  return errors;
}
