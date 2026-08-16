import newsHandler from "./news.js";

function getCalgaryHour() {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Edmonton",
      hour: "2-digit",
      hour12: false,
    }).format(new Date())
  );
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Metodo nao permitido."
    });
  }

  const hour = getCalgaryHour();

  // O cron pode executar a cada hora.
  // Somente a execucao correspondente as 7h de Calgary gera a edicao.
  if (hour !== 7) {
    return res.status(200).json({
      success: true,
      skipped: true,
      message: "Fora do horario de geracao.",
      calgaryHour: hour
    });
  }

  req.body = {
    prompt:
      "Gere a edicao automatica do WIRE/GEEK de hoje com exatamente 12 noticias reais, sendo 3 games, 3 geek, 3 cinema e 3 anime. Todas devem ser publicadas nas ultimas 24 horas. Use busca na web antes de escrever. Responda somente com JSON valido."
  };

  return newsHandler(req, res);
}
