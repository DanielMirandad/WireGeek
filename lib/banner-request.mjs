import { cleanEditorialText, validateHighlights } from "./editorial-rules.mjs";

function buildEditorialImageQuery(item, fallbackTitle) {
  const contextSource = [
    item.titulo,
    item.title,
    item.titulo_curto,
    fallbackTitle,
    item.materia,
    item.categoria,
    item.category,
  ]
    .filter(Boolean)
    .join(" ");

  const context = contextSource
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

  const qualifiers = [];
  if (/\bremake\b/.test(context)) qualifiers.push("remake");
  if (/\bremaster(?:ed)?\b/.test(context)) qualifiers.push("remaster");
  if (/\breboot\b/.test(context)) qualifiers.push("reboot");
  if (/\bcontinuacao\b/.test(context)) qualifiers.push("continuacao");
  if (/\b(?:sequel|sequencia)\b/.test(context)) qualifiers.push("sequel");
  if (/\b(?:nova|segunda|terceira|quarta)\s+temporada\b/.test(context)) {
    qualifiers.push("nova temporada");
  }

  const base = [
    ...new Set(
      [fallbackTitle, ...qualifiers, item.titulo, item.image_query]
        .filter(Boolean)
        .map((value) => String(value).trim())
    ),
  ].join(" ");

  let visual = "official press photo editorial photo";

  if (/\b(jogo|game|games|gaming|playstation|xbox|nintendo|steam|capcom|ubisoft)\b/.test(context)) {
    visual = "official gameplay screenshot in-game scene";
  } else if (/\b(anime|manga|crunchyroll)\b/.test(context)) {
    visual = "official anime scene still character image";
  } else if (/\b(novela|tv globo|globo|televisao|serie|series|ator|atriz|elenco)\b/.test(context)) {
    visual = "official cast photo scene still press photo";
  } else if (/\b(filme|cinema|movie|actor|actress|director|diretor)\b/.test(context)) {
    visual = "official movie still cast scene press photo";
  }

  return (
    base +
    " " +
    visual +
    " -logo -banner -thumbnail -wallpaper -template -collage -poster -mockup -desktop -interface"
  )
    .replace(/\s+/g, " ")
    .trim();
}

const MAX_BANNER_TITLE_CHARS = 48;

function cutTitleAtWordBoundary(value, maxChars = MAX_BANNER_TITLE_CHARS) {
  const source = String(value || "").replace(/\s+/g, " ").trim();
  if (source.length <= maxChars) return source;

  const cut = source.slice(0, maxChars + 1);
  const boundary = cut.lastIndexOf(" ");
  let result = (boundary >= Math.floor(maxChars * 0.62)
    ? cut.slice(0, boundary)
    : source.slice(0, maxChars)
  ).trim();

  // Nao deixe o titulo terminar em conectivos que so fazem sentido
  // quando a frase continua na linha seguinte.
  result = result.replace(
    /\s+(?:a|ao|aos|as|com|da|das|de|do|dos|e|em|na|nas|no|nos|para|por|seu|seus|sua|suas)$/i,
    ""
  );

  return result || source.slice(0, maxChars).trim();
}

function compactEditorialEvent(value) {
  return String(value || "")
    .replace(/\bum milhão\b/gi, "1 milhão")
    .replace(/\bdois milhões\b/gi, "2 milhões")
    .replace(/\btrês milhões\b/gi, "3 milhões")
    .replace(/\bquatro milhões\b/gi, "4 milhões")
    .replace(/\bcinco milhões\b/gi, "5 milhões")
    .replace(/\ba (?:expressiva )?marca de\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildEditorialBannerTitle(item, fallbackTitle, primaryHighlight = "") {
  const source = cleanEditorialText(
    item.banner_title || item.titulo || item.title || fallbackTitle
  )
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "")
    .trim();

  if (!source) return fallbackTitle;
  if (source.length <= MAX_BANNER_TITLE_CHARS) return source;

  const subject = String(fallbackTitle || "").trim();
  const eventSource = compactEditorialEvent(primaryHighlight || source);

  // Para titulos muito longos, preserve o assunto curto e reaproveite a
  // primeira acao factual encontrada no titulo/highlight. Nenhum fato novo
  // e criado; apenas removemos palavras excedentes para o headline visual.
  const verbMatch = eventSource.match(
    /\b(alcanç\w*|anunci\w*|apresent\w*|ating\w*|bat\w*|cheg\w*|confirm\w*|estre\w*|ganh\w*|lanç\w*|lider\w*|marc\w*|mostr\w*|quebr\w*|receb\w*|revel\w*|super\w*|traz|terá|tem|vend\w*|volt\w*)\b/i
  );

  if (subject && verbMatch && Number.isInteger(verbMatch.index)) {
    const action = eventSource.slice(verbMatch.index).trim();
    const candidate = compactEditorialEvent(`${subject} ${action}`);
    return cutTitleAtWordBoundary(candidate);
  }

  return cutTitleAtWordBoundary(source);
}

export function buildBannerRequest(
  item,
  { shortTitle = item.titulo_curto, images = ["", ""] } = {}
) {
  const highlights = Array.isArray(item.highlights)
    ? item.highlights.map(cleanEditorialText)
    : [];

  const issues = validateHighlights(highlights, item.titulo);
  if (issues.length) {
    throw new Error(
      `Revise os highlights desta notícia: ${issues.join("; ")}.`
    );
  }

  const title = cleanEditorialText(shortTitle).replace(/\s+/g, " ");
  const titleWords = title ? title.split(/\s+/).filter(Boolean) : [];

  if (!title || title.length > 24 || titleWords.length > 2) {
    throw new Error(
      "Informe o nome curto do assunto com 1 ou 2 palavras completas e até 24 caracteres. Nunca corte uma palavra ou nome."
    );
  }

  const bannerTitle = buildEditorialBannerTitle(item, title, highlights[0] || "");
  if (!bannerTitle) {
    throw new Error("Nao foi possivel montar o titulo editorial do banner.");
  }

  const overrides = images.map((url) => String(url || "").trim());
  const manual = overrides.some(Boolean);

  if (
    manual &&
    (overrides.length !== 2 ||
      overrides.some((url) => !/^https?:\/\//i.test(url)))
  ) {
    throw new Error(
      "Preencha as duas URLs de imagens ou deixe ambas vazias para a busca automática."
    );
  }

  const candidates = [
    { url: item.image_url || item.imageUrl || item.imagem || "" },
    ...(Array.isArray(item.imagens)
      ? item.imagens.map((image) =>
          typeof image === "string" ? { url: image } : image
        )
      : []),
  ].filter((image) => /^https?:\/\//i.test(image?.url || ""));

  const unique = candidates.filter(
    (image, index) =>
      candidates.findIndex((other) => other.url === image.url) === index
  );

  return {
    noticia_id: item.id || null,
    categoria: item.categoria || item.category || "",
    titulo_curto: title,
    image_query: buildEditorialImageQuery(item, title),
    image_mode: manual ? "manual" : "automatic",
    image_candidates: unique,
    source_urls: (Array.isArray(item.fontes) ? item.fontes : [])
      .map((source) => source?.url)
      .filter(Boolean),
    banners: highlights.map((highlight, index) => ({
      banner_title: bannerTitle,
      highlight,
      image_url: manual ? overrides[index] : unique[index]?.url || "",
    })),
  };
}
