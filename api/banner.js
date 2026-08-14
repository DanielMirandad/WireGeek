export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Metodo nao permitido",
    });
  }

  try {
    const {
      categoria = "geek",
      titulo = "Wire/Geek",
      publicado_em = "Hoje",
      highlights = [],
    } = req.body || {};

    const safeHighlights = Array.isArray(highlights)
      ? highlights.slice(0, 4)
      : [];

    const categoryColors = {
      games: "#E8002D",
      geek: "#7C3AED",
      cinema: "#D97706",
      anime: "#0EA5E9",
    };

    const categoryLabels = {
      games: "GAMES",
      geek: "GEEK",
      cinema: "CINEMA",
      anime: "ANIME",
    };

    const color = categoryColors[categoria] || "#E0452F";
    const category =
      categoryLabels[categoria] || "WIRE/GEEK";

    const escapeXml = (value) =>
      String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

    const escapeMultiline = (value, max = 90) => {
      const text = String(value || "").trim();

      if (text.length <= max) {
        return [text];
      }

      const words = text.split(/\s+/);
      const lines = [];
      let current = "";

      for (const word of words) {
        const test = current
          ? `${current} ${word}`
          : word;

        if (test.length > max && current) {
          lines.push(current);
          current = word;
        } else {
          current = test;
        }
      }

      if (current) {
        lines.push(current);
      }

      return lines.slice(0, 4);
    };

    const titleLines = escapeMultiline(titulo, 34);

    const highlightLines = safeHighlights.map(
      (item) => escapeMultiline(item, 45)
    );

    const titleSvg = titleLines
      .map(
        (line, index) =>
          `<text x="80" y="${350 + index * 58}"
             font-family="Arial, Helvetica, sans-serif"
             font-size="46"
             font-weight="900"
             fill="#F4F0E8">${escapeXml(line)}</text>`
      )
      .join("");

    const highlightsSvg = highlightLines
      .map(
        (lines, index) => {
          const y = 610 + index * 85;

          return `
            <rect
              x="80"
              y="${y - 42}"
              width="864"
              height="68"
              rx="4"
              fill="#132025"
              stroke="${color}"
              stroke-width="2"
            />
            <text
              x="105"
              y="${y}"
              font-family="Arial, Helvetica, sans-serif"
              font-size="22"
              font-weight="700"
              fill="#F4F0E8"
            >${escapeXml(lines[0] || "")}</text>
          `;
        }
      )
      .join("");

    const svg = `
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="1080"
  height="1080"
  viewBox="0 0 1080 1080"
>
  <rect width="1080" height="1080" fill="#0A1315"/>

  <rect
    x="0"
    y="0"
    width="1080"
    height="22"
    fill="${color}"
  />

  <text
    x="80"
    y="95"
    font-family="Arial, Helvetica, sans-serif"
    font-size="28"
    font-weight="900"
    letter-spacing="5"
    fill="${color}"
  >WIRE/GEEK</text>

  <text
    x="80"
    y="145"
    font-family="Arial, Helvetica, sans-serif"
    font-size="18"
    font-weight="700"
    letter-spacing="4"
    fill="#8FA39D"
  >BAGACA STUDIOS · ${category}</text>

  <text
    x="80"
    y="205"
    font-family="Arial, Helvetica, sans-serif"
    font-size="17"
    font-weight="600"
    fill="#5FBF7A"
  >${escapeXml(publicado_em)}</text>

  ${titleSvg}

  <rect
    x="80"
    y="535"
    width="920"
    height="3"
    fill="${color}"
  />

  ${highlightsSvg}

  <text
    x="80"
    y="1015"
    font-family="Arial, Helvetica, sans-serif"
    font-size="15"
    font-weight="600"
    letter-spacing="3"
    fill="#5C6F6B"
  >BAGACA STUDIOS · NEWSROOM 3.0</text>
</svg>
`;

    const svgBase64 = Buffer.from(svg).toString("base64");

    return res.status(200).json({
      success: true,
      format: "svg",
      mimeType: "image/svg+xml",
      filename: "wire-geek-banner.svg",
      data: `data:image/svg+xml;base64,${svgBase64}`,
    });
  } catch (error) {
    console.error("Banner error:", error);

    return res.status(500).json({
      error: "Nao foi possivel gerar o banner.",
      details: error?.message || "Erro desconhecido",
    });
  }
}
