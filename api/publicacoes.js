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
      const rawRequestedNoticiaId =
        req.query?.noticia_id;

      if (
        rawRequestedNoticiaId !==
          undefined &&
        rawRequestedNoticiaId !==
          null &&
        String(
          rawRequestedNoticiaId
        ).trim() !== ""
      ) {
        const requestedNoticiaId =
          Number(
            rawRequestedNoticiaId
          );

        if (
          !Number.isInteger(
            requestedNoticiaId
          ) ||
          requestedNoticiaId <= 0
        ) {
          return res.status(400).json({
            error:
              "Informe um noticia_id valido.",
          });
        }

        const {
          data: latestPublication,
          error: latestError,
        } =
          await supabase
            .from("publicacoes")
            .select(
              "id,publication_group_id,criado_em"
            )
            .eq(
              "noticia_id",
              requestedNoticiaId
            )
            .not(
              "publication_group_id",
              "is",
              null
            )
            .order(
              "criado_em",
              {
                ascending: false,
              }
            )
            .limit(1)
            .maybeSingle();

        if (latestError) {
          throw new Error(
            `Nao foi possivel localizar a publicacao mais recente da noticia: ${latestError.message}`
          );
        }

        if (
          !latestPublication
            ?.publication_group_id
        ) {
          return res.status(404).json({
            error:
              "Esta noticia ainda nao possui publicacoes materializadas pelo modo Briefing.",
          });
        }

        const {
          data: latestGroup,
          error: latestGroupError,
        } =
          await supabase
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
              publication_group_id,
              carousel_position,
              cta_url,
              selected_channels,
              instagram_status,
              instagram_caption_sha256,
              instagram_post_id,
              instagram_url,
              instagram_parent_container_id,
              instagram_child_container_ids,
              instagram_containers_created_at,
              publish_attempts,
              last_error,
              noticias (
                id,
                titulo,
                categoria
              )
            `)
            .eq(
              "publication_group_id",
              latestPublication
                .publication_group_id
            )
            .order(
              "carousel_position",
              {
                ascending: true,
              }
            );

        if (latestGroupError) {
          throw new Error(
            `Nao foi possivel carregar o grupo mais recente da noticia: ${latestGroupError.message}`
          );
        }

        return res.status(200).json({
          success:
            true,

          resolved_by:
            "noticia_id",

          noticia_id:
            requestedNoticiaId,

          publication_group_id:
            latestPublication
              .publication_group_id,

          quantidade:
            latestGroup?.length || 0,

          publicacoes:
            latestGroup || [],
        });
      }


      const requestedId =
        Number(req.query?.id);

      /*
       * Consulta detalhada de um grupo.
       *
       * Usada pela interface depois que o Briefing
       * devolve publication_id.
       *
       * Sem ?id=..., o comportamento historico
       * permanece exatamente igual.
       */
      if (
        Number.isInteger(requestedId) &&
        requestedId > 0
      ) {
        const {
          data: selected,
          error: selectedError,
        } =
          await supabase
            .from("publicacoes")
            .select(
              "id,publication_group_id"
            )
            .eq("id", requestedId)
            .maybeSingle();

        if (selectedError) {
          throw new Error(
            `Nao foi possivel localizar a publicacao: ${selectedError.message}`
          );
        }

        if (!selected) {
          return res.status(404).json({
            error:
              "Publicacao nao encontrada.",
          });
        }

        if (
          !selected.publication_group_id
        ) {
          return res.status(409).json({
            error:
              "A publicacao nao possui publication_group_id.",
          });
        }

        const {
          data: group,
          error: groupError,
        } =
          await supabase
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
              publication_group_id,
              carousel_position,
              cta_url,
              selected_channels,
              instagram_status,
              instagram_post_id,
              instagram_url,
              instagram_parent_container_id,
              instagram_child_container_ids,
              instagram_containers_created_at,
              publish_attempts,
              last_error,
              noticias (
                id,
                titulo,
                categoria
              )
            `)
            .eq(
              "publication_group_id",
              selected.publication_group_id
            )
            .order(
              "carousel_position",
              { ascending: true }
            );

        if (groupError) {
          throw new Error(
            `Nao foi possivel carregar o grupo da publicacao: ${groupError.message}`
          );
        }

        return res.status(200).json({
          success: true,

          publication_group_id:
            selected.publication_group_id,

          quantidade:
            group?.length || 0,

          publicacoes:
            group || [],
        });
      }

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
