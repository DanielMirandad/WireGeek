import { randomUUID } from "node:crypto";
import {
  correctedEditorials,
} from "./manual-reel-correction.mjs";

export const BRIEFING_BANNER_MODEL_VERSION =
  "briefing-approved-2026-09-21-v2";

function clean(value) {
  return String(value || "").trim();
}

function validateNoticiaId(value) {
  const noticiaId =
    Number(value);

  if (
    !Number.isInteger(noticiaId) ||
    noticiaId <= 0
  ) {
    throw new Error(
      "Informe um noticia_id valido."
    );
  }

  return noticiaId;
}

function correctedCtaUrl(slides) {
  if (!Array.isArray(slides)) {
    throw new Error(
      "Conjunto corrigido ausente."
    );
  }

  const ctas =
    slides.filter(
      (slide) =>
        slide?.type === "cta"
    );

  if (ctas.length !== 1) {
    throw new Error(
      "O conjunto corrigido deve possuir exatamente um CTA."
    );
  }

  let url;

  try {
    url =
      new URL(
        clean(
          ctas[0]?.banner_url
        )
      );
  } catch {
    throw new Error(
      "CTA corrigido possui URL invalida."
    );
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "CTA corrigido deve possuir URL HTTPS publica."
    );
  }

  return url.href;
}

async function loadHashtags(
  supabase,
  noticiaId
) {
  const {
    data,
    error,
  } =
    await supabase
      .from("hashtags")
      .select("hashtag")
      .eq(
        "noticia_id",
        noticiaId
      );

  if (error) {
    throw new Error(
      "Nao foi possivel carregar as hashtags: " +
      error.message
    );
  }

  return (data || [])
    .map(
      (item) =>
        clean(item?.hashtag)
    )
    .filter(Boolean)
    .join(" ");
}

export async function materializeCorrectedPublicationGroup({
  supabase,
  noticiaId:
    rawNoticiaId,
  slides,
} = {}) {
  if (
    !supabase ||
    typeof supabase.from !== "function" ||
    typeof supabase.rpc !== "function"
  ) {
    throw new Error(
      "Cliente Supabase invalido."
    );
  }

  const noticiaId =
    validateNoticiaId(
      rawNoticiaId
    );

  const editorials =
    correctedEditorials(
      slides
    );

  const ctaUrl =
    correctedCtaUrl(
      slides
    );

  const hashtags =
    await loadHashtags(
      supabase,
      noticiaId
    );

  const requestedGroupId =
    randomUUID();

  const {
    data: rows,
    error,
  } =
    await supabase.rpc(
      "materialize_corrected_publication_group",
      {
        p_noticia_id:
          noticiaId,

        p_requested_group_id:
          requestedGroupId,

        p_editorials:
          editorials,

        p_cta_url:
          ctaUrl,

        p_hashtags:
          hashtags,

        p_banner_model_version:
          BRIEFING_BANNER_MODEL_VERSION,
      }
    );

  if (error) {
    throw new Error(
      "Nao foi possivel materializar a publicacao corrigida: " +
      error.message
    );
  }

  if (
    !Array.isArray(rows) ||
    rows.length < 1 ||
    rows.length > 2
  ) {
    throw new Error(
      "Materializacao corrigida retornou quantidade inesperada de editoriais."
    );
  }

  const publicationGroupId =
    clean(
      rows[0]
        ?.publication_group_id
    );

  if (!publicationGroupId) {
    throw new Error(
      "Materializacao corrigida nao retornou publication_group_id."
    );
  }

  if (
    rows.some(
      (row, index) =>
        clean(
          row?.publication_group_id
        ) !== publicationGroupId ||
        Number(
          row?.noticia_id
        ) !== noticiaId ||
        Number(
          row?.carousel_position
        ) !== index + 1 ||
        clean(
          row?.cta_url
        ) !== ctaUrl ||
        ![
          "APROVADO",
          "AGUARDANDO_APROVACAO",
        ].includes(
          clean(
            row?.status
          )
        )
    )
  ) {
    throw new Error(
      "Materializacao corrigida nao confirmou um grupo seguro."
    );
  }

  return {
    created:
      publicationGroupId ===
      requestedGroupId,

    publication_group_id:
      publicationGroupId,

    rows,
  };
}