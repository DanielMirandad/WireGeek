import { GoogleGenAI } from "@google/genai";

import {
  persistEdition,
  loadRecentPublishedNews,
} from "./persistence.js";

import {
  WIREGEEK_PROMPT,
  NEWS_SCHEMA,
  validateCanonicalShape,
} from "../lib/wiregeek-contract.mjs";

import {
  researchWireGeek,
} from "../lib/wiregeek-research.mjs";

const MODEL =
  process.env.GEMINI_MODEL ||
  "gemini-3.5-flash-lite";

function extractJson(text) {
  const value = String(text || "").trim();

  if (!value) {
    throw new Error(
      "Gemini nao retornou o JSON editorial."
    );
  }

  try {
    return JSON.parse(value);
  } catch {
    const first = value.indexOf("{");
    const last = value.lastIndexOf("}");

    if (first === -1 || last <= first) {
      throw new Error(
        "Gemini retornou JSON editorial invalido."
      );
    }

    return JSON.parse(
      value.slice(first, last + 1)
    );
  }
}

function categoryCounts(news) {
  const counts = {};

  for (const item of news) {
    const category =
      String(item?.categoria || "sem categoria")
        .trim() ||
      "sem categoria";

    counts[category] =
      (counts[category] || 0) + 1;
  }

  return counts;
}

function validateEdition(news) {
  if (!Array.isArray(news)) {
    return ["news deve ser um array"];
  }

  if (news.length < 1 || news.length > 12) {
    return [
      "a edicao deve possuir entre 1 e 12 noticias",
    ];
  }

  const errors = [];

  news.forEach((item, index) => {
    const itemErrors =
      validateCanonicalShape(item);

    for (const error of itemErrors) {
      errors.push(
        `noticia ${index + 1}: ${error}`
      );
    }
  });

  return errors;
}

async function generateEditorialNews({
  ai,
  researchData,
}) {
  const researched =
    Array.isArray(researchData?.noticias)
      ? researchData.noticias
      : [];

  if (!researched.length) {
    const error = new Error(
      "Nenhuma noticia valida foi encontrada na pesquisa."
    );

    error.code = "NO_VALID_CANDIDATES";
    throw error;
  }

  const contents = `${WIREGEEK_PROMPT}

ETAPA ATUAL: GERACAO EDITORIAL

Produza a edicao exclusivamente a partir da apuracao fornecida abaixo.

Nao acrescente acontecimentos, fontes, datas, declaracoes ou fatos que nao estejam sustentados pela apuracao.

Nao substitua uma noticia rejeitada por outra.
Nao complete quantidade.
Nao relaxe nenhuma regra do contrato.

A resposta deve seguir exatamente o schema fornecido.

APURACAO:
${JSON.stringify(researched)}`;

  const response =
    await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        responseMimeType:
          "application/json",
        responseSchema: NEWS_SCHEMA,
        maxOutputTokens: 18000,
      },
    });

  const parsed =
    extractJson(response?.text);

  if (!Array.isArray(parsed?.news)) {
    throw new Error(
      "Gemini retornou uma edicao fora do formato esperado."
    );
  }


  return parsed.news;
}

export async function generateNews(
  req,
  res,
  run = null
) {
  if (
    process.env.WIREGEEK_DISABLE_GEMINI ===
    "true"
  ) {
    return res.status(503).json({
      error:
        "Gemini temporariamente desativado.",
    });
  }

  const apiKey =
    process.env.GOOGLE_GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error:
        "GOOGLE_GEMINI_API_KEY nao configurada.",
    });
  }

  try {
    console.log(
      "WIRE/GEEK: iniciando novo pipeline."
    );

    const ai =
      new GoogleGenAI({ apiKey });

    const history =
      await loadRecentPublishedNews();

    console.log(
      "WIRE/GEEK: historico carregado:",
      Array.isArray(history)
        ? history.length
        : 0
    );

    const researchData =
      await researchWireGeek({
        ai,
        model: MODEL,
        history,
      });

    console.log(
      "WIRE/GEEK: pesquisa concluida:",
      {
        pesquisadas:
          researchData.pesquisadas,
      }
    );

    if (!researchData.noticias.length) {
      return res.status(422).json({
        code: "NO_VALID_CANDIDATES",
        error:
          "Nenhuma noticia valida foi encontrada na pesquisa.",
        pesquisadas: 0,
      });
    }

    const news =
      await generateEditorialNews({
        ai,
        researchData,
      });

    const errors =
      validateEdition(news);

    if (errors.length) {
      return res.status(422).json({
        code:
          "INVALID_EDITORIAL_EDITION",
        error:
          "Gemini retornou uma edicao fora do contrato WireGeek.",
        details: errors,
      });
    }

    console.log(
      "WIRE/GEEK: edicao validada:",
      {
        total: news.length,
        categorias:
          categoryCounts(news),
      }
    );

    const persistedEdition =
      await persistEdition({
        title: "Edição Wire/Geek",
        date: new Date().toISOString(),
        status: "publicada",
        news,
        researchData,
        execution: run,
      });

    if (
      !persistedEdition.noticiaIds.length
    ) {
      return res.status(409).json({
        code: "NO_NEW_STORIES",
        error:
          "Todas as pautas desta rodada ja estao salvas. Nenhuma nova edicao foi criada.",
        deduplication:
          persistedEdition.deduplication,
      });
    }

    const persistedNews =
      persistedEdition.retainedIndexes.map(
        (originalIndex, index) => ({
          ...news[originalIndex],
          id:
            persistedEdition
              .noticiaIds[index],
        })
      );

    console.log(
      "WIRE/GEEK: novo pipeline concluido:",
      {
        editionId:
          persistedEdition.editionId,
        persistidas:
          persistedNews.length,
      }
    );

    return res.status(200).json({
      success: true,
      generated_at:
        new Date().toISOString(),
      quantidade:
        persistedNews.length,
      categorias:
        categoryCounts(persistedNews),
      news: persistedNews,
      editionId:
        persistedEdition.editionId,
      deduplication:
        persistedEdition.deduplication,
    });
  } catch (error) {
    console.error(
      "WIRE/GEEK: ERRO:",
      error
    );

    if (
      error?.code ===
      "NO_VALID_CANDIDATES"
    ) {
      return res.status(422).json({
        code: error.code,
        error: error.message,
      });
    }

    if (
      error?.code ===
      "NO_NEW_STORIES"
    ) {
      return res.status(409).json({
        code: error.code,
        error: error.message,
      });
    }

    return res.status(500).json({
      error:
        error?.message ||
        "Erro interno ao gerar edicao.",
    });
  }
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método não permitido.",
    });
  }

  const auth =
    await import("./auth.js");

  if (
    !auth.hasValidWireGeekAuth(req)
  ) {
    return res.status(401).json({
      error: "Acesso não autorizado.",
    });
  }

  console.log(
    "WIRE/GEEK: POST /api/news recebido."
  );

  return generateNews(req, res);
}



