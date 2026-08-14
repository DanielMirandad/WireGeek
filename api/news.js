export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Metodo nao permitido",
    });
  }

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({
        error: "ANTHROPIC_API_KEY nao configurada na Vercel.",
      });
    }

    const { prompt } = req.body || {};

    const system = `
Voce e o editor-chefe de uma redacao especializada em GAMES, CULTURA GEEK, CINEMA e ANIME no Brasil.

Sua voz e de colunista: opinativa, engajada, moderna e com personalidade propria, mas sempre apoiada em fatos reais e verificaveis.

Voce tem acesso a busca na web e DEVE usa-la antes de escrever.

OBJETIVO:
Encontrar exatamente 12 noticias reais publicadas HOJE ou nas ULTIMAS 24 HORAS.

DIVERSIDADE OBRIGATORIA:
3 noticias de games.
3 noticias de geek.
3 noticias de cinema.
3 noticias de anime.

REGRAS CRITICAS:
- NUNCA use travessao em nenhum campo.
- Use virgulas, dois-pontos, pontos ou parenteses.
- Nao invente fatos.
- Nao invente datas.
- Nao invente fontes.
- Nao invente URLs.
- Nao use noticias com mais de 24 horas.
- A materia deve ter entre 2000 e 2200 caracteres.
- Conte os caracteres antes de responder.
- Se estiver abaixo de 2000 caracteres, desenvolva a analise.
- Se estiver acima de 2200 caracteres, reduza o texto.
- Highlights exatamente 4 por noticia.
- Hashtags exatamente 5 por noticia.
- Fontes entre 1 e 3 por noticia.

PARA CADA NOTICIA:

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

FORMATO DA RESPOSTA:
Responda SOMENTE com JSON valido.

{
  "news": [
    {
      "categoria": "",
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

O array news deve conter exatamente 12 itens:
3 games,
3 geek,
3 cinema,
3 anime.
`;

    const anthropicResponse = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
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
        details: raw.slice(0, 1000),
      });
    }

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        error: "Resposta invalida da Anthropic.",
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
     * Tenta interpretar o JSON produzido pelo modelo.
     */
    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: "A Anthropic retornou JSON invalido.",
        text: text.slice(0, 2000),
      });
    }

    if (!parsed || !Array.isArray(parsed.news)) {
      return res.status(502).json({
        error: "Formato de noticias invalido.",
      });
    }

    /*
     * Expande automaticamente materias abaixo de 2000 caracteres.
     */
    async function expandMateria(item) {
      const materiaAtual = String(item.materia || "").trim();

      if (materiaAtual.length >= 2000) {
        return materiaAtual;
      }

      const expandResponse = await fetch(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 5000,
            system: `
Voce e um editor de noticias do Wire/Geek.

Sua tarefa e expandir uma materia jornalistica existente.

REGRAS OBRIGATORIAS:
- O resultado deve ter entre 2000 e 2200 caracteres.
- Nunca ultrapasse 2200 caracteres.
- Nunca fique abaixo de 2000 caracteres.
- Preserve os fatos existentes.
- Nao invente fatos.
- Nao invente numeros.
- Nao invente datas.
- Nao invente declaracoes.
- Nao invente fontes.
- Desenvolva contexto, impacto, repercussao e analise.
- Mantenha o tom jornalistico e opinativo.
- NUNCA use travessao.
- Use virgulas, pontos, dois-pontos ou parenteses.
- Retorne SOMENTE o texto final da materia.
`,
            messages: [
              {
                role: "user",
                content: `
TITULO:
${item.titulo}

MATERIA ATUAL:
${materiaAtual}

A materia possui atualmente ${materiaAtual.length} caracteres.

Expanda a materia ate atingir obrigatoriamente entre 2000 e 2200 caracteres.
`,
              },
            ],
          }),
        }
      );

      if (!expandResponse.ok) {
        throw new Error(
          `Falha ao expandir "${item.titulo}": HTTP ${expandResponse.status}`
        );
      }

      const expandRaw = await expandResponse.json();

      const expandedText = (expandRaw.content || [])
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .replace(/[—–]/g, ",")
        .trim();

      if (!expandedText) {
        throw new Error(
          `A expansao de "${item.titulo}" nao retornou texto.`
        );
      }

      return expandedText;
    }

    /*
     * Processa somente as noticias que ficaram abaixo do minimo.
     */
    for (const item of parsed.news) {
      const materia = String(item.materia || "").trim();

      if (materia.length < 2000) {
        item.materia = await expandMateria(item);
      }
    }

    /*
     * Validacao final.
     */
    for (const item of parsed.news) {
      const materia = String(item.materia || "").trim();

      item.materia = materia
        .replace(/[—–]/g, ",")
        .trim();

      const length = item.materia.length;

      if (length < 2000 || length > 2200) {
        return res.status(422).json({
          error: `"${item.titulo}" precisa ter entre 2000 e 2200 caracteres.`,
          encontrados: length,
        });
      }
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
