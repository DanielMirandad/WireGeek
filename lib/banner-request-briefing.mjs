import { cleanBriefingText } from "./briefing-text.mjs";

function clean(value) {
  return cleanBriefingText(
    String(value || "")
  )
    .replace(/\s+/g, " ")
    .trim();
}
/*
 * ============================================================
 * NORMALIZACAO DO BLOCO EDITORIAL
 * ============================================================
 *
 * banner_title + highlight formam um unico bloco visual.
 *
 * Esta funcao remove somente repeticao textual comprovavel
 * entre o final/inicio dos dois campos.
 *
 * Ela NAO:
 *
 * - inventa fatos;
 * - resume semanticamente;
 * - reduz fonte;
 * - altera o renderer.
 */

function editorialTokenKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .replace(
      /[^a-z0-9]/g,
      ""
    );
}


function normalizeEditorialPair(
  titleValue,
  highlightValue
) {
  const bannerTitle =
    clean(titleValue);

  const originalHighlight =
    clean(highlightValue);

  if (
    !bannerTitle ||
    !originalHighlight
  ) {
    return {
      bannerTitle,
      highlight:
        originalHighlight,
      removedWords:
        0,
      strategy:
        "none",
    };
  }

  const titleWords =
    bannerTitle
      .split(/\s+/)
      .filter(Boolean);

  const highlightWords =
    originalHighlight
      .split(/\s+/)
      .filter(Boolean);

  const titleKeys =
    titleWords.map(
      editorialTokenKey
    );

  const highlightKeys =
    highlightWords.map(
      editorialTokenKey
    );

  let removeCount = 0;
  let strategy = "none";

  /*
   * CASO 1
   *
   * banner_title aparece inteiro
   * no inicio do highlight.
   *
   * Exemplo:
   *
   * A KIA REVELOU A NOVA VAN
   *
   * +
   *
   * A KIA REVELOU A NOVA VAN
   * ELETRICA PV7...
   */
  if (
    titleKeys.length <=
      highlightKeys.length &&
    titleKeys.every(
      (token, index) =>
        token &&
        token ===
          highlightKeys[index]
    )
  ) {
    removeCount =
      titleWords.length;

    strategy =
      "full-title-prefix";
  }

  /*
   * CASO 2
   *
   * O fim do banner_title reaparece
   * no inicio do highlight.
   *
   * Exemplo:
   *
   * KIA DETALHA A NOVA PV7
   *
   * +
   *
   * A NOVA PV7 CHEGA...
   */
  if (!removeCount) {
    const limit =
      Math.min(
        titleKeys.length,
        highlightKeys.length
      );

    for (
      let size = limit;
      size >= 2;
      size--
    ) {
      const titleStart =
        titleKeys.length -
        size;

      let matches = true;

      for (
        let offset = 0;
        offset < size;
        offset++
      ) {
        const left =
          titleKeys[
            titleStart +
            offset
          ];

        const right =
          highlightKeys[
            offset
          ];

        if (
          !left ||
          !right ||
          left !== right
        ) {
          matches = false;
          break;
        }
      }

      if (matches) {
        removeCount = size;
        strategy =
          "boundary-overlap";
        break;
      }
    }
  }

  if (!removeCount) {
    return {
      bannerTitle,
      highlight:
        originalHighlight,
      removedWords:
        0,
      strategy:
        "none",
    };
  }

  const highlight =
    highlightWords
      .slice(removeCount)
      .join(" ")
      .replace(
        /^[,.;:!?–—-]+\s*/,
        ""
      )
      .trim();

  return {
    bannerTitle,
    highlight,
    removedWords:
      removeCount,
    strategy,
  };
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

  const tituloCurto = clean(
    item.titulo_curto ||
    item.short_title ||
    item.shortTitle
  );

  if (!titulo) {
    throw new Error(
      "A notícia precisa de título."
    );
  }

  if (!tituloCurto) {
    throw new Error(
      "A noticia precisa de titulo_curto para o modelo Briefing."
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

        const rawHighlight = clean(
          banner?.highlight
        );

        if (!bannerTitle) {
          throw new Error(
            `Banner editorial ${index + 1} está sem banner_title.`
          );
        }

        if (!rawHighlight) {
          throw new Error(
            `Banner editorial ${index + 1} está sem highlight.`
          );
        }

        const editorialPair =
          normalizeEditorialPair(
            bannerTitle,
            rawHighlight
          );

        const highlight =
          editorialPair.highlight;

        /*
         * Se os dois campos continham exatamente
         * a mesma copy, remover a repeticao deixaria
         * o highlight vazio.
         *
         * Nesse caso o conteudo editorial precisa ser
         * refeito antes de chegar ao renderer.
         */
        if (!highlight) {
          throw new Error(
            `Banner editorial ${index + 1}: banner_title e highlight repetem integralmente a mesma informação. Reescreva a copy.`
          );
        }

        if (
          editorialPair.removedWords > 0
        ) {
          console.log(
            "WIRE/GEEK BRIEFING: sobreposicao editorial removida",
            {
              banner:
                index + 1,

              estrategia:
                editorialPair.strategy,

              palavras_removidas:
                editorialPair.removedWords,

              banner_title:
                bannerTitle,

              highlight_original:
                rawHighlight,

              highlight_final:
                highlight,
            }
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

          titulo_curto: clean(
            banner?.titulo_curto ||
            banner?.short_title ||
            banner?.shortTitle ||
            tituloCurto
          ),

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
    titulo_curto: tituloCurto,
    source_urls: sourceUrls,
    banners: ctaBanner
      ? [
          ...editorialBanners,
          ctaBanner,
        ]
      : editorialBanners,
  };
}
