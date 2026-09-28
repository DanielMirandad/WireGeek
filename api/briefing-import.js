import { runEditorialRequest } from "../lib/editorial-execution.mjs";
import { createClient } from "@supabase/supabase-js";
import { hasValidWireGeekAuth } from "./auth.js";
import { persistEdition } from "./persistence.js";
import { parseBriefingPayload } from "../lib/briefing-adapter.mjs";

function getSupabase() {
  const url = String(process.env.SUPABASE_URL || "").trim();
  const serviceRoleKey = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  ).trim();

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function resolveNewsIds(persisted) {
  if (persisted && typeof persisted === "object") {
    const direct = Array.isArray(persisted.noticiaIds)
      ? persisted.noticiaIds
      : Array.isArray(persisted.newsIds)
        ? persisted.newsIds
        : [];

    if (direct.length) {
      return direct;
    }
  }

  const editionId =
    persisted && typeof persisted === "object"
      ? persisted.editionId || persisted.id || null
      : persisted;

  if (!editionId) {
    return [];
  }

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("edicao_noticias")
    .select("noticia_id,ordem")
    .eq("edicao_id", editionId)
    .order("ordem", { ascending: true });

  if (error) {
    throw new Error(
      `Nao foi possivel recuperar os IDs importados: ${error.message}`
    );
  }

  return (data || [])
    .map((row) => row.noticia_id)
    .filter(Boolean);
}

async function importBriefing(req, res, run) {
  try {
    const raw =
      req.body?.payload ??
      req.body?.text ??
      req.body;

    const briefing = parseBriefingPayload(raw);
    await run.progress({ researched: briefing.news.length });

    const researchData = {
      pesquisados: briefing.news.length,

      candidatos: briefing.news.map((item) => ({
        titulo: item.titulo,
        categoria: item.categoria,
        publicado_em: item.publicado_em,
        resumo:
          item.resumo ||
          item.por_que_importa ||
          "",
        url: item.fontes[0]?.url || "",
        fonte: item.fontes[0]?.nome || "",
        contexto_visual: item.contexto_visual,
        image_query: item.image_query,
      })),

      errosValidacao: [],
    };

    const persisted = await persistEdition({
      title:
        briefing.title ||
        "Briefing Geek Diário",

      date:
        briefing.generatedAt ||
        new Date().toISOString(),

      status: "publicada",

      news: briefing.news,

      researchData,
      execution: run,
    });

    if (!persisted.noticiaIds.length) {
      return res.status(409).json({
        error: "Todas as pautas deste briefing já estão salvas. Nenhuma nova edição foi criada.",
        code: "NO_NEW_STORIES",
        deduplication: persisted.deduplication,
      });
    }

    const noticiaIds =
      await resolveNewsIds(persisted);

    const news = persisted.retainedIndexes.map(
      (originalIndex, index) => ({
        ...briefing.news[originalIndex],
        id: noticiaIds[index],
      })
    );

    return res.status(200).json({
      success: true,

      edition: {
        title: briefing.title,
        generatedAt: briefing.generatedAt,
        news,
      },

      persisted: true,
      deduplication: persisted.deduplication,

      noticia_ids_resolvidos:
        noticiaIds.length,
    });
  } catch (error) {
    console.error(
      "WIRE/GEEK: erro ao importar Briefing Geek Diário:",
      error
    );

    return res
      .status(error?.statusCode || 400)
      .json({
        error:
          "Nao foi possivel importar o Briefing Geek Diário.",

        details:
          error?.message ||
          "Erro desconhecido.",
      });
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido." });
  if (!hasValidWireGeekAuth(req)) return res.status(401).json({ error: "Acesso não autorizado." });
  const result = await runEditorialRequest({ source: "import" }, (output, run) => importBriefing(req, output, run));
  return res.status(result.status).json(result.body);
}
