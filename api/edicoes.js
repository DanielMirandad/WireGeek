import { createClient } from "@supabase/supabase-js";

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

export default async function handler(req, res) {
  const sessionModule = await import("./auth.js");

  if (!sessionModule.hasValidSession(req)) {
    return res.status(401).json({
      error: "Acesso nao autorizado.",
    });
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Metodo nao permitido.",
    });
  }

  try {
    const supabase = getSupabase();

    const { data: editions, error: editionsError } =
      await supabase
        .from("edicoes")
        .select(`
          id,
          titulo,
          data_edicao,
          status,
          edicao_noticias (
            ordem,
            noticias (
              id,
              titulo,
              categoria,
              resumo,
              artigo,
              publicado_em,
              url,
              fonte,
              highlights (
                texto
              ),
              hashtags (
                hashtag
              ),
              fontes (
                nome,
                url,
                publicado_em
              ),
              imagens (
                tipo,
                url,
                caminho,
                alt_text
              )
            )
          )
        `)
        .order("data_edicao", { ascending: false });

    if (editionsError) {
      throw new Error(editionsError.message);
    }

    const result = (editions || []).map((edition) => {
      const news = (edition.edicao_noticias || [])
        .sort(
          (a, b) =>
            Number(a.ordem || 0) - Number(b.ordem || 0)
        )
        .map((link) => {
          const noticia = link.noticias;

          if (!noticia) {
            return null;
          }

          const {
            highlights = [],
            hashtags = [],
            fontes = [],
            imagens = [],
            ...baseNoticia
          } = noticia;

          return {
            ...baseNoticia,
            ordem: link.ordem,
            materia: baseNoticia.artigo || "",
            highlights: highlights.map(
              (item) => item.texto
            ),
            hashtags: hashtags.map(
              (item) => item.hashtag
            ),
            fontes,
            imagens,
          };
        })
        .filter(Boolean);

      const {
        edicao_noticias,
        ...baseEdition
      } = edition;

      return {
        ...baseEdition,
        news,
      };
    });

    return res.status(200).json({
      edicoes: result,
    });
  } catch (error) {
    console.error(
      "WIRE/GEEK: erro ao carregar arquivo de edicoes:",
      error
    );

    return res.status(500).json({
      error: "Nao foi possivel carregar o arquivo de edicoes.",
    });
  }
}
