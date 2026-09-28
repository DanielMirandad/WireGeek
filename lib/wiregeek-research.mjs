const RESEARCH_SCHEMA = {
  type: "object",
  properties: {
    noticias: {
      type: "array",
      minItems: 0,
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          titulo: { type: "string" },
          categoria: { type: "string" },
          resumo_factual: { type: "string" },
          publicado_em: { type: "string" },
          fontes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                titulo: { type: "string" },
                url: { type: "string" },
                publicado_em: { type: "string" },
                oficial: { type: "boolean" },
              },
              required: ["titulo", "url", "oficial"],
            },
          },
          fonte_oficial_primaria: {
            type: "object",
            properties: {
              encontrada: { type: "boolean" },
              titulo: { type: "string" },
              url: { type: "string" },
            },
            required: ["encontrada"],
          },
          fatos_confirmados: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: [
          "titulo",
          "categoria",
          "resumo_factual",
          "fontes",
          "fonte_oficial_primaria",
          "fatos_confirmados",
        ],
      },
    },
  },
  required: ["noticias"],
};

function extractJson(text) {
  const value = String(text || "").trim();

  if (!value) {
    throw new Error("Pesquisa retornou resposta vazia.");
  }

  try {
    return JSON.parse(value);
  } catch {
    const first = value.indexOf("{");
    const last = value.lastIndexOf("}");

    if (first === -1 || last <= first) {
      throw new Error("Pesquisa nao retornou JSON valido.");
    }

    return JSON.parse(value.slice(first, last + 1));
  }
}

function compactHistory(history) {
  if (!Array.isArray(history)) return [];

  return history.map((item) => ({
    titulo: item?.titulo || "",
    titulo_curto: item?.titulo_curto || "",
    categoria: item?.categoria || "",
    publicado_em:
      item?.publicado_em ||
      item?.data_publicacao ||
      item?.created_at ||
      "",
    fontes: Array.isArray(item?.fontes)
      ? item.fontes.map((fonte) => ({
          titulo: fonte?.nome || "",
          url: fonte?.url || "",
        }))
      : [],
  }));
}

export async function researchWireGeek({
  ai,
  model,
  history,
}) {
  if (!ai) {
    throw new Error("Cliente Gemini ausente na pesquisa.");
  }

  if (!model) {
    throw new Error("Modelo Gemini ausente na pesquisa.");
  }

  const previous = compactHistory(history);

  const contents = `PESQUISA E APURACAO WIREGEEK

Pesquise acontecimentos atuais que possam originar no minimo 1 e no maximo 12 noticias para o WireGeek.

Priorize:
- cultura geek e cultura pop;
- cinema;
- series e streaming;
- games;
- anime e manga;
- tecnologia e inteligencia artificial.

De mais peso a:
- trailers;
- anuncios oficiais;
- lancamentos;
- novidades de producoes;
- assuntos viralizando;
- grandes acontecimentos;
- novos jogos, filmes, series e animes;
- anuncios de elenco, datas, plataformas e novos projetos.

FRESCOR E NAO REPETICAO

Priorize desenvolvimentos realmente novos desde a execucao anterior.

Evite repetir uma noticia ja utilizada anteriormente quando nao existir um fato novo relevante.

Uma historia anterior somente pode reaparecer quando houver desenvolvimento concreto, como novo trailer, nova data, lancamento, novo elenco, nova plataforma, gameplay, novo episodio ou temporada, comunicado oficial ou mudanca relevante na producao.

FONTES E CONFIRMACAO

Use uma combinacao ampla de fontes confiaveis e atuais.

Inclua Omelete e IGN Brasil quando forem relevantes, sem prioridade fixa.

Sempre que possivel, confirme fatos, datas, trailers, lancamentos, plataformas, elenco e declaracoes em fonte oficial primaria, como estudio, publisher, plataforma, produtora, fabricante, site oficial, newsroom, conta oficial ou canal oficial no YouTube.

Nao invente fatos, datas, URLs, declaracoes ou fontes.

Nao inclua rumores, vazamentos nao confirmados, listas ou rankings.

Para cada acontecimento:
- registre um titulo factual de identificacao;
- informe a categoria editorial mais adequada;
- produza apenas um resumo factual da apuracao;
- registre de 1 a 3 fontes reais utilizadas;
- indique se existe fonte oficial primaria e identifique-a quando existir;
- registre em fatos_confirmados somente informacoes sustentadas pelas fontes;
- informe a data de publicacao quando disponivel.

Esta etapa NAO deve escrever materia editorial, titulo curto, highlights, hashtags ou image_query.
Esta etapa deve retornar somente os dossies factuais definidos pelo schema de resposta.

Se nenhum acontecimento atender a essas regras, retorne noticias como array vazio.

HISTORICO DE NOTICIAS JA UTILIZADAS:
${JSON.stringify(previous)}`;

  const response = await ai.interactions.create({
    model,
    input: contents,
    tools: [
      {
        type: "google_search",
      },
    ],
    response_format: [
      {
        type: "text",
        mime_type: "application/json",
        schema: RESEARCH_SCHEMA,
      },
    ],
  });

  const parsed = extractJson(response?.output_text);

  if (!Array.isArray(parsed?.noticias)) {
    throw new Error("Pesquisa retornou estrutura invalida.");
  }

  if (parsed.noticias.length > 12) {
    throw new Error("Pesquisa retornou mais de 12 noticias.");
  }

  return {
    noticias: parsed.noticias,
    pesquisadas: parsed.noticias.length,
  };
}




