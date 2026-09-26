import newsHandler from "./news.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Metodo nao permitido."
    });
  }

  const cronSecret =
    String(
      process.env.CRON_SECRET || ""
    ).trim();

  if (!cronSecret) {
    console.error(
      "WIRE/GEEK: CRON_SECRET nao configurado."
    );

    return res.status(500).json({
      success: false,
      error:
        "Cron nao configurado.",
    });
  }

  const authorization =
    String(
      req.headers?.authorization || ""
    ).trim();

  if (
    authorization !==
    `Bearer ${cronSecret}`
  ) {
    console.warn(
      "WIRE/GEEK: chamada de cron recusada."
    );

    return res.status(401).json({
      success: false,
      error:
        "Cron nao autorizado.",
    });
  }

  const automationKey =
    String(
      process.env.WIREGEEK_AUTOMATION_KEY || ""
    ).trim();

  if (!automationKey) {
    console.error(
      "WIRE/GEEK: WIREGEEK_AUTOMATION_KEY nao configurada."
    );

    return res.status(500).json({
      success: false,
      error:
        "Automacao nao configurada.",
    });
  }

  req.headers = {
    ...(req.headers || {}),
    "x-wiregeek-automation-key":
      automationKey,
  };

  /*
   * /api/news aceita somente POST.
   * O Vercel Cron chama este endpoint
   * por GET, entao a chamada interna
   * precisa ser convertida para POST.
   */
  req.method =
    "POST";

  req.body = {
    prompt:
      "Gere a edicao automatica do WIRE/GEEK de hoje com noticias reais disponiveis na pesquisa. A edicao deve conter entre 1 e 12 noticias validas. Se houver 12 ou mais candidatos validos, selecione as 12 melhores. Se houver entre 1 e 11 candidatos validos, utilize todas as noticias validas disponiveis. Se houver menos de 1 candidato valido, nao finalize a edicao. A distribuicao entre categorias e livre. Nao crie noticias para completar quantidade. Considere acontecimentos das ultimas 48 horas. Use busca na web antes de escrever. Responda somente com JSON valido."
  };

  return newsHandler(req, res);
}


