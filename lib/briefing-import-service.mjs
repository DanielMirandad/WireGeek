import { persistEdition } from "../api/persistence.js";
import { validateCanonicalShape } from "./wiregeek-contract.mjs";

export function parseCanonicalPayload(raw) {
  const parsed = raw;

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      "O payload do Briefing Geek 2h deve ser um objeto JSON."
    );
  }

  if (!Array.isArray(parsed.news)) {
    throw new Error(
      "O payload do Briefing Geek 2h deve possuir o array news."
    );
  }

  if (
    parsed.news.length < 1 ||
    parsed.news.length > 12
  ) {
    throw new Error(
      "O Briefing Geek 2h deve conter entre 1 e 12 noticias."
    );
  }

  parsed.news.forEach((item, index) => {
    const errors = validateCanonicalShape(item);

    if (errors.length) {
      throw new Error(
        `Noticia ${index + 1} invalida: ${errors.join("; ")}`
      );
    }
  });

  return {
    title:
      typeof parsed.title === "string" &&
      parsed.title.trim()
        ? parsed.title.trim()
        : "Briefing Geek 2h",

    generatedAt:
      typeof parsed.generatedAt === "string" &&
      parsed.generatedAt.trim()
        ? parsed.generatedAt.trim()
        : new Date().toISOString(),

    news: parsed.news,
  };
}

function buildImportMetadata(news) {
  return {
    pesquisados: news.length,

    candidatos: news.map((item) => ({
      titulo: item.titulo,
      categoria: item.categoria,
      publicado_em:
        item.fontes[0]?.publicado_em || "",
      resumo: "",
      url: item.fontes[0]?.url || "",
      fonte: item.fontes[0]?.titulo || "",
      image_query: item.image_query,
    })),

    errosValidacao: [],
  };
}

export async function persistCanonicalBriefing(raw, run) {
  const briefing = parseCanonicalPayload(raw);

  await run.progress({
    researched: briefing.news.length,
  });

  const persisted = await persistEdition({
    title: briefing.title,
    date: briefing.generatedAt,
    status: "publicada",
    news: briefing.news,
    researchData: buildImportMetadata(
      briefing.news
    ),
    execution: run,
  });

  if (!persisted.noticiaIds.length) {
    return {
      status: 409,
      body: {
        error:
          "Todas as pautas deste briefing ja estao salvas. Nenhuma nova edicao foi criada.",
        code: "NO_NEW_STORIES",
        deduplication: persisted.deduplication,
      },
    };
  }

  const noticiaIds = persisted.noticiaIds;

  if (
    noticiaIds.length !==
    persisted.retainedIndexes.length
  ) {
    throw new Error(
      "Persistencia retornou IDs inconsistentes com as noticias retidas."
    );
  }

  const news =
    persisted.retainedIndexes.map(
      (originalIndex, index) => ({
        ...briefing.news[originalIndex],
        id: noticiaIds[index],
      })
    );

  return {
    status: 200,
    body: {
      success: true,

      edition: {
        title: briefing.title,
        generatedAt: briefing.generatedAt,
        news,
      },

      persisted: true,
      deduplication: persisted.deduplication,

      noticia_ids_resolvidos:
        noticiaIds.length,
    },
  };
}