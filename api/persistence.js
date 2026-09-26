import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

import { validateCanonicalShape } from "../lib/editorial-rules.mjs";
import { loadEditorialHistory, selectUnseenNews, compareEditorialStories, editorialEventSignature, primarySourceKey } from "../lib/editorial-dedup.mjs";

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function buildNewsDedupKey(item) {
  const url = primarySourceKey(item);
  // Retain the existing key format; normalization is centralized.
  return url ? `url:${digest(`https://${url}`)}` : null;
}

function isDedupConflict(error) {
  return error?.code === "23505" &&
    String(error.message || "").includes("noticias_dedup_key_unique");
}

async function insertUnseenNews(supabase, row, item) {
  const insert = (data) => supabase.from("noticias").insert(data).select("id").single();
  let result = await insert(row);
  if (!row.dedup_key || !isDedupConflict(result.error)) return result;

  // The unique URL barrier also covers stories older than the recent window.
  // Recheck its stored event before admitting a new development on that URL.
  const { data: previous, error } = await supabase.from("noticias")
    .select("id,titulo,resumo,artigo,url,fontes(url)")
    .eq("dedup_key", row.dedup_key).maybeSingle();
  if (error || !previous) {
    throw new Error(`Não foi possível conferir conflito de deduplicação: ${error?.message || "notícia anterior ausente"}`);
  }
  if (compareEditorialStories(item, previous).reason !== "novo_acontecimento") {
    return { data: null, error: null, duplicate: true, previousId: previous.id };
  }
  const signature = editorialEventSignature(item);
  if (!signature) throw new Error("Atualização sem evidência de acontecimento novo.");
  result = await insert({ ...row, dedup_key: `${row.dedup_key}:event:${digest(signature)}` });
  return isDedupConflict(result.error)
    ? { data: null, error: null, duplicate: true, previousId: previous.id }
    : result;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeArray(value) {
  return Array.isArray(value)
    ? value.map((item) =>
        typeof item === "string" ? normalizeText(item) : item
      )
    : [];
}

function prepareNewsItem(item, index) {
  const normalized = {
    ...item,
    titulo: normalizeText(item?.titulo),
    titulo_curto: normalizeText(item?.titulo_curto),
    manchete_curta: normalizeText(item?.manchete_curta),
    categoria: normalizeText(item?.categoria),
    materia: normalizeText(item?.materia),
    highlights: normalizeArray(item?.highlights),
    hashtags: normalizeArray(item?.hashtags).map((tag) => {
      if (typeof tag !== "string") return tag;
      const text = tag.replace(/^#+/, "").replace(/\s+/g, "").toLowerCase();
      return text ? `#${text}` : "";
    }),
    fontes: Array.isArray(item?.fontes)
      ? item.fontes.map((source) => ({
          nome: normalizeText(source?.nome),
          url: normalizeText(source?.url),
          publicado_em: normalizeText(source?.publicado_em),
        }))
      : [],
  };

  const errors = validateCanonicalShape(normalized);
  if (normalized.hashtags.some((tag) => typeof tag !== "string" || !tag)) {
    errors.push("hashtags devem ser textos não vazios");
  }
  if (normalized.fontes.some((source) => !source.url)) {
    errors.push("cada fonte deve ter uma URL");
  }
  if (errors.length) {
    throw new Error(
      `Notícia ${index + 1} inválida para persistência: ${errors.join("; ")}`
    );
  }

  return normalized;
}

function getSupabase() {
  const url = normalizeText(process.env.SUPABASE_URL);
  const serviceRoleKey = normalizeText(
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios para persistencia."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function loadRecentPublishedNews() {
  return (await loadEditorialHistory(getSupabase())).history;
}

async function persistEdition({
  title,
  date,
  status = "publicada",
  news,
  researchData,
}) {
  if (!Array.isArray(news) || news.length === 0) {
    throw new Error(
      "Nao e possivel persistir uma edicao sem noticias."
    );
  }

  // Validate the entire edition before its first database write.
  const validatedNews = news.map(prepareNewsItem);
  const supabase = getSupabase();
  const { history, since } = await loadEditorialHistory(supabase);
  const deduplication = { ...selectUnseenNews(validatedNews, history), since };
  const candidateIndexes = deduplication.retainedIndexes;
  const preparedNews = candidateIndexes.map(index => validatedNews[index]);
  const retainedIndexes = [];
  console.log("WIRE/GEEK: deduplicação entre rodadas", {
    recebidas: validatedNews.length,
    historico: history.length,
    novas: preparedNews.length,
    duplicadas: deduplication.duplicates,
    atualizacoes: deduplication.updates,
  });
  if (!preparedNews.length) {
    return { editionId: null, noticiaIds: [], retainedIndexes, deduplication };
  }

  // Delay edition/research records until the first insert wins the unique key.
  // A concurrent all-duplicate round must not create an empty edition.
  async function createEditionAndResearch() {
    const { data: edition, error: editionError } = await supabase
      .from("edicoes")
      .insert({
        titulo: normalizeText(title) || "Edicao Wire/Geek",
        data_edicao:
          normalizeText(date) || new Date().toISOString(),
        status,
      })
      .select("id")
      .single();

    if (editionError) {
      throw new Error(
        `Erro ao inserir edicao: ${editionError.message}`
      );
    }

    const editionId = edition.id;

    const researchCandidates =
      Array.isArray(researchData?.candidatos)
        ? researchData.candidatos
        : [];

    const { data: researchRun, error: researchRunError } =
      await supabase
        .from("research_runs")
        .insert({
          janela_horas: 48,
          candidatos_pesquisados:
            Number(researchData?.pesquisados) || 0,
          candidatos_validos:
            researchCandidates.length,
          erro:
            Array.isArray(
              researchData?.errosValidacao
            ) &&
            researchData.errosValidacao.length
              ? researchData.errosValidacao.join(" | ")
              : null,
        })
        .select("id")
        .single();

    if (researchRunError) {
      throw new Error(
        `Erro ao inserir research_run: ${researchRunError.message}`
      );
    }

    const researchRunId = researchRun.id;

    if (researchCandidates.length > 0) {
      const researchRows = researchCandidates.map(
        (candidate) => ({
          research_run_id: researchRunId,
          titulo: normalizeText(candidate.titulo),
          categoria: normalizeText(candidate.categoria),
          publicado_em:
            normalizeText(candidate.publicado_em) || null,
          resumo: normalizeText(candidate.resumo),
          url: normalizeText(candidate.url),
          fonte: normalizeText(candidate.fonte),
          dados_json: JSON.stringify(candidate),
        })
      );

      const { error: candidatesError } = await supabase
        .from("research_candidates")
        .insert(researchRows);

      if (candidatesError) {
        throw new Error(
          `Erro ao inserir candidatos de pesquisa: ${candidatesError.message}`
        );
      }
    }

    return editionId;
  }

  let editionId = null;
  const noticiaIds = [];

  for (const [index, item] of preparedNews.entries()) {
    const primarySource = item.fontes[0];

    const sourceName =
      normalizeText(primarySource?.nome) ||
      normalizeText(item.fonte);

    const sourceUrl =
      normalizeText(primarySource?.url) ||
      normalizeText(item.url);

    const { data: noticia, error: noticiaError, duplicate, previousId } =
      await insertUnseenNews(supabase, {
          titulo: normalizeText(item.titulo),
          titulo_curto: item.titulo_curto,
          manchete_curta: item.manchete_curta,
          categoria: normalizeText(item.categoria),
          resumo: normalizeText(item.resumo),
          artigo: normalizeText(item.materia),
          publicado_em:
            normalizeText(item.publicado_em) || null,
          url: sourceUrl,
          fonte: sourceName,
          dedup_key: buildNewsDedupKey(item),
        }, item);

    if (duplicate) {
      deduplication.duplicates.push({ index: candidateIndexes[index], noticia_id: previousId, reason: "conflito_atomico" });
      continue;
    }

    if (noticiaError) {
      throw new Error(
        `Erro ao inserir noticia "${item.titulo}": ${noticiaError.message}`
      );
    }

    const noticiaId = noticia.id;
    if (editionId === null) editionId = await createEditionAndResearch();
    noticiaIds.push(noticiaId);
    retainedIndexes.push(candidateIndexes[index]);

    const { error: editionNewsError } =
      await supabase
        .from("edicao_noticias")
        .insert({
          edicao_id: editionId,
          noticia_id: noticiaId,
          ordem: noticiaIds.length,
        });

    if (editionNewsError) {
      throw new Error(
        `Erro ao vincular noticia "${item.titulo}" a edicao: ${editionNewsError.message}`
      );
    }

    const { error: sourceError } = await supabase
      .from("fontes")
      .insert(item.fontes.map((source) => ({
        noticia_id: noticiaId,
        nome: source.nome || "Fonte",
        url: source.url,
        publicado_em:
          source.publicado_em || normalizeText(item.publicado_em) || null,
      })));

    if (sourceError) {
      throw new Error(
        `Erro ao inserir fonte "${item.titulo}": ${sourceError.message}`
      );
    }

    const highlights = item.highlights;

    if (highlights.length > 0) {
      const highlightRows = highlights.map(
        (texto) => ({
          noticia_id: noticiaId,
          texto,
        })
      );

      const { error: highlightsError } =
        await supabase
          .from("highlights")
          .insert(highlightRows);

      if (highlightsError) {
        throw new Error(
          `Erro ao inserir highlights "${item.titulo}": ${highlightsError.message}`
        );
      }
    }

    const hashtags = item.hashtags;

    if (hashtags.length > 0) {
      const hashtagRows = hashtags.map(
        (hashtag) => ({
          noticia_id: noticiaId,
          hashtag,
        })
      );

      const { error: hashtagsError } =
        await supabase
          .from("hashtags")
          .insert(hashtagRows);

      if (hashtagsError) {
        throw new Error(
          `Erro ao inserir hashtags "${item.titulo}": ${hashtagsError.message}`
        );
      }
    }

    const imageUrl = normalizeText(
      item.image_url ||
        item.imagem ||
        item.image
    );

    if (imageUrl) {
      const { error: imageError } =
        await supabase
          .from("imagens")
          .insert({
            noticia_id: noticiaId,
            tipo: "url",
            url: imageUrl,
            caminho: null,
            alt_text:
              normalizeText(item.titulo),
          });

      if (imageError) {
        throw new Error(
          `Erro ao inserir imagem "${item.titulo}": ${imageError.message}`
        );
      }
    }
  }

  console.log(
    "WIRE/GEEK: edicao persistida no Supabase:",
    editionId
  );

  deduplication.retainedIndexes = retainedIndexes;
  console.log("WIRE/GEEK: resultado da deduplicação", {
    persistidas: noticiaIds.length,
    duplicadas: deduplication.duplicates.length,
  });
  return { editionId, noticiaIds, retainedIndexes, deduplication };
}

export {
  persistEdition,
  loadRecentPublishedNews,
};
