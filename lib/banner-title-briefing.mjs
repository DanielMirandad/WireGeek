import { validateApprovedVisualTitleWidth } from "./banner-renderer-briefing.mjs";
import { createGenerationCache, generationKey } from './generation-cache.mjs';
const titleCache = createGenerationCache({ name: 'banner-title', ttlMs: 60 * 60_000, maxEntries: 256 });
import {
  createOpenAIResponse,
  getOpenAIModel,
} from "./openai-responses.mjs";

function clean(value) {
  return String(value || "").trim();
}

function wordCount(value) {
  return clean(value)
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function buildTitleSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title_main: {
        type: "string",
        minLength: 1,
        maxLength: 24,
      },
      title_theme: {
        type: "string",
        minLength: 1,
        maxLength: 32,
      },
    },
    required: [
      "title_main",
      "title_theme",
    ],
  };
}

function buildPrompt(item = {}, layoutFeedback = "") {
  return [
    "Crie um titulo visual editorial em duas partes para um banner WireGeek.",
    layoutFeedback ? `Correcao obrigatoria apos medicao: ${layoutFeedback}` : "",
    "",
    "Objetivo:",
    "- O banner usa um titulo tematico em duas linhas.",
    "- A primeira linha e a entidade principal.",
    "- A segunda linha e o gancho tematico da noticia.",
    "",
    "Regras obrigatorias:",
    "- title_main: entidade principal da noticia.",
    "- title_main deve ser extremamente curto.",
    "- title_main deve preferencialmente ter UMA palavra para caber na linha visual aprovada.",
    "- title_main nao deve passar de 24 caracteres.",
    "- title_theme: complemento tematico do assunto.",
    "- title_theme deve preferencialmente ter de 1 a 2 palavras, sem perder a identificacao do assunto.",
    "- title_theme nao deve passar de 32 caracteres.",
    "- title_theme deve ser visual, direto e curto.",
    "- Ambas as linhas devem caber no limite visual de 950 px com a fonte e o tamanho fixos do template.",
    "- Nao use toda a denominacao longa da obra em title_main quando ela puder ser dividida em titulo principal e tema.",
    "- Nunca altere a grafia oficial de nomes e marcas.",
    "- Nao repetir title_main.",
    "- Nao inventar informacao.",
    "- Nao usar clickbait.",
    "- Nao usar dois-pontos, ponto final, exclamações ou frases longas.",
    "- Evite conectivos longos como 'para', 'com', 'em ambientes', 'voltado a'.",
    "- Prefira sintese editorial, por exemplo: 'Pesadelos 2026', 'IA Corporativa', 'Bob Autogerenciado', 'Novo Trailer', 'Temporada Final'.",
    "",
    "Se o assunto for tecnico ou corporativo:",
    "- prefira expressoes curtas como 'IA Corporativa', 'Codigo Aberto', 'Nova Fase', 'Versao Local', 'Modo Offline'.",
    "",
    `Categoria: ${clean(item.categoria)}`,
    `Titulo: ${clean(item.titulo)}`,
    `Titulo curto: ${clean(item.titulo_curto)}`,
    "",
    "Materia:",
    clean(item.materia),
  ].join("\n");
}

function validateVisualTitle(parsed) {
  const title_main =
    clean(parsed?.title_main);

  const title_theme =
    clean(parsed?.title_theme);

  if (!title_main || !title_theme) {
    throw new Error(
      "Titulo visual incompleto."
    );
  }

  if (title_main.length > 24) {
    throw new Error(
      `title_main excedeu 24 caracteres: ${title_main.length}.`
    );
  }

  if (title_theme.length > 32) {
    throw new Error(
      `title_theme excedeu 32 caracteres: ${title_theme.length}.`
    );
  }

  if (wordCount(title_main) > 3) {
    throw new Error(
      `title_main excedeu 3 palavras: ${title_main}`
    );
  }

  if (wordCount(title_theme) > 5) {
    throw new Error(
      `title_theme excedeu 5 palavras: ${title_theme}`
    );
  }

  if (
    title_main.toLowerCase() ===
    title_theme.toLowerCase()
  ) {
    throw new Error(
      "title_main e title_theme nao podem ser iguais."
    );
  }

  return {
    title_main,
    title_theme,
  };
}

export async function deriveBannerVisualTitle(
  item = {},
  { forceRegenerate = false, layoutFeedback = "" } = {}
) {
  const model =
    getOpenAIModel(
      "OPENAI_BANNER_TITLE_MODEL",
      "gpt-5.6-terra"
    );

  const prompt = buildPrompt(item, layoutFeedback);
  return titleCache.run(
    generationKey({ version: 'banner-title-v1', model, prompt }),
    () => generateValidatedTitle(model, prompt),
    { refresh: forceRegenerate, cacheIf: value => {
      try { validateVisualTitle(value); return true; } catch { return false; }
    } }
  );
}

// Duas propostas no maximo; o renderer e a autoridade sobre largura real.
export async function deriveFittingBannerVisualTitle(item = {}, {
  generate = deriveBannerVisualTitle,
  validate = validateApprovedVisualTitleWidth,
  maxAttempts = 2,
} = {}) {
  let feedback = "";
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = await generate(item, {
      forceRegenerate: attempt > 0,
      layoutFeedback: feedback,
    });
    try {
      await validate(candidate.title_main, candidate.title_theme);
      return candidate;
    } catch (error) {
      if (!["TITLE_MAIN_TOO_LONG", "TITLE_THEME_TOO_LONG"].includes(error?.code)) {
        throw error;
      }
      lastError = error;
      feedback = error.message + " Divida ou encurte SOMENTE o titulo visual, conservando nomes oficiais.";
    }
  }
  throw lastError || new Error("VISUAL_TITLE_NO_FIT");
}

async function generateValidatedTitle(model, prompt) {
  const generated =
    await createOpenAIResponse({
      model,
      purpose: 'banner-title',

      instructions:
        "Derive somente o titulo visual solicitado. " +
        "Nao altere o conteudo factual da noticia. " +
        "Priorize concisao extrema e legibilidade visual.",

      input:
        prompt,

      reasoning: {
        effort: "low",
      },

      text: {
        format: {
          type: "json_schema",
          name: "wiregeek_banner_title",
          strict: true,
          schema:
            buildTitleSchema(),
        },
      },

      maxOutputTokens: 120,
      timeoutMs: 20000,
    });

  const parsed =
    JSON.parse(
      generated.text
    );

  return validateVisualTitle(
    parsed
  );
}
