import { runEditorialRequest } from "../lib/editorial-execution.mjs";
import { persistCanonicalBriefing } from "../lib/briefing-import-service.mjs";
import { hasValidWireGeekAuth } from "./auth.js";

export { parseCanonicalPayload } from "../lib/briefing-import-service.mjs";

async function importBriefing(req, res, run) {
  try {
    const result = await persistCanonicalBriefing(
      req.body,
      run
    );

    return res
      .status(result.status)
      .json(result.body);
  } catch (error) {
    console.error(
      "WIRE/GEEK: erro ao importar Briefing Geek 2h:",
      error
    );

    return res
      .status(error?.statusCode || 400)
      .json({
        error:
          "Nao foi possivel importar o Briefing Geek 2h.",

        details:
          error?.message ||
          "Erro desconhecido.",
      });
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({
        error: "Metodo nao permitido.",
      });
  }

  if (!hasValidWireGeekAuth(req)) {
    return res
      .status(401)
      .json({
        error: "Acesso nao autorizado.",
      });
  }

  const result = await runEditorialRequest(
    { source: "import" },
    (output, run) =>
      importBriefing(req, output, run)
  );

  return res
    .status(result.status)
    .json(result.body);
}