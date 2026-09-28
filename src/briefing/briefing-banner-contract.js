import { canonicalNewsId, buildCanonicalClientPayload } from "../../lib/banner-canonical.mjs";

/*
 * FRONTEIRA CANONICA DOS BANNERS DO BRIEFING
 *
 * O frontend envia somente a identidade da noticia salva
 * e escolhas opcionais de imagem.
 *
 * O conteudo editorial usado pelos banners e carregado
 * pelo backend a partir da noticia persistida.
 */

export function hasBriefingBannerSpecs(item = {}) {
  try {
    canonicalNewsId(item.id);
    return true;
  } catch {
    return false;
  }
}

export function buildBriefingClientPayload(item = {}) {
  return buildCanonicalClientPayload(item);
}