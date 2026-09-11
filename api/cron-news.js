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
      "Gere a edicao automatica do WIRE/GEEK de hoje com noticias reais disponiveis na pesquisa. A edicao deve conter entre 1 e 12 noticias validas. Se houver 12 ou mais candidatos validos, selecione as 12 melhores. Se houver entre 1 e 11 candidatos validos, utilize todas as noticias validas disponiveis. Se houver menos de 1 candidato valido, nao finalize a edicao. A distribuicao entre categorias e livre. Nao crie noticias para completar quantidade. Considere acontecimentos das ultimas 48 horas. Use busca na web antes de escrever. Responda somente com JSON valido."
  };

  return newsHandler(req, res);
}


