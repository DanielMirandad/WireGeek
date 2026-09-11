import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = String(process.env.SUPABASE_URL || "").trim();
  const key = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    ""
  ).trim();

  if (!url || !key) {
    throw new Error("Supabase nao configurado.");
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export default async function handler(req, res) {
  const sessionModule = await import("./auth.js");

  if (!sessionModule.hasValidSession(req)) {
    return res.status(401).json({
      error: "Acesso nao autorizado.",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Metodo nao permitido.",
    });
  }

  try {
    const id = Number(req.body?.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        error: "Informe um id de publicacao valido.",
      });
    }

    const supabase = getSupabase();

    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("publicacoes")
      .update({
        status: "PUBLICANDO",
        atualizado_em: now,
      })
      .eq("id", id)
      .eq("status", "APROVADO")
      .is("published_at", null)
      .select(`
        id,
        noticia_id,
        banner_url,
        caption,
        hashtags,
        status,
        published_at,
        instagram_url,
        facebook_url
      `)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Nao foi possivel reservar a publicacao: ${error.message}`
      );
    }

    if (!data) {
      return res.status(409).json({
        error:
          "A publicacao precisa estar APROVADA e ainda nao pode ter sido publicada.",
      });
    }

    const { data: restored, error: restoreError } = await supabase
      .from("publicacoes")
      .update({
        status: "APROVADO",
        atualizado_em: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("status", "PUBLICANDO")
      .is("published_at", null)
      .select(`
        id,
        noticia_id,
        banner_url,
        caption,
        hashtags,
        status,
        published_at
      `)
      .maybeSingle();

    if (restoreError || !restored) {
      throw new Error(
        `Dry-run concluido, mas nao foi possivel devolver a publicacao para APROVADO: ${
          restoreError?.message || "registro nao encontrado"
        }`
      );
    }

    return res.status(200).json({
      success: true,
      dry_run: true,
      transicao: [
        "APROVADO",
        "PUBLICANDO",
        "APROVADO",
      ],
      publicacao: {
        id: restored.id,
        noticia_id: restored.noticia_id,
        banner_url: restored.banner_url,
        caption: restored.caption,
        hashtags: restored.hashtags,
        status: restored.status,
        published_at: restored.published_at,
      },
    });
  } catch (error) {
    console.error("WIRE/GEEK: erro no dry-run de publicacao:", error);

    return res.status(500).json({
      error: "Nao foi possivel preparar a publicacao.",
      details: error?.message || "Erro desconhecido.",
    });
  }
}
