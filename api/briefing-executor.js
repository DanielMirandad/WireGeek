import { hasValidWireGeekAuth } from "./auth.js";

import {
  cronSlot,
  runEditorialRequest,
} from "../lib/editorial-execution.mjs";

import {
  executeBriefing,
} from "../lib/briefing-executor.mjs";

function hasValidCronAuth(req) {
  const secret =
    String(
      process.env.CRON_SECRET || ""
    ).trim();

  if (!secret) {
    return false;
  }

  const authorization =
    String(
      req.headers?.authorization || ""
    ).trim();

  return authorization === `Bearer ${secret}`;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res
      .status(405)
      .json({
        error: "Metodo nao permitido.",
      });
  }

  const manual = req.method === "POST";

  if (!(manual ? hasValidWireGeekAuth(req) : hasValidCronAuth(req))) {
    return res
      .status(401)
      .json({
        error: "Acesso nao autorizado.",
      });
  }

  try {
    const result =
      await runEditorialRequest(
        manual
          ? { source: "manual" }
          : { source: "cron", slot: cronSlot() },
        async (output, run) => {
          const executed =
            await executeBriefing(run);

          return output
            .status(executed.status)
            .json(executed.body);
        }
      );

    return res
      .status(result.status)
      .json(result.body);
  } catch (error) {
    console.error(
      "WIRE/GEEK: erro no executor Briefing OpenAI:",
      error
    );

    return res
      .status(error?.statusCode || 500)
      .json({
        error:
          "Nao foi possivel executar o Briefing OpenAI.",
        details:
          error?.message ||
          "Erro desconhecido.",
      });
  }
}