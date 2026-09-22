// Perfis fixos fornecidos pelo proprietario do WireGeek.
export const FIXED_INSTAGRAM_PROFILES = Object.freeze([
  "hakkunna",
  "leomiratos",
  "charles.wemerson",
]);

/*
 * V1 IMUTAVEL.
 *
 * Nao alterar.
 * Containers criados antes do catalogo ampliado dependem
 * desta selecao para preservar o SHA-256 da legenda.
 */
export const RELATED_INSTAGRAM_PROFILES_V1 = Object.freeze([
  Object.freeze({
    username: "xbox",
    terms: /\bxbox\b/i,
    source: "https://www.instagram.com/xbox/",
  }),

  Object.freeze({
    username: "playstation_br",
    terms: /\b(?:playstation|ps5|ps4)\b/i,
    source: "https://www.instagram.com/playstation_br/",
  }),

  Object.freeze({
    username: "nintendoamerica",
    terms: /\bnintendo\b/i,
    source: "https://www.instagram.com/nintendoamerica/",
  }),
]);

/*
 * V2.
 *
 * Ordem importa:
 * 1. empresas/plataformas/franquias explicitamente citadas;
 * 2. veiculos/perfis editoriais explicitamente citados;
 * 3. fallback por categoria.
 *
 * No maximo tres perfis relacionados serao usados.
 */
export const RELATED_INSTAGRAM_PROFILES = Object.freeze([
  // Games - plataformas e fabricantes.
  Object.freeze({
    username: "xbox",
    terms: /\b(?:xbox|xbox game pass|game pass|microsoft gaming)\b/i,
    source: "https://www.instagram.com/xbox/",
  }),

  Object.freeze({
    username: "playstation_br",
    terms: /\b(?:playstation|playstation studios|ps5|ps4)\b/i,
    source: "https://www.instagram.com/playstation_br/",
  }),

  Object.freeze({
    username: "nintendoamerica",
    terms: /\b(?:nintendo|nintendo switch|switch 2|super mario|mario|zelda)\b/i,
    source: "https://www.instagram.com/nintendoamerica/",
  }),

  // Streaming / cinema / cultura pop.
  Object.freeze({
    username: "netflixbrasil",
    terms: /\bnetflix\b/i,
    source: "https://www.instagram.com/netflixbrasil/",
  }),

  Object.freeze({
    username: "primevideobr",
    terms: /\b(?:prime video|amazon prime video)\b/i,
    source: "https://www.instagram.com/primevideobr/",
  }),

  Object.freeze({
    username: "disneyplusbr",
    terms: /\b(?:disney\+|disney plus)\b/i,
    source: "https://www.instagram.com/disneyplusbr/",
  }),

  Object.freeze({
    username: "marvelbrasil",
    terms: /\b(?:marvel|marvel studios|mcu)\b/i,
    source: "https://www.instagram.com/marvelbrasil/",
  }),

  Object.freeze({
    username: "hbomaxbrasil",
    terms: /\b(?:hbo max|hbo|max original|originais max)\b/i,
    source: "https://www.instagram.com/hbomaxbrasil/",
  }),

  Object.freeze({
    username: "wbpictures_br",
    terms: /\b(?:warner bros\.?|warner brothers|warner bros pictures)\b/i,
    source: "https://www.instagram.com/wbpictures_br/",
  }),

  Object.freeze({
    username: "sonypicturesbr",
    terms: /\bsony pictures\b/i,
    source: "https://www.instagram.com/sonypicturesbr/",
  }),

  Object.freeze({
    username: "paramountbrasil",
    terms: /\b(?:paramount|paramount pictures)\b/i,
    source: "https://www.instagram.com/paramountbrasil/",
  }),

  // Anime.
  Object.freeze({
    username: "crunchyroll_br",
    terms: /\b(?:crunchyroll|crunchyroll anime awards|anime awards)\b/i,
    source: "https://www.instagram.com/crunchyroll_br/",
  }),

  // Veiculos/editoriais quando citados diretamente.
  Object.freeze({
    username: "ignbrasil",
    terms: /\b(?:ign brasil|ign)\b/i,
    source: "https://www.instagram.com/ignbrasil/",
  }),

  Object.freeze({
    username: "omelete",
    terms: /\bomelete\b/i,
    source: "https://www.instagram.com/omelete/",
  }),

  Object.freeze({
    username: "adorocinema",
    terms: /\badorocinema\b/i,
    source: "https://www.instagram.com/adorocinema/",
  }),

  /*
   * Fallbacks editoriais por categoria.
   *
   * Ficam por ultimo para nunca ocupar o lugar de
   * empresas ou plataformas explicitamente citadas.
   */
  Object.freeze({
    username: "ignbrasil",
    terms: /\b(?:games?|jogos?|videogames?|gaming)\b/i,
    source: "category:games",
  }),

  Object.freeze({
    username: "omelete",
    terms: /\b(?:geek|cultura pop|quadrinhos?|hqs?|tecnologia)\b/i,
    source: "category:geek",
  }),

  Object.freeze({
    username: "adorocinema",
    terms: /\b(?:cinema|filmes?|longa-metragem|longas-metragens|streaming)\b/i,
    source: "category:cinema",
  }),

  Object.freeze({
    username: "crunchyroll_br",
    terms: /\b(?:anime|animes|manga|mangas|mangá|mangás|animacao japonesa|animação japonesa)\b/i,
    source: "category:anime",
  }),
]);

export function normalizeInstagramProfiles(values) {
  if (!Array.isArray(values)) {
    throw new Error("Lista de perfis inválida.");
  }

  const result = [];

  for (const value of values) {
    if (typeof value !== "string") {
      throw new Error("Perfil inválido.");
    }

    const username =
      value
        .trim()
        .replace(/^@/, "")
        .toLowerCase();

    if (
      !/^[a-z0-9_](?:[a-z0-9._]{0,28}[a-z0-9_])?$/.test(username) ||
      username.includes("..")
    ) {
      throw new Error(
        "Nome de usuário do Instagram inválido."
      );
    }

    if (!result.includes(username)) {
      result.push(username);
    }
  }

  if (result.length > 8) {
    throw new Error(
      "Use no máximo oito perfis por Reel."
    );
  }

  return result;
}

function selectFromCatalog(article, catalog, maxRelated = 3) {
  const text =
    String(article || "");

  const related = [];

  for (const entry of catalog) {
    if (!entry.terms.test(text)) {
      continue;
    }

    if (!related.includes(entry.username)) {
      related.push(entry.username);
    }

    if (related.length === maxRelated) {
      break;
    }
  }

  return normalizeInstagramProfiles([
    ...FIXED_INSTAGRAM_PROFILES,
    ...related,
  ]);
}

/*
 * Usado apenas para validar containers V1 ja existentes.
 */
export function selectInstagramProfilesV1(article) {
  return selectFromCatalog(article, RELATED_INSTAGRAM_PROFILES_V1, 3);
}

/*
 * Selecao padrao para novos Reels.
 */
export function selectInstagramProfiles(article) {
  return selectFromCatalog(article, RELATED_INSTAGRAM_PROFILES, 5);
}

export function previewInstagramProfiles(group) {
  if (
    !Array.isArray(group) ||
    group.length !== 2 ||
    group.some(
      (row) =>
        row.instagram_parent_container_id ||
        row.instagram_caption_sha256 ||
        row.published_at ||
        row.instagram_post_id ||
        ![
          "APROVADO",
          "AGUARDANDO_APROVACAO",
        ].includes(row.status) ||
        [
          "PUBLICANDO",
          "VERIFICAR_MANUALMENTE",
        ].includes(row.instagram_status)
    )
  ) {
    return null;
  }

  const article =
    group[0]?.noticias?.artigo;

  if (!String(article || "").trim()) {
    return null;
  }

  return selectInstagramProfiles(article);
}