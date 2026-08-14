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
- Materia com no maximo 2200 caracteres.
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
jogos, consoles, PC, Xbox, PlayStation, Nintendo, Steam, trailers, lançamentos, atualizações, indústria e esports.

GEEK:
quadrinhos, tecnologia geek, cultura pop, colecionáveis, eventos, ficção científica, fantasia e cultura nerd.

CINEMA:
filmes, lançamentos, trailers, franquias, atores, atrizes, diretores, produções, bilheterias, adaptações, remakes e sequências.

ANIME:
animes, mangás, light novels, episódios, temporadas, adaptações, dublagem, filmes, streaming, Crunchyroll e declarações de criadores.

FONTES PRIORITARIAS:
IGN Brasil, Omelete, Eurogamer, The Enemy, Jovem Nerd, Adrenaline, Canaltech, GameSpot, IGN, Polygon, Variety, Deadline, The Hollywood Reporter, Crunchyroll News, Anime News Network e MyAnimeList News.

FORMATO DA RESPOSTA:
Responda SOMENTE com JSON válido.

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

    return res.status(200).json({
      text,
    });
  } catch (error) {
    console.error("WIRE/GEEK API ERROR:", error);

    return res.status(500).json({
      error: error?.message || "Erro interno do servidor.",
    });
  }
}
