export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Metodo nao permitido",
    });
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "ANTHROPIC_API_KEY nao configurada na Vercel.",
      });
    }

    const { prompt } = req.body || {};

    const system = `
Voce e o editor-chefe do Wire/Geek, uma redacao especializada em GAMES, CULTURA GEEK, CINEMA e ANIME no Brasil.

OBJETIVO:
Encontrar exatamente 12 noticias reais publicadas HOJE ou nas ULTIMAS 24 HORAS.

DIVERSIDADE:
3 noticias de games.
3 noticias de geek.
3 noticias de cinema.
3 noticias de anime.

REGRAS:
- NUNCA use travessao.
- Nao invente fatos.
- Nao invente datas.
- Nao invente fontes.
- Nao invente URLs.
- Use somente informacoes verificaveis.
- A materia deve ter entre 2000 e 2200 caracteres.
- Highlights exatamente 4 por noticia.
- Hashtags exatamente 5 por noticia.
- Fontes entre 1 e 3 por noticia.
- Use tom jornalistico, opinativo e envolvente.
- Responda SOMENTE com JSON.
- NAO use Markdown.
- NAO escreva explicacoes antes ou depois do JSON.

ESTRUTURA:

{
  "news": [
    {
      "categoria": "games|geek|cinema|anime",
      "titulo": "",
      "publicado_em": "",
      "materia": "",
      "highlights": ["", "", "", ""],
      "hashtags": ["", "", "", "", ""],
      "fontes": [
        {
          "nome": "",
          "url": "",
          "publicado_em": ""
        }
      ],
      "image_query": ""
    }
  ]
}

CATEGORIAS:

GAMES:
jogos, consoles, PC, Xbox, PlayStation, Nintendo, Steam, trailers, lancamentos, atualizacoes, industria e esports.

GEEK:
quadrinhos, tecnologia geek, cultura pop, colecionaveis, eventos, ficcao cientifica, fantasia e cultura nerd.

CINEMA:
filmes, lancamentos, trailers, franquias, atores, atrizes, diretores, producoes, bilheterias, adaptacoes, remakes e sequencias.

ANIME:
animes, mangas, light novels, episodios, temporadas, adaptacoes, dublagem, filmes, streaming, Crunchyroll e declaracoes de criadores.

FONTES PRIORITARIAS:
IGN Brasil, Omelete, Eurogamer, The Enemy, Jovem Nerd, Adrenaline, Canaltech, GameSpot, IGN, Polygon, Variety, Deadline, The Hollywood Reporter, Crunchyroll News, Anime News Network e MyAnimeList News.

O array news deve conter exatamente 12 itens:
3 games,
3 geek,
3 cinema,
3 anime.
`;

    /*
     * PRIMEIRA CHAMADA
     */
    const anthropicResponse = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 16000,
          system,
          messages: [
            {
              role: "user",
              content:
                prompt ||
                "Gere a edicao de hoje com exatamente 12 noticias reais das ultimas 24 horas.",
            },
          ],
          tools: [
            {
              type: "web_search_20250305",
              name: "web_search",
              max_uses: 10,
            },
          ],
        }),
      }
    );

    const raw = await anthropicResponse.text();

    if (!anthropicResponse.ok) {
      return res.status(anthropicResponse.status).json({
        error: "Erro retornado pela Anthropic.",
        details: raw.slice(0, 1500),
      });
    }

    let data;

    try {
      data = JSON.parse(raw);
    } catch (error) {
      return res.status(502).json({
        error: "Resposta invalida da Anthropic.",
        details: error.message,
      });
    }

    const text = (data.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!text) {
      return res.status(502).json({
        error: "A Anthropic nao retornou texto.",
      });
    }

    /*
     * PARSER ROBUSTO
     */
    function parseJsonFromText(value) {
      const clean = String(value || "").trim();

      try {
        return JSON.parse(clean);
      } catch {}

      const codeBlock = clean.match(
        /```(?:json)?\s*([\s\S]*?)\s*```/i
      );

      if (codeBlock) {
        try {
          return JSON.parse(codeBlock[1].trim());
        } catch {}
      }

      const firstBrace = clean.indexOf("{");
      const lastBrace = clean.lastIndexOf("}");

      if (firstBrace >= 0 && lastBrace > firstBrace) {
        return JSON.parse(
          clean.slice(firstBrace, lastBrace + 1)
        );
      }

      throw new Error("Nenhum JSON valido encontrado.");
    }

    let parsed;

    try {
      parsed = parseJsonFromText(text);
    } catch (error) {
      console.error("WIRE/GEEK JSON ERROR:", error);

      return res.status(502).json({
        error: "A Anthropic retornou JSON invalido.",
        details: error.message,
        text: text.slice(0, 2000),
      });
    }

    if (!parsed || !Array.isArray(parsed.news)) {
      return res.status(502).json({
        error: "Formato de noticias invalido.",
      });
    }

    /*
     * NORMALIZA TEXTO
     */
    function normalizeMateria(value) {
      return String(value || "")
        .replace(/[—–]/g, ",")
        .replace(/\s{2,}/g, " ")
        .trim();
    }

    /*
     * IDENTIFICA MATERIAS CURTAS
     */
    const shortNews = parsed.news
      .map((item, index) => ({
        index,
        titulo: item.titulo,
        materia: normalizeMateria(item.materia),
      }))
      .filter((item) => item.materia.length < 2000);

    /*
     * UMA UNICA CHAMADA PARA EXPANDIR TODAS
     */
    if (shortNews.length > 0) {
      const correctionPrompt = `
Algumas materias do Wire/Geek ficaram abaixo de 2000 caracteres.

Expanda SOMENTE as materias listadas abaixo.

REGRAS OBRIGATORIAS:
- Cada materia final deve ter entre 2000 e 2200 caracteres.
- Nunca ultrapasse 2200 caracteres.
- Nunca fique abaixo de 2000 caracteres.
- Preserve todos os fatos existentes.
- Nao invente fatos.
- Nao invente numeros.
- Nao invente datas.
- Nao invente declaracoes.
- Nao invente fontes.
- Desenvolva contexto, impacto, repercussao e analise.
- Nao use travessao.
- Use virgulas, pontos, dois-pontos ou parenteses.
- Retorne SOMENTE JSON valido.
- Nao use Markdown.

FORMATO:

{
  "items": [
    {
      "index": 0,
      "materia": "texto entre 2000 e 2200 caracteres"
    }
  ]
}

MATERIAS:

${shortNews
  .map(
    (item) => `
INDEX: ${item.index}
TITULO: ${item.titulo}
CARACTERES ATUAIS: ${item.materia.length}

MATERIA:
${item.materia}
`
  )
  .join("\n")}
`;

      const correctionResponse = await fetch(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 12000,
            messages: [
              {
                role: "user",
                content: correctionPrompt,
              },
            ],
          }),
        }
      );

      const correctionRaw =
        await correctionResponse.text();

      if (!correctionResponse.ok) {
        return res.status(502).json({
          error: "Falha ao expandir materias.",
          details: correctionRaw.slice(0, 1500),
        });
      }

      let correctionData;

      try {
        correctionData = JSON.parse(correctionRaw);
      } catch (error) {
        return res.status(502).json({
          error: "Resposta invalida durante expansao.",
          details: error.message,
        });
      }

      const correctionText = (correctionData.content || [])
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();

      let corrections;

      try {
        corrections = parseJsonFromText(correctionText);
      } catch (error) {
        return res.status(502).json({
          error: "JSON invalido durante expansao.",
          details: error.message,
          text: correctionText.slice(0, 2000),
        });
      }

      if (!corrections || !Array.isArray(corrections.items)) {
        return res.status(502).json({
          error: "Formato de expansao invalido.",
        });
      }

      /*
       * APLICA AS EXPANSOES
       */
      for (const correction of corrections.items) {
        const index = Number(correction.index);

        if (
          Number.isInteger(index) &&
          parsed.news[index]
        ) {
          parsed.news[index].materia =
            normalizeMateria(correction.materia);
        }
      }
    }

    /*
     * VALIDACAO FINAL
     */
    for (const item of parsed.news) {
      item.materia = normalizeMateria(item.materia);

      const length = item.materia.length;

      if (length < 2000 || length > 2200) {
        return res.status(422).json({
          error: `"${item.titulo}" precisa ter entre 2000 e 2200 caracteres.`,
          encontrados: length,
        });
      }
    }

    /*
     * VALIDACAO DA QUANTIDADE
     */
    if (parsed.news.length !== 12) {
      return res.status(422).json({
        error: "A edicao precisa conter exatamente 12 noticias.",
        encontrados: parsed.news.length,
      });
    }

    return res.status(200).json({
      text: JSON.stringify(parsed),
    });
  } catch (error) {
    console.error("WIRE/GEEK API ERROR:", error);

    return res.status(500).json({
      error: error?.message || "Erro interno do servidor.",
    });
  }
}
