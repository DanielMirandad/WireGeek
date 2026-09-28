import { createClient } from "@supabase/supabase-js";
import { HASHTAG_COUNT, SOURCE_MIN_COUNT, SOURCE_MAX_COUNT } from "../lib/wiregeek-contract.mjs";

const EDITION_SELECT = `
  id, titulo, data_edicao, criado_em, status,
  edicao_noticias (
    ordem,
    noticias (
      id, titulo, titulo_curto, manchete_curta, categoria, resumo, artigo,
      publicado_em, url, fonte,
      highlights (id, texto), hashtags (id, hashtag),
      fontes (nome, url, publicado_em), imagens (tipo, url, caminho, alt_text)
    )
  )
`;

function getSupabase() {
  const url = String(process.env.SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new Error("Configuração do banco ausente.");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function normalizeStoredEdition(edition) {
  const { edicao_noticias = [], ...baseEdition } = edition;
  const news = [...edicao_noticias]
    .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0))
    .filter(link => link.noticias)
    .map(({ noticias, ordem }) => {
      const { highlights = [], hashtags = [], fontes = [], imagens = [], ...item } = noticias;
      return {
        ...item, ordem, materia: item.artigo || "",
        highlights: [...highlights].sort((a, b) => Number(a.id) - Number(b.id)).map(row => row.texto),
        hashtags: [...hashtags].sort((a, b) => Number(a.id) - Number(b.id))
          .map(row => String(row.hashtag || "").trim().toLowerCase()).filter(Boolean),
        fontes, imagens,
      };
    });
  return { ...baseEdition, news };
}

// Read completeness, not an editorial rewrite: legacy single highlights remain readable.
// Children are written in separate requests; do not expose a half-saved latest edition.
export function isReadableEdition(edition) {
  return edition.news.length > 0 && edition.news.every(item =>
    item.id && item.titulo && item.materia && item.highlights.length >= 1 &&
    item.hashtags.length === HASHTAG_COUNT && item.fontes.length >= SOURCE_MIN_COUNT && item.fontes.length <= SOURCE_MAX_COUNT
  );
}

async function generationInProgress(client) {
  const { data, error } = await client.from("editorial_execution_lock")
    .select("name").eq("name", "news").gt("expires_at", new Date().toISOString()).limit(1);
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Resposta de execução inválida.");
  return data.length > 0;
}

export async function loadEditions(client, latest) {
  if (latest && await generationInProgress(client)) return { edicoes: [], pending: true };

  const result = [];
  const pageSize = latest ? 20 : 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from("edicoes").select(EDITION_SELECT)
      // data_edicao is free-form text; the server timestamp defines round order.
      .order("criado_em", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false }).range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("Resposta inválida do banco.");
    const editions = data.map(normalizeStoredEdition);
    if (latest) {
      const edition = editions.find(isReadableEdition);
      if (edition) {
        // A generation can start between the first lock check and the edition read.
        if (await generationInProgress(client)) return { edicoes: [], pending: true };
        return { edicoes: [edition], pending: false };
      }
    } else result.push(...editions);
    if (data.length < pageSize) return { edicoes: result, pending: false };
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  const { hasValidSession } = await import("./auth.js");
  if (!hasValidSession(req)) return res.status(401).json({ error: "Acesso não autorizado." });
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }
  try {
    return res.status(200).json(await loadEditions(getSupabase(), req.query?.latest === "1"));
  } catch (error) {
    console.error("WIRE/GEEK: erro ao carregar edições:", error);
    return res.status(500).json({ error: "Não foi possível carregar as edições." });
  }
}
