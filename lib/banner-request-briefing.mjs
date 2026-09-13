import { cleanBriefingText } from "./briefing-text.mjs";

function clean(value) {
  return cleanBriefingText(
    String(value || "")
  )
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeImages(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((image) => {
      if (typeof image === "string") {
        return {
          url: image.trim(),
        };
      }

      if (
        image &&
        typeof image === "object"
      ) {
        return {
          ...image,
          url: String(
            image.url ||
            image.image_url ||
            image.imageUrl ||
            ""
          ).trim(),
        };
      }

      return null;
    })
    .filter(
      (image) =>
        image &&
        /^https?:\/\//i.test(image.url)
    );
}


function uniqueImages(images) {
  const seen = new Set();

  return images.filter((image) => {
    const url = String(
      image?.url || ""
    ).trim();

    if (!url || seen.has(url)) {
      return false;
    }

    seen.add(url);
    return true;
  });
}


function bannerType(banner) {
  return String(
    banner?.type ||
    "editorial"
  )
    .trim()
    .toLowerCase();
}


export function buildBriefingBannerRequest(
  item
) {
  if (
    !item ||
    typeof item !== "object"
  ) {
    throw new Error(
      "Notícia inválida para o modo Briefing."
    );
  }

  const sourceBanners =
    Array.isArray(item.banners)
      ? item.banners
      : [];

  const editorialSource =
    sourceBanners
      .filter(
        (banner) =>
          bannerType(banner) ===
          "editorial"
      )
      .slice(0, 2);

  if (editorialSource.length !== 2) {
    throw new Error(
      "O modo Briefing exige exatamente dois banners editoriais."
    );
  }

  const ctaSource =
    sourceBanners.find(
      (banner) =>
        bannerType(banner) === "cta"
    ) || null;

  const titulo = clean(
    item.titulo ||
    item.title
  );

  if (!titulo) {
    throw new Error(
      "A notícia precisa de título."
    );
  }

  const categoria = clean(
    item.categoria ||
    item.category ||
    "geek"
  ).toLowerCase();

  const rootImages =
    normalizeImages(item.imagens);

  const sourceUrls = [
    ...new Set(
      (
        Array.isArray(item.fontes)
          ? item.fontes
          : []
      )
        .map((source) =>
          typeof source === "string"
            ? source
            : source?.url
        )
        .map((url) =>
          String(url || "").trim()
        )
        .filter((url) =>
          /^https?:\/\//i.test(url)
        )
    ),
  ];

  const editorialBanners =
    editorialSource.map(
      (banner, index) => {
        const bannerTitle = clean(
          banner?.banner_title ||
          banner?.bannerTitle
        );

        const highlight = clean(
          banner?.highlight
        );

        if (!bannerTitle) {
          throw new Error(
            `Banner editorial ${index + 1} está sem banner_title.`
          );
        }

        if (!highlight) {
          throw new Error(
            `Banner editorial ${index + 1} está sem highlight.`
          );
        }

        const ownImages =
          normalizeImages(
            banner?.imagens
          );

        const preferredImage = String(
          banner?.image_url ||
          banner?.imageUrl ||
          banner?.imagem ||
          ownImages[0]?.url ||
          rootImages[index]?.url ||
          ""
        ).trim();

        const candidates =
          uniqueImages([
            ...ownImages,
            ...(rootImages[index]
              ? [rootImages[index]]
              : []),
            ...rootImages,
          ]);

        const contextoVisual = clean(
          banner?.contexto_visual ||
          item.contexto_visual
        );

        const visualSubject = clean(
          banner?.visual_subject ||
          banner?.assunto_visual ||
          contextoVisual ||
          titulo
        );

        const imageQuery = clean(
          banner?.image_query ||
          item.image_query ||
          visualSubject ||
          titulo
        );

        return {
          type: "editorial",
          index,
          categoria,
          banner_title: bannerTitle,
          highlight,
          visual_subject: visualSubject,
          contexto_visual: contextoVisual,
          image_query: imageQuery,
          image_url:
            /^https?:\/\//i.test(
              preferredImage
            )
              ? preferredImage
              : "",
          image_candidates:
            candidates,
        };
      }
    );

  const ctaBanner =
    ctaSource
      ? {
          type: "cta",
          index: 2,
          asset_path: String(
            ctaSource.asset_path ||
            ctaSource.assetPath ||
            "./assets/cta/bagaca-studios-cta.jpg"
          ).trim(),
          cta_title_top: clean(
            ctaSource.cta_title_top ||
            "Curtiu esse"
          ),
          cta_title_main: clean(
            ctaSource.cta_title_main ||
            "conteúdo?"
          ),
          cta_handle: clean(
            ctaSource.cta_handle ||
            "bagacastudios"
          ),
          cta_actions:
            Array.isArray(
              ctaSource.cta_actions
            )
              ? ctaSource.cta_actions
                  .map(clean)
                  .filter(Boolean)
              : [
                  "curta",
                  "comenta",
                  "compartilha",
                  "salva",
                ],
        }
      : null;

  return {
    mode: "briefing",
    noticia_id:
      item.id || null,
    categoria,
    titulo,
    source_urls: sourceUrls,
    banners: ctaBanner
      ? [
          ...editorialBanners,
          ctaBanner,
        ]
      : editorialBanners,
  };
}