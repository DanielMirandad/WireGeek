import { cleanBriefingText } from "./briefing-text.mjs";

function clean(value) {
  return cleanBriefingText(
    String(value || "")
  )
    .replace(/\s+/g, " ")
    .trim();
}

const INFORMATION_ONLY_IMAGE_DOMAINS = [
  "omelete.com.br",
  "omelete.com",
  "ign.com",
];

function isInformationOnlyImageSource(value) {
  try {
    const host = new URL(String(value || "")).hostname.toLowerCase();
    return INFORMATION_ONLY_IMAGE_DOMAINS.some(domain =>
      host === domain || host.endsWith("." + domain)
    );
  } catch {
    return false;
  }
}


function visualEntityKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function deriveProductionVisualSubject(...values) {
  const text = values.filter(Boolean).join(" ");
  const phrases = [
    ...new Set(
      text.match(
        /\b\p{Lu}[\p{L}\p{N}'’.-]*(?:\s+(?:(?:of|the|and|da|de|do|dos|das|e|a|o)\s+)?\p{Lu}[\p{L}\p{N}'’.-]*)+\b/gu
      ) || []
    ),
  ];
  const connectors = new Set(["of", "the", "and", "da", "de", "do", "dos", "das", "e", "a", "o"]);
  const candidates = phrases.filter(phrase => {
    const words = visualEntityKey(phrase).split(/\s+/).filter(Boolean);
    return words.length >= 3 || words.some(word => connectors.has(word));
  });
  return candidates[candidates.length - 1] || "";
}

function isCastingStory(...values) {
  return /\b(cast|casting|elenco|escalad|contratad|temporada|season|joins|entram|entra)\b/
    .test(visualEntityKey(values.filter(Boolean).join(" ")));
}


function deriveSharedVisualEntityHint(
  item,
  editorialSource
) {
  /*
   * Recupera um identificador especifico de produto
   * presente em qualquer um dos dois banners.
   *
   * Exemplo:
   *
   * titulo geral:
   * "Oculos inteligentes sao alvos de recall..."
   *
   * banner 2:
   * "dispositivo INMO Air3..."
   *
   * Resultado:
   * INMO Air3
   *
   * O segundo token precisa conter letra E numero,
   * reduzindo falsos positivos de frases comuns.
   */
  const corpus = [
    item?.titulo,
    item?.title,
    item?.image_query,
    item?.contexto_visual,

    ...(
      Array.isArray(editorialSource)
        ? editorialSource.flatMap(
            banner => [
              banner?.banner_title,
              banner?.bannerTitle,
              banner?.highlight,
              banner?.visual_subject,
              banner?.assunto_visual,
              banner?.image_query,
              banner?.contexto_visual,
            ]
          )
        : []
    ),
  ]
    .filter(Boolean)
    .join(" ");

  const tokens =
    corpus
      .replace(
        /[^\p{L}\p{N}._-]+/gu,
        " "
      )
      .split(/\s+/)
      .map(value =>
        String(value || "")
          .replace(
            /^[._-]+|[._-]+$/g,
            ""
          )
          .trim()
      )
      .filter(Boolean);

  const genericLeads =
    new Set([
      "modelo",
      "model",
      "versao",
      "version",
      "dispositivo",
      "device",
      "produto",
      "product",
      "serie",
      "series",
      "geracao",
      "generation",
      "firmware",
      "software",
      "patch",
    ]);

  for (
    let index = 0;
    index < tokens.length - 1;
    index++
  ) {
    const first =
      tokens[index];

    const second =
      tokens[index + 1];

    const firstKey =
      visualEntityKey(first);

    const secondKey =
      visualEntityKey(second)
        .replace(
          /\s+/g,
          ""
        );

    if (
      firstKey.length < 2 ||
      genericLeads.has(firstKey) ||
      !/[a-z]/.test(secondKey) ||
      !/\d/.test(secondKey)
    ) {
      continue;
    }

    return clean(
      first + " " + second
    );
  }

  return "";
}


function isQuestionLikeEditorialText(value) {
  const raw = String(value || "").trim();
  const normalized = visualEntityKey(raw);

  return (
    raw.includes("?") ||
    /^(?:qual|quais|quem|onde|quando|como|porque|por que|o que|which|what|who|where|when|how)\b/.test(normalized)
  );
}


function enrichVisualField(
  value,
  entityHint
) {
  const base =
    clean(value);

  const hint =
    clean(entityHint);

  if (!hint) {
    return base;
  }

  const baseKey =
    visualEntityKey(base);

  const hintKey =
    visualEntityKey(hint);

  if (
    baseKey.includes(hintKey)
  ) {
    return base;
  }

  return clean(
    [
      hint,
      base,
    ]
      .filter(Boolean)
      .join(" ")
  );
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



function deriveLeadingEntityTitle(value) {
  const words =
    clean(value)
      .split(/\s+/)
      .filter(Boolean);

  if (!words.length) {
    return "";
  }

  const result = [];

  for (const word of words) {
    const token =
      String(word)
        .replace(
          /^[("'“‘]+|[)"'”’.,;:!?]+$/g,
          ""
        )
        .trim();

    if (!token) {
      continue;
    }

    if (!result.length) {
      result.push(word);
      continue;
    }

    if (
      /^[A-ZÁÉÍÓÚÀÃÕÂÊÔÇ0-9]/u.test(
        token
      )
    ) {
      result.push(word);
      continue;
    }

    break;
  }

  return result.join(" ");
}


const BRIEFING_SHORT_TITLE_SAFE_CHARS = 14;


function compactBriefingShortTitle(
  value
) {
  const title =
    clean(value);

  if (
    !title ||
    title.length <=
      BRIEFING_SHORT_TITLE_SAFE_CHARS
  ) {
    return title;
  }

  const words =
    title
      .split(/\s+/)
      .map(word => word.replace(/[,;:!?]+$/u, ""))
      .filter(Boolean);

  /*
   * Primeiro tenta preservar duas palavras
   * completas e consecutivas.
   *
   * Ex.:
   *
   * Final Fantasy XIV
   * -> Final Fantasy
   */
  const pairs = [];

  for (
    let index = 0;
    index < words.length - 1;
    index++
  ) {
    const candidate =
      `${words[index]} ${words[index + 1]}`;

    if (
      candidate.length <=
        BRIEFING_SHORT_TITLE_SAFE_CHARS
    ) {
      pairs.push(
        candidate
      );
    }
  }

  if (pairs.length) {
    return pairs
      .sort(
        (left, right) =>
          right.length -
          left.length
      )[0];
  }

  /*
   * Se nenhuma dupla couber, usa uma
   * palavra completa.
   *
   * Nunca corta uma palavra para caber.
   */
  const singleWords =
    words
      .filter(
        word =>
          word.length <=
            BRIEFING_SHORT_TITLE_SAFE_CHARS
      )
      .sort(
        (left, right) =>
          right.length -
          left.length
      );

  if (singleWords.length) {
    return singleWords[0];
  }

  /*
   * Caso extremo:
   *
   * nenhuma palavra individual cabe.
   * Mantemos o original para o renderer
   * rejeitar explicitamente em vez de
   * mutilar um nome.
   */
  return title;
}


function repairBriefingShortTitle(
  shortValue,
  fullTitleValue
) {
  const suppliedShortTitle =
    clean(shortValue);

  const shortTitle =
    isQuestionLikeEditorialText(suppliedShortTitle)
      ? ""
      : suppliedShortTitle;

  const entityTitle =
    deriveLeadingEntityTitle(
      fullTitleValue
    );

  /*
   * Sem titulo_curto explicito:
   * deriva da entidade e compacta.
   */
  if (!shortTitle) {
    const repaired =
      compactBriefingShortTitle(
        entityTitle
      );

    if (
      repaired &&
      repaired !== entityTitle
    ) {
      console.log(
        "WIRE/GEEK BRIEFING: titulo_curto compactado",
        {
          original:
            entityTitle,

          final:
            repaired,

          motivo:
            "limite_pre_renderer",
        }
      );
    }

    return repaired;
  }

  if (!entityTitle) {
    return compactBriefingShortTitle(
      shortTitle
    );
  }

  const key =
    value =>
      String(value || "")
        .normalize("NFD")
        .replace(
          /[\u0300-\u036f]/g,
          ""
        )
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

  const shortKey =
    key(shortTitle);

  const entityKey =
    key(entityTitle);

  let selected =
    shortTitle;

  /*
   * A logica antiga expandia sempre:
   *
   * Acampamento
   * ->
   * Acampamento Miasma
   *
   * Agora so expandimos quando a entidade
   * completa continua dentro do limite
   * seguro anterior ao renderer.
   */
  if (
    (
      entityKey === shortKey ||
      entityKey.startsWith(
        shortKey + " "
      )
    ) &&
    entityTitle.length <=
      BRIEFING_SHORT_TITLE_SAFE_CHARS
  ) {
    selected =
      entityTitle;
  }

  const repaired =
    compactBriefingShortTitle(
      selected
    );

  if (
    repaired !== selected
  ) {
    console.log(
      "WIRE/GEEK BRIEFING: titulo_curto compactado",
      {
        original:
          selected,

        final:
          repaired,

        motivo:
          "limite_pre_renderer",
      }
    );
  }

  return repaired;
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


function imageComesFromInformationOnlySource(image) {
  const sourceLabel = [
    image?.source_name,
    image?.publisher,
    typeof image?.source === "string" ? image.source : image?.source?.name,
  ].filter(Boolean).join(" ");
  return (
    isInformationOnlyImageSource(
      image?.url,
      image?.source_url,
      image?.sourceUrl,
      image?.page_url,
      image?.source
    ) ||
    /(?:^|\\W)(?:omelete|ign)(?:$|\\W)/i.test(sourceLabel)
  );
}

function hasImageSourceAttribution(image) {
  return Boolean(
    image?.source_url ||
    image?.sourceUrl ||
    image?.page_url ||
    image?.origin_url ||
    image?.image_source_url
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

  const tituloCurto =
    repairBriefingShortTitle(
      item.titulo_curto ||
      item.short_title ||
      item.shortTitle ||
      "",
      titulo
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

  const rawRootImages =
    normalizeImages(item.imagens);

  const allSourceUrls = [
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
  const sourceUrls = allSourceUrls.filter(
    url => !isInformationOnlyImageSource(url)
  );
  const informationOnlySourceCount =
    allSourceUrls.length - sourceUrls.length;
  const onlyInformationalImageSources =
    informationOnlySourceCount > 0 && sourceUrls.length === 0;
  const rootImages =
    rawRootImages.filter(image =>
      !imageComesFromInformationOnlySource(image) &&
      !(onlyInformationalImageSources && !hasImageSourceAttribution(image))
    );
  let inheritedImagesIgnored =
    rawRootImages.length - rootImages.length;

  const sharedVisualEntityHint =
    deriveSharedVisualEntityHint(
      item,
      editorialSource
    );

  if (sharedVisualEntityHint) {
    console.log(
      "WIRE/GEEK BRIEFING: entidade visual especifica compartilhada",
      {
        noticia_id:
          item?.id ||
          null,

        entidade:
          sharedVisualEntityHint,
      }
    );
  }

  const editorialBanners =
    editorialSource.map(
      (banner, index) => {
        const rawBannerTitle = clean(
          banner?.banner_title ||
          banner?.bannerTitle
        );

        const bannerTitleLooksLikeQuestion =
          isQuestionLikeEditorialText(
            rawBannerTitle
          );

        const fallbackBannerTitle =
          clean(
            [
              tituloCurto,
              deriveProductionVisualSubject(titulo),
              deriveLeadingEntityTitle(titulo),
              titulo,
            ]
              .filter(Boolean)
              .find(value => !isQuestionLikeEditorialText(value)) ||
            ""
          );

        const bannerTitle = String(
          bannerTitleLooksLikeQuestion
            ? fallbackBannerTitle
            : rawBannerTitle
        )
          .replace(/[,;:]\s*$/u, "")
          .trim();

        if (bannerTitleLooksLikeQuestion) {
          console.warn(
            "WIRE/GEEK BRIEFING: banner_title em formato de pergunta substituído",
            {
              noticia_id:
                item?.id || null,
              titulo_descartado:
                rawBannerTitle,
              titulo_usado:
                bannerTitle,
            }
          );
        }

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

        const rawOwnImages =
          normalizeImages(
            banner?.imagens
          );
        const ownImages =
          rawOwnImages.filter(image =>
            !imageComesFromInformationOnlySource(image) &&
            !(onlyInformationalImageSources && !hasImageSourceAttribution(image))
          );
        inheritedImagesIgnored +=
          rawOwnImages.length - ownImages.length;

        const explicitImage = String(
          banner?.image_url ||
          banner?.imageUrl ||
          banner?.imagem ||
          ""
        ).trim();
        const explicitImageSource =
          banner?.image_source_url ||
          banner?.source_url ||
          banner?.image_source?.url ||
          "";
        const explicitImageRejected =
          Boolean(explicitImage) &&
          (
            isInformationOnlyImageSource(explicitImage, explicitImageSource) ||
            (onlyInformationalImageSources && !explicitImageSource)
          );
        if (explicitImageRejected) {
          inheritedImagesIgnored++;
        }
        const preferredImage =
          explicitImageRejected
            ? String(
                ownImages[0]?.url ||
                rootImages[index]?.url ||
                ""
              ).trim()
            : String(
                explicitImage ||
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

        const baseContextoVisual =
          clean(
            banner?.contexto_visual ||
            item.contexto_visual
          );

        // A manchete identifica a produção; highlights podem começar com
        // nomes de atores e contaminar a extração do assunto visual.
        const productionSubject =
          deriveProductionVisualSubject(titulo);
        const productionCenteredCastingStory =
          Boolean(productionSubject) &&
          isCastingStory(titulo, bannerTitle, rawHighlight);

        const contextoVisual =
          enrichVisualField(
            [
              productionCenteredCastingStory
                ? `Still oficial da série ${productionSubject}; notícia de elenco.`
                : "",
              baseContextoVisual,
            ]
              .filter(Boolean)
              .join(" "),
            sharedVisualEntityHint
          );

        const baseVisualSubject =
          clean(
            productionCenteredCastingStory
              ? productionSubject
              : banner?.visual_subject ||
                banner?.assunto_visual ||
                baseContextoVisual ||
                titulo
          );

        const visualSubject =
          enrichVisualField(
            baseVisualSubject,
            sharedVisualEntityHint
          );

        const baseImageQuery =
          productionCenteredCastingStory
            ? clean(
                `${productionSubject} HBO official series still press image high resolution`
              )
            : clean(
                banner?.image_query ||
                item.image_query ||
                baseVisualSubject ||
                titulo
              );

        const queryLooksLikeQuestion =
          isQuestionLikeEditorialText(
            baseImageQuery
          );

        const fallbackImageQuery =
          clean(
            (productionCenteredCastingStory
              ? [
                  `${productionSubject} HBO official series still press image high resolution`,
                ]
              : [
                  tituloCurto,
                  titulo,
                  baseVisualSubject,
                ]
            )
              .filter(Boolean)
              .filter(value => !isQuestionLikeEditorialText(value))
              .join(" ")
          );

        const selectedImageQuery =
          queryLooksLikeQuestion
            ? fallbackImageQuery
            : baseImageQuery;

        if (queryLooksLikeQuestion) {
          console.warn(
            "WIRE/GEEK BRIEFING: image_query em formato de pergunta descartada",
            {
              noticia_id:
                item?.id || null,
              consulta_rejeitada:
                baseImageQuery,
              consulta_fallback:
                fallbackImageQuery,
            }
          );
        }

        const imageQuery =
          enrichVisualField(
            selectedImageQuery,
            sharedVisualEntityHint
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
          production_subject:
            productionCenteredCastingStory
              ? productionSubject
              : "",
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
    source_urls_ignored_for_images: informationOnlySourceCount,
    inherited_images_ignored_for_sources: inheritedImagesIgnored,
    banners: ctaBanner
      ? [
          ...editorialBanners,
          ctaBanner,
        ]
      : editorialBanners,
  };
}
