import {
  NEWS_SCHEMA,
  WIREGEEK_PROMPT,
} from "./wiregeek-contract.mjs";

import {
  createOpenAIResponse,
  getOpenAIModel,
} from "./openai-responses.mjs";

import {
  persistCanonicalBriefing,
} from "./briefing-import-service.mjs";

import {
  loadRecentPublishedNews,
} from "../api/persistence.js";

function buildStructuredSchema() {
  return {
    ...NEWS_SCHEMA,
    additionalProperties: false,
    required: ["news"],
    properties: {
      ...NEWS_SCHEMA.properties,
      news: {
        ...NEWS_SCHEMA.properties.news,
        items: {
          ...NEWS_SCHEMA.properties.news.items,
          additionalProperties: false,
          required: [
            "titulo",
            "titulo_curto",
            "categoria",
            "materia",
            "highlights",
            "hashtags",
            "fontes",
            "fonte_oficial_primaria",
            "image_query",
          ],
          properties: {
            ...NEWS_SCHEMA.properties.news.items.properties,
            fontes: {
              ...NEWS_SCHEMA.properties.news.items.properties.fontes,
              items: {
                ...NEWS_SCHEMA.properties.news.items.properties.fontes.items,
                additionalProperties: false,
                required: [
                  "titulo",
                  "url",
                  "publicado_em",
                ],
              },
            },
            fonte_oficial_primaria: {
              ...NEWS_SCHEMA.properties.news.items.properties
                .fonte_oficial_primaria,
              additionalProperties: false,
              required: [
                "encontrada",
                "titulo",
                "url",
              ],
            },
          },
        },
      },
    },
  };
}

function buildEditorialHistoryContext(history) {
  const entries =
    Array.isArray(history)
      ? history.map((item) => ({
          id:
            item?.id ?? null,

          titulo:
            String(item?.titulo || "").trim(),

          titulo_curto:
            String(item?.titulo_curto || "").trim(),

          publicado_em:
            String(item?.publicado_em || "").trim(),

          criado_em:
            String(item?.criado_em || "").trim(),

          fontes:
            Array.isArray(item?.fontes)
              ? item.fontes
                  .map((source) =>
                    String(source?.url || "").trim()
                  )
                  .filter(Boolean)
              : [],
        }))
      : [];

  return [
    "CONTEXTO DE CONTINUIDADE EDITORIAL DO WIREGEEK:",
    "As pautas abaixo ja foram publicadas anteriormente.",
    "Use este historico para interpretar a regra de nao repeticao do contrato editorial.",
    "Nao repita uma pauta apenas com nova redacao.",
    "Uma historia anterior pode reaparecer somente quando a pesquisa web confirmar um desenvolvimento concreto novo.",
    "O mesmo personagem, franquia, jogo, filme, serie ou anime nao torna automaticamente uma nova noticia repetida.",
    "",
    JSON.stringify(entries),
  ].join("\n");
}

function parseGeneratedBriefing(text) {
  if (!text || !text.trim()) {
    throw new Error(
      "OpenAI nao retornou o briefing canonico."
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "OpenAI retornou JSON invalido para o briefing."
    );
  }
}

export async function generateCanonicalBriefing() {
  const history =
    await loadRecentPublishedNews();

  const historyContext =
    buildEditorialHistoryContext(
      history
    );

  const model =
    getOpenAIModel(
      "OPENAI_BRIEFING_MODEL",
      "gpt-5.6-terra"
    );

  const generated =
    await createOpenAIResponse({
      model,

      instructions:
        "Execute integralmente o contrato editorial fornecido. " +
        "Use pesquisa web atual para apurar as noticias. " +
        "Entregue somente o objeto estruturado solicitado.",

      input: [
        WIREGEEK_PROMPT,
        "",
        historyContext,
      ].join("\n"),

      tools: [
        {
          type: "web_search",
          search_context_size: "high",
        },
      ],

      toolChoice:
        "required",

      reasoning: {
        effort: "high",
      },

      text: {
        format: {
          type: "json_schema",
          name: "wiregeek_briefing",
          strict: true,
          schema: buildStructuredSchema(),
        },
      },

      maxOutputTokens: 12000,
      timeoutMs: 280000,
    });

  return parseGeneratedBriefing(
    generated.text
  );
}

export async function executeBriefing(run) {
  const payload =
    await generateCanonicalBriefing();

  return persistCanonicalBriefing(
    payload,
    run
  );
}