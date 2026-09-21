import {
  readFile,
} from "node:fs/promises";
import {
  fileURLToPath,
} from "node:url";

import sharp from "sharp";

export const CTA_WIDTH = 1080;
export const CTA_HEIGHT = 1350;

const BUNDLED_CTA_ASSET =
  fileURLToPath(
    new URL(
      "../assets/cta/bagaca-studios-cta.jpg",
      import.meta.url
    )
  );


export async function renderCtaBanner({
  assetPath,
}) {
  if (
    !assetPath ||
    !String(assetPath).trim()
  ) {
    throw new Error(
      "Informe o caminho da arte CTA."
    );
  }

  const requestedAssetPath =
    String(assetPath).trim();

  const normalizedAssetPath =
    requestedAssetPath
      .replaceAll("\\", "/")
      .replace(/^\.\//, "");

  const resolvedAssetPath =
    normalizedAssetPath ===
    "assets/cta/bagaca-studios-cta.jpg"
      ? BUNDLED_CTA_ASSET
      : requestedAssetPath;

  const input =
    await readFile(
      resolvedAssetPath
    );

  /*
   * Primeiro normalizamos somente a largura.
   *
   * Para a arte atual:
   * 1080 x 1350
   *
   * portanto nenhuma escala será necessária.
   */
  const base =
    await sharp(input)
      .rotate()
      .resize({
        width: CTA_WIDTH,
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();

  const metadata =
    await sharp(base)
      .metadata();

  const sourceWidth =
    Number(metadata.width || 0);

  const sourceHeight =
    Number(metadata.height || 0);

  if (
    sourceWidth !== CTA_WIDTH ||
    !sourceHeight
  ) {
    throw new Error(
      "Não foi possível normalizar a arte CTA."
    );
  }

  /*
   * Se a imagem já tiver 1440px,
   * não precisamos acrescentar nada.
   */
  if (sourceHeight === CTA_HEIGHT) {
    return {
      png: base,

      layout: {
        type: "cta",
        sourceWidth,
        sourceHeight,
        outputWidth: CTA_WIDTH,
        outputHeight: CTA_HEIGHT,
        extensionMode: "none",
      },
    };
  }

  /*
   * Caso excepcional:
   * se a arte for maior que 1440,
   * preservamos enquadramento central.
   */
  if (sourceHeight > CTA_HEIGHT) {
    const png =
      await sharp(base)
        .extract({
          left: 0,
          top: Math.floor(
            (sourceHeight - CTA_HEIGHT) / 2
          ),
          width: CTA_WIDTH,
          height: CTA_HEIGHT,
        })
        .png()
        .toBuffer();

    return {
      png,

      layout: {
        type: "cta",
        sourceWidth,
        sourceHeight,
        outputWidth: CTA_WIDTH,
        outputHeight: CTA_HEIGHT,
        extensionMode: "center-crop",
      },
    };
  }

  /*
   * A arte aprovada possui 1350px.
   *
   * Faltam:
   *
   * 1440 - 1350 = 90px
   *
   * então usamos:
   *
   * 45px acima
   * 45px abaixo
   *
   * Esses pixels NÃO recebem uma cor sólida.
   * Eles são extensões espelhadas das bordas
   * reais da própria arte.
   */
  const missing =
    CTA_HEIGHT - sourceHeight;

  const topPad =
    Math.floor(missing / 2);

  const bottomPad =
    missing - topPad;

  const topSourceHeight =
    Math.min(
      topPad,
      sourceHeight
    );

  const bottomSourceHeight =
    Math.min(
      bottomPad,
      sourceHeight
    );

  const topStrip =
    topSourceHeight > 0
      ? await sharp(base)
          .extract({
            left: 0,
            top: 0,
            width: CTA_WIDTH,
            height: topSourceHeight,
          })
          .flip()
          .png()
          .toBuffer()
      : null;

  const bottomStrip =
    bottomSourceHeight > 0
      ? await sharp(base)
          .extract({
            left: 0,
            top:
              sourceHeight -
              bottomSourceHeight,
            width: CTA_WIDTH,
            height: bottomSourceHeight,
          })
          .flip()
          .png()
          .toBuffer()
      : null;

  const layers = [];

  if (topStrip) {
    layers.push({
      input: topStrip,
      left: 0,
      top: 0,
    });
  }

  layers.push({
    input: base,
    left: 0,
    top: topPad,
  });

  if (bottomStrip) {
    layers.push({
      input: bottomStrip,
      left: 0,
      top:
        topPad +
        sourceHeight,
    });
  }

  const png =
    await sharp({
      create: {
        width: CTA_WIDTH,
        height: CTA_HEIGHT,
        channels: 4,
        background: {
          r: 0,
          g: 0,
          b: 0,
          alpha: 0,
        },
      },
    })
      .composite(layers)
      .png()
      .toBuffer();

  return {
    png,

    layout: {
      type: "cta",

      sourceWidth,
      sourceHeight,

      outputWidth:
        CTA_WIDTH,

      outputHeight:
        CTA_HEIGHT,

      topExtension:
        topPad,

      bottomExtension:
        bottomPad,

      extensionMode:
        "mirrored-edge",
    },
  };
}