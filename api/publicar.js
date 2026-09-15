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

    const { data: selected, error: selectedError } = await supabase
      .from("publicacoes")
      .select("id,publication_group_id")
      .eq("id", id)
      .maybeSingle();

    if (selectedError) {
      throw new Error(`Nao foi possivel carregar a publicacao: ${selectedError.message}`);
    }

    if (!selected?.publication_group_id) {
      return res.status(409).json({
        error: "A publicacao precisa pertencer a um grupo de carrossel.",
      });
    }

    const { data: group, error: groupError } = await supabase
      .from("publicacoes")
      .select("id,status,published_at,carousel_position,banner_url,cta_url")
      .eq("publication_group_id", selected.publication_group_id)
      .order("carousel_position", { ascending: true });

    if (groupError) {
      throw new Error(`Nao foi possivel carregar o carrossel: ${groupError.message}`);
    }

    if (
      group?.length !== 2 ||
      !group.some((item) => String(item.id) === String(id)) ||
      group[0].carousel_position !== 1 ||
      group[1].carousel_position !== 2 ||
      group.some((item) => item.status !== "APROVADO" || item.published_at !== null)
    ) {
      return res.status(409).json({
        error: "O carrossel exige dois editoriais nas posicoes 1 e 2, ambos APROVADOS e ainda nao publicados.",
      });
    }

    const isImageUrl = (value) => {
      if (typeof value !== "string" || !value.trim()) return false;
      try {
        const url = new URL(value);
        return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
      } catch {
        return false;
      }
    };

    if (
      group.some((item) => !isImageUrl(item.banner_url) || !isImageUrl(item.cta_url)) ||
      group[0].cta_url !== group[1].cta_url
    ) {
      return res.status(409).json({
        error: "O carrossel exige URLs validas dos editoriais e a mesma URL do CTA nos dois registros.",
      });
    }

    const carouselImages = [group[0].banner_url, group[1].banner_url, group[0].cta_url];

    const { data: reservedGroup, error: reserveError } = await supabase.rpc(
      "reserve_publication_group",
      {
        p_group_id: selected.publication_group_id,
      }
    );

    if (reserveError) {
      throw new Error(
        `Nao foi possivel reservar o carrossel: ${reserveError.message}`
      );
    }

    if (
      !Array.isArray(reservedGroup) ||
      reservedGroup.length !== 2 ||
      !reservedGroup.some((item) => String(item.id) === String(id))
    ) {
      return res.status(409).json({
        error:
          "O carrossel nao esta mais disponivel para publicacao. Recarregue a fila e tente novamente.",
      });
    }

    const { data: restoredGroup, error: restoreError } = await supabase
      .from("publicacoes")
      .update({
        status: "APROVADO",
        atualizado_em: new Date().toISOString(),
      })
      .eq("publication_group_id", selected.publication_group_id)
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
      `);

    if (
      restoreError ||
      !Array.isArray(restoredGroup) ||
      restoredGroup.length !== 2
    ) {
      throw new Error(
        `Dry-run concluido, mas nao foi possivel devolver o carrossel inteiro para APROVADO: ${
          restoreError?.message || "grupo incompleto"
        }`
      );
    }

    const restored = restoredGroup.find(
      (item) => String(item.id) === String(id)
    );

    if (!restored) {
      throw new Error(
        "Dry-run concluido, mas a publicacao selecionada nao foi encontrada no grupo restaurado."
      );
    }
    return res.status(200).json({
      success: true,
      dry_run: true,
      carrossel: {
        publication_group_id: selected.publication_group_id,
        publication_ids: group.map((item) => item.id),
        imagens: carouselImages,
      },
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
