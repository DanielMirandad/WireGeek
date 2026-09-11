import "./fontconfig-env.mjs";
import sharp from "sharp";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const WIDTH = 1080;
export const HEIGHT = 1920;

const FONT = fileURLToPath(
  new URL("../public/fonts/Archive-Regular.otf", import.meta.url)
);

const LOGO = fileURLToPath(
  new URL("../public/logo-bstudios.png", import.meta.url)
);

const LABELS = {
  games: "GAMES",
  geek: "GEEK / TECH",
  tech: "GEEK / TECH",
  "geek/tech": "GEEK / TECH",
  cinema: "CINEMA",
  anime: "ANIME",
};

const DEFAULT_COLOR = "#FF7518";
const TEXT_LEFT = 72;
const TEXT_WIDTH = 936;
const TEXT_REGION_TOP = 1160;
const TEXT_REGION_BOTTOM = 1680;
const TEXT_REGION_HEIGHT = TEXT_REGION_BOTTOM - TEXT_REGION_TOP;
const DIVIDER_WIDTH = 96;
const MAX_VISUAL_TITLE_CHARS = 48;

function compactVisualTitle(value) {
  const source = String(value || "").trim().replace(/\s+/g, " ");
  if (source.length <= MAX_VISUAL_TITLE_CHARS) return source;

  const cut = source.slice(0, MAX_VISUAL_TITLE_CHARS + 1);
  const boundary = cut.lastIndexOf(" ");
  let result = (boundary >= 40 ? cut.slice(0, boundary) : source.slice(0, MAX_VISUAL_TITLE_CHARS)).trim();

  result = result.replace(
    /\s+(?:a|ao|aos|as|com|da|das|de|do|dos|e|em|na|nas|no|nos|para|por|seu|seus|sua|suas)$/i,
    ""
  );

  return result || source.slice(0, MAX_VISUAL_TITLE_CHARS).trim();
}

export function inputError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

const clean = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ");

const xml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export function normalizeBanner(body) {
  const categoria = clean(body.categoria || "geek").toLowerCase();

  if (!LABELS[categoria]) {
    throw inputError("Categoria invalida.");
  }

  const headline = clean(
    body.highlight || body.headline || body.resumo || body.summary
  );

  const shortTitle = clean(
    body.titulo_curto ||
      body.short_title ||
      body.shortTitle ||
      LABELS[categoria]
  );

  const bannerTitle = compactVisualTitle(clean(
    body.banner_title ||
      body.bannerTitle ||
      body.titulo_banner ||
      body.titulo ||
      body.title ||
      shortTitle
  ));

  const imageUrl = clean(body.image_url || body.imageUrl || body.imagem);
  const color = clean(body.cor || DEFAULT_COLOR);

  if (!headline || headline.length > 1200) {
    throw inputError("Informe highlight de ate 1200 caracteres.");
  }

  if (!shortTitle || shortTitle.length > 180) {
    throw inputError("Informe titulo curto de ate 180 caracteres.");
  }

  if (!bannerTitle) {
    throw inputError("Informe titulo editorial para o banner.");
  }

  if (!/^https?:\/\//i.test(imageUrl)) {
    throw inputError("Informe image_url HTTP ou HTTPS.");
  }

  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    throw inputError("Cor invalida. Use #RRGGBB.");
  }

  return {
    categoria,
    category: LABELS[categoria],
    headline,
    shortTitle,
    bannerTitle,
    imageUrl,
    color,
  };
}

function raster(text, size, color = "#FFFFFF", { bold = false } = {}) {
  const weight = bold ? ' weight="bold"' : "";

  return sharp({
    text: {
      text: `<span foreground="${color}"${weight}>${xml(text)}</span>`,
      font: `Archive ${size}`,
      fontfile: FONT,
      dpi: 96,
      rgba: true,
    },
  });
}

async function measureLineHeight(size, options = {}) {
  const meta = await raster("AG", size, "#FFFFFF", options).metadata();
  return meta.height || Math.round(size * 1.05);
}

async function wrap(
  text,
  size,
  width,
  { uppercase = false, maxLines = 99, bold = false } = {}
) {
  const source = uppercase
    ? String(text || "").toUpperCase()
    : String(text || "");
  const words = source.split(/\s+/).filter(Boolean);

  if (!words.length) return [];

  const lines = [];
  let current = "";

  for (const word of words) {
    const wordWidth =
      (await raster(word, size, "#FFFFFF", { bold }).metadata()).width || 0;

    if (wordWidth > width) return null;

    const candidate = current ? `${current} ${word}` : word;
    const candidateWidth =
      (await raster(candidate, size, "#FFFFFF", { bold }).metadata()).width || 0;

    if (current && candidateWidth > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) lines.push(current);
  if (lines.length > maxLines) return null;

  return lines;
}

function splitHeadline(headline) {
  const normalized = clean(headline);

  const sentenceParts = normalized
    .split(/(?<=[.!?])\s+/)
    .map((part) => clean(part))
    .filter(Boolean);

  if (sentenceParts.length >= 2) {
    return {
      deck: sentenceParts[0].replace(/[.!?]+$/, ""),
      support: sentenceParts.slice(1).join(" "),
    };
  }

  if (normalized.length <= 76) {
    return { deck: normalized, support: "" };
  }

  const preferredCut = 72;
  const cutAt = normalized.lastIndexOf(" ", preferredCut);

  if (cutAt >= 46) {
    return {
      deck: normalized.slice(0, cutAt).trim(),
      support: normalized.slice(cutAt + 1).trim(),
    };
  }

  return { deck: normalized, support: "" };
}

export async function layoutText(bannerTitle, headline) {
  await access(FONT);

  const { deck, support } = splitHeadline(headline);

  for (let step = 0; step <= 16; step++) {
    const scale = 1 - step * 0.04;

    const titleSize = Math.max(52, Math.round(82 * scale));
    const deckSize = Math.max(27, Math.round(34 * scale));
    const supportSize = Math.max(22, Math.round(27 * scale));

    const titleLines = await wrap(bannerTitle, titleSize, TEXT_WIDTH, {
      uppercase: true,
      maxLines: 3,
      bold: true,
    });

    if (!titleLines?.length) continue;

    const deckLines = await wrap(deck, deckSize, TEXT_WIDTH, {
      uppercase: false,
      maxLines: 3,
    });

    if (!deckLines?.length) continue;

    const supportLines = support
      ? await wrap(support, supportSize, TEXT_WIDTH, {
          uppercase: false,
          maxLines: 2,
        })
      : [];

    if (support && !supportLines?.length) continue;

    const titleLineHeight = await measureLineHeight(titleSize, { bold: true });
    const deckLineHeight = await measureLineHeight(deckSize);
    const supportLineHeight = await measureLineHeight(supportSize);

    // Gaps are intentionally larger than the rendered glyph height. The old
    // renderer advanced by less than one line height, which caused overlap.
    const titleGap = titleLineHeight + 8;
    const deckGap = deckLineHeight + 8;
    const supportGap = supportLineHeight + 6;

    const titleHeight =
      titleLineHeight + Math.max(0, titleLines.length - 1) * titleGap;

    const deckHeight =
      deckLineHeight + Math.max(0, deckLines.length - 1) * deckGap;

    const supportHeight = supportLines.length
      ? supportLineHeight + Math.max(0, supportLines.length - 1) * supportGap
      : 0;

    const titleToDeck = 24;
    const deckToDivider = supportLines.length ? 24 : 0;
    const dividerToSupport = supportLines.length ? 24 : 0;
    const dividerHeight = supportLines.length ? 5 : 0;

    const blockHeight =
      titleHeight +
      titleToDeck +
      deckHeight +
      deckToDivider +
      dividerHeight +
      dividerToSupport +
      supportHeight;

    if (blockHeight > TEXT_REGION_HEIGHT) continue;

    const blockTop =
      TEXT_REGION_TOP + Math.round((TEXT_REGION_HEIGHT - blockHeight) / 2);

    return {
      scale,
      titleSize,
      deckSize,
      supportSize,
      titleLines,
      deckLines,
      supportLines,
      titleLineHeight,
      deckLineHeight,
      supportLineHeight,
      titleGap,
      deckGap,
      supportGap,
      titleHeight,
      deckHeight,
      supportHeight,
      titleToDeck,
      deckToDivider,
      dividerToSupport,
      dividerHeight,
      blockHeight,
      blockTop,
    };
  }

  throw inputError(
    "Texto nao cabe com legibilidade. Reduza o titulo editorial ou highlight."
  );
}

export async function renderBanner({
  imageBuffer,
  bannerTitle,
  shortTitle,
  headline,
  category,
  color = DEFAULT_COLOR,
}) {
  const visualTitle = compactVisualTitle(clean(bannerTitle || shortTitle));
  const layout = await layoutText(visualTitle, headline);

  const background = await sharp(imageBuffer, { limitInputPixels: 40000000 })
    .rotate()
    .resize(WIDTH, HEIGHT, { fit: "cover", position: "centre" })
    .modulate({ brightness: 0.98, saturation: 1.02 })
    .png()
    .toBuffer();

  const logo = await sharp(await readFile(LOGO))
    .trim()
    .resize({
      width: 126,
      height: 126,
      fit: "contain",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();

  const overlay = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#000000" stop-opacity="0.04"/>
          <stop offset="0.50" stop-color="#000000" stop-opacity="0.08"/>
          <stop offset="0.64" stop-color="#000000" stop-opacity="0.28"/>
          <stop offset="0.80" stop-color="#000000" stop-opacity="0.76"/>
          <stop offset="1" stop-color="#000000" stop-opacity="0.96"/>
        </linearGradient>
      </defs>

      <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="url(#shade)"/>
      <rect x="0" y="0" width="${WIDTH}" height="74" fill="${color}"/>
      <line x1="930" y1="37" x2="1038" y2="37" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" opacity="0.9"/>
      <line x1="72" y1="198" x2="156" y2="198" stroke="${color}" stroke-width="6" stroke-linecap="round"/>
    </svg>
  `);

  const layers = [
    { input: background, left: 0, top: 0 },
    { input: overlay, left: 0, top: 0 },
  ];

  const addTextLeft = async (
    value,
    size,
    left,
    top,
    fill,
    options = {}
  ) => {
    const { data } = await raster(value, size, fill, options)
      .png()
      .toBuffer({ resolveWithObject: true });

    layers.push({ input: data, left: Math.round(left), top: Math.round(top) });
  };

  const addRule = (top) => {
    layers.push({
      input: Buffer.from(`
        <svg xmlns="http://www.w3.org/2000/svg" width="${DIVIDER_WIDTH}" height="8">
          <line x1="0" y1="4" x2="${DIVIDER_WIDTH}" y2="4" stroke="${color}" stroke-width="5" stroke-linecap="round"/>
        </svg>
      `),
      left: TEXT_LEFT,
      top: Math.round(top),
    });
  };

  const breakingText = await raster("BREAKING NEWS", 34, "#111111", {
    bold: false,
  })
    .png()
    .toBuffer({ resolveWithObject: true });

  layers.push({
    input: breakingText.data,
    left: Math.round((WIDTH - breakingText.info.width) / 2),
    top: 15,
  });

  await addTextLeft(category, 29, TEXT_LEFT, 136, "#FFFFFF");

  let currentY = layout.blockTop;

  for (let index = 0; index < layout.titleLines.length; index++) {
    const line = layout.titleLines[index];
    const accentLine = index === layout.titleLines.length - 1;

    await addTextLeft(
      line,
      layout.titleSize,
      TEXT_LEFT,
      currentY,
      accentLine ? color : "#FFFFFF",
      { bold: true }
    );

    currentY += layout.titleGap;
  }

  currentY =
    layout.blockTop + layout.titleHeight + layout.titleToDeck;

  for (let index = 0; index < layout.deckLines.length; index++) {
    await addTextLeft(
      layout.deckLines[index],
      layout.deckSize,
      TEXT_LEFT,
      currentY,
      "#F5F5F5"
    );

    currentY += layout.deckGap;
  }

  currentY =
    layout.blockTop +
    layout.titleHeight +
    layout.titleToDeck +
    layout.deckHeight;

  if (layout.supportLines.length) {
    currentY += layout.deckToDivider;
    addRule(currentY);
    currentY += layout.dividerHeight + layout.dividerToSupport;

    for (let index = 0; index < layout.supportLines.length; index++) {
      await addTextLeft(
        layout.supportLines[index],
        layout.supportSize,
        TEXT_LEFT,
        currentY,
        "#D6D6D6"
      );

      currentY += layout.supportGap;
    }
  }

  const logoMeta = await sharp(logo).metadata();

  layers.push({
    input: logo,
    left: Math.round((WIDTH - (logoMeta.width || 126)) / 2),
    top: 1756,
  });

  const png = await sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      background: "#000000",
    },
  })
    .composite(layers)
    .png()
    .toBuffer();

  return { png, layout };
}
