import { createClient } from "@supabase/supabase-js";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeArray(value) {
  return Array.isArray(value)
    ? value
        .map((item) => normalizeText(item))
        .filter(Boolean)
    : [];
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

  const supabase = getSupabase();

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

  for (const [index, item] of news.entries()) {
    const primarySource =
      Array.isArray(item.fontes)
        ? item.fontes[0]
        : null;

    const sourceName =
      normalizeText(primarySource?.nome) ||
      normalizeText(item.fonte);

    const sourceUrl =
      normalizeText(primarySource?.url) ||
      normalizeText(item.url);

    const sourcePublishedAt =
      normalizeText(primarySource?.publicado_em) ||
      normalizeText(item.publicado_em);

    const { data: noticia, error: noticiaError } =
      await supabase
        .from("noticias")
        .insert({
          titulo: normalizeText(item.titulo),
          categoria: normalizeText(item.categoria),
          resumo: normalizeText(item.resumo),
          artigo: normalizeText(item.materia),
          publicado_em:
            normalizeText(item.publicado_em) || null,
          url: sourceUrl,
          fonte: sourceName,
        })
        .select("id")
        .single();

    if (noticiaError) {
      throw new Error(
        `Erro ao inserir noticia "${item.titulo}": ${noticiaError.message}`
      );
    }

    const noticiaId = noticia.id;

    const { error: editionNewsError } =
      await supabase
        .from("edicao_noticias")
        .insert({
          edicao_id: editionId,
          noticia_id: noticiaId,
          ordem: index + 1,
        });

    if (editionNewsError) {
      throw new Error(
        `Erro ao vincular noticia "${item.titulo}" a edicao: ${editionNewsError.message}`
      );
    }

    const { error: sourceError } = await supabase
      .from("fontes")
      .insert({
        noticia_id: noticiaId,
        nome: sourceName || "Fonte",
        url: sourceUrl,
        publicado_em:
          sourcePublishedAt || null,
      });

    if (sourceError) {
      throw new Error(
        `Erro ao inserir fonte "${item.titulo}": ${sourceError.message}`
      );
    }

    const highlights = normalizeArray(
      item.highlights
    );

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

    const hashtags = normalizeArray(
      item.hashtags
    );

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

  return editionId;
}

export {
  persistEdition,
};