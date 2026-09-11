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

  try {
    const supabase = getSupabase();

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("publicacoes")
        .select(`
          id,
          noticia_id,
          banner_url,
          caption,
          hashtags,
          status,
          approved_at,
          rejected_at,
          published_at,
          criado_em,
          atualizado_em,
          noticias (
            id,
            titulo,
            categoria
          )
        `)
        .eq("status", "AGUARDANDO_APROVACAO")
        .order("criado_em", { ascending: false });

      if (error) {
        throw new Error(
          `Nao foi possivel carregar as publicacoes: ${error.message}`
        );
      }

      return res.status(200).json({
        success: true,
        quantidade: data?.length || 0,
        publicacoes: data || [],
      });
    }

    if (req.method === "PATCH") {
      const id = Number(req.body?.id);
      const acao = String(req.body?.acao || "")
        .trim()
        .toLowerCase();

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          error: "Informe um id de publicacao valido.",
        });
      }

      if (!["aprovar", "rejeitar"].includes(acao)) {
        return res.status(400).json({
          error: 'A acao deve ser "aprovar" ou "rejeitar".',
        });
      }

      const now = new Date().toISOString();

      const update =
        acao === "aprovar"
          ? {
              status: "APROVADO",
              approved_at: now,
              rejected_at: null,
              atualizado_em: now,
            }
          : {
              status: "REJEITADO",
              rejected_at: now,
              approved_at: null,
              atualizado_em: now,
            };

      const { data, error } = await supabase
        .from("publicacoes")
        .update(update)
        .eq("id", id)
        .eq("status", "AGUARDANDO_APROVACAO")
        .select(`
          id,
          noticia_id,
          banner_url,
          caption,
          hashtags,
          status,
          approved_at,
          rejected_at,
          atualizado_em,
          source_image_url,
          source_image_full_hash,
          source_image_crop_hash
        `)
        .maybeSingle();

      if (error) {
        throw new Error(
          `Nao foi possivel atualizar a publicacao: ${error.message}`
        );
      }

      if (!data) {
        return res.status(409).json({
          error:
            "A publicacao nao esta mais aguardando aprovacao ou nao existe.",
        });
      }

      let feedbackImagem = null;

      if (acao === "rejeitar") {
        if (data.source_image_url) {
          const { error: feedbackError } = await supabase
            .from("imagens_rejeitadas")
            .upsert(
              {
                noticia_id: data.noticia_id,
                image_url: data.source_image_url,
                full_hash: data.source_image_full_hash || null,
                crop_hash: data.source_image_crop_hash || null,
              },
              {
                onConflict: "noticia_id,image_url",
              }
            );

          if (feedbackError) {
            console.error(
              "WIRE/GEEK: falha ao registrar imagem rejeitada:",
              feedbackError
            );
            feedbackImagem = false;
          } else {
            console.log(
              "WIRE/GEEK: imagem rejeitada registrada",
              {
                noticia_id: data.noticia_id,
                image_url: data.source_image_url,
              }
            );
            feedbackImagem = true;
          }
        } else {
          feedbackImagem = false;
        }
      }

      return res.status(200).json({
        success: true,
        publicacao: data,
        feedback_imagem: feedbackImagem,
      });
    }

    return res.status(405).json({
      error: "Metodo nao permitido.",
    });
  } catch (error) {
    console.error("WIRE/GEEK: erro em publicacoes:", error);

    return res.status(500).json({
      error: "Nao foi possivel processar as publicacoes.",
      details: error?.message || "Erro desconhecido.",
    });
  }
}