export const HIGHLIGHT_COUNT = 2;
export const MIN_HIGHLIGHT_WORDS = 8;
export const MAX_HIGHLIGHT_WORDS = 12;
export const HASHTAG_COUNT = 5;
export const REQUIRED_HASHTAG = "#bagacastudios";
export const FORBIDDEN_HASHTAG = "#wiregeek";

export function validateHashtags(hashtags) {
  if (!Array.isArray(hashtags) || hashtags.length !== HASHTAG_COUNT) {
    return ["hashtags deve possuir exatamente 5 itens"];
  }
  const errors = [];
  hashtags.forEach((tag, index) => {
    if (typeof tag !== "string" || tag !== tag.toLowerCase() || !/^#[\p{L}\p{N}_]+$/u.test(tag)) {
      errors.push(`hashtag ${index + 1} deve existir e estar em letras minusculas`);
    }
  });
  if (new Set(hashtags).size !== HASHTAG_COUNT) errors.push("hashtags devem ser distintas");
  if (!hashtags.includes(REQUIRED_HASHTAG)) errors.push(`hashtags deve incluir ${REQUIRED_HASHTAG}`);
  if (hashtags.some(tag => typeof tag === "string" && tag.toLowerCase() === FORBIDDEN_HASHTAG)) {
    errors.push(`hashtags nao deve incluir ${FORBIDDEN_HASHTAG}`);
  }
  return errors;
}
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
- musica.

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

APURAÇÃO E VALIDAÇÃO

Origem do fato:

- Uma fonte jornalística pode servir para descobrir a notícia, mas não é necessariamente a fonte primária. Abra a matéria, siga os links para o anúncio, trailer, comunicado ou página oficial e confirme que a fonte original sustenta a afirmação.
- Um título parecido ou uma URL de aparência legítima não validam uma fonte.
- Agregadores, republicações, páginas sem autoria clara, fóruns e Reddit ajudam a encontrar a notícia, mas nunca são a única base factual.

Notícia antiga reaproveitada:

- Priorize as últimas 48 horas e, dentro delas, as últimas 24 horas. Um fato mais antigo só entra com desenvolvimento novo, verificável e recente ligado a ele.
- Antes de aprovar, pesquise o mesmo assunto com datas anteriores e verifique se o anúncio já havia sido feito, se a página é antiga ou se o veículo apenas republicou.
- A data de atualização de uma página não é a data do anúncio. Só passa quando existir um elemento novo verificável.
- Entre candidatas que relatam o mesmo acontecimento, mantenha apenas uma: a de melhor fonte, mais completa e mais recente.

Conferência de detalhes:

- Confirme nomes de jogo, filme, série, anime, personagem, ator e empresa, distinguindo desenvolvedora, publisher, distribuidora e produtora.
- Data de lançamento: dia, mês, ano, região e plataforma exatamente como na fonte. "2027" não vira "janeiro de 2027". Não infira plataformas por versões anteriores.
- Respeite a natureza do material: teaser, trailer, gameplay e anúncio não são sinônimos. Confirme temporada, parte, episódio e janela de estreia. Elenco só conta se foi anunciado.
- Datas, preços, elenco, cancelamentos, adiamentos, aquisições, exclusividades, números financeiros e declarações controversas pedem uma segunda confirmação independente.
- Se duas fontes divergem, não escolha arbitrariamente: busque a fonte original ou descarte.

Rumores:

- Insiders, leaks, screenshots sem origem, fóruns e "fontes próximas" são descartados.
- "Reportedly", "may", "could", "rumored" e "expected" nunca viram fato confirmado.

Descarte e relevância:

- Descarte a notícia e procure outra quando: nenhuma fonte confiável estiver acessível; não for possível saber se o fato é novo; houver contradição fundamental; depender de rumor; a única fonte for um agregador; a manchete exagerar o conteúdo original; a data não puder ser confirmada; houver sinais de conteúdo reciclado.
- Priorize relevância alta (trailer importante, anúncio oficial, novo jogo, nova temporada, data de lançamento, aquisição, confirmação importante de elenco) e média (gameplay, atualização significativa, novos detalhes). Descarte promoções, curiosidades sem fato novo e conteúdo puramente promocional.
- Nunca reduza os critérios para completar a quantidade.

FORMATO

Pesquise notícias atuais e prepare no minimo 1 e maximo de 12 notícias.

Para cada notícia, entregue:

Título:
Título completo e editorial da notícia.

Título curto:
Identidade curta e direta da notícia.

Categoria:
Use exatamente uma destas: games, geek, cinema, anime ou musica. Séries, streaming, tecnologia e inteligência artificial entram em geek; mangá entra em anime.

Matéria:
Texto editorial em português do Brasil, natural e informativo.


Evite linguagem artificial, exageradamente promocional ou com aparência de texto gerado por IA.

Highlight:
Exatamente 2 highlight declarativo com 8 a 12 palavras.

O highlight deve apresentar uma informação factual concreta da notícia.

Hashtags:
Exatamente 5 hashtags relevantes.

Todas as hashtags devem obrigatoriamente estar em letras minúsculas.
Sempre inclua #bagacastudios entre as cinco hashtags distintas. Nunca use #wiregeek.

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
- Highlight entre 8 e 12 palavras.
- Exatamente 5 hashtags por notícia.
- Sempre incluir #bagacastudios; nunca usar #wiregeek; sem duplicatas.
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
            minItems: HASHTAG_COUNT,
            maxItems: HASHTAG_COUNT,
            description: "Cinco hashtags distintas em minúsculas, incluindo #bagacastudios e nunca #wiregeek.",
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

      if (words < MIN_HIGHLIGHT_WORDS || words > MAX_HIGHLIGHT_WORDS) {
        errors.push(
          `highlight ${index + 1} deve possuir entre 8 e 12 palavras`
        );
      }
    });
  }

  errors.push(...validateHashtags(item.hashtags));

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
