export const WIREGEEK_CATEGORIES =
  Object.freeze([
    "games",
    "geek",
    "cinema",
    "anime",
    "musica",
  ]);

const CATEGORY_ALIASES =
  new Map([
    ["games", "games"],
    ["game", "games"],
    ["jogos", "games"],

    ["geek", "geek"],
    ["tech", "geek"],
    ["geek tech", "geek"],
    ["tecnologia", "geek"],
    ["tecnologia e ia", "geek"],
    ["tecnologia ia", "geek"],
    ["series", "geek"],
    ["series e streaming", "geek"],
    ["streaming", "geek"],
    ["cultura geek", "geek"],
    ["cultura pop", "geek"],
    ["cultura geek e cultura pop", "geek"],

    ["cinema", "cinema"],
    ["filmes", "cinema"],

    ["anime", "anime"],
    ["animes", "anime"],
    ["anime e manga", "anime"],
    ["manga", "anime"],

    ["musica", "musica"],
    ["music", "musica"],
  ]);

function categoryKey(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[\/&+]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeWireGeekCategory(
  value
) {
  const key =
    categoryKey(value);

  if (!key) {
    return "";
  }

  return (
    CATEGORY_ALIASES.get(key) ||
    ""
  );
}

export function isWireGeekCategory(
  value
) {
  return WIREGEEK_CATEGORIES.includes(
    String(value || "")
      .trim()
      .toLowerCase()
  );
}
