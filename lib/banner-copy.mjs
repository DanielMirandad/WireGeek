import { layoutText } from "./banner-renderer.mjs";

export async function validateBannerCopy(item) {
  const errors = [];
  if (!Array.isArray(item?.highlights)) return errors;

  // O renderer e a autoridade final de encaixe. A validacao previa so mede
  // quando recebeu o mesmo titulo editorial que sera realmente renderizado.
  // Isso evita falso negativo usando apenas titulo_curto.
  const bannerTitle = String(
    item?.banner_title ||
      item?.bannerTitle ||
      item?.titulo_banner ||
      ""
  ).trim();

  if (!bannerTitle) return errors;

  for (let index = 0; index < item.highlights.length; index++) {
    const highlight = item.highlights[index];
    if (typeof highlight !== "string" || !highlight.trim()) continue;

    try {
      // Qualquer escala retornada por layoutText ja foi considerada legivel
      // pelo proprio renderer. Nao rejeite apenas porque scale !== 1.
      await layoutText(bannerTitle, highlight);
    } catch (error) {
      if (error?.statusCode !== 400) throw error;
      errors.push(`highlight ${index + 1}: ${error.message}`);
    }
  }

  return errors;
}
