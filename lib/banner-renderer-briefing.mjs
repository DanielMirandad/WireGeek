import './fontconfig-env.mjs';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Reconstructed from the Coach Taylor reference, not recovered historical code.
export const WIDTH = 1080;
export const HEIGHT = 1440;
// Fixed photo viewport and fade, independent of editorial text length.
export const IMAGE_FRAME = Object.freeze({ left: 0, top: 68, width: 1080, height: 960, fadeStart: 650, fadeEnd: 1028 });
const DEFAULT_COLOR = '#FF7518';
const LABELS = { games: 'GAMES', geek: 'GEEK / CULTURA POP', tech: 'GEEK / TECH', 'geek/tech': 'GEEK / TECH', cinema: 'CINEMA / CULTURA POP', anime: 'ANIME / CULTURA POP' };
const clean = value => String(value || '').trim().replace(/\s+/g, ' ');
const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function inputError(message) { return Object.assign(new Error(message), { statusCode: 400 }); }
// Preserve the complete editorial title; fit it by measurement, never truncate it.
const compactVisualTitle = clean;
export function normalizeBanner(body) {
    const categoria = clean(
        body.categoria || "geek"
    ).toLowerCase();

    if (!LABELS[categoria]) {
        throw inputError("Categoria invalida.");
    }

    const headline = clean(
        body.highlight ||
        body.headline ||
        body.resumo ||
        body.summary
    );

    const shortTitle = clean(
        body.titulo_curto ||
        body.short_title ||
        body.shortTitle ||
        LABELS[categoria]
    );

    const bannerTitle = compactVisualTitle(
        clean(
            body.banner_title ||
            body.bannerTitle ||
            body.titulo_banner ||
            body.titulo ||
            body.title ||
            shortTitle
        )
    );

    const imageUrl = clean(
        body.image_url ||
        body.imageUrl ||
        body.imagem
    );

    const color = clean(
        body.cor || DEFAULT_COLOR
    );

    if (!headline || headline.length > 1200) {
        throw inputError(
            "Informe highlight de ate 1200 caracteres."
        );
    }

    if (!shortTitle || shortTitle.length > 180) {
        throw inputError(
            "Informe titulo curto de ate 180 caracteres."
        );
    }

    if (!bannerTitle) {
        throw inputError(
            "Informe titulo editorial para o banner."
        );
    }

    if (!/^https?:\/\//i.test(imageUrl)) {
        throw inputError(
            "Informe image_url HTTP ou HTTPS."
        );
    }

    if (!/^#[0-9a-f]{6}$/i.test(color)) {
        throw inputError(
            "Cor invalida. Use #RRGGBB."
        );
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

function fontPath(env, bundledFile, windowsFilename) {
    const candidates = [process.env[env], bundledFile];
    if (process.platform === 'win32') candidates.push(join(process.env.WINDIR || 'C:/Windows', 'Fonts', windowsFilename));
    const found = candidates.find(value => value && existsSync(value));
    if (!found) throw new Error('Fonte de layout ausente: ' + bundledFile + '. Configure ' + env + '.');
    return found;
}
function makeTextEngine() {
    const titleFont = fontPath('BANNER_TITLE_FONT', fileURLToPath(new URL('../assets/fonts/briefing/Anton-Regular.ttf', import.meta.url)), 'impact.ttf');
    const bodyFont = fontPath('BANNER_BODY_FONT', fileURLToPath(new URL('../assets/fonts/briefing/Arimo-wght.ttf', import.meta.url)), 'arial.ttf');
    const fonts = { title: titleFont, body: bodyFont, accent: bodyFont };
    const cache = new Map();
    return async (text, size, role = 'title', color = '#FFFFFF', spacing = 0) => {
        const key = JSON.stringify([text, size, role, color, spacing]);
        if (!cache.has(key)) cache.set(key, sharp({
            text: {
                text: '<span foreground="' + color + '" letter_spacing="' + Math.round(spacing * 1024) + '">' + xml(text) + '</span>',
                font: (role === 'title' ? 'Anton ' : role === 'accent' ? 'Arimo Bold ' : 'Arimo ') + size,
                fontfile: fonts[role], dpi: 72, rgba: true,
            }
        }).png().toBuffer({ resolveWithObject: true }));
        return cache.get(key);
    };
}
async function wrap(text, size, width, maxLines, role, raster) {
    const words = clean(text).split(' ').filter(Boolean), lines = [];
    let current = '';
    for (const word of words) {
        if ((await raster(word, size, role)).info.width > width) return null;
        const candidate = current ? current + ' ' + word : word;
        if (current && (await raster(candidate, size, role)).info.width > width) { lines.push(current); current = word; }
        else current = candidate;
    }
    if (current) lines.push(current);
    return lines.length && lines.length <= maxLines ? lines : null;
}
export function splitBannerTitle(title, shortTitle) {
    const full = clean(
        title || shortTitle
    ).toUpperCase();

    if (!full) {
        throw inputError(
            "Informe o título do banner."
        );
    }

    const words = full
        .split(/\s+/)
        .filter(Boolean);

    if (words.length <= 2) {
        return {
            subject: full,
            callout: "",
        };
    }

    /*
     * O Briefing define o banner_title.
     *
     * Aqui NÃO reescrevemos o título.
     * Apenas escolhemos uma quebra visual
     * entre a linha branca e a linha laranja.
     *
     * Preferimos iniciar a segunda parte em
     * conectivos naturais do pt-BR quando isso
     * também produz linhas equilibradas.
     */
    const preferredCalloutStarts =
        new Set([
            "A",
            "AS",
            "COM",
            "DA",
            "DAS",
            "DE",
            "DO",
            "DOS",
            "E",
            "EM",
            "NA",
            "NAS",
            "NO",
            "NOS",
            "O",
            "OS",
            "PARA",
            "POR",
        ]);

    let bestIndex = 1;
    let bestScore = Infinity;

    for (
        let index = 1;
        index < words.length;
        index++
    ) {
        const first = words
            .slice(0, index)
            .join(" ");

        const second = words
            .slice(index)
            .join(" ");

        if (!first || !second) {
            continue;
        }

        let score = Math.abs(
            first.length - second.length
        );

        if (
            preferredCalloutStarts.has(
                words[index]
            )
        ) {
            score -= 8;
        }

        /*
         * Evita deixar apenas uma palavra
         * muito curta na primeira linha quando
         * existem opções melhores.
         */
        if (
            index === 1 &&
            words.length > 3 &&
            first.length < 8
        ) {
            score += 8;
        }

        if (score < bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    }

    return {
        subject: words
            .slice(0, bestIndex)
            .join(" "),
        callout: words
            .slice(bestIndex)
            .join(" "),
    };
}
async function fitLayout(title, headline, raster, shortTitle) {
    const { subject, callout } = splitBannerTitle(title, shortTitle);
    headline = clean(headline);
    if (!headline) throw inputError('Informe o highlight.');
    // The subject is indivisible: shrink the font, never append callout words.
    let titleSize = 180;
    while (titleSize >= 40 && (await raster(subject, titleSize)).info.width > 960) titleSize -= 2;
    if (titleSize < 40) throw inputError('Assunto longo demais para uma linha legível.');
    const subjectMetric = await raster(subject, titleSize);
    // Prefer one orange line when legible, then permit two or three.
    for (const maxLines of [1, 2, 3]) {
        for (let accentSize = 120; accentSize >= 58; accentSize -= 2) {
            const calloutLines = callout ? await wrap(callout, accentSize, 960, maxLines, 'title', raster) : [];
            if (!calloutLines) continue;
            const titleLines = [subject, ...calloutLines];
            const titleMetrics = [subjectMetric, ...await Promise.all(calloutLines.map(line => raster(line, accentSize)))];
            const titleGap = 14;
            const titleHeight = titleMetrics.reduce((sum, item) => sum + item.info.height, 0) + (titleLines.length - 1) * titleGap;
            for (let headlineSize = 42; headlineSize >= 30; headlineSize -= 2) {
                const headlineLines = await wrap(headline, headlineSize, 950, 4, 'body', raster);
                if (!headlineLines) continue;
                const headlineMetrics = await Promise.all(headlineLines.map(line => raster(line, headlineSize, 'body')));
                const headlineGap = 12;
                const headlineHeight = headlineMetrics.reduce((sum, item) => sum + item.info.height, 0) + (headlineLines.length - 1) * headlineGap;
                const blockHeight = titleHeight + 30 + headlineHeight;
                if (blockHeight > 530) continue;
                const titleTop = 1262 - blockHeight;
                let y = titleTop;
                const titlePositions = titleMetrics.map(item => { const top = y; y += item.info.height + titleGap; return top; });
                const headlineTop = titleTop + titleHeight + 30;
                y = headlineTop;
                const headlinePositions = headlineMetrics.map(item => { const top = y; y += item.info.height + headlineGap; return top; });
                return { subject, callout, calloutLines, accentSize, titleSize, headlineSize, titleLines, headlineLines, titleTop, headlineTop, titleHeight, headlineHeight, titleGap, headlineGap, titlePositions, headlinePositions, blockHeight };
            }
        }
    }
    throw inputError('Texto excede a área legível do banner. Reduza a chamada ou highlight.');
}
export async function layoutText(title, headline, shortTitle) { return fitLayout(title, headline, makeTextEngine(), shortTitle); }
export async function renderBanner({ imageBuffer, bannerTitle, shortTitle, headline, category, color = DEFAULT_COLOR }) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw inputError('Cor inválida.');
    const raster = makeTextEngine();
    const layout = await fitLayout(bannerTitle || shortTitle, headline, raster, shortTitle);
    const photo = await sharp(imageBuffer, { limitInputPixels: 50000000 }).rotate()
        .resize(IMAGE_FRAME.width, IMAGE_FRAME.height, { fit: 'cover', position: 'centre' }).png().toBuffer();
    const background = await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: '#000000' } })
        .composite([{ input: photo, left: IMAGE_FRAME.left, top: IMAGE_FRAME.top }]).png().toBuffer();
    const fadeStart = IMAGE_FRAME.fadeStart;
    const overlay = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440"><defs><linearGradient id="shade" gradientUnits="userSpaceOnUse" x1="0" y1="' + fadeStart + '" x2="0" y2="' + IMAGE_FRAME.fadeEnd + '"><stop offset="0" stop-color="black" stop-opacity="0"/><stop offset=".48" stop-color="black" stop-opacity=".55"/><stop offset=".8" stop-color="black" stop-opacity=".94"/><stop offset="1" stop-color="black"/></linearGradient></defs><rect width="1080" height="1440" fill="url(#shade)"/><rect width="1080" height="68" fill="' + color + '"/><path d="M30 51H124 M904 36H1048" stroke="white" stroke-width="3"/><path d="M63 1346H434 M648 1346H1017" stroke="' + color + '" stroke-width="5"/></svg>');
    const layers = [{ input: overlay, left: 0, top: 0 }];
    const bounds = [];
    async function add(value, size, top, role, fill = '#FFFFFF', spacing = 0, left = null, maxWidth = 960) {
        const result = await raster(value, size, role, fill, spacing);
        if (result.info.width > maxWidth) throw inputError('Texto excede a largura do layout.');
        const x = left ?? Math.round((WIDTH - result.info.width) / 2);
        layers.push({ input: result.data, left: x, top: Math.round(top) });
        bounds.push({ text: value, left: x, top: Math.round(top), width: result.info.width, height: result.info.height });
    }
    let categorySize = 30;
    while (categorySize > 18 && (await raster(clean(category), categorySize, 'body')).info.width > 285) categorySize--;
    await add(clean(category), categorySize, 18, 'body', '#FFFFFF', 0, 30, 285);
    await add('BREAKING NEWS', 36, 18, 'title', '#080808', 12, null, 460);
    for (let i = 0; i < layout.titleLines.length; i++) await add(layout.titleLines[i], i === 0 ? layout.titleSize : layout.accentSize, layout.titlePositions[i], 'title', i === 0 ? '#FFFFFF' : color);
    for (let i = 0; i < layout.headlineLines.length; i++) await add(layout.headlineLines[i], layout.headlineSize, layout.headlinePositions[i], 'body', '#F5F5F5');
    const brandMainMetric = await raster('BAGA\u00C7A', 52, 'title');
    const brandSubMetric = await raster('STUDIOS', 22, 'title', '#FFFFFF', 8);
    const brandGap = 8;
    const brandBottom = HEIGHT - 32;
    const brandSubTop = brandBottom - brandSubMetric.info.height;
    const brandMainTop = brandSubTop - brandGap - brandMainMetric.info.height;
    await add('BAGA\u00C7A', 52, brandMainTop, 'title');
    await add('STUDIOS', 22, brandSubTop, 'title', '#FFFFFF', 8);

    const png = await sharp(background).composite(layers).png().toBuffer();
    return { png, layout: { ...layout, imageFrame: IMAGE_FRAME, bounds } };
}
