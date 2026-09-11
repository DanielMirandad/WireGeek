import {
  cleanEditorialText,
  validateHighlights,
} from "./editorial-rules.mjs";

const CATEGORY_MAP = new Map([
  ["games", "games"],
  ["game", "games"],
  ["jogos", "games"],

  ["geek", "geek"],
  ["tecnologia", "geek"],
  ["tecnologia / ia", "geek"],
  ["tecnologia/ia", "geek"],
  ["ia", "geek"],
  ["ai", "geek"],

  ["cinema", "cinema"],
  ["cinema / streaming", "cinema"],
  ["cinema/streaming", "cinema"],
  ["series", "cinema"],
  ["séries", "cinema"],
  ["streaming", "cinema"],

  ["anime", "anime"],
  ["anime / manga", "anime"],
  ["anime / mangá", "anime"],
  ["anime/manga", "anime"],
  ["anime/mangá", "anime"],
  ["manga", "anime"],
  ["mangá", "anime"],
]);

function clean(value) {
  return cleanEditorialText(
    String(value || "")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function plain(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function asciiLower(value) {
  return plain(value)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

export function normalizeBriefingCategory(
  value
) {
  const original =
    plain(value).toLowerCase();

  if (CATEGORY_MAP.has(original)) {
    return CATEGORY_MAP.get(original);
  }

  const normalized =
    asciiLower(value);

  if (
    /\b(game|games|jogo|jogos)\b/.test(
      normalized
    )
  ) {
    return "games";
  }

  if (
    /\b(anime|manga)\b/.test(normalized)
  ) {
    return "anime";
  }

  if (
    /\b(cinema|filme|streaming|serie|series|tv)\b/.test(
      normalized
    )
  ) {
    return "cinema";
  }

  if (
    /\b(geek|tecnologia|tech|ia|ai|inteligencia artificial)\b/.test(
      normalized
    )
  ) {
    return "geek";
  }

  return "geek";
}

function normalizeShortTitle(
  value,
  fallback = ""
) {
  let source = clean(value || fallback);

  if (!source) {
    return "";
  }

  const segment =
    source
      .split(/\s*(?:\/|\||:)\s*/)[0]
      .trim();

  if (segment) {
    source = segment;
  }

  let words =
    source
      .split(/\s+/)
      .filter(Boolean);

  if (words.length > 2) {
    words = words.slice(0, 2);
  }

  let result = words.join(" ");

  if (result.length > 24) {
    result =
      words[0] ||
      result.slice(0, 24);
  }

  if (result.length > 24) {
    result =
      result.slice(0, 24).trim();
  }

  return result;
}

function normalizeHashtag(value) {
  const tag =
    plain(value).replace(/\s+/g, "");

  if (!tag) {
    return "";
  }

  return tag.startsWith("#")
    ? tag
    : `#${tag}`;
}

function normalizeSource(source) {
  if (typeof source === "string") {
    return {
      nome: clean(source),
      url: "",
      publicado_em: "",
    };
  }

  if (
    !source ||
    typeof source !== "object"
  ) {
    return {
      nome: "",
      url: "",
      publicado_em: "",
    };
  }

  return {
    nome: clean(
      source.nome ||
      source.name ||
      source.fonte ||
      ""
    ),

    url: plain(
      source.url ||
      source.link ||
      ""
    ),

    publicado_em: plain(
      source.publicado_em ||
      source.published_at ||
      source.data ||
      ""
    ),
  };
}

function normalizeImageCandidates(item) {
  const list = [
    ...(Array.isArray(item.imagens)
      ? item.imagens
      : []),

    ...(Array.isArray(
      item.image_candidates
    )
      ? item.image_candidates
      : []),
  ];

  const primary =
    item.image_url ||
    item.imageUrl ||
    item.imagem;

  if (primary) {
    list.unshift(primary);
  }

  const seen = new Set();
  const normalized = [];

  for (const entry of list) {
    const candidate =
      typeof entry === "string"
        ? { url: entry }
        : { ...(entry || {}) };

    const url = plain(
      candidate.url ||
      candidate.image_url ||
      candidate.link ||
      ""
    );

    if (
      !/^https?:\/\//i.test(url) ||
      seen.has(url)
    ) {
      continue;
    }

    seen.add(url);

    normalized.push({
      ...candidate,
      url,
    });
  }

  return normalized.slice(0, 10);
}

function extractJson(raw) {
  if (
    raw &&
    typeof raw === "object"
  ) {
    return raw;
  }

  const text =
    String(raw || "").trim();

  if (!text) {
    throw new Error(
      "Cole o bloco WIREGEEK_JSON gerado pelo Briefing Geek Diário."
    );
  }

  try {
    return JSON.parse(text);
  } catch {}

  const markerIndex =
    text.lastIndexOf("WIREGEEK_JSON");

  const scoped =
    markerIndex >= 0
      ? text.slice(markerIndex)
      : text;

  const fenced = [
    ...scoped.matchAll(
      /```(?:json)?\s*([\s\S]*?)```/gi
    ),
  ];

  for (
    let index = fenced.length - 1;
    index >= 0;
    index--
  ) {
    try {
      return JSON.parse(
        fenced[index][1].trim()
      );
    } catch {}
  }

  const first =
    scoped.indexOf("{");

  const last =
    scoped.lastIndexOf("}");

  if (
    first >= 0 &&
    last > first
  ) {
    try {
      return JSON.parse(
        scoped.slice(
          first,
          last + 1
        )
      );
    } catch {}
  }

  throw new Error(
    "Nao foi encontrado JSON valido no bloco do Briefing Geek Diário."
  );
}

function normalizeBannerEntries(
  item,
  highlights,
  fallbackTitle
) {
  const supplied =
    Array.isArray(item.banners)
      ? item.banners
      : [];

  const titleArray =
    Array.isArray(item.banner_titles)
      ? item.banner_titles
      : [];

  return highlights.map(
    (highlight, index) => {
      const raw =
        supplied[index];

      const object =
        raw &&
        typeof raw === "object"
          ? raw
          : {};

      const headline =
        object.banner_title ||
        object.headline ||
        object.titulo ||
        titleArray[index] ||
        (typeof raw === "string"
          ? raw
          : "") ||
        fallbackTitle;

      return {
        banner_title:
          clean(headline),

        highlight:
          clean(
            object.highlight ||
            highlight
          ),
      };
    }
  );
}

export function normalizeBriefingItem(
  item = {},
  index = 0
) {
  const titulo = clean(
    item.titulo ||
    item.title ||
    item.titulo_completo ||
    ""
  );

  const materia = clean(
    item.materia ||
    item.article ||
    item.texto ||
    ""
  );

  const categoria =
    normalizeBriefingCategory(
      item.categoria ||
      item.category ||
      ""
    );

  const tituloCurto =
    normalizeShortTitle(
      item.titulo_curto ||
      item.short_title ||
      item.manchete_curta,

      titulo
    );

  if (!titulo) {
    throw new Error(
      `Noticia ${index + 1}: titulo ausente.`
    );
  }

  if (!materia) {
    throw new Error(
      `Noticia ${index + 1}: materia ausente.`
    );
  }

  if (materia.length < 500 || materia.length > 2000) {
    throw new Error(
      `Noticia ${index + 1}: materia deve conter entre 500 e 2000 caracteres (recebidos: ${materia.length}).`
    );
  }

  if (!tituloCurto) {
    throw new Error(
      `Noticia ${index + 1}: titulo_curto ausente.`
    );
  }

  const highlights =
    (
      Array.isArray(item.highlights)
        ? item.highlights
        : []
    )
      .map(clean)
      .filter(Boolean)
      .slice(0, 2);

  const highlightIssues =
    validateHighlights(
      highlights,
      titulo
    );

  if (highlightIssues.length) {
    throw new Error(
      `Noticia ${index + 1}: ${highlightIssues.join("; ")}.`
    );
  }

  const hashtags =
    (
      Array.isArray(item.hashtags)
        ? item.hashtags
        : []
    )
      .map(normalizeHashtag)
      .filter(Boolean)
      .slice(0, 5);

  if (hashtags.length !== 5) {
    throw new Error(
      `Noticia ${index + 1}: informe exatamente 5 hashtags.`
    );
  }

  const fontes =
    (
      Array.isArray(item.fontes)
        ? item.fontes
        : []
    )
      .map(normalizeSource)
      .filter(
        (source) =>
          source.nome ||
          source.url
      )
      .slice(0, 3);

  if (!fontes.length) {
    throw new Error(
      `Noticia ${index + 1}: informe pelo menos uma fonte.`
    );
  }

  const contextoVisual = clean(
    item.contexto_visual ||
    item.visual_context ||
    item.contextoVisual ||
    item.orientacao_visual ||
    ""
  );

  const imageQuery = clean(
    item.image_query ||
    item.consulta_imagem ||
    [titulo, contextoVisual]
      .filter(Boolean)
      .join(" ")
  );

  const bannerFallback = clean(
    item.banner_title ||
    titulo
  );

  const banners =
    normalizeBannerEntries(
      item,
      highlights,
      bannerFallback
    );

  const imagens =
    normalizeImageCandidates(item);

  return {
    id: item.id || null,

    categoria,

    titulo,

    titulo_curto:
      tituloCurto,

    publicado_em: plain(
      item.publicado_em ||
      item.published_at ||
      "Últimas 48h"
    ),

    materia,

    resumo: clean(
      item.resumo ||
      item.summary ||
      item.por_que_importa ||
      ""
    ),

    por_que_importa: clean(
      item.por_que_importa ||
      item.why_it_matters ||
      ""
    ),

    highlights,

    hashtags,

    fontes,

    contexto_visual:
      contextoVisual,

    image_query:
      imageQuery,

    image_url:
      imagens[0]?.url || "",

    imagens,

    banners,

    briefing_source: true,
  };
}

export function parseBriefingPayload(
  raw
) {
  const parsed =
    extractJson(raw);

  const items =
    Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.news)
        ? parsed.news
        : Array.isArray(
          parsed.noticias
        )
          ? parsed.noticias
          : [];

  if (!items.length) {
    throw new Error(
      "O payload do Briefing nao contem noticias."
    );
  }

  if (items.length > 12) {
    throw new Error(
      "O WireGeek aceita no maximo 12 noticias por edicao."
    );
  }

  const news =
    items.map(normalizeBriefingItem);

  return {
    title: clean(
      parsed.title ||
      parsed.titulo ||
      "Briefing Geek Diário"
    ),

    generatedAt: plain(
      parsed.generated_at ||
      parsed.generatedAt ||
      parsed.data_edicao ||
      new Date().toISOString()
    ),

    news,
  };
}
