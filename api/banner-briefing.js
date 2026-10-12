
    const rendererCopy = banner;

    let normalized =
      normalizeBanner({
        categoria:
          currentCategory ||
          briefing.categoria,

        banner_title:
          rendererCopy.banner_title,

        title_main:
          visualTitle.title_main,

        title_theme:
          visualTitle.title_theme,

        highlight:
          rendererCopy.highlight,

        editorial_copy:
          rendererCopy.editorial_copy,

        /*
         * Campo mantido apenas para
         * compatibilidade interna com
         * o renderer.
         *
         * O renderer junta banner_title e highlight
         * no mesmo bloco visual.
         */
        titulo_curto:
          briefing.titulo_curto,

        contexto_visual:
          banner.contexto_visual ||
          banner.visual_subject ||
          body.contexto_visual ||
          body.visual_subject ||
          "",

        image_position:
          banner.image_position ||
          body.image_position ||
          "",

        image_url:
          image.url,
      });

    let output;
    let copyRecoveryAttempts = 0;

    while (true) {
    try {
      output =
        await renderBanner({
          ...normalized,

          imageBuffer:
            image.imageBuffer,
        });
    } catch (error) {
      const thematicWidthError =
        error?.code === "TITLE_MAIN_TOO_WIDE" ||
        error?.code === "TITLE_THEME_TOO_WIDE";

      if (
        thematicWidthError &&
        thematicTitleRecoveryAttempts < 4 &&
        visualTitle.title_main &&
        visualTitle.title_theme
      ) {
        const rejectedField =
          error.code === "TITLE_MAIN_TOO_WIDE"
            ? "title_main"
            : "title_theme";

        const currentKey =
          `${visualTitle.title_main}\u0000${visualTitle.title_theme}`;

        seenVisualTitles.add(currentKey);

        const recoveredTitle =
          preserveCanonicalTitle
            ? recoverCanonicalVisualTitle(
                briefing.titulo_curto,
                visualTitle,
                rejectedField
              )
            : shortenRejectedVisualTitle(
                visualTitle,
                rejectedField
              );

        const recoveredKey =
          recoveredTitle
            ? `${recoveredTitle.title_main}\u0000${recoveredTitle.title_theme}`
            : "";

        if (
          !recoveredTitle ||
          seenVisualTitles.has(recoveredKey)
        ) {
          throw error;
        }

        thematicTitleRecoveryAttempts += 1;

        console.warn(
          "WIRE/GEEK BRIEFING: titulo tematico excedeu a largura; recuperando deterministicamente.",
          {
            noticia_id:
              body.noticia_id ||
              null,

            error_code:
              error.code,

            tentativa:
              thematicTitleRecoveryAttempts,

            canonical:
              preserveCanonicalTitle,
          }
        );

        visualTitle = recoveredTitle;
        normalized = {
          ...normalized,
          titleMain: visualTitle.title_main,
          titleTheme: visualTitle.title_theme,
        };

        continue;
      }

      if (
        error?.code === "COPY_TOO_LONG" &&
        visualTitle.title_main &&
        visualTitle.title_theme &&
        copyRecoveryAttempts < 6
      ) {
        const recoveredCopy =
          shortenEditorialDisplayCopy(
            normalized.editorialCopy
          );

        if (!recoveredCopy) {
          throw error;
        }

        copyRecoveryAttempts += 1;

        console.warn(
          "WIRE/GEEK BRIEFING: copy visual excedeu a area segura; encurtando somente a copy de exibicao.",
          {
            noticia_id:
              body.noticia_id ||
              null,

            banner_index:
              index,

            tentativa:
              copyRecoveryAttempts,
          }
        );

        normalized = {
          ...normalized,
          editorialCopy:
            recoveredCopy,
        };

        continue;
      }

      throw error;
    }
    break;
    }

    rendered.push({
      type:
        "editorial",

      bannerIndex:
        index,

      normalized,

      sourceImage:
        image,

      png:
        output.png,
    });
  }