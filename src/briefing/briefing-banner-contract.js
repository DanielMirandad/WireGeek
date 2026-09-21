/*
 * CONTRATO DE BANNERS DO BRIEFING
 *
 * Fonte única para validação dos dois banners editoriais
 * e construção do payload do modo Briefing.
 *
 * Contrato exclusivo do Briefing Geek Diário.
 */
export function hasBriefingBannerSpecs(item = {}) {
  const shortTitle =
    String(
      item.titulo_curto ||
      item.short_title ||
      ""
    ).trim();

  const editorial =
    Array.isArray(item.banners)
      ? item.banners
          .filter((banner) => {
            const type = String(
              banner?.type ||
              "editorial"
            )
              .trim()
              .toLowerCase();

            return type === "editorial";
          })
          .slice(0, 2)
      : [];

  return (
    Boolean(shortTitle) &&
    editorial.length === 2 &&
    editorial.every((banner) => {
      const title = String(
        banner?.banner_title ||
        banner?.bannerTitle ||
        ""
      ).trim();

      const highlight = String(
        banner?.highlight ||
        ""
      ).trim();

      return Boolean(
        title &&
        highlight
      );
    })
  );
}


export function buildBriefingClientPayload(
  item = {}
) {
  const shortTitle =
    String(
      item.titulo_curto ||
      item.short_title ||
      ""
    ).trim();

  if (!shortTitle) {
    throw new Error(
      "Esta noticia nao possui titulo_curto para o modelo Briefing."
    );
  }

  const editorial =
    Array.isArray(item.banners)
      ? item.banners
          .filter((banner) => {
            const type = String(
              banner?.type ||
              "editorial"
            )
              .trim()
              .toLowerCase();

            return type === "editorial";
          })
          .slice(0, 2)
      : [];

  if (
    editorial.length !== 2 ||
    !editorial.every(
      (banner) =>
        String(
          banner?.banner_title ||
          banner?.bannerTitle ||
          ""
        ).trim() &&
        String(
          banner?.highlight ||
          ""
        ).trim()
    )
  ) {
    throw new Error(
      "Esta notícia não possui os dois banners editoriais exigidos pelo modo Briefing."
    );
  }

  const editorialBanners =
    editorial.map(
      (banner) => ({
        type:
          "editorial",

        titulo_curto:
          shortTitle,

        banner_title:
          String(
            banner.banner_title ||
            banner.bannerTitle ||
            ""
          ).trim(),

        highlight:
          String(
            banner.highlight ||
            ""
          ).trim(),

        visual_subject:
          String(
            banner.visual_subject ||
            banner.assunto_visual ||
            item.contexto_visual ||
            item.titulo ||
            ""
          ).trim(),

        contexto_visual:
          String(
            banner.contexto_visual ||
            item.contexto_visual ||
            ""
          ).trim(),

        image_query:
          String(
            banner.image_query ||
            item.image_query ||
            item.titulo ||
            ""
          ).trim(),

        image_url:
          String(
            banner.image_url ||
            banner.imageUrl ||
            ""
          ).trim(),

        imagens:
          Array.isArray(
            banner.imagens
          )
            ? banner.imagens
            : [],
      })
    );

  return {
    mode:
      "briefing",

    noticia_id:
      item.id ||
      undefined,

    categoria:
      item.categoria ||
      "geek",

    titulo:
      item.titulo ||
      "",

    titulo_curto:
      shortTitle,

    fontes:
      Array.isArray(item.fontes)
        ? item.fontes
        : [],

    contexto_visual:
      item.contexto_visual ||
      "",

    image_query:
      item.image_query ||
      item.titulo ||
      "",

    imagens:
      Array.isArray(item.imagens)
        ? item.imagens
        : [],

    banners: [
      ...editorialBanners,

      {
        type:
          "cta",

        asset_path:
          "./assets/cta/bagaca-studios-cta.jpg",

        cta_title_top:
          "Curtiu esse",

        cta_title_main:
          "conteúdo?",

        cta_handle:
          "bagacastudios",

        cta_actions: [
          "curta",
          "comenta",
          "compartilha",
          "salva",
        ],
      },
    ],
  };
}
