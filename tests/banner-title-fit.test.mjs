import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import {
  renderBanner,
  APPROVED_BANNER_MODEL,
} from "../lib/banner-renderer-briefing.mjs";

async function makeImage() {
  return sharp({
    create: {
      width: 1080,
      height: 1350,
      channels: 3,
      background: {
        r: 20,
        g: 20,
        b: 20,
      },
    },
  })
    .png()
    .toBuffer();
}

function baseInput(imageBuffer) {
  return {
    imageBuffer,

    bannerTitle:
      "NOVO PRODUTO",

    shortTitle:
      "DARKWING DUCK",

    titleTheme:
      "NOVO TRAILER",

    headline:
      "Novo trailer divulgado",

    editorialCopy:
      "Novo trailer divulgado oficialmente para o público.",

    category:
      "GEEK",
  };
}

test(
  "title_main com varias palavras reduz somente o necessario para caber em 950px",
  async () => {
    const imageBuffer =
      await makeImage();

    const result =
      await renderBanner({
        ...baseInput(imageBuffer),

        /*
         * Deve exceder como frase completa,
         * mas possuir prefixo semanticamente util
         * que caiba sem alterar a tipografia.
         */
        titleMain:
          "DARKWING DUCK RETURNS",
      });

    assert.ok(
      Buffer.isBuffer(result.png)
    );

    assert.equal(
      result.layout.width,
      1080
    );

    assert.equal(
      result.layout.height,
      1350
    );

    const mainBounds =
      result.layout.bounds.filter(
        item =>
          item.fontSize ===
          APPROVED_BANNER_MODEL
            .thematicTitle
            .mainFontSize
      );

    assert.equal(
      mainBounds.length,
      1
    );

    assert.ok(
      mainBounds[0].width <=
        APPROVED_BANNER_MODEL
          .thematicTitle
          .maxWidth
    );

    assert.notEqual(
      mainBounds[0].text,
      "DARKWING DUCK RETURNS"
    );

    assert.ok(
      "DARKWING DUCK RETURNS"
        .startsWith(
          mainBounds[0].text
        )
    );
  }
);

test(
  "title_main de uma unica palavra impossivel falha sem reduzir fonte ou largura aprovada",
  async () => {
    const imageBuffer =
      await makeImage();

    await assert.rejects(
      () =>
        renderBanner({
          ...baseInput(imageBuffer),

          titleMain:
            "INTERNATIONALIZATION",
        }),

      error => {
        assert.equal(
          error?.statusCode,
          400
        );

        assert.equal(
          error?.code,
          "TITLE_MAIN_TOO_WIDE"
        );

        return true;
      }
    );
  }
);