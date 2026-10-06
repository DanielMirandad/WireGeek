import BriefingBannerSection from "./briefing/BriefingBannerSection.jsx";
import PublicationPanel from "./PublicationPanel.jsx";
import { cleanBriefingText } from "../lib/briefing-text.mjs";
import { parseBriefingRealInput } from "./briefing-real-input.mjs";
import {
  HIGHLIGHT_COUNT,
  MIN_HIGHLIGHT_WORDS,
  MAX_HIGHLIGHT_WORDS,
  HASHTAG_COUNT,
} from "../lib/wiregeek-contract.mjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { createEditionSync, mergeLatestEdition, sameEdition, readPreparedEdition, savePreparedEdition } from "./latest-edition.mjs";
import {
  AlertCircle, Check, CheckCircle2, Clock, Copy,
  Hash, Newspaper, Radio, RefreshCw, Zap, ImageIcon,
  Archive,
} from "lucide-react";

import {
  buildBriefingClientPayload,
  applyManualBannerImages,
} from "./briefing/briefing-banner-contract.js";

// --- CONSTANTES ---
const TEMPLATE_DESIGN_ID = "DAHSAXUcxX4";
const LOCATORS = {
  pages: [
    { badge: "PBh0XHD7f51kGytW-LB8JLWDRlqf3zjVq", subtitle: "PBh0XHD7f51kGytW-LBt1zdTS5fdVJTjx", title: "PBh0XHD7f51kGytW-LBqCnTzmXzLqNWpD", image: "PBh0XHD7f51kGytW-LBcrH5XySKL6yNB8" },
    { badge: "PBFyZVcCQVwCb0d3-LBKvNPT8SJnDH1dH", subtitle: "PBFyZVcCQVwCb0d3-LBnqhzhh7z7GZ8jz", title: "PBFyZVcCQVwCb0d3-LB2MsMYr8xcXw1M1", image: "PBFyZVcCQVwCb0d3-LBd2pgL8y4n6Ns3V" },
    { badge: "PB4wYBY6qz0T0XRs-LBKNjYr8rfxC1y3H", subtitle: "PB4wYBY6qz0T0XRs-LBv71qJNWmMm4vCy", title: "PB4wYBY6qz0T0XRs-LBcrrR5z0Ynr61Zm", image: "PB4wYBY6qz0T0XRs-LBhHjmVCZhs6p0bf" },
    { badge: "PBVm2lDStJp1vY2K-LBSccwgKrvXSV2qc", subtitle: "PBVm2lDStJp1vY2K-LBhzgt6pqVSk6mmn", title: "PBVm2lDStJp1vY2K-LBr6s9x2J5KY9nBn", image: "PBVm2lDStJp1vY2K-LBn5H3KPYykqy4LL" },
  ],
  badgeOriginalText: "cinema",
};

const CATEGORY_LABEL  = { games: "GAMES", geek: "GEEK", cinema: "CINEMA", anime: "ANIME" };
const CATEGORY_COLOR  = { games: "#E8002D", geek: "#7C3AED", cinema: "#D97706", anime: "#0EA5E9" };
const CATEGORY_ORDER  = ["games", "geek", "cinema", "anime"];

const RODAPE_FIXO = `---

Estaremos acompanhando tudo e traremos as informações até vocês.

SEGUE A GENTE, COMPARTILHA E COMENTA!

LIVES TODOS OS SÁBADOS!!
https://www.twitch.tv/bagacacast_lives
https://youtube.com/@bagacastudios

REDES SOCIAIS:
Instagram: @bagacastudios
Youtube: @bagacastudios

SEJA VIP:
https://linktr.ee/Bagacacast
`;

// --- HELPERS ---
function todayKey()     { const d = new Date(); return `wire-geek:v3:${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function sleep(ms)      { return new Promise(r => setTimeout(r, ms)); }

function copyViaTextarea(text) {
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly",""); ta.style.position="fixed"; ta.style.opacity="0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy") ? resolve() : reject(new Error("Falhou"));
      document.body.removeChild(ta);
    } catch(e) { reject(e); }
  });
}
function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(() => copyViaTextarea(text));
  return copyViaTextarea(text);
}
async function postPublisherMode(
  payload
) {
  const response =
    await fetch(
      "/api/publicar",
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        credentials:
          "include",

        body:
          JSON.stringify(
            payload
          ),
      }
    );

  const data =
    await response
      .json()
      .catch(
        () => ({})
      );

  if (!response.ok) {
    const message =
      data?.details ||
      data?.error ||
      `Falha em /api/publicar. HTTP ${response.status}.`;

    const error =
      new Error(
        message
      );

    error.status =
      response.status;

    error.data =
      data;

    throw error;
  }

  return data;
}


async function loadPublicationGroupForAutomation(
  publicationId
) {
  const response =
    await fetch(
      `/api/publicacoes?id=${encodeURIComponent(
        publicationId
      )}`,
      {
        method:
          "GET",

        credentials:
          "include",
      }
    );

  const data =
    await response
      .json()
      .catch(
        () => ({})
      );

  if (!response.ok) {
    throw new Error(
      data?.details ||
      data?.error ||
      `Falha carregando grupo de publicacao. HTTP ${response.status}.`
    );
  }

  return data;
}


async function autoPrepareInstagramReel(
  publicationId,
  onAssetReady = null
) {
  const normalizedPublicationId =
    Number(
      publicationId
    );

  if (
    !Number.isInteger(
      normalizedPublicationId
    ) ||
    normalizedPublicationId <= 0
  ) {
    throw new Error(
      "AUTO-PUBLISH: publication_id invalido para preparar Reel."
    );
  }

  /*
   * =======================================================
   * ETAPA 1 - MP4 IMUTAVEL
   * =======================================================
   *
   * Este modo:
   *
   * - nao chama Meta;
   * - nao cria container;
   * - nao executa media_publish.
   */

  const asset =
    await postPublisherMode({
      id:
        normalizedPublicationId,

      instagram_reel_asset:
        true,
    });

  const assetGroupId =
    String(
      asset
        ?.publication_group_id ||
      ""
    ).trim();

  const assetStoragePath =
    String(
      asset
        ?.asset
        ?.storage_path ||
      ""
    ).trim();

  const assetVideoUrl =
    String(
      asset
        ?.asset
        ?.video_url ||
      ""
    ).trim();

  const assetSha256 =
    String(
      asset
        ?.asset
        ?.sha256 ||
      ""
    ).trim();

  const assetValid =
    asset?.success ===
      true &&
    asset?.mode ===
      "instagram_reel_asset" &&
    asset?.publication_type ===
      "REEL" &&
    asset?.publish_called ===
      false &&
    asset?.instagram_api_called ===
      false &&
    asset
      ?.asset
      ?.immutable ===
      true &&
    Boolean(
      assetGroupId
    ) &&
    assetStoragePath.startsWith(
      `instagram-reels/${assetGroupId}-`
    ) &&
    /^https:\/\//i.test(
      assetVideoUrl
    ) &&
    /^[0-9a-f]{64}$/i.test(
      assetSha256
    ) &&
    Number(
      asset
        ?.caption
        ?.hashtags_count
    ) === 5;

  if (!assetValid) {
    throw new Error(
      "AUTO-PUBLISH: MP4 retornou contrato invalido."
    );
  }

  console.log(
    "WIRE/GEEK AUTO-PUBLISH: MP4 imutavel pronto",
    {
      publication_id:
        normalizedPublicationId,

      publication_group_id:
        assetGroupId,

      storage_path:
        assetStoragePath,

      sha256_prefix:
        assetSha256.slice(
          0,
          16
        ),

      reused:
        asset
          ?.asset
          ?.reused ===
          true,
    }
  );


  /*
   * Sincronizar a interface assim que o MP4 estiver
   * comprovadamente pronto.
   *
   * Isto acontece ANTES da etapa de container.
   *
   * Assim, uma falha posterior nunca faz a interface
   * oferecer novamente a geracao de um MP4 que ja existe.
   */
  if (
    typeof onAssetReady ===
    "function"
  ) {
    await onAssetReady({
      publication_id:
        normalizedPublicationId,

      publication_group_id:
        assetGroupId,

      storage_path:
        assetStoragePath,

      video_url:
        assetVideoUrl,

      asset_sha256:
        assetSha256,
    });
  }


  /*
   * =======================================================
   * ETAPA 2 - RECARREGAR O GRUPO
   * =======================================================
   *
   * Precisamos consultar o estado atual antes de qualquer
   * chamada mutavel a Meta.
   */

  const group =
    await loadPublicationGroupForAutomation(
      normalizedPublicationId
    );

  const groupId =
    String(
      group
        ?.publication_group_id ||
      ""
    ).trim();

  const rows =
    Array.isArray(
      group?.publicacoes
    )
      ? group.publicacoes
      : [];

  const profileUsernames =
    group
      ?.instagram_profile_usernames;

  const currentPublicationIds =
    rows
      .map(
        row =>
          Number(
            row?.id ||
            0
          )
      )
      .filter(
        value =>
          Number.isInteger(
            value
          ) &&
          value > 0
      );

  if (
    group?.success !==
      true ||
    (rows.length < 1 || rows.length > 2) ||
    currentPublicationIds.length !==
      rows.length ||
    new Set(
      currentPublicationIds
    ).size !== rows.length ||
    !currentPublicationIds.includes(
      normalizedPublicationId
    ) ||
    groupId !==
      assetGroupId ||
    !Array.isArray(
      profileUsernames
    ) ||
    rows.some(
      row =>
        row?.status !==
          "APROVADO" ||
        row?.published_at ||
        String(
          row
            ?.instagram_post_id ||
          ""
        ).trim() ||
        [
          "PUBLICANDO",
          "VERIFICAR_MANUALMENTE",
          "PUBLICADO",
        ].includes(
          String(
            row
              ?.instagram_status ||
            ""
          )
        )
    )
  ) {
    throw new Error(
      "AUTO-PUBLISH: grupo mudou depois da geracao do MP4."
    );
  }


  /*
   * =======================================================
   * ETAPA 3 - CONTAINER REEL
   * =======================================================
   *
   * Esta chamada PODE criar estado na Meta.
   *
   * CRITICO:
   *
   * NUNCA repetir automaticamente esta chamada em caso
   * de erro de rede, timeout ou resposta ambigua.
   */

  const container =
    await postPublisherMode({
      id:
        normalizedPublicationId,

      instagram_containers:
        true,

      expected_profile_usernames:
        profileUsernames,
    });

  const parentId =
    String(
      container
        ?.instagram
        ?.parent_container_id ||
      ""
    ).trim();

  const containerGroupId =
    String(
      container
        ?.reel
        ?.publication_group_id ||
      ""
    ).trim();

  const containerValid =
    container?.success ===
      true &&
    container?.mode ===
      "instagram_reel_container_only" &&
    container?.publication_type ===
      "REEL" &&
    container?.publish_called ===
      false &&
    containerGroupId ===
      groupId &&
    Boolean(
      parentId
    ) &&
    container
      ?.instagram
      ?.media_type ===
      "REELS" &&
    container
      ?.instagram
      ?.share_to_feed ===
      true &&
    container
      ?.instagram
      ?.parent_status_code ===
      "FINISHED" &&
    container
      ?.instagram
      ?.persisted ===
      true &&
    Array.isArray(
      container
        ?.instagram
        ?.child_containers
    ) &&
    container
      .instagram
      .child_containers
      .length === 0 &&
    Number(
      container
        ?.instagram
        ?.hashtags_count
    ) === 5 &&
    String(
      container
        ?.instagram
        ?.video_url ||
      ""
    ) ===
      assetVideoUrl;

  if (!containerValid) {
    throw new Error(
      "AUTO-PUBLISH: container Reel retornou contrato inesperado. Nao criar outro container automaticamente."
    );
  }

  console.log(
    "WIRE/GEEK AUTO-PUBLISH: container Reel preparado",
    {
      publication_id:
        normalizedPublicationId,

      publication_group_id:
        groupId,

      parent_container_id:
        parentId,

      status:
        container
          .instagram
          .parent_status_code,

      reused:
        container
          .instagram
          .reused ===
          true,
    }
  );


  /*
   * =======================================================
   * ETAPA 4 - PREFLIGHT
   * =======================================================
   *
   * Somente leitura.
   *
   * Ainda NAO executa media_publish.
   */

  const preflight =
    await postPublisherMode({
      id:
        normalizedPublicationId,

      instagram_publish_preflight:
        true,
    });

  const preflightParentId =
    String(
      preflight
        ?.instagram
        ?.parent_container_id ||
      ""
    ).trim();

  const preflightAccountId =
    String(
      preflight
        ?.instagram
        ?.account_id ||
      ""
    ).trim();

  const preflightHash =
    String(
      preflight
        ?.caption
        ?.caption_sha256 ||
      ""
    ).trim();

  const preflightIds =
    Array.isArray(
      preflight
        ?.publication_ids
    )
      ? preflight
          .publication_ids
          .map(Number)
          .filter(
            value =>
              Number.isInteger(
                value
              ) &&
              value > 0
          )
      : [];

  const preflightValid =
    preflight?.success ===
      true &&
    preflight?.mode ===
      "instagram_publish_preflight" &&
    preflight?.publication_type ===
      "REEL" &&
    preflight?.ready_to_publish ===
      true &&
    preflight?.publish_called ===
      false &&
    String(
      preflight
        ?.publication_group_id ||
      ""
    ) ===
      groupId &&
    preflightIds.length ===
      2 &&
    new Set(
      preflightIds
    ).size === 2 &&
    currentPublicationIds.every(
      id =>
        preflightIds.includes(
          id
        )
    ) &&
    preflightParentId ===
      parentId &&
    Boolean(
      preflightAccountId
    ) &&
    preflight
      ?.instagram
      ?.media_type ===
      "REELS" &&
    preflight
      ?.instagram
      ?.share_to_feed ===
      true &&
    preflight
      ?.instagram
      ?.parent_status_code ===
      "FINISHED" &&
    String(
      preflight
        ?.instagram
        ?.video_url ||
      ""
    ) ===
      assetVideoUrl &&
    Array.isArray(
      preflight
        ?.instagram
        ?.child_containers
    ) &&
    preflight
      .instagram
      .child_containers
      .length === 0 &&
    Number(
      preflight
        ?.caption
        ?.hashtags_count
    ) === 5 &&
    preflight
      ?.caption
      ?.caption_integrity ===
      true &&
    /^[0-9a-f]{64}$/i.test(
      preflightHash
    );

  if (!preflightValid) {
    throw new Error(
      "AUTO-PUBLISH: preflight do Reel nao confirmou PRONTO_PARA_PUBLICAR."
    );
  }

  console.log(
    "WIRE/GEEK AUTO-PUBLISH: Reel preparado automaticamente",
    {
      publication_id:
        normalizedPublicationId,

      publication_group_id:
        groupId,

      parent_container_id:
        parentId,

      ready_to_publish:
        true,

      publish_called:
        false,
    }
  );

  return {
    success:
      true,

    publication_id:
      normalizedPublicationId,

    publication_group_id:
      groupId,

    publication_ids:
      currentPublicationIds,

    parent_container_id:
      parentId,

    expected_account_id:
      preflightAccountId,

    video_url:
      assetVideoUrl,

    asset_sha256:
      assetSha256,

    caption_sha256:
      preflightHash,

    ready_to_publish:
      true,

    publish_called:
      false,
  };
}


async function autoPublishPreparedInstagramReel(
  prepared
) {
  const publicationId =
    Number(
      prepared
        ?.publication_id ||
      0
    );

  const publicationGroupId =
    String(
      prepared
        ?.publication_group_id ||
      ""
    ).trim();

  const parentContainerId =
    String(
      prepared
        ?.parent_container_id ||
      ""
    ).trim();

  const expectedAccountId =
    String(
      prepared
        ?.expected_account_id ||
      ""
    ).trim();

  const publicationIds =
    Array.isArray(
      prepared
        ?.publication_ids
    )
      ? prepared
          .publication_ids
          .map(Number)
          .filter(
            value =>
              Number.isInteger(
                value
              ) &&
              value > 0
          )
      : [];

  if (
    !Number.isInteger(
      publicationId
    ) ||
    publicationId <= 0 ||
    !publicationGroupId ||
    !parentContainerId ||
    !expectedAccountId ||
    (publicationIds.length < 1 || publicationIds.length > 2) ||
    new Set(
      publicationIds
    ).size !== publicationIds.length ||
    !publicationIds.includes(
      publicationId
    ) ||
    prepared
      ?.ready_to_publish !==
      true ||
    prepared
      ?.publish_called !==
      false
  ) {
    throw new Error(
      "AUTO-PUBLISH: preflight invalido para iniciar media_publish."
    );
  }

  let published;

  try {
    /*
     * CRITICO:
     *
     * Esta chamada ocorre exatamente UMA vez.
     *
     * postPublisherMode nao possui retry.
     *
     * Se a conexao cair depois que o servidor receber
     * a requisicao, o cliente NAO pode decidir repetir.
     */
    published =
      await postPublisherMode({
        id:
          publicationId,

        instagram_publish:
          true,

        publish_origin:
          "auto_media_publish",

        publish_confirmation:
          `PUBLICAR_INSTAGRAM_${publicationId}`,

        expected_parent_container_id:
          parentContainerId,

        expected_publication_group_id:
          publicationGroupId,

        expected_account_id:
          expectedAccountId,
      });
  }
  catch (error) {
    error.autoPublishStage =
      "instagram_publish";

    error.doNotRetry =
      true;

    throw error;
  }

  const returnedIds =
    Array.isArray(
      published
        ?.publication_ids
    )
      ? published
          .publication_ids
          .map(Number)
          .filter(
            value =>
              Number.isInteger(
                value
              ) &&
              value > 0
          )
      : [];

  const postId =
    String(
      published
        ?.instagram
        ?.post_id ||
      ""
    ).trim();

  const valid =
    published
      ?.success ===
      true &&
    published
      ?.mode ===
      "instagram_publish" &&
    published
      ?.publish_called ===
      true &&
    published
      ?.published ===
      true &&
    published
      ?.do_not_retry ===
      true &&
    String(
      published
        ?.publication_group_id ||
      ""
    ) ===
      publicationGroupId &&
    returnedIds.length ===
      2 &&
    new Set(
      returnedIds
    ).size ===
      2 &&
    publicationIds.every(
      id =>
        returnedIds.includes(
          id
        )
    ) &&
    String(
      published
        ?.instagram
        ?.account_id ||
      ""
    ) ===
      expectedAccountId &&
    String(
      published
        ?.instagram
        ?.parent_container_id ||
      ""
    ) ===
      parentContainerId &&
    Boolean(
      postId
    ) &&
    published
      ?.database
      ?.status ===
      "PUBLICADO" &&
    published
      ?.database
      ?.instagram_status ===
      "PUBLICADO" &&
    Number(
      published
        ?.database
        ?.rows
    ) === 2;

  if (!valid) {
    const error =
      new Error(
        "AUTO-PUBLISH: media_publish respondeu com contrato inesperado. NAO REPETIR automaticamente."
      );

    error.autoPublishStage =
      "instagram_publish";

    error.doNotRetry =
      true;

    error.data =
      published;

    throw error;
  }

  console.log(
    "WIRE/GEEK AUTO-PUBLISH: Reel publicado automaticamente",
    {
      publication_id:
        publicationId,

      publication_group_id:
        publicationGroupId,

      parent_container_id:
        parentContainerId,

      instagram_post_id:
        postId,

      permalink:
        published
          ?.instagram
          ?.permalink ||
        null,
    }
  );

  return published;
}


function estimateReading(text) {
  const words = String(text||"").trim().split(/\s+/).filter(Boolean);
  return { words: words.length, minutes: Math.max(1,Math.round(words.length/200)) };
}

// Remove travessões de todos os campos
function removeDashes(str) {
  return cleanBriefingText(str);
}


// --- BANNER PROMPT ---

function normalizeNewsItem(item={}) {
  return {
    id:             item.id,
    categoria:      String(item.categoria||"geek").toLowerCase(),
    titulo:         removeDashes(item.titulo||"Sem título").replace(/\bfuncionarios\b/gi, word =>
      word === word.toUpperCase() ? "FUNCIONÁRIOS" :
      word[0] === "F" ? "Funcionários" : "funcionários"
    ),
    titulo_curto: removeDashes(
      item.titulo_curto ||
      item.short_title ||
      ""
    ),
    manchete_curta: removeDashes(item.manchete_curta || ""),
    publicado_em:   item.publicado_em||"",
    materia:        removeDashes(item.materia||""),
    resumo:         removeDashes(item.resumo||""),
    por_que_importa: removeDashes(item.por_que_importa||""),
    highlights:     Array.isArray(item.highlights)?item.highlights.map(removeDashes):[],
    hashtags:       Array.isArray(item.hashtags)
      ? item.hashtags
          .filter((tag) => typeof tag === "string")
          .map((tag) => tag.trim().toLowerCase())
          .filter(Boolean)
      : [],
    fontes:         Array.isArray(item.fontes)?item.fontes.slice(0,3):[],
    contexto_visual: removeDashes(item.contexto_visual||""),
    image_query:    item.image_query||item.titulo||"",
    image_url:      item.image_url||item.imageUrl||item.imagem||"",
    url:            item.url||"",
    imagens:        Array.isArray(item.imagens)?item.imagens:[],
    banners:        Array.isArray(item.banners)?item.banners.slice(0,2):[],
    final_banners:  Array.isArray(item.final_banners)?item.final_banners.slice(0,3):[],
    briefing_generated_banners: Array.isArray(item.briefing_generated_banners)
      ? item.briefing_generated_banners.slice(0,3)
      : [],
    briefing_source: item.briefing_source === true,
  };
}
function validateEdition(news) {
  if (!Array.isArray(news) || news.length < 1 || news.length > 12)
    return "A edição deve conter entre 1 e 12 notícias.";

  for (const item of news) {
    if (!item.titulo || !item.materia)
      return "Notícia sem título ou matéria.";

    if (item.highlights.length !== HIGHLIGHT_COUNT)
      return `"${item.titulo}" precisa de ${HIGHLIGHT_COUNT} destaques.`;

    if (item.hashtags.length !== HASHTAG_COUNT)
      return `"${item.titulo}" precisa de ${HASHTAG_COUNT} hashtags.`;
  }

  return null;
}

const BRIEFING_ONLY_LOCAL =
  import.meta.env.DEV;

const BRIEFING_LAB_ANIME = {
  categoria: "anime",

  titulo:
    "Chitose Is in the Ramune Bottle Cour 2 ganha novo trailer, músicas e estreia em 13 de outubro",

  contexto_visual:
    "Mostrar Saku Chitose e o elenco de Chitose Is in the Ramune Bottle. Priorizar material oficial da adaptação. Evitar personagens de outros romances escolares, fanart, imagens genéricas e close-ups extremos.",

  image_query:
    "Chitose Is in the Ramune Bottle Cour 2 Saku Chitose official key visual October 2026",

  fontes: [
    {
      nome: "Anime Corner",
      url:
        "https://animecorner.me/chitose-is-in-the-ramune-bottle-part-2-trailer-and-october-13-premiere-revealed-sora-amamiya-joins-cast/",
    },
  ],

  imagens: [],

  banners: [
    {
      type: "editorial",

      banner_title:
        "CHITOSE VOLTA EM 13 DE OUTUBRO",

      highlight:
        "Chitose Is in the Ramune Bottle retorna em 13 de outubro, com novo trailer, Sora Amamiya e duas músicas inéditas",

      visual_subject:
        "Chitose Is in the Ramune Bottle Cour 2, Saku Chitose e elenco principal",

      contexto_visual:
        "Mostrar Saku Chitose ou o elenco principal da adaptação oficial. Priorizar key visual ou material promocional do novo cour.",

      image_query:
        "Chitose Is in the Ramune Bottle Cour 2 Saku Chitose official key visual October 2026",
    },

    {
      type: "editorial",

      banner_title:
        "CIDER GIRL ABRE O NOVO COUR",

      highlight:
        "Cider Girl canta a nova abertura, enquanto aruma assume o encerramento da segunda parte produzida novamente pelo estúdio feel.",

      visual_subject:
        "Chitose Is in the Ramune Bottle Cour 2, novo cour e personagens mostrados no trailer",

      contexto_visual:
        "Usar uma segunda imagem oficial diferente do primeiro banner, ligada ao novo cour, trailer ou personagens da adaptação. Evitar close-up extremo.",

      image_query:
        "Chitose Is in the Ramune Bottle Cour 2 official trailer still new cour 2026",
    },
  ],
};

const BRIEFING_LAB_GAMES = {
  categoria: "games",

  titulo:
    "Onimusha: Way of the Sword alcança um milhão de unidades vendidas",

  contexto_visual:
    "Mostrar Onimusha: Way of the Sword usando material oficial do jogo. Priorizar Musashi, combate, gameplay ou key art oficial. Evitar jogos de outras franquias da Capcom, fanart, thumbnails de terceiros e imagens genéricas de samurais.",

  image_query:
    "Onimusha Way of the Sword Musashi official gameplay screenshot key art",

  fontes: [],

  imagens: [],

  banners: [
    {
      type: "editorial",

      banner_title:
        "ONIMUSHA CHEGA A 1 MILHÃO",

      highlight:
        "Onimusha: Way of the Sword alcançou um milhão de unidades vendidas e reforçou o retorno da clássica franquia da Capcom.",

      visual_subject:
        "Onimusha Way of the Sword, Musashi e combate",

      contexto_visual:
        "Mostrar Musashi ou uma cena clara de combate de Onimusha: Way of the Sword. Priorizar imagem oficial, gameplay ou key art reconhecível.",

      image_query:
        "Onimusha Way of the Sword Musashi official gameplay screenshot",
    },

    {
      type: "editorial",

      banner_title:
        "A FRANQUIA VOLTOU COM FORÇA",

      highlight:
        "O novo Onimusha marcou o retorno de um título inédito da série após duas décadas e encontrou forte resposta do público.",

      visual_subject:
        "Onimusha Way of the Sword, cenário, inimigos e ação",

      contexto_visual:
        "Usar uma segunda imagem oficial diferente do primeiro banner. Priorizar gameplay, inimigo, cenário ou outra composição que represente o jogo sem repetir o mesmo enquadramento.",

      image_query:
        "Onimusha Way of the Sword official gameplay enemy environment screenshot",
    },
  ],
};

function CopyButton({ text, label = "Copiar" }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await copyToClipboard(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error("WIRE/GEEK: erro ao copiar", error);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="wg-button wg-button-secondary wg-button-compact font-mono"
    >
      <Copy size={11} />
      {copied ? "Copiado" : label}
    </button>
  );
}

function Stamp({ children }) {
  return (
    <span className="wg-badge font-mono text-[9px] uppercase tracking-[0.16em]">
      {children}
    </span>
  );
}

function FormattedArticle({ text }) {
  return (
    <div className="max-w-4xl space-y-4 text-[16px] leading-8 text-wg-secondary" style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}>
      {String(text || "")
        .split(/\n+/)
        .filter(Boolean)
        .map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
    </div>
  );
}

const BRIEFING_LAB_CINEMA = {
  categoria: "cinema",

  titulo:
    "Superman ganha novo material oficial com foco no herói e em Metrópolis",

  contexto_visual:
    "Mostrar Superman usando material oficial do filme. Priorizar o herói uniformizado, Metrópolis, cenas de ação ou stills oficiais. Evitar adaptações antigas, fanart, cosplay, quadrinhos e imagens de outros atores ou versões do personagem.",

  image_query:
    "Superman movie official still Metropolis Superman David Corenswet",

  fontes: [],

  imagens: [],

  banners: [
    {
      type: "editorial",

      banner_title:
        "SUPERMAN VOLTA AOS CÉUS",

      highlight:
        "O novo filme coloca Superman novamente no centro da ação com uma abordagem visual focada no herói e em Metrópolis.",

      visual_subject:
        "Superman do novo filme, uniforme e Metrópolis",

      contexto_visual:
        "Mostrar Superman claramente reconhecível no novo filme. Priorizar still oficial ou material promocional cinematográfico com boa leitura do personagem.",

      image_query:
        "Superman movie David Corenswet official still flying Metropolis",
    },

    {
      type: "editorial",

      banner_title:
        "METRÓPOLIS ENTRA EM CENA",

      highlight:
        "O material promocional também destaca a escala da cidade e reforça o contraste entre o cotidiano de Clark Kent e a ação de Superman.",

      visual_subject:
        "Superman, Metrópolis e cenas do novo filme",

      contexto_visual:
        "Usar uma segunda imagem oficial diferente do primeiro banner. Priorizar Metrópolis, ação, Lois Lane, Clark Kent ou composição ampla ligada ao filme.",

      image_query:
        "Superman movie official still Metropolis Clark Kent Lois Lane",
    },
  ],
};

const BRIEFING_LAB_GEEK = {
  categoria: "geek",

  titulo:
    "Star Wars e Marvel se encontram em crossover histórico nos quadrinhos",

  contexto_visual:
    "Mostrar material oficial de Star Wars/Marvel: Hope Assembles. Priorizar arte promocional, capa oficial ou personagens de Star Wars e Marvel juntos. Evitar fanart, cosplay, brinquedos, montagens de terceiros e imagens genéricas de Star Wars.",

  image_query:
    "Star Wars Marvel Hope Assembles official cover David Marquez Kevin Smith",

  fontes: [],

  imagens: [],

  banners: [
    {
      type: "editorial",

      banner_title:
        "STAR WARS ENCONTRA A MARVEL",

      highlight:
        "Lucasfilm e Marvel unem oficialmente seus universos em Hope Assembles, minissérie escrita por Kevin Smith com arte de David Marquez.",

      visual_subject:
        "Star Wars Marvel Hope Assembles, Luke Skywalker, Leia, Han Solo e heróis Marvel",

      contexto_visual:
        "Usar arte oficial de Hope Assembles que deixe evidente o crossover entre Star Wars e Marvel. Priorizar capa ou arte promocional oficial com personagens reconhecíveis.",

      image_query:
        "Star Wars Marvel Hope Assembles official cover Luke Leia Avengers David Marquez",
    },

    {
      type: "editorial",

      banner_title:
        "DUAS GALÁXIAS NO MESMO QUADRINHO",

      highlight:
        "Luke, Leia e Han Solo cruzam o caminho de heróis da Marvel na primeira colaboração narrativa oficial entre os dois universos.",

      visual_subject:
        "Star Wars Marvel Hope Assembles, personagens dos dois universos",

      contexto_visual:
        "Usar uma segunda arte oficial diferente do primeiro banner. Priorizar outra capa, composição ou grupo de personagens que mostre claramente Star Wars e Marvel juntos.",

      image_query:
        "Star Wars Marvel Hope Assembles official comic art Avengers Spider-Man Luke Skywalker",
    },
  ],
};

function BriefingLab() {
  const [inputMode, setInputMode] = useState("real");
  const [payloadText, setPayloadText] = useState("");
  const [realItem, setRealItem] = useState(null);
  const [inputError, setInputError] = useState("");
  const [loadVersion, setLoadVersion] = useState(0);

  function loadRealItem(event) {
    event.preventDefault();
    try {
      const nextItem = parseBriefingRealInput(payloadText);
      setRealItem(nextItem);
      setLoadVersion(version => version + 1);
      setInputError("");
    } catch (error) {
      setRealItem(null);
      setInputError(error.message);
    }
  }

  const [fixtureKey, setFixtureKey] =
    useState("anime");

  const fixtures = {
    anime: BRIEFING_LAB_ANIME,
    games: BRIEFING_LAB_GAMES,
    cinema: BRIEFING_LAB_CINEMA,
    geek: BRIEFING_LAB_GEEK,
  };

  const fixture =
    inputMode === "real"
      ? realItem
      : fixtures[fixtureKey] || BRIEFING_LAB_ANIME;

  const options = [
    {
      id: "anime",
      label: "ANIME · CHITOSE",
    },
    {
      id: "games",
      label: "GAMES · ONIMUSHA",
    },
    {
      id: "cinema",
      label: "CINEMA · SUPERMAN",
    },
    {
      id: "geek",
      label: "GEEK · STAR WARS",
    },
  ];

  return (
    <section className="mb-8 border border-wg-success/40 bg-wg-inset p-4 sm:p-5">

      <div className="mb-5 border-b border-wg-border pb-4">

        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-wg-success">
          BRIEFING LAB
        </div>

        <label className="mt-4 block text-sm text-wg-secondary">
          Origem do teste
          <select value={inputMode} onChange={event => setInputMode(event.target.value)} className="ml-3 rounded border border-wg-border bg-wg-surface p-2 text-white">
            <option value="real">Item real do Briefing Geek 2h</option>
            <option value="fixtures">Regressão · 4 fixtures aprovadas</option>
          </select>
        </label>

        {inputMode === "real" && (
          <form onSubmit={loadRealItem} className="mt-4 space-y-3">
            <label htmlFor="briefing-real-json" className="block text-sm text-wg-secondary">JSON de um único item do Briefing</label>
            <p id="briefing-real-help" className="text-sm text-wg-muted">
              Informe categoria, titulo, titulo_curto, highlights, fontes, contexto_visual e image_query.
              Os dois editoriais serão derivados de titulo_curto + highlights. imagens pode estar vazia ou ausente para busca automática. O CTA será acrescentado na geração.
            </p>
            <textarea id="briefing-real-json" aria-describedby="briefing-real-help" value={payloadText} onChange={event => setPayloadText(event.target.value)} rows={12} spellCheck={false} className="w-full rounded border border-wg-border bg-wg-surface p-3 font-mono text-xs text-white" />
            <button type="submit" disabled={!payloadText.trim()} className="wg-button wg-button-primary">Carregar item e gerar banners</button>
            {inputError && <p role="alert" className="text-sm text-red-400">{inputError}</p>}
            {realItem && <p role="status" className="text-sm text-wg-muted">Item carregado abaixo. Alterações no JSON só serão aplicadas ao carregar novamente.</p>}
          </form>
        )}

        {inputMode === "fixtures" && <div className="mt-4 grid gap-2 sm:grid-cols-2">

          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() =>
                setFixtureKey(
                  option.id
                )
              }
              className={`rounded-lg border px-3 py-2 font-mono text-[10px] font-bold tracking-wider transition ${
                fixtureKey === option.id
                  ? "border-wg-success bg-wg-success/10 text-wg-success"
                  : "border-wg-border text-wg-muted"
              }`}
            >
              {option.label}
            </button>
          ))}

        </div>}

        <h2 className="mt-4 text-xl font-black leading-tight text-wg-text">
          {fixture?.titulo || "Nenhum item real carregado"}
        </h2>

        <div className="mt-2 flex items-center gap-2">
          <span className="rounded border border-wg-border-strong bg-wg-raised px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-wg-secondary">
            {fixture?.categoria || "BRIEFING"}
          </span>

          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-wg-muted">
            {inputMode === "fixtures" ? "IMAGENS 100% AUTOMÁTICAS" : "TESTE COM ITEM REAL"}
          </span>
        </div>

        <p className="mt-3 text-[15px] leading-7 text-wg-secondary">
          Teste isolado do pipeline Briefing: até 2 banners editoriais + CTA.
        </p>

      </div>

      {fixture && <BriefingBannerSection
        key={inputMode === "real" ? `real-${loadVersion}` : fixtureKey}
        item={fixture}
      />}

    </section>
  );
}

function DispatchCard({
  item,
  index,
  onGenerateBanner,
  generatingBanner,
  bannerError,
}) {
  const [tab, setTab] = useState("materia");

  const [
    manualBannerImages,
    setManualBannerImages,
  ] = useState(["", ""]);
  const { words, minutes } = estimateReading(item.materia);
  const catColor = CATEGORY_COLOR[item.categoria] || "#e0452f";

  const hasGeneratedBanners =
    Array.isArray(
      item.briefing_generated_banners
    ) &&
    (item.briefing_generated_banners.length >= 2 &&
      item.briefing_generated_banners.length <= 3);

  const tabs = [
    { id: "materia", label: "Matéria", icon: Newspaper },
    { id: "highlights", label: "Highlights", icon: Zap },
    { id: "hashtags", label: "Hashtags", icon: Hash },
    { id: "publicacao", label: "Publicação", icon: Radio },

  ];

  return (
    <article className="relative overflow-hidden rounded-xl border border-wg-border bg-wg-surface">

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-wg-border bg-wg-raised px-5 py-3">
        <div className="flex flex-wrap items-center gap-3">

          <span className="font-mono text-[10px] text-wg-muted">
            DESPACHO {String(index + 1).padStart(2, "0")}
          </span>

          <span className="font-mono text-[10px] text-wg-border">
            ·
          </span>

          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.12em] text-wg-secondary">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: catColor }}
            />
            {CATEGORY_LABEL[item.categoria] || "PAUTA"}
          </span>

          {item.publicado_em && (
            <>
              <span className="font-mono text-[10px] text-wg-border">
                ·
              </span>

              <span className="font-mono text-[10px] text-wg-muted">
                PUBLICADO{" "}
                {new Date(item.publicado_em).toLocaleDateString("pt-BR")}
                {" · "}
                {new Date(item.publicado_em).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">

          <button
            type="button"
            onClick={() =>
              onGenerateBanner(
                index,
                manualBannerImages
              )
            }
            disabled={generatingBanner}
            className="wg-button wg-button-primary min-w-[142px] font-mono uppercase tracking-[0.08em]"
          >
            <ImageIcon size={12} />

            {generatingBanner
              ? "Gerando..."
              : hasGeneratedBanners
                ? "Regenerar banner"
                : "Gerar banner"}
          </button>
        </div>
      </div>

      <div className="px-5 pb-3 pt-5">
        <h3
          className="max-w-4xl text-2xl font-black leading-[1.15] text-wg-text sm:text-[28px]"
          style={{ fontFamily: "'Archivo Black', sans-serif" }}
        >
          {item.titulo}
        </h3>

        {(item.titulo_curto || item.manchete_curta) && (
          <dl className="mt-3 space-y-2 border-l-2 border-wg-border pl-3">
            {item.titulo_curto && (
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-wider text-wg-muted">
                  Título curto
                </dt>
                <dd className="break-words text-sm font-bold text-wg-text">
                  {item.titulo_curto}
                </dd>
              </div>
            )}
            {item.manchete_curta && (
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-wider text-wg-muted">
                  Manchete curta
                </dt>
                <dd className="break-words text-sm leading-relaxed text-wg-text">
                  {item.manchete_curta}
                </dd>
              </div>
            )}
          </dl>
        )}
      </div>

      <div className="mx-4 mb-4 grid gap-3 md:grid-cols-2">
        {[0, 1].map((manualIndex) => (
          <label
            key={manualIndex}
            className="block rounded-lg border border-wg-border bg-wg-raised p-3"
          >
            <span className="mb-2 block font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-wg-muted">
              {manualIndex === 0
                ? "IMAGEM MANUAL - BANNER 1"
                : "IMAGEM MANUAL - BANNER 2"}
            </span>

            <input
              type="url"
              value={
                manualBannerImages[
                  manualIndex
                ]
              }
              disabled={
                generatingBanner
              }
              onChange={(event) => {
                const value =
                  event.target.value;

                setManualBannerImages(
                  (current) =>
                    current.map(
                      (
                        currentValue,
                        currentIndex
                      ) =>
                        currentIndex ===
                        manualIndex
                          ? value
                          : currentValue
                    )
                );
              }}
              placeholder="https://.../imagem.jpg"
              className="w-full rounded-lg border border-wg-border bg-wg-surface px-3 py-2 text-sm text-wg-text outline-none transition placeholder:text-wg-muted focus:border-wg-accent"
            />

            <span className="mt-2 block text-[10px] leading-5 text-wg-muted">
              Opcional. Vazio mantem a busca automatica.
            </span>
          </label>
        ))}
      </div>

      {bannerError && (
        <div className="mx-4 mb-3 border border-wg-danger/50 bg-wg-danger-soft px-3 py-2.5 text-[11px] leading-5 text-wg-danger">
          {bannerError}
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto border-b border-wg-border px-5">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`wg-tab shrink-0 gap-1.5 font-mono uppercase ${
              tab === id
                ? "wg-tab-active"
                : ""
            }`}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      <div className="p-5 sm:p-6">

        {tab === "materia" && (
          <div>

            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-wg-muted">
                <Clock size={11} />
                {minutes} min · {words} palavras · {item.materia.length} caracteres
              </span>

                         <CopyButton
                text={`${item.titulo}\n\n${item.materia}\n\n${RODAPE_FIXO}`}
                label="Copiar matéria"
              />
            </div>

            <div

              className="mb-4 border-l-2 pl-3"
              style={{ borderColor: catColor }}
            >
              <h5 className="text-[15px] font-black leading-snug text-wg-text">
                {item.titulo}
              </h5>
            </div>

            <FormattedArticle text={item.materia} />

            <div
              className="mt-6 border-t border-wg-border pt-5"
              style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}
            >
              <FormattedArticle text={RODAPE_FIXO} />
            </div>

            {item.fontes.length > 0 && (
              <div className="mt-5 border-t border-wg-border pt-3">

                <span className="mb-2 block font-mono text-[9px] tracking-[0.2em] text-wg-muted">
                  FONTES DA APURAÇÃO
                </span>

                <ul className="space-y-1">
                  {item.fontes.map((source, i) => (
                    <li
                      key={i}
                      className="font-mono text-[10px] text-wg-muted"
                    >
                      {source.url ? (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-wg-accent"
                        >
                          {source.nome || source.url}
                        </a>
                      ) : (
                        source.nome
                      )}

                      {source.publicado_em
                        ? ` · ${source.publicado_em}`
                        : ""}
                    </li>
                  ))}
                </ul>
              </div>

        )}
              </div>
        )}

        {tab === "highlights" && (

  <div className="space-y-4">

    <div className="flex items-center justify-between border-b border-wg-border pb-3">
      <div>
        <Stamp>Destaques editoriais</Stamp>
        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-wg-muted">
          {HIGHLIGHT_COUNT} destaques editoriais • {MIN_HIGHLIGHT_WORDS}–{MAX_HIGHLIGHT_WORDS} palavras cada
        </p>
      </div>

      <CopyButton
        text={item.highlights.join("\n")}
        label="Copiar"
      />
    </div>

    <div className="grid gap-3">

      {item.highlights.map((highlight, i) => (
        <div
          key={i}
          className="wg-panel group relative overflow-hidden px-4 py-4 transition-colors hover:border-wg-border-strong"
        >

          <div className="absolute left-0 top-0 h-full w-1 bg-wg-border-strong" />

          <div className="flex items-start gap-4">

            <div className="flex h-7 w-7 shrink-0 items-center justify-center border border-wg-border-strong bg-wg-inset">
              <span className="font-mono text-[11px] font-bold text-wg-secondary">
                {String(i + 1).padStart(2, "0")}
              </span>
            </div>

            <div className="min-w-0 flex-1">

              <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-wg-muted">
                Destaque {String(i + 1).padStart(2, "0")}
              </div>

              <p className="font-mono text-[13px] font-medium leading-relaxed text-wg-text">
                {highlight}
              </p>

            </div>

          </div>

        </div>
      ))}

    </div>

  </div>
)}

        {tab === "hashtags" && (
          <div>

            <div className="mb-3 flex justify-end">
              <CopyButton
                text={item.hashtags.join(" ")}
                label="Copiar hashtags"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {item.hashtags.map((tag, i) => (
                <span
                  key={i}
                  className="wg-chip font-mono text-[11px]"
                >
                  {tag}
                </span>
              ))}
            </div>

          </div>
        )}



      </div>
      {tab === "publicacao" && (
        <div className="border-t border-wg-border p-4">
          <PublicationPanel item={item} />
        </div>
      )}

    </article>

  );
}

export default function GeekNewsWire() {
  function openArchivedEdition(item) {
    const news = Array.isArray(item?.news)
      ? item.news.map(normalizeNewsItem)
      : [];

    setFollowingLatest(false);
    const next = {
      id: item.id,
      title: item?.titulo || "Edição Wire/Geek",
      generatedAt: item?.criado_em || item?.data_edicao || new Date().toISOString(),
      news,
    };
    let preparedCache = null;
    try {
      preparedCache = readPreparedEdition(localStorage, todayKey());
    } catch { /* Optional visual cache. */ }
    setEdition(current => mergeLatestEdition(current, next, preparedCache));

    setActiveFilter("all");
    setStatus(news.length > 0 ? "done" : "idle");
    setArchiveOpen(false);
  }
  async function loadArchive() {
    if (archiveLoading) return;

    setArchiveLoading(true);
    setArchiveError("");

    try {
      const response = await fetch("/api/edicoes", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data?.error || `Arquivo respondeu com HTTP ${response.status}.`
        );
      }

      setArchive(Array.isArray(data?.edicoes) ? data.edicoes : []);
      setArchiveOpen(true);
    } catch (error) {
      setArchiveError(
        error?.message || "Não foi possível carregar o arquivo de edições."
      );
    } finally {
      setArchiveLoading(false);
    }
  }
  const [authenticated, setAuthenticated] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [adminKey, setAdminKey] = useState("");
  const [authError, setAuthError] = useState("");

  const [status,   setStatus]   = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [archive, setArchive] = useState([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const [briefingImportOpen, setBriefingImportOpen] = useState(false);
  const [briefingText, setBriefingText] = useState("");
  const [briefingImporting, setBriefingImporting] = useState(false);
  const [briefingError, setBriefingError] = useState("");
  const [bannerGeneratingKey, setBannerGeneratingKey] = useState("");
  const [bannerErrors, setBannerErrors] = useState({});
const [edition,  setEdition]  = useState(null);
  const [ticker,   setTicker]   = useState("PREPARANDO TRANSMISSAO");
  const [activeFilter, setActiveFilter] = useState("all");
  const [followingLatest, setFollowingLatest] = useState(true);
  const [latestSnapshot, setLatestSnapshot] = useState({ state: "loading", edition: undefined });
  const syncRef = useRef(null);
  const manualGenerationRef = useRef(false);
  const appliedSnapshotRef = useRef(undefined);
  const syncPaused = status === "loading" || briefingImporting || Boolean(bannerGeneratingKey) || archiveOpen || archiveLoading || briefingImportOpen;
  const syncPausedRef = useRef(syncPaused);
  syncPausedRef.current = syncPaused;

  useEffect(() => {
    if (!authenticated || authChecking) return;
    let storage;
    try { storage = window.localStorage; } catch { /* Optional offline cache. */ }
    const sync = createEditionSync({
      storage,
      visible: () => document.visibilityState !== "hidden",
      onChange: update => setLatestSnapshot(previous => ({ ...previous, fromCache: false, ...update })),
      onUnauthorized: () => {
        setAuthenticated(false);
        setFollowingLatest(true);
        setEdition(null);
        setLatestSnapshot({ state: "loading", edition: undefined });
        appliedSnapshotRef.current = undefined;
        setAuthError("Sua sessão expirou. Entre novamente para consultar as notícias.");
      },
    });
    syncRef.current = sync;
    sync.setPaused(syncPausedRef.current);
    void sync.refresh();
    const refresh = () => { void sync.refresh(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      sync.stop();
      syncRef.current = null;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [authenticated, authChecking]);

  useEffect(() => { syncRef.current?.setPaused(syncPaused); }, [syncPaused]);

  useEffect(() => {
    const received = latestSnapshot.edition;
    if (!authenticated || syncPaused || !followingLatest || received === undefined || appliedSnapshotRef.current === received) return;
    appliedSnapshotRef.current = received;
    const next = received ? { ...received, news: received.news.map(normalizeNewsItem) } : null;
    // Existing banner cache may supply visual preparation only after the saved
    // edition has been identified. It never selects the edition or its text.
    let preparedCache = null;
    if (next) {
      try {
        preparedCache = readPreparedEdition(localStorage, todayKey());
      } catch { /* Optional visual cache. */ }
    }
    setEdition(current => {
      const merged = mergeLatestEdition(current, next, preparedCache);
      return JSON.stringify(current) === JSON.stringify(merged) ? current : merged;
    });
    if (status !== "error") setStatus(next ? "done" : "idle");
    setTicker(next ? `EDIÇÃO CARREGADA · ${next.news.length} DESPACHOS` : "NENHUMA EDIÇÃO DISPONÍVEL");
  }, [authenticated, latestSnapshot, followingLatest, syncPaused, status]);

  function showLatestEdition() {
    appliedSnapshotRef.current = undefined;
    setFollowingLatest(true);
    setActiveFilter("all");
    setBannerErrors({});
    void syncRef.current?.refresh();
  }

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const response = await fetch("/api/auth", {
          method: "GET",
          credentials: "include",
        });

        if (active) {
          const data = await response.json().catch(() => ({}));
          setAuthenticated(response.ok && data.authenticated === true);
        }
      } catch {
        if (active) {
          setAuthenticated(false);
        }
      } finally {
        if (active) {
          setAuthChecking(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  async function login() {
    const normalizedAdminKey =
      adminKey.trim();

    if (!normalizedAdminKey) {
      setAuthError("Informe a chave administrativa.");
      return;
    }

    setAuthError("");
    setAuthChecking(true);

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          key: normalizedAdminKey,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Falha na autenticacao.");
      }

      setAuthenticated(true);
      setAdminKey("");
    } catch (error) {
      setAuthenticated(false);
      setAuthError(error?.message || "Falha na autenticacao.");
    } finally {
      setAuthChecking(false);
    }
  }

  const summary = useMemo(()=>{
    const news=edition?.news||[]; const byCategory={};
    for(const cat of CATEGORY_ORDER) byCategory[cat]=news.filter(n=>n.categoria===cat).length;
    return {total:news.length,byCategory};
  },[edition]);

  const filteredNews = useMemo(()=>{
    if(!edition?.news) return [];
    if(activeFilter==="all") return edition.news;
    return edition.news.filter(n=>n.categoria===activeFilter);
  },[edition,activeFilter]);

  async function generateBannerForNews(
    newsIndex,
    manualImageUrls = []
  ) {
    const currentNews =
      Array.isArray(edition?.news)
        ? edition.news
        : [];

    const currentItem =
      currentNews[newsIndex];

    if (!currentItem) {
      return;
    }

    let item = currentItem;

    const hasManualImageOverride =
      manualImageUrls.some(
        (url) =>
          String(url || "").trim()
      );

    const noticiaId =
      String(
        item?.id || ""
      ).trim();

    const generationKey =
      noticiaId ||
      String(newsIndex);

    if (
      bannerGeneratingKey ===
      generationKey
    ) {
      return;
    }

    if (!noticiaId) {
      setBannerErrors(
        current => ({
          ...current,
          [generationKey]:
            "Esta notícia não possui noticia_id.",
        })
      );

      return;
    }

    setBannerGeneratingKey(
      generationKey
    );

    setBannerErrors(
      current => ({
        ...current,
        [generationKey]: "",
      })
    );

    setBriefingError("");
    setErrorMsg("");

    setTicker(
      `GERANDO 3 SLIDES · NOTÍCIA ${newsIndex + 1}`
    );

    try {
      // O servidor carrega os textos canônicos pelo ID da notícia.
      const briefingPayload =
        applyManualBannerImages(
          buildBriefingClientPayload(
            item
          ),
          manualImageUrls
        );

      console.log(
        "WIRE/GEEK: GERANDO BANNER INDIVIDUAL",
        {
          noticia_id: noticiaId,
          indice: newsIndex,
          titulo: item.titulo,
        }
      );

      const bannerResponse =
        await fetch(
          "/api/banner-briefing",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            credentials:
              "include",

            body:
              JSON.stringify({
                ...briefingPayload,
                noticia_id: noticiaId,
                mode: "briefing",
                manual_image_override:
                  hasManualImageOverride,
              }),
          }
        );

      const bannerData =
        await bannerResponse
          .json()
          .catch(() => ({}));

      if (
        !bannerResponse.ok ||
        !bannerData?.success
      ) {
        throw new Error(
          bannerData?.details ||
          bannerData?.error ||
          `Falha ao gerar banners. HTTP ${bannerResponse.status}.`
        );
      }

      if (
        !Array.isArray(
          bannerData?.banners
        ) ||
        (bannerData.banners.length < 2 || bannerData.banners.length > 3)
      ) {
        throw new Error(
          "A notícia não retornou os 3 slides esperados."
        );
      }

      const editorialSlides =
        bannerData.banners.filter(
          banner =>
            banner?.type ===
            "editorial"
        );

      const ctaSlides =
        bannerData.banners.filter(
          banner =>
            banner?.type ===
            "cta"
        );

      if (
        editorialSlides.length < 1 ||
        editorialSlides.length > 2 ||
        ctaSlides.length !== 1
      ) {
        throw new Error(
          "Composição inválida. Esperado: 1 ou 2 editoriais + 1 CTA."
        );
      }

      const generatedItem = {
        ...item,

        briefing_source: true,

        briefing_generated_banners:
          bannerData.banners,
      };

      const updatedNews =
        [...currentNews];

      updatedNews[newsIndex] =
        generatedItem;

      const updatedEdition = {
        ...edition,
        news: updatedNews,
      };

      setEdition(
        updatedEdition
      );

      setStatus("done");

      try {
        savePreparedEdition(localStorage, updatedEdition, todayKey());
      } catch {}

      setBannerErrors(
        current => ({
          ...current,
          [generationKey]: "",
        })
      );

      setTicker(
        hasManualImageOverride
          ? `BANNERS CORRIGIDOS COM IMAGEM MANUAL - NOTICIA ${newsIndex + 1}`
          : `BANNERS GERADOS - NOTICIA ${newsIndex + 1}`
      );

      console.log(
        "WIRE/GEEK: BANNER INDIVIDUAL CONCLUIDO",
        {
          noticia_id: noticiaId,
          indice: newsIndex,
          slides:
            bannerData.banners.length,
        }
      );

      /*
       * =====================================================
       * AUTO-PUBLISH - PREPARO AUTOMATICO
       * =====================================================
       *
       * So continua quando o backend confirmou:
       *
       * - WIREGEEK_AUTO_PUBLISH ativa;
       * - auto-aprovacao concluida;
       * - um ou dois IDs dos editoriais materializados.
       *
       * media_publish so acontece quando o backend tambem
       * retornar auto_media_publish=true.
       *
       * Sem essa segunda flag, o fluxo para no preflight.
       */

      if (
        !hasManualImageOverride &&
        bannerData
          ?.auto_publish ===
          true &&
        bannerData
          ?.auto_approval
          ?.approved ===
          true
      ) {
        const autoPublicationIds =
          Array.isArray(
            bannerData
              ?.auto_approval
              ?.publication_ids
          )
            ? bannerData
                .auto_approval
                .publication_ids
                .map(Number)
                .filter(
                  value =>
                    Number.isInteger(
                      value
                    ) &&
                    value > 0
                )
            : [];

        if (
          autoPublicationIds.length !==
            editorialSlides.length ||
          new Set(
            autoPublicationIds
          ).size !== editorialSlides.length
        ) {
          throw new Error(
            "AUTO-PUBLISH: auto-aprovacao nao retornou os IDs dos editoriais materializados."
          );
        }

        setTicker(
          `GERANDO MP4 - NOTICIA ${newsIndex + 1}`
        );

        try {
          const prepared =
            await autoPrepareInstagramReel(
              autoPublicationIds[0],

              async assetReadyInfo => {
                const assetRefreshKey =
                  [
                    "asset",

                    assetReadyInfo
                      .publication_group_id,

                    assetReadyInfo
                      .asset_sha256,
                  ]
                    .filter(Boolean)
                    .join(":");

                setEdition(
                  currentEdition => {
                    if (
                      !Array.isArray(
                        currentEdition?.news
                      )
                    ) {
                      return currentEdition;
                    }

                    let changed =
                      false;

                    const syncedNews =
                      currentEdition.news.map(
                        newsItem => {
                          const currentNoticiaId =
                            String(
                              newsItem?.id ||
                              newsItem?.noticia_id ||
                              ""
                            ).trim();

                          if (
                            currentNoticiaId !==
                              noticiaId
                          ) {
                            return newsItem;
                          }

                          const slides =
                            Array.isArray(
                              newsItem
                                ?.briefing_generated_banners
                            )
                              ? newsItem
                                  .briefing_generated_banners
                              : [];

                          if (!slides.length) {
                            return newsItem;
                          }

                          changed =
                            true;

                          return {
                            ...newsItem,

                            briefing_generated_banners:
                              slides.map(
                                (
                                  slide,
                                  slideIndex
                                ) => ({
                                  ...slide,

                                  _publication_refresh_key:
                                    slideIndex === 0
                                      ? assetRefreshKey
                                      : String(
                                          slide
                                            ?._publication_refresh_key ||
                                          ""
                                        ),
                                })
                              ),
                          };
                        }
                      );

                    if (!changed) {
                      return currentEdition;
                    }

                    return {
                      ...currentEdition,

                      news:
                        syncedNews,
                    };
                  }
                );

                console.log(
                  "WIRE/GEEK AUTO-PUBLISH: painel sincronizado apos MP4 automatico",
                  {
                    noticia_id:
                      noticiaId,

                    publication_id:
                      assetReadyInfo
                        .publication_id,

                    publication_group_id:
                      assetReadyInfo
                        .publication_group_id,

                    storage_path:
                      assetReadyInfo
                        .storage_path,

                    sha256_prefix:
                      String(
                        assetReadyInfo
                          .asset_sha256 ||
                        ""
                      ).slice(
                        0,
                        16
                      ),
                  }
                );
              }
            );

          setTicker(
            `REEL PRONTO PARA PUBLICAR - NOTICIA ${newsIndex + 1}`
          );

          console.log(
            "WIRE/GEEK AUTO-PUBLISH: preparo automatico concluido",
            {
              noticia_id:
                noticiaId,

              publication_id:
                prepared
                  .publication_id,

              publication_group_id:
                prepared
                  .publication_group_id,

              parent_container_id:
                prepared
                  .parent_container_id,

              ready_to_publish:
                prepared
                  .ready_to_publish,

              publish_called:
                prepared
                  .publish_called,
            }
          );
          /*
           * =================================================
           * SINCRONIZACAO DO PUBLICATION PANEL
           * =================================================
           *
           * O MP4, container e preflight ja foram concluídos
           * no backend.
           *
           * Alterar uma chave interna dos slides faz o
           * PublicationPanel remontar e reidratar:
           *
           * - MP4 imutavel;
           * - parent container;
           * - status atual do grupo.
           *
           * Nenhuma chamada mutavel adicional e executada.
           */

          const publicationRefreshKey =
            [
              prepared
                .publication_group_id,

              prepared
                .parent_container_id,

              prepared
                .asset_sha256,
            ]
              .filter(Boolean)
              .join(":");

          setEdition(
            currentEdition => {
              if (
                !Array.isArray(
                  currentEdition?.news
                )
              ) {
                return currentEdition;
              }

              let changed =
                false;

              const syncedNews =
                currentEdition.news.map(
                  newsItem => {
                    const currentNoticiaId =
                      String(
                        newsItem?.id ||
                        newsItem?.noticia_id ||
                        ""
                      ).trim();

                    if (
                      currentNoticiaId !==
                        noticiaId
                    ) {
                      return newsItem;
                    }

                    const slides =
                      Array.isArray(
                        newsItem
                          ?.briefing_generated_banners
                      )
                        ? newsItem
                            .briefing_generated_banners
                        : [];

                    if (!slides.length) {
                      return newsItem;
                    }

                    changed =
                      true;

                    return {
                      ...newsItem,

                      briefing_generated_banners:
                        slides.map(
                          (
                            slide,
                            slideIndex
                          ) => ({
                            ...slide,

                            _publication_refresh_key:
                              slideIndex === 0
                                ? publicationRefreshKey
                                : String(
                                    slide
                                      ?._publication_refresh_key ||
                                    ""
                                  ),
                          })
                        ),
                    };
                  }
                );

              if (!changed) {
                return currentEdition;
              }

              return {
                ...currentEdition,
                news:
                  syncedNews,
              };
            }
          );

          console.log(
            "WIRE/GEEK AUTO-PUBLISH: painel de publicacao sincronizado",
            {
              noticia_id:
                noticiaId,

              publication_id:
                prepared
                  .publication_id,

              publication_group_id:
                prepared
                  .publication_group_id,

              parent_container_id:
                prepared
                  .parent_container_id,
            }
          );

          /*
           * =================================================
           * FASE 3 - MEDIA_PUBLISH AUTOMATICO
           * =================================================
           *
           * Segunda feature flag independente.
           *
           * WIREGEEK_AUTO_PUBLISH controla:
           * - auto-aprovacao;
           * - MP4;
           * - container;
           * - preflight.
           *
           * WIREGEEK_AUTO_MEDIA_PUBLISH controla somente
           * a chamada final e irreversivel media_publish.
           */
          if (
            bannerData
              ?.auto_media_publish ===
              true
          ) {
            setTicker(
              `PUBLICANDO REEL - NOTICIA ${newsIndex + 1}`
            );

            const published =
              await autoPublishPreparedInstagramReel(
                prepared
              );

            const publishedPostId =
              String(
                published
                  ?.instagram
                  ?.post_id ||
                ""
              ).trim();

            const publishedRefreshKey =
              [
                prepared
                  .publication_group_id,

                prepared
                  .parent_container_id,

                "published",

                publishedPostId,
              ]
                .filter(Boolean)
                .join(":");

            setEdition(
              currentEdition => {
                if (
                  !Array.isArray(
                    currentEdition?.news
                  )
                ) {
                  return currentEdition;
                }

                let changed =
                  false;

                const syncedNews =
                  currentEdition.news.map(
                    newsItem => {
                      const currentNoticiaId =
                        String(
                          newsItem?.id ||
                          newsItem?.noticia_id ||
                          ""
                        ).trim();

                      if (
                        currentNoticiaId !==
                          noticiaId
                      ) {
                        return newsItem;
                      }

                      const slides =
                        Array.isArray(
                          newsItem
                            ?.briefing_generated_banners
                        )
                          ? newsItem
                              .briefing_generated_banners
                          : [];

                      if (!slides.length) {
                        return newsItem;
                      }

                      changed =
                        true;

                      return {
                        ...newsItem,

                        briefing_generated_banners:
                          slides.map(
                            (
                              slide,
                              slideIndex
                            ) => ({
                              ...slide,

                              _publication_refresh_key:
                                slideIndex === 0
                                  ? publishedRefreshKey
                                  : String(
                                      slide
                                        ?._publication_refresh_key ||
                                      ""
                                    ),
                            })
                          ),
                      };
                    }
                  );

                if (!changed) {
                  return currentEdition;
                }

                return {
                  ...currentEdition,
                  news:
                    syncedNews,
                };
              }
            );

            setTicker(
              `REEL PUBLICADO - NOTICIA ${newsIndex + 1}`
            );

            console.log(
              "WIRE/GEEK AUTO-PUBLISH: publicacao automatica concluida",
              {
                noticia_id:
                  noticiaId,

                publication_id:
                  prepared
                    .publication_id,

                publication_group_id:
                  prepared
                    .publication_group_id,

                parent_container_id:
                  prepared
                    .parent_container_id,

                instagram_post_id:
                  publishedPostId,
              }
            );
          }
        }
        catch (
          autoPrepareError
        ) {
          /*
           * Os banners permanecem gerados e aprovados.
           *
           * Asset/container existentes tambem sao preservados.
           *
           * Nenhuma operacao mutavel e repetida
           * automaticamente.
           */

          console.error(
            "WIRE/GEEK AUTO-PUBLISH: preparo automatico interrompido",
            {
              noticia_id:
                noticiaId,

              erro:
                autoPrepareError
                  ?.message ||
                "Falha desconhecida.",
            }
          );

          setBannerErrors(
            current => ({
              ...current,

              [generationKey]:
                autoPrepareError
                  ?.autoPublishStage ===
                  "instagram_publish"
                  ? (
                      "A publicacao automatica do Reel foi interrompida depois de iniciar a etapa de publicacao. NAO REPETIR automaticamente. Verifique o Instagram e o status salvo antes de qualquer nova tentativa: " +
                      (
                        autoPrepareError
                          ?.message ||
                        "resultado desconhecido"
                      )
                    )
                  : (
                      "Banners gerados e aprovados, mas a preparacao automatica do Reel foi interrompida: " +
                      (
                        autoPrepareError
                          ?.message ||
                        "falha desconhecida"
                      )
                    ),
            })
          );

          setTicker(
            autoPrepareError
              ?.autoPublishStage ===
              "instagram_publish"
              ? `PUBLICACAO EXIGE VERIFICACAO MANUAL - NOTICIA ${newsIndex + 1}`
              : `BANNERS APROVADOS - REEL EXIGE ATENCAO - NOTICIA ${newsIndex + 1}`
          );
        }
      }
    }
    catch (error) {
      console.error(
        "WIRE/GEEK: falha no banner individual:",
        {
          noticia_id: noticiaId,
          indice: newsIndex,
          titulo: item.titulo,
          erro:
            error?.message ||
            "Falha desconhecida.",
        }
      );

      setBannerErrors(
        current => ({
          ...current,
          [generationKey]:
            error?.message ||
            "Não foi possível gerar os banners desta notícia.",
        })
      );

      setTicker(
        `FALHA NO BANNER · NOTÍCIA ${newsIndex + 1}`
      );
    }
    finally {
      setBannerGeneratingKey(
        current =>
          current === generationKey
            ? ""
            : current
      );
    }
  }
  async function generateNews() {
    if (manualGenerationRef.current || syncPaused) return;
    manualGenerationRef.current = true;
    syncRef.current?.setPaused(true);
    setStatus("loading");
    setErrorMsg("");
    setTicker("APURANDO NOTÍCIAS · AGUARDE A CONCLUSÃO");
    try {
      const response = await fetch("/api/briefing-executor", {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        setAuthenticated(false);
        setAuthError("Sua sessão expirou. Entre novamente para gerar notícias.");
      }
      if (!response.ok || data.success !== true) {
        throw new Error(data.details || data.error || `Apuração respondeu com HTTP ${response.status}.`);
      }
      if (data.researchPackage?.format !== "wiregeek-codex-research-v1") {
        throw new Error("A apuração não retornou um pacote Codex válido.");
      }
      const downloadUrl = URL.createObjectURL(new Blob([
        JSON.stringify(data.researchPackage, null, 2),
      ], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = "wiregeek-codex-research.json";
      link.click();
      URL.revokeObjectURL(downloadUrl);
      setBriefingImportOpen(true);
      setStatus("done");
      setTicker("PESQUISA EXPORTADA · REDIJA NO CODEX E IMPORTE O JSON CANÔNICO");
      syncRef.current?.setPaused(false);
    } catch (error) {
      setStatus("error");
      setErrorMsg(error?.message || "Não foi possível apurar as notícias.");
      setTicker("FALHA NA APURAÇÃO DE NOTÍCIAS");
    } finally {
      manualGenerationRef.current = false;
    }
  }

async function importBriefing() {
    if (briefingImporting) return;

    const payload = briefingText.trim();

    if (!payload) {
      setBriefingError(
        "Cole o JSON canônico do Briefing Geek 2h."
      );
      return;
    }

    let canonicalBriefing;

    try {
      canonicalBriefing = JSON.parse(payload);
    } catch {
      setBriefingError(
        "O Briefing Geek 2h deve ser um JSON válido."
      );
      return;
    }

    if (
      !canonicalBriefing ||
      typeof canonicalBriefing !== "object" ||
      Array.isArray(canonicalBriefing) ||
      !Array.isArray(canonicalBriefing.news) ||
      canonicalBriefing.news.length < 1
    ) {
      setBriefingError(
        "O JSON canônico deve possuir o array news com pelo menos uma notícia."
      );
      return;
    }

    setBriefingImporting(true);
    appliedSnapshotRef.current =
      latestSnapshot.edition;
    setFollowingLatest(true);
    setBriefingError("");
    setErrorMsg("");

    setTicker(
      "IMPORTANDO BRIEFING GEEK 2H"
    );

    try {
      const response = await fetch(
        "/api/briefing-import",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          credentials: "include",
          body: JSON.stringify(
            canonicalBriefing
          ),
        }
      );

      const data = await response
        .json()
        .catch(() => ({}));

      if (
        !response.ok ||
        !data?.success ||
        !data?.edition ||
        !Array.isArray(data.edition.news)
      ) {
        throw new Error(
          data?.details ||
          data?.error ||
          `Importação respondeu com HTTP ${response.status}.`
        );
      }

      const news =
        data.edition.news.map(
          normalizeNewsItem
        );

      if (!news.length) {
        throw new Error(
          "O importador não retornou notícias persistidas."
        );
      }

      const validationError =
        validateEdition(news);

      if (validationError) {
        throw new Error(validationError);
      }

      const newEdition = {
        ...data.edition,
        news,
      };

      setEdition(newEdition);
      setStatus("done");

      setTicker(
        `BRIEFING IMPORTADO · ${news.length} DESPACHOS · BANNERS SOB DEMANDA`
      );

      setActiveFilter("all");
      setBriefingImportOpen(false);
      setBriefingText("");

      try {
        localStorage.setItem(
          todayKey(),
          JSON.stringify(newEdition)
        );
      } catch {}

      console.log(
        "WIRE/GEEK: BRIEFING GEEK 2H IMPORTADO",
        {
          recebidas:
            canonicalBriefing.news.length,
          persistidas:
            news.length,
          deduplicacao:
            data.deduplication || null,
        }
      );
    } catch (error) {
      console.error(
        "WIRE/GEEK: falha ao importar Briefing Geek 2h:",
        error
      );

      setBriefingError(
        error?.message ||
        "Não foi possível importar o Briefing Geek 2h."
      );

      setTicker(
        "FALHA NA IMPORTAÇÃO DO BRIEFING"
      );
    } finally {
      setBriefingImporting(false);
    }
  }
  if (authChecking) {
    return (
      <div className="min-h-screen bg-wg-bg text-wg-secondary flex items-center justify-center p-6"
        style={{ fontFamily: "\x27IBM Plex Mono\x27, monospace" }}>
        <div className="w-full max-w-md border border-wg-border-strong bg-wg-surface p-6 text-center">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.25em] text-wg-accent">
            WIRE/GEEK
          </div>
          <div className="font-mono text-sm text-wg-muted">
            VERIFICANDO SESSAO...
          </div>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-wg-bg text-wg-secondary flex items-center justify-center p-6"
        style={{ fontFamily: "\x27IBM Plex Mono\x27, monospace" }}>
        <div className="w-full max-w-md border border-wg-border-strong bg-wg-surface p-6">
          <div className="mb-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-wg-accent">
              ACESSO ADMINISTRATIVO
            </div>
            <h1 className="mt-2 text-2xl font-black text-wg-text"
              style={{ fontFamily: "\x27Archivo Black\x27, sans-serif" }}>
              WIRE/GEEK
            </h1>
            <p className="mt-2 text-xs leading-5 text-wg-muted">
              Informe a chave administrativa para acessar o painel de apuracao.
            </p>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              login();
            }}
            className="space-y-4"
          >
            <div>
              <label className="mb-2 block font-mono text-[10px] uppercase tracking-wider text-wg-muted">
                Chave administrativa
              </label>
              <input
                type="password"
                value={adminKey}
                onChange={(event) => setAdminKey(event.target.value)}
                autoComplete="new-password"
                autoCapitalize="none"
                spellCheck={false}
                name="wiregeek-admin-key"
                autoFocus
                className="wg-field font-mono"
                placeholder="Digite a chave de acesso"
              />
            </div>

            {authError && (
              <div className="flex gap-2 border border-wg-danger/40 bg-wg-danger-soft p-3 text-xs text-wg-danger">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={authChecking}
              className="wg-button wg-button-primary w-full font-mono uppercase tracking-wider"
            >
              {authChecking ? "Autenticando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-wg-bg text-wg-secondary" style={{fontFamily:"system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"}}>
      <link rel="preconnect" href="https://fonts.googleapis.com"/>
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin=""/>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=IBM+Plex+Mono:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&display=swap');`}</style>

      {/* Ticker */}
      <div className="hidden">
        <div className="flex items-center gap-2 px-4 py-2">
          <Radio size={13} className="shrink-0 text-wg-accent"/>
          <span className="shrink-0 font-mono text-[10px] font-bold tracking-[0.2em] text-wg-accent">AO VIVO</span>
          <span className="text-wg-muted">/</span>
          <span className="truncate font-mono text-[10px] tracking-[0.15em] text-wg-muted">{ticker}</span>
        </div>
      </div>

      {/* Header */}
      <header className="mx-auto max-w-6xl px-6 pb-5 pt-7 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-wg-text sm:text-4xl" style={{fontFamily:"'Archivo Black', sans-serif"}}>
              WIRE<span className="text-wg-accent">/</span>GEEK
            </h1>
            <div className="mt-1 font-mono text-[9px] tracking-[0.25em] text-wg-muted">BAGAÇA STUDIOS · NEWSROOM 3.0</div>
          </div>
          <span className="font-mono text-[10px] tracking-[0.2em] text-wg-muted">GAMES · GEEK · CINEMA · ANIME</span>
        </div>
        <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-wg-muted">
          Central editorial do Briefing Geek 2h, com notícias importadas em contrato canônico e banners sob demanda.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 border border-wg-success/40 px-2 py-1 font-mono text-[10px] tracking-wider text-wg-success">
            <CheckCircle2 size={11}/>BRIEFING GEEK 2H
          </span>
          <span className="inline-flex items-center gap-1.5 border border-wg-border-strong px-2 py-1 font-mono text-[10px] tracking-wider text-wg-muted" title="Cadência configurada no servidor. Ativação pendente na etapa de produção.">
            <Clock size={11}/>IMPORTAÇÃO CANÔNICA
          </span>
          {CATEGORY_ORDER.map(cat=>(
            <span key={cat} className="inline-flex items-center gap-1.5 border border-wg-border px-2 py-1 font-mono text-[10px] tracking-wider text-wg-muted">
              {CATEGORY_LABEL[cat]}
            </span>
          ))}
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-6xl px-6 py-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">

            <button
              type="button"
              onClick={generateNews}
              disabled={syncPaused}
              className="wg-button wg-button-secondary font-mono uppercase tracking-wider"
            >
              <Newspaper size={14}/>
              {status === "loading" ? "Apurando notícias..." : "Apurar / Exportar para Codex"}
            </button>

            <button
              type="button"
              onClick={loadArchive}
              disabled={archiveLoading || status === "loading" || briefingImporting || Boolean(bannerGeneratingKey)}
              className="wg-button wg-button-secondary font-mono uppercase tracking-wider"
            >
              <Archive size={14}/>
              {archiveLoading ? "Carregando..." : "Arquivo de Edições"}
            </button>


            <button
              type="button"
              onClick={() => {
                setBriefingImportOpen(current => !current);
                setBriefingError("");
              }}
              disabled={briefingImporting || status === "loading" || Boolean(bannerGeneratingKey)}
              className="wg-button wg-button-secondary font-mono uppercase tracking-wider"
            >
              <Newspaper size={14}/>
              {briefingImportOpen ? "Fechar Briefing" : "Importar Briefing"}
            </button>


          </div>
          {edition && (
            <div className="text-right">
              <div className="font-mono text-[10px] text-wg-muted">EDIÇÃO EM EXIBIÇÃO</div>
              <div className="font-mono text-[11px] text-wg-muted">{new Date(edition.generatedAt).toLocaleString("pt-BR")}</div>
            </div>
          )}
               </div>

        <div role="status" aria-live="polite" className="wg-status mb-5 text-wg-muted">
          {latestSnapshot.state === "loading" && "Consultando a edição mais recente no servidor…"}
          {latestSnapshot.state === "pending" && "Uma nova rodada está em preparação. Ela aparecerá após ser salva."}
          {latestSnapshot.state === "offline" && (edition
            ? "Não foi possível atualizar. Exibindo a última edição disponível; tentaremos novamente automaticamente."
            : "Não foi possível consultar as edições. Tentaremos novamente automaticamente.")}
          {latestSnapshot.state === "ready" && "Novas rodadas são consultadas automaticamente enquanto esta página está aberta."}
          {!followingLatest && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span>{latestSnapshot.edition && !sameEdition(edition, latestSnapshot.edition)
                ? "Há uma edição mais recente disponível."
                : "Esta edição será mantida durante sua leitura e preparação."}</span>
              <button type="button" onClick={showLatestEdition} disabled={syncPaused}
                className="wg-button wg-button-secondary wg-button-compact font-mono uppercase">
                Ver edição mais recente
              </button>
            </div>
          )}
        </div>

        {briefingImportOpen && (
          <section className="mb-6 border border-wg-border bg-wg-inset">
            <div className="border-b border-wg-border px-4 py-3">
              <div className="font-mono text-[10px] font-bold tracking-[0.2em] text-wg-accent">
                IMPORTAR BRIEFING GEEK 2H
              </div>

              <p className="mt-2 text-[12px] leading-5 text-wg-muted">
                Cole o JSON canônico do Briefing Geek 2h. O Wire/Geek validará o contrato e persistirá somente as notícias novas.
                Nenhuma imagem será buscada durante a importação. Depois, use Gerar banner
                somente nas notícias que realmente serão utilizadas.
              </p>
            </div>

            <div className="space-y-3 p-4">
              <textarea
                value={briefingText}
                onChange={(event) =>
                  setBriefingText(event.target.value)
                }
                disabled={briefingImporting}
                rows={14}
                spellCheck={false}
                placeholder={'{\n  "news": [\n    {\n      "titulo": "...",\n      "titulo_curto": "...",\n      "categoria": "...",\n      "materia": "...\\n\\n...\\n\\n...",\n      "highlights": ["...", "..."],\n      "hashtags": ["#...", "#...", "#...", "#...", "#..."],\n      "fontes": [{"titulo": "...", "url": "..."}],\n      "fonte_oficial_primaria": {"encontrada": true, "titulo": "...", "url": "..."},\n      "image_query": "..."\n    }\n  ]\n}'}
                className="wg-field resize-y font-mono leading-5"
              />

              <div className="border border-wg-border bg-wg-inset px-3 py-3">
                <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-wg-success">
                  GERAÇÃO SOB DEMANDA
                </div>

                <p className="mt-1 text-[11px] leading-5 text-wg-muted">
                  As notícias serão importadas sem consumir buscas de imagem.
                  Use o botão Gerar banner somente nas matérias que serão utilizadas.
                  Cada clique gera 2 banners editoriais + 1 CTA para uma única notícia.
                </p>
              </div>

              {briefingError && (
                <div className="flex items-start gap-2 border border-wg-danger/50 bg-wg-danger-soft px-3 py-2.5 text-[12px] text-wg-danger">
                  <AlertCircle
                    size={15}
                    className="mt-0.5 shrink-0"
                  />
                  <span>{briefingError}</span>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={importBriefing}
                  disabled={
                    briefingImporting ||
                    !briefingText.trim()
                  }
                  className="wg-button wg-button-primary font-mono uppercase tracking-wider"
                >
                  <Newspaper size={14}/>

                  {briefingImporting
                    ? "Importando..."
                    : "Importar briefing"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setBriefingImportOpen(false);
                    setBriefingError("");
                    setBriefingText("");
                  }}
                  disabled={briefingImporting}
                  className="wg-button wg-button-secondary font-mono uppercase tracking-wider"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </section>
        )}
        {archiveOpen && (
          <section className="mb-6 border border-wg-border bg-wg-inset">
            <div className="flex items-center justify-between border-b border-wg-border px-4 py-3">
              <div>
                <div className="font-mono text-[10px] font-bold tracking-[0.2em] text-wg-accent">
                  ARQUIVO DE EDIÇÕES
                </div>
                <div className="mt-1 font-mono text-[10px] text-wg-muted">
                  {archive.length} {archive.length === 1 ? "edição armazenada" : "edições armazenadas"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setArchiveOpen(false)}
                className="wg-button wg-button-secondary wg-button-compact font-mono uppercase tracking-wider"
              >
                Fechar
              </button>
            </div>

            {archiveError && (
              <div className="m-4 border border-wg-danger/50 bg-wg-danger-soft px-3 py-2.5 text-[12px] text-wg-danger">
                {archiveError}
              </div>
            )}

            {!archiveError && archive.length === 0 && (
              <div className="px-4 py-8 text-center font-mono text-[11px] text-wg-muted">
                NENHUMA EDIÇÃO ARQUIVADA
              </div>
            )}

            {archive.length > 0 && (
              <div className="divide-y divide-wg-border">
                {archive.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => openArchivedEdition(item)}
                    onKeyDown={event => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openArchivedEdition(item);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer px-4 py-3 transition-colors hover:bg-wg-raised"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-mono text-[12px] font-bold text-wg-secondary">
                        {item.titulo || "Edição Wire/Geek"}
                      </div>
                      <div className="font-mono text-[9px] uppercase tracking-wider text-wg-muted">
                        {item.status || "sem status"}
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-wg-muted">
                      <span>
                        {item.criado_em
                          ? new Date(item.criado_em).toLocaleString("pt-BR")
                          : item.data_edicao || "Data não informada"}
                      </span>
                      <span>
                        {item.news?.length || 0} notícia{(item.news?.length || 0) === 1 ? "" : "s"}
                      </span>
                    </div>

                    <div className="mt-3 space-y-1.5 border-t border-wg-border pt-3">
                      <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-wg-muted">
                        EDICAO #{item.id}
                      </div>

                      {(item.news || []).slice(0, 3).map((newsItem, newsIndex) => (
                        <div
                          key={newsItem.id || newsItem.noticia_id || newsIndex}
                          className="flex min-w-0 items-center gap-2 font-mono text-[10px]"
                        >
                          <span className="shrink-0 text-wg-muted">
                            #{newsItem.id || newsItem.noticia_id || "—"}
                          </span>

                          <span className="shrink-0 text-wg-border">
                            ·
                          </span>

                          <span className="shrink-0 uppercase text-wg-muted">
                            {CATEGORY_LABEL[newsItem.categoria] || newsItem.categoria || "SEM CATEGORIA"}
                          </span>

                          <span className="shrink-0 text-wg-border">
                            ·
                          </span>

                          <span className="min-w-0 truncate text-wg-secondary">
                            {newsItem.titulo_curto || newsItem.titulo || "Sem titulo"}
                          </span>
                        </div>
                      ))}

                      {(item.news?.length || 0) > 3 && (
                        <div className="font-mono text-[9px] text-wg-muted">
                          +{item.news.length - 3} noticias
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Status grid */}
        {edition && (
          <div className="mb-5 grid grid-cols-4 border border-wg-border bg-wg-inset">
            {CATEGORY_ORDER.map(cat=>{
              const count=summary.byCategory[cat]||0;
              return (
                <div key={cat} className="border-r border-wg-border px-3 py-2 last:border-r-0">
                  <div className="font-mono text-[9px] tracking-[0.2em] text-wg-muted">{cat}</div>
                  <div className={`mt-0.5 font-mono text-[10px] ${count > 0 ? "text-wg-secondary" : "text-wg-muted"}`}>
                    {`${count} notícia${count===1?"":"s"}`}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {status==="error" && (
          <div className="mb-6 flex items-start gap-2 border border-wg-danger/50 bg-wg-danger-soft px-3 py-2.5 text-[13px] text-wg-danger">
            <AlertCircle size={16} className="mt-0.5 shrink-0"/><span>{errorMsg}</span>
          </div>
        )}
        {status==="idle"&&!edition && (
          <div className="border border-dashed border-wg-border-strong px-4 py-12 text-center text-[13px] text-wg-muted">
            <div className="mb-2 font-mono text-[11px] tracking-[0.2em] text-wg-muted">REDAÇÃO EM ESPERA</div>
            {latestSnapshot.state === "ready"
              ? "Nenhuma edição disponível no servidor. As próximas rodadas aparecerão aqui automaticamente."
              : "Aguardando a consulta das edições no servidor."}
          </div>
        )}
        {status==="loading"&&!edition && (
          <div className="animate-pulse border border-dashed border-wg-border-strong px-4 py-12 text-center text-[13px] text-wg-muted">{ticker}...</div>
        )}

        {/* Filtros + cards */}
        {edition && (
          <>
            <div className="mb-4 flex flex-wrap gap-1 border-b border-wg-border pb-4">
              <button type="button" onClick={()=>setActiveFilter("all")}
                className={`border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${activeFilter==="all"?"border-wg-secondary bg-wg-secondary text-wg-bg":"border-wg-border text-wg-muted hover:border-wg-muted hover:text-wg-secondary"}`}>
                Todos ({edition.news.length})
              </button>
              {CATEGORY_ORDER.map(cat=>{
                const count=summary.byCategory[cat]||0,active=activeFilter===cat;
                return (
                  <button key={cat} type="button" onClick={()=>setActiveFilter(cat)}
                    className={`border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${active?"border-wg-secondary bg-wg-secondary text-wg-bg":"border-wg-border text-wg-muted hover:border-wg-muted hover:text-wg-secondary"}`}
                    >
                    {CATEGORY_LABEL[cat]} ({count})
                  </button>
                );
              })}
            </div>
            {BRIEFING_ONLY_LOCAL && (
              <BriefingLab />
            )}

            <div className="space-y-5" onPointerDownCapture={() => setFollowingLatest(false)} onFocusCapture={() => setFollowingLatest(false)}>
              {filteredNews.map((item,index)=>(
                <DispatchCard
                  key={item.id || `${edition.id || edition.generatedAt}-${item.categoria}-${index}`}
                  item={item}
                  index={edition.news.indexOf(item)}
                  onGenerateBanner={generateBannerForNews}
                  generatingBanner={
                    bannerGeneratingKey ===
                    (String(item?.id || "").trim() ||
                      String(edition.news.indexOf(item)))
                  }
                  bannerError={
                    bannerErrors[
                      String(item?.id || "").trim() ||
                      String(edition.news.indexOf(item))
                    ] || ""
                  }
                />
              ))}
            </div>
          </>
        )}
      </main>

      <footer className="mx-auto max-w-3xl border-t border-wg-border px-4 pb-8 pt-4 sm:px-6">
        <div className="flex flex-wrap justify-between gap-2 font-mono text-[9px] text-wg-border-strong">
          <span>WIRE/GEEK 3.0 · BAGAÇA STUDIOS</span>
          <span>EDIÇÕES SALVAS · BANNERS COM IMAGENS REAIS</span>
        </div>
      </footer>
    </div>
  );
}
