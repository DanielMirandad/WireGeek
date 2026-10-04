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

export function applyManualBannerImages(
  payload = {},
  manualImageUrls = []
) {
  const existing =
    Array.isArray(payload.banners)
      ? payload.banners
      : [];

  const manual =
    [0, 1].map((index) =>
      String(
        manualImageUrls[index] || ""
      ).trim()
    );

  for (const url of manual) {
    if (
      url &&
      !/^https?:\/\//i.test(url)
    ) {
      throw new Error(
        "A imagem manual deve usar uma URL http ou https."
      );
    }
  }

  return {
    ...payload,

    banners: [0, 1].map(
      (index) => ({
        type: "editorial",

        ...(existing[index] || {}),

        image_url:
          manual[index] ||
          String(
            existing[index]?.image_url ||
            ""
          ).trim(),
      })
    ),
  };
}
