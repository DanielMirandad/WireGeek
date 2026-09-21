import "./fontconfig-env.mjs";

import sharp from "sharp";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/*
 * ============================================================
 * BAGAÇA STUDIOS / WIREGEEK
 * MODELO OFICIAL DO BRIEFING
 * ============================================================
 *
 * O renderer nao interpreta o design.
 * Ele reproduz o design aprovado.
 *
 * REGRAS FIXAS:
 *
 * Canvas................ 1080 x 1350
 * Aspect ratio.......... 4:5
 *
 * Categoria............. 34 px
 * Titulo curto.......... 100 px
 * Editorial............. 44 px
 * Line-height........... 52 px
 * BAGAÇA................ 31 px
 * STUDIOS............... 18 px
 *
 * Editorial max-width... 950 px
 * Editorial max-lines... 5
 *
 * Auto-scale............ PROIBIDO
 * Divisor inferior...... PROIBIDO
 *
 * Se a copy nao couber:
 * COPY_TOO_LONG.
 *
 * Nunca reduzir fonte.
 */

export const APPROVED_BANNER_MODEL =
    Object.freeze({
        width: 1080,
        height: 1350,
        aspectRatio: "4:5",

        colors: {
            black: "#000000",
            white: "#FFFFFF",
            orange: "#FF9700",
        },

        category: {
            x: 45,
            y: 35,
            fontSize: 34,
            fontWeight: 800,
            letterSpacing: 1.5,

            underlineY: 77,
            underlineHeight: 5,
            underlineMaxWidth: 140,
        },

        shortTitle: {
            centerX: 540,
            top: 835,

            fontSize: 100,
            fontWeight: 900,
            letterSpacing: -4,

        wordGap: 12,

            maxWidth: 950,
            maxLines: 1,

            autoScale: false,
        },

        divider: {
            x: 270,
            y: 955,
            width: 540,
            height: 4,
        },

        editorial: {
            wordTightening: 0, // Preserve natural character spacing.
            centerX: 540,

            fontSize: 44,
            fontWeight: 800,

            lineHeight: 52,

            maxWidth: 950,
            maxLines: 5,

            topGap: 14,
            bottomGap: 14,

            autoScale: false,
            uniformFontSize: true,

            bottomDivider: false,
        },

        brand: {
            centerX: 540,

            top: 1260,

            nameFontSize: 31,
            nameSpacing: 4,

            studiosTop: 1300,
            studiosFontSize: 18,
            studiosSpacing: 7,

            lineOuterLeft: 65,
            lineOuterRight: 1015,

            lineGap: 18,
            lineHeight: 4,
        },

        image: {
            x: 0,
            y: 0,

            width: 1080,
            height: 1350,

            fit: "cover",
            contextualFocus: true,
        },
    });

export const WIDTH =
    APPROVED_BANNER_MODEL.width;

export const HEIGHT =
    APPROVED_BANNER_MODEL.height;

export const IMAGE_FRAME =
    Object.freeze({
        left: 0,
        top: 0,
        width: WIDTH,
        height: HEIGHT,

        fadeStart:
            Math.round(
                HEIGHT * 0.45
            ),

        fadeEnd:
            HEIGHT,
    });

const WHITE =
    APPROVED_BANNER_MODEL
        .colors.white;

const ORANGE =
    APPROVED_BANNER_MODEL
        .colors.orange;

const LABELS = {
    games: "GAMES",
    geek: "GEEK",
    tech: "GEEK",
    "geek/tech": "GEEK",
    cinema: "CINEMA",
    anime: "ANIME",
};

const clean =
    value =>
        String(value || "")
            .trim()
            .replace(/\s+/g, " ");

const xml =
    value =>
        String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

export function inputError(
    message,
    code = "BANNER_INPUT_ERROR"
) {
    return Object.assign(
        new Error(message),
        {
            statusCode: 400,
            code,
        }
    );
}

/*
 * ============================================================
 * ASSERTIONS DO MODELO
 * ============================================================
 */

function assertApprovedModel() {
    const m =
        APPROVED_BANNER_MODEL;

    const failures = [];

    if (m.width !== 1080)
        failures.push("width");

    if (m.height !== 1350)
        failures.push("height");

    if (m.aspectRatio !== "4:5")
        failures.push("aspectRatio");

    if (m.category.fontSize !== 34)
        failures.push("category.fontSize");

    if (m.shortTitle.fontSize !== 100)
        failures.push("shortTitle.fontSize");

    if (m.shortTitle.autoScale !== false)
        failures.push("shortTitle.autoScale");

    if (m.editorial.fontSize !== 44)
        failures.push("editorial.fontSize");

    if (m.editorial.lineHeight !== 52)
        failures.push("editorial.lineHeight");

    if (m.editorial.maxWidth !== 950)
        failures.push("editorial.maxWidth");

    if (m.editorial.maxLines !== 5)
        failures.push("editorial.maxLines");

    if (m.editorial.autoScale !== false)
        failures.push("editorial.autoScale");

    if (m.editorial.uniformFontSize !== true)
        failures.push("editorial.uniformFontSize");

    if (m.editorial.bottomDivider !== false)
        failures.push("editorial.bottomDivider");

    if (m.brand.nameFontSize !== 31)
        failures.push("brand.nameFontSize");

    if (m.brand.studiosFontSize !== 18)
        failures.push("brand.studiosFontSize");

    if (failures.length) {
        throw new Error(
            "Modelo aprovado alterado: " +
            failures.join(", ")
        );
    }
}

assertApprovedModel();

/*
 * ============================================================
 * NORMALIZACAO
 * ============================================================
 */

export function normalizeBanner(
    body = {}
) {
    const categoria =
        clean(
            body.categoria ||
            body.category ||
            "geek"
        ).toLowerCase();

    if (!LABELS[categoria]) {
        throw inputError(
            "Categoria invalida."
        );
    }

    const shortTitle =
        clean(
            body.titulo_curto ||
            body.short_title ||
            body.shortTitle
        );

    const bannerTitle =
        clean(
            body.banner_title ||
            body.bannerTitle ||
            body.titulo_banner
        );

    const headline =
        clean(
            body.highlight ||
            body.headline ||
            body.resumo ||
            body.summary
        );

    const imageUrl =
        clean(
            body.image_url ||
            body.imageUrl ||
            body.imagem
        );

    const contextVisual =
        clean(
            body.contexto_visual ||
            body.visual_subject ||
            body.visualSubject
        );

    const imagePosition =
        clean(
            body.image_position ||
            body.imagePosition ||
            body.foco_imagem
        );

    if (!shortTitle) {
        throw inputError(
            "Informe titulo_curto.",
            "SHORT_TITLE_MISSING"
        );
    }
if (!bannerTitle) {
        throw inputError(
            "Informe banner_title."
        );
    }

    if (!headline) {
        throw inputError(
            "Informe highlight."
        );
    }

    if (
        !imageUrl ||
        !/^https?:\/\//i.test(
            imageUrl
        )
    ) {
        throw inputError(
            "Informe image_url HTTP ou HTTPS."
        );
    }

    return {
        categoria,

        category:
            LABELS[categoria],

        shortTitle,

        bannerTitle,

        headline,

        imageUrl,

        contextVisual,

        imagePosition,

        color:
            ORANGE,
    };
}

/*
 * ============================================================
 * FONTE
 * ============================================================
 */

function makeTextEngine() {
    const fontFile =
        fileURLToPath(
            new URL(
                "../public/fonts/Archive-Regular.otf",
                import.meta.url
            )
        );

    if (!existsSync(fontFile)) {
        throw new Error(
            "Archive-Regular.otf ausente."
        );
    }

    const cache =
        new Map();

    return async (
        text,
        size,
        color = WHITE,
        spacing = 0
    ) => {
        const value =
            clean(text);

        const key =
            JSON.stringify([
                value,
                size,
                color,
                spacing,
            ]);

        if (!cache.has(key)) {
            cache.set(
                key,

                sharp({
                    text: {
                        text:
                            '<span foreground="' +
                            color +
                            '" letter_spacing="' +
                            Math.round(
                                spacing * 1024
                            ) +
                            '">' +
                            xml(value) +
                            "</span>",

                        font:
                            "Archive " +
                            size,

                        fontfile:
                            fontFile,

                        dpi:
                            72,

                        rgba:
                            true,
                    },
                })
                    .png()
                    .toBuffer({
                        resolveWithObject:
                            true,
                    })
            );
        }

        return cache.get(key);
    };
}

/*
 * ============================================================
 * TITULO CURTO - 100 PX FIXOS
 * ============================================================
 */

async function emboldenShortTitle(
    rendered
) {
    if (
        !rendered?.data ||
        !rendered?.info?.width ||
        !rendered?.info?.height
    ) {
        throw new Error(
            "Raster invalido para embolden."
        );
    }

    /*
     * O projeto possui somente Archive-Regular.
     *
     * Para manter:
     *
     * - a fonte aprovada;
     * - tamanho real de 100 px;
     * - render deterministico;
     *
     * criamos peso visual adicional sobre o proprio
     * raster, sem alterar font-size.
     */
    /*
     * Negrito sintetico deterministico.
     *
     * Archive-Regular continua sendo a fonte.
     * Font-size continua exatamente 100 px.
     *
     * Expandimos principalmente no eixo horizontal
     * para obter peso Bold sem deformar a altura.
     */
    const paddingX = 4;
    const paddingY = 1;

    const width =
        rendered.info.width +
        paddingX * 2;

    const height =
        rendered.info.height +
        paddingY * 2;

    const offsets = [];

    /*
     * Expansao horizontal principal:
     * -4 ... +4 px.
     */
    for (
        let dx = -4;
        dx <= 4;
        dx++
    ) {
        offsets.push(
            [dx, 0]
        );
    }

    /*
     * Pequena expansao vertical e diagonal
     * para evitar aparencia apenas "esticada".
     */
    offsets.push(
        [-2, -1],
        [-1, -1],
        [ 0, -1],
        [ 1, -1],
        [ 2, -1],

        [-2,  1],
        [-1,  1],
        [ 0,  1],
        [ 1,  1],
        [ 2,  1]
    );

    const composites =
        offsets.map(
            ([dx, dy]) => ({
                input:
                    rendered.data,

                left:
                    paddingX + dx,

                top:
                    paddingY + dy,
            })
        );

    return sharp({
        create: {
            width,
            height,
            channels: 4,

            background: {
                r: 0,
                g: 0,
                b: 0,
                alpha: 0,
            },
        },
    })
        .composite(
            composites
        )
        .png()
        .toBuffer({
            resolveWithObject:
                true,
        });
}


async function measureShortTitle(
    value,
    raster
) {
    const text =
        clean(value)
            .toLocaleUpperCase(
                "pt-BR"
            );

    if (!text) {
        throw inputError(
            "titulo_curto esta vazio.",
            "SHORT_TITLE_MISSING"
        );
    }

    const model =
        APPROVED_BANNER_MODEL
            .shortTitle;

    const words =
        text
            .split(/\s+/)
            .filter(Boolean);

    const renderedWords = [];

    for (const word of words) {
        const regular =
            await raster(
                word,
                model.fontSize,
                ORANGE,
                model.letterSpacing
            );

        const bold =
            await emboldenShortTitle(
                regular
            );

        renderedWords.push(
            bold
        );
    }

    const wordGap =
        Number(
            model.wordGap
        ) || 0;

    const width =
        renderedWords.reduce(
            (sum, item) =>
                sum + item.info.width,
            0
        ) +
        Math.max(
            0,
            renderedWords.length - 1
        ) * wordGap;

    const height =
        Math.max(
            ...renderedWords.map(
                (item) =>
                    item.info.height
            )
        );

    if (
        width >
        model.maxWidth
    ) {
        throw inputError(
            `SHORT_TITLE_TOO_LONG: titulo_curto ocupa ${width}px e o limite e ${model.maxWidth}px.`,
            "SHORT_TITLE_TOO_LONG"
        );
    }

    let left = 0;

    const composites =
        renderedWords.map(
            (item) => {
                const currentLeft =
                    left;

                left +=
                    item.info.width +
                    wordGap;

                return {
                    input:
                        item.data,

                    left:
                        currentLeft,

                    top:
                        Math.floor(
                            (
                                height -
                                item.info.height
                            ) / 2
                        ),
                };
            }
        );

    const metric =
        await sharp({
            create: {
                width,
                height,
                channels: 4,

                background: {
                    r: 0,
                    g: 0,
                    b: 0,
                    alpha: 0,
                },
            },
        })
            .composite(
                composites
            )
            .png()
            .toBuffer({
                resolveWithObject:
                    true,
            });

    return {
        text,
        metric,
    };
}

/*
 * ============================================================
 * QUEBRA DO BLOCO EDITORIAL
 * ============================================================
 */
async function wrapEditorial(
    text,
    raster
) {
    const editorial =
        APPROVED_BANNER_MODEL
            .editorial;

    const words =
        clean(text)
            .toLocaleUpperCase(
                "pt-BR"
            )
            .split(/\s+/)
            .filter(Boolean);

    if (!words.length) {
        return null;
    }

    const cache =
        new Map();

    async function measure(
        start,
        end
    ) {
        const key =
            `${start}:${end}`;

        if (cache.has(key)) {
            return cache.get(key);
        }

        const line =
            words
                .slice(
                    start,
                    end
                )
                .join(" ");

        const metric =
            await raster(
                line,
                editorial.fontSize,
                WHITE,
                editorial.wordTightening
            );

        const value = {
            text:
                line,

            width:
                metric.info.width,

            words:
                end - start,
        };

        cache.set(
            key,
            value
        );

        return value;
    }

    /*
     * Primeiro calculamos o numero MINIMO de linhas
     * necessario para a copy caber em 950 px.
     *
     * Depois mantemos esse numero e apenas redistribuimos
     * as palavras para equilibrar o bloco.
     */
    let minimumLines = 1;
    let currentStart = 0;

    while (
        currentStart <
        words.length
    ) {
        let bestEnd =
            currentStart;

        for (
            let end =
                currentStart + 1;

            end <= words.length;

            end++
        ) {
            const candidate =
                await measure(
                    currentStart,
                    end
                );

            if (
                candidate.width >
                editorial.maxWidth
            ) {
                break;
            }

            bestEnd = end;
        }

        if (
            bestEnd ===
            currentStart
        ) {
            return null;
        }

        currentStart =
            bestEnd;

        if (
            currentStart <
            words.length
        ) {
            minimumLines++;
        }
    }

    if (
        minimumLines >
        editorial.maxLines
    ) {
        return null;
    }

    const complete =
        await raster(
            words.join(" "),
            editorial.fontSize,
            WHITE
        );

    /*
     * Largura ideal aproximada por linha.
     *
     * Nunca ultrapassa a safe width.
     */
    const targetWidth =
        Math.min(
            editorial.maxWidth * 0.92,

            complete.info.width /
            minimumLines
        );

    const memo =
        new Map();

    async function solve(
        start,
        linesLeft
    ) {
        const key =
            `${start}:${linesLeft}`;

        if (memo.has(key)) {
            return memo.get(key);
        }

        const remainingWords =
            words.length -
            start;

        if (
            linesLeft < 1 ||
            remainingWords <
                linesLeft
        ) {
            memo.set(
                key,
                null
            );

            return null;
        }

        if (linesLeft === 1) {
            const last =
                await measure(
                    start,
                    words.length
                );

            if (
                last.width >
                editorial.maxWidth
            ) {
                memo.set(
                    key,
                    null
                );

                return null;
            }

            const ratio =
                last.width /
                targetWidth;

            let cost =
                Math.pow(
                    last.width -
                    targetWidth,
                    2
                );

            /*
             * Ultima linha curta recebe penalidade forte.
             *
             * Exemplo que queremos evitar:
             *
             * MERCADO GLOBAL.
             */
            if (
                ratio < 0.62 &&
                minimumLines > 1
            ) {
                cost +=
                    Math.pow(
                        targetWidth *
                        (
                            0.62 -
                            ratio
                        ),
                        2
                    ) *
                    12;
            }

            if (
                last.words === 1 &&
                words.length > 1
            ) {
                cost +=
                    1000000;
            }

            const result = {
                cost,

                lines: [
                    last.text,
                ],

                widths: [
                    last.width,
                ],
            };

            memo.set(
                key,
                result
            );

            return result;
        }

        let best = null;

        const maximumEnd =
            words.length -
            (
                linesLeft -
                1
            );

        for (
            let end =
                start + 1;

            end <= maximumEnd;

            end++
        ) {
            const current =
                await measure(
                    start,
                    end
                );

            if (
                current.width >
                editorial.maxWidth
            ) {
                break;
            }

            const rest =
                await solve(
                    end,
                    linesLeft - 1
                );

            if (!rest) {
                continue;
            }

            let cost =
                Math.pow(
                    current.width -
                    targetWidth,
                    2
                );

            if (
                current.words === 1
            ) {
                cost +=
                    250000;
            }

            /*
             * Linha intermediaria muito curta tambem
             * perde pontos, mas menos que a ultima.
             */
            if (
                current.width <
                targetWidth * 0.55
            ) {
                cost +=
                    Math.pow(
                        targetWidth * 0.55 -
                        current.width,
                        2
                    ) *
                    4;
            }

            const candidate = {
                cost:
                    cost +
                    rest.cost,

                lines: [
                    current.text,
                    ...rest.lines,
                ],

                widths: [
                    current.width,
                    ...rest.widths,
                ],
            };

            if (
                !best ||
                candidate.cost <
                    best.cost
            ) {
                best =
                    candidate;
            }
        }

        memo.set(
            key,
            best
        );

        return best;
    }

    const balanced =
        await solve(
            0,
            minimumLines
        );

    if (!balanced) {
        return null;
    }

    if (
        balanced.lines.length >
        editorial.maxLines
    ) {
        return null;
    }

    if (
        balanced.widths.some(
            width =>
                width >
                editorial.maxWidth
        )
    ) {
        return null;
    }

    return balanced.lines;
}

/*
 * ============================================================
 * VALIDACAO DA COPY
 * ============================================================
 */

async function validateEditorialLines(
    lines,
    raster
) {
    const editorial =
        APPROVED_BANNER_MODEL
            .editorial;

    if (
        !Array.isArray(lines) ||
        !lines.length ||
        lines.length >
            editorial.maxLines
    ) {
        throw inputError(
            "COPY_TOO_LONG",
            "COPY_TOO_LONG"
        );
    }

    for (const line of lines) {
        const metric =
            await raster(
                line,
                editorial.fontSize,
                WHITE,
                editorial.wordTightening
            );

        if (
            metric.info.width >
            editorial.maxWidth
        ) {
            throw inputError(
                "REWRAP_REQUIRED",
                "REWRAP_REQUIRED"
            );
        }
    }
}

/*
 * ============================================================
 * COMPATIBILIDADE DE LAYOUT
 * ============================================================
 */

export function splitBannerTitle(
    title,
    shortTitle
) {
    return {
        subject:
            clean(
                shortTitle ||
                title
            )
                .toLocaleUpperCase(
                    "pt-BR"
                ),

        callout:
            "",
    };
}

export async function layoutText(
    bannerTitle,
    headline,
    shortTitle
) {
    const raster =
        makeTextEngine();

    const short =
        await measureShortTitle(
            shortTitle,
            raster
        );

    const editorialText =
        clean(
            `${bannerTitle || ""} ${headline || ""}`
        )
            .toLocaleUpperCase(
                "pt-BR"
            );

    const editorialLines =
        await wrapEditorial(
            editorialText,
            raster
        );

    if (!editorialLines) {
        throw inputError(
            "COPY_TOO_LONG",
            "COPY_TOO_LONG"
        );
    }

    await validateEditorialLines(
        editorialLines,
        raster
    );

    return {
        subject:
            short.text,

        titleSize:
            100,

        titleLines: [
            short.text,
        ],

        headlineSize:
            44,

        headlineLines:
            editorialLines,

        headlineGap:
            APPROVED_BANNER_MODEL
                .editorial
                .lineHeight,
    };
}

/*
 * ============================================================
 * FOCO DA IMAGEM
 * ============================================================
 */

function resolveImagePosition(
    explicitPosition,
    contextVisual
) {
    const explicit =
        clean(
            explicitPosition
        ).toLowerCase();

    const allowed = {
        top: "north",
        north: "north",

        center: "centre",
        centre: "centre",

        left: "west",
        west: "west",

        right: "east",
        east: "east",

        "top-left": "northwest",
        northwest: "northwest",

        "top-right": "northeast",
        northeast: "northeast",

        bottom: "south",
        south: "south",
    };

    if (
        explicit &&
        allowed[explicit]
    ) {
        return allowed[
            explicit
        ];
    }

    const context =
        clean(
            contextVisual
        ).toLowerCase();

    if (
        /\b(direita|lado direito|right)\b/.test(
            context
        )
    ) {
        return "east";
    }

    if (
        /\b(esquerda|lado esquerdo|left)\b/.test(
            context
        )
    ) {
        return "west";
    }

    /*
     * Default:
     * center top.
     */
    return "north";
}

/*
 * ============================================================
 * RENDER FINAL
 * ============================================================
 */

export async function renderBanner({
    imageBuffer,
    bannerTitle,
    shortTitle,
    headline,
    category,
    contextVisual = "",
    imagePosition = "",
}) {
    assertApprovedModel();

    if (!imageBuffer) {
        throw inputError(
            "Imagem ausente."
        );
    }

    const raster =
        makeTextEngine();

    const short =
        await measureShortTitle(
            shortTitle,
            raster
        );

    /*
     * banner_title e highlight
     * sao UM UNICO BLOCO.
     */
    const editorialText =
        clean(
            `${bannerTitle || ""} ${headline || ""}`
        )
            .toLocaleUpperCase(
                "pt-BR"
            );

    const editorialLines =
        await wrapEditorial(
            editorialText,
            raster
        );

    if (!editorialLines) {
        throw inputError(
            "COPY_TOO_LONG: texto editorial excede cinco linhas em 44px.",
            "COPY_TOO_LONG"
        );
    }

    await validateEditorialLines(
        editorialLines,
        raster
    );

    const focus =
        resolveImagePosition(
            imagePosition,
            contextVisual
        );

    /*
     * BASE VISUAL
     * ocupa o canvas inteiro.
     */
    const background =
        await sharp(
            imageBuffer,
            {
                limitInputPixels:
                    50000000,
            }
        )
            .rotate()
            .resize(
                WIDTH,
                HEIGHT,
                {
                    fit:
                        "cover",

                    position:
                        focus,
                }
            )
            .png()
            .toBuffer();

    /*
     * DEGRADE OFICIAL
     */
    const overlay =
        Buffer.from(`
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="${WIDTH}"
            height="${HEIGHT}"
        >
            <defs>
                <linearGradient
                    id="fade"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                >
                    <stop
                        offset="0"
                        stop-color="#000000"
                        stop-opacity="0"
                    />

                    <stop
                        offset=".45"
                        stop-color="#000000"
                        stop-opacity="0"
                    />

                    <stop
                        offset=".55"
                        stop-color="#000000"
                        stop-opacity=".18"
                    />

                    <stop
                        offset=".65"
                        stop-color="#000000"
                        stop-opacity=".45"
                    />

                    <stop
                        offset=".71037037"
                        stop-color="#000000"
                        stop-opacity=".649222221"
                    />

                    <stop
                        offset=".75"
                        stop-color="#000000"
                        stop-opacity=".90"
                    />

                    <stop
                        offset=".86"
                        stop-color="#000000"
                        stop-opacity=".98"
                    />

                    <stop
                        offset="1"
                        stop-color="#000000"
                        stop-opacity="1"
                    />
                </linearGradient>
            </defs>

            <rect
                x="0"
                y="0"
                width="${WIDTH}"
                height="${HEIGHT}"
                fill="url(#fade)"
            />
        </svg>
    `);

    const layers = [
        {
            input:
                overlay,

            left:
                0,

            top:
                0,
        },
    ];

    const bounds = [];

    async function addText({
        text,
        size,
        top,
        left = null,
        fill = WHITE,
        spacing = 0,
        maxWidth = WIDTH,
    }) {
        const rendered =
            await raster(
                text,
                size,
                fill,
                spacing
            );

        if (
            rendered.info.width >
            maxWidth
        ) {
            throw inputError(
                "Texto excede largura aprovada."
            );
        }

        const x =
            left === null
                ? Math.round(
                    (
                        WIDTH -
                        rendered.info.width
                    ) / 2
                )
                : Math.round(left);

        const y =
            Math.round(top);

        layers.push({
            input:
                rendered.data,

            left:
                x,

            top:
                y,
        });

        bounds.push({
            text,

            left:
                x,

            top:
                y,

            width:
                rendered.info.width,

            height:
                rendered.info.height,

            fontSize:
                size,
        });

        return {
            ...rendered,
            x,
            y,
        };
    }

    /*
     * CATEGORIA
     */
    const categoryText =
        clean(category)
            .toLocaleUpperCase(
                "pt-BR"
            );

    const categoryRendered =
        await addText({
            text:
                categoryText,

            size:
                APPROVED_BANNER_MODEL
                    .category
                    .fontSize,

            left:
                APPROVED_BANNER_MODEL
                    .category
                    .x,

            top:
                APPROVED_BANNER_MODEL
                    .category
                    .y,

            fill:
                WHITE,

            spacing:
                APPROVED_BANNER_MODEL
                    .category
                    .letterSpacing,

            maxWidth:
                400,
        });

    // A compact dark backing keeps the white category readable on bright photos.
    layers.splice(layers.length - 1, 0, {
        input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${categoryRendered.info.width + 24}" height="${categoryRendered.info.height + 20}"><rect width="100%" height="100%" rx="6" fill="#000000" fill-opacity="0.8"/></svg>`),
        left: categoryRendered.x - 12,
        top: categoryRendered.y - 10,
    });

    const underlineWidth =
        Math.min(
            APPROVED_BANNER_MODEL
                .category
                .underlineMaxWidth,

            Math.max(
                70,
                categoryRendered
                    .info
                    .width
            )
        );

    layers.push({
        input:
            Buffer.from(`
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="${Math.ceil(
                    underlineWidth
                )}"
                height="${
                    APPROVED_BANNER_MODEL
                        .category
                        .underlineHeight
                }"
            >
                <rect
                    x="0"
                    y="0"
                    width="100%"
                    height="100%"
                    fill="${ORANGE}"
                />
            </svg>
        `),

        left:
            APPROVED_BANNER_MODEL
                .category
                .x,

        top:
            APPROVED_BANNER_MODEL
                .category
                .underlineY,
    });

    /*
     * TITULO CURTO
     * 100 PX FIXOS
     */
    const shortLeft =
        Math.round(
            (
                WIDTH -
                short.metric.info.width
            ) / 2
        );

    layers.push({
        input:
            short.metric.data,

        left:
            shortLeft,

        top:
            APPROVED_BANNER_MODEL
                .shortTitle
                .top,
    });

    bounds.push({
        text:
            short.text,

        left:
            shortLeft,

        top:
            APPROVED_BANNER_MODEL
                .shortTitle
                .top,

        width:
            short.metric.info.width,

        height:
            short.metric.info.height,

        fontSize:
            100,
    });

    /*
     * UNICO DIVISOR EDITORIAL
     */
    const divider =
        APPROVED_BANNER_MODEL
            .divider;

    layers.push({
        input:
            Buffer.from(`
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="${divider.width}"
                height="${divider.height}"
            >
                <rect
                    width="100%"
                    height="100%"
                    fill="${ORANGE}"
                />
            </svg>
        `),

        left:
            divider.x,

        top:
            divider.y,
    });

    /*
     * BLOCO EDITORIAL
     *
     * Exatamente:
     * 44 px
     * line-height 52
     */
    const editorial =
        APPROVED_BANNER_MODEL
            .editorial;

    // Trim transparent margins, then center each line in a fixed 52px row.
    const editorialMetrics =
        await Promise.all(
            editorialLines.map(
                async line => {
                    const raw =
                        await raster(
                            line,
                            editorial.fontSize,
                            WHITE,
                            editorial.wordTightening
                        );

                    const trimmed =
                        await sharp(
                            raw.data
                        )
                            .trim({
                                threshold: 1,
                            })
                            .png()
                            .toBuffer({
                                resolveWithObject:
                                    true,
                            });

                    if (
                        trimmed.info.width >
                        editorial.maxWidth
                    ) {
                        throw inputError(
                            "REWRAP_REQUIRED",
                            "REWRAP_REQUIRED"
                        );
                    }

                    if (trimmed.info.height > editorial.lineHeight) {
                        throw inputError("COPY_TOO_LONG: linha excede a entrelinha aprovada.", "COPY_TOO_LONG");
                    }

                    return trimmed;
                }
            )
        );

    const textHeight = editorialLines.length * editorial.lineHeight;

    const usableTop =
        divider.y +
        divider.height +
        editorial.topGap;

    const usableBottom =
        APPROVED_BANNER_MODEL
            .brand
            .top -
        editorial.bottomGap;

    const usableHeight =
        usableBottom -
        usableTop;

    if (
        textHeight >
        usableHeight
    ) {
        throw inputError(
            "COPY_TOO_LONG: bloco editorial excede altura aprovada.",
            "COPY_TOO_LONG"
        );
    }

    /*
     * Mantemos todo o bloco centralizado entre
     * divisor superior e assinatura.
     */
    const editorialTop =
        usableTop +
        (
            usableHeight -
            textHeight
        ) / 2;

    for (
        let index = 0;
        index <
        editorialLines.length;
        index++
    ) {
        const metric =
            editorialMetrics[index];

        const x =
            Math.round(
                (
                    WIDTH -
                    metric.info.width
                ) / 2
            );

        const y =
            Math.round(
                editorialTop + index * editorial.lineHeight +
                (editorial.lineHeight - metric.info.height) / 2
            );

        /*
         * Usamos diretamente o raster ja recortado.
         * Nao chamamos addText novamente, pois isso
         * recriaria a caixa transparente original.
         */
        layers.push({
            input:
                metric.data,

            left:
                x,

            top:
                y,
        });

        bounds.push({
            text:
                editorialLines[index],

            left:
                x,

            top:
                y,

            width:
                metric.info.width,

            height:
                metric.info.height,

            fontSize:
                editorial.fontSize,
        });

    }

    /*
     * ASSINATURA BAGAÇA STUDIOS
     */
    const brand =
        APPROVED_BANNER_MODEL
            .brand;

    const bagaca =
        await raster(
            "BAGAÇA",
            brand.nameFontSize,
            WHITE,
            brand.nameSpacing
        );

    const bagacaLeft =
        Math.round(
            (
                WIDTH -
                bagaca.info.width
            ) / 2
        );

    const brandLineY =
        brand.top +
        Math.round(
            bagaca.info.height /
            2
        );

    const leftLineEnd =
        bagacaLeft -
        brand.lineGap;

    const rightLineStart =
        bagacaLeft +
        bagaca.info.width +
        brand.lineGap;

    /*
     * SOMENTE linhas laterais da marca.
     * Nenhum divisor abaixo da noticia.
     */
    layers.push({
        input:
            Buffer.from(`
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="${WIDTH}"
                height="${HEIGHT}"
            >
                <line
                    x1="${brand.lineOuterLeft}"
                    y1="${brandLineY}"
                    x2="${leftLineEnd}"
                    y2="${brandLineY}"
                    stroke="${ORANGE}"
                    stroke-width="${brand.lineHeight}"
                />

                <line
                    x1="${rightLineStart}"
                    y1="${brandLineY}"
                    x2="${brand.lineOuterRight}"
                    y2="${brandLineY}"
                    stroke="${ORANGE}"
                    stroke-width="${brand.lineHeight}"
                />
            </svg>
        `),

        left:
            0,

        top:
            0,
    });

    layers.push({
        input:
            bagaca.data,

        left:
            bagacaLeft,

        top:
            brand.top,
    });

    bounds.push({
        text:
            "BAGAÇA",

        left:
            bagacaLeft,

        top:
            brand.top,

        width:
            bagaca.info.width,

        height:
            bagaca.info.height,

        fontSize:
            31,
    });

    await addText({
        text:
            "STUDIOS",

        size:
            brand.studiosFontSize,

        top:
            brand.studiosTop,

        fill:
            WHITE,

        spacing:
            brand.studiosSpacing,

        maxWidth:
            300,
    });

    /*
     * ASSERTIONS PRE-FINAL
     */
    const editorialBounds =
        bounds.filter(
            item =>
                item.fontSize === 44
        );

    if (
        editorialBounds.length !==
        editorialLines.length
    ) {
        throw new Error(
            "ASSERT_EDITORIAL_FONT_SIZE"
        );
    }

    if (
        editorialBounds.some(
            item =>
                item.width > 950
        )
    ) {
        throw new Error(
            "ASSERT_EDITORIAL_WIDTH"
        );
    }

    if (
        editorialLines.length > 5
    ) {
        throw new Error(
            "ASSERT_EDITORIAL_LINES"
        );
    }

    for (let index = 1; index < editorialBounds.length; index++) {
        const previous = editorialBounds[index - 1];
        const current = editorialBounds[index];
        if (current.top < previous.top + previous.height) {
            throw new Error("ASSERT_EDITORIAL_OVERLAP");
        }
    }

    /*
     * FINAL
     */
    const png =
        await sharp(
            background
        )
            .composite(
                layers
            )
            .png()
            .toBuffer();

    const metadata =
        await sharp(
            png
        ).metadata();

    if (
        metadata.width !== 1080 ||
        metadata.height !== 1350
    ) {
        throw new Error(
            "ASSERT_CANVAS_SIZE"
        );
    }

    return {
        png,

        layout: {
            width:
                WIDTH,

            height:
                HEIGHT,

            aspectRatio:
                "4:5",

            categorySize:
                34,

            titleSize:
                100,

            editorialSize:
                44,

            editoriallineHeight: editorial.lineHeight,

            editorialLines,

            editorialBottomDivider:
                false,

            brandSize:
                31,

            studiosSize:
                18,

            imageFrame: {
                left:
                    0,

                top:
                    0,

                width:
                    WIDTH,

                height:
                    HEIGHT,

                position:
                    focus,
            },

            bounds,
        },
    };
}
