/** Global approved editorial banner geometry. Category and news never override it.
 * Visible raster tops are in pixels on a 1080 x 1350 canvas.
 * titleGap and bottomSafeArea describe the approved reference raster; glyph bounds vary.
 * Never shrink text to fit: the renderer rejects width/copy overflow.
 */
function deepFreeze(value) {
    for (const child of Object.values(value)) {
        if (child && typeof child === 'object') deepFreeze(child);
    }
    return Object.freeze(value);
}

export const APPROVED_BANNER_MODEL =
    deepFreeze({
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

        thematicTitle: {
            mainTop: 826,
            mainFontSize: 132,
            mainLetterSpacing: -2,
            mainWordGap: 18,

            themeTop: 932,
            themeFontSize: 78,
            themeLetterSpacing: -2,

            maxWidth: 950,
            autoScale: false,
            titleGap: 11,
            firstEditorialLineTop: 1042,
            maxEditorialLines: 3,
            bottomSafeArea: 103,
            intermediateDivider: false,
            // Visible reference bounds normalized from 1122x1402 to 1080x1350.
            editorialTop: 986,
            brandTop: 1195,
            studiosTop: 1235,
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
