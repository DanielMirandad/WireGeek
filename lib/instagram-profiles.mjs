// Catálogo v1 imutável: manter esta versão para validar containers já preparados.
// Perfis fixos fornecidos pelo proprietário do WireGeek em 2026-09-22.
export const FIXED_INSTAGRAM_PROFILES = Object.freeze([
  "hakkunna", "leomiratos", "charles.wemerson",
]);

// Catálogo deliberadamente explícito: nunca transformar nomes em @s por adivinhação.
export const RELATED_INSTAGRAM_PROFILES = Object.freeze([
  Object.freeze({ username: "xbox", terms: /\bxbox\b/i,
    source: "https://www.xbox.com/en-US/community" }),
  Object.freeze({ username: "playstation_br", terms: /\b(?:playstation|ps5|ps4)\b/i,
    source: "https://www.playstation.com/pt-br/legal/playstation-brasil-comunicado/" }),
  Object.freeze({ username: "nintendoamerica", terms: /\bnintendo\b/i,
    source: "https://www.nintendo.com/us/whatsnew/countdown-to-adventure-with-snapchat/" }),
]);

export function normalizeInstagramProfiles(values) {
  if (!Array.isArray(values)) throw new Error("Lista de perfis inválida.");
  const result = [];
  for (const value of values) {
    if (typeof value !== "string") throw new Error("Perfil inválido.");
    const username = value.trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_](?:[a-z0-9._]{0,28}[a-z0-9_])?$/.test(username) || username.includes("..")) {
      throw new Error("Nome de usuário do Instagram inválido.");
    }
    if (!result.includes(username)) result.push(username);
  }
  if (result.length > 6) throw new Error("Use no máximo seis perfis por Reel.");
  return result;
}

export function selectInstagramProfiles(article) {
  const text = String(article || "");
  const related = RELATED_INSTAGRAM_PROFILES.filter(({ terms }) => terms.test(text))
    .slice(0, 3).map(({ username }) => username);
  return normalizeInstagramProfiles([...FIXED_INSTAGRAM_PROFILES, ...related]);
}

export function previewInstagramProfiles(group) {
  if (!Array.isArray(group) || group.length !== 2 || group.some((row) =>
    row.instagram_parent_container_id || row.instagram_caption_sha256 ||
    row.published_at || row.instagram_post_id ||
    !["APROVADO", "AGUARDANDO_APROVACAO"].includes(row.status) ||
    ["PUBLICANDO", "VERIFICAR_MANUALMENTE"].includes(row.instagram_status))) return null;
  const article = group[0]?.noticias?.artigo;
  if (!String(article || "").trim()) return null;
  return selectInstagramProfiles(article);
}
