import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import {
  buildInstagramReelCaption,
  buildInstagramReelVideo,
  normalizeInstagramHashtags,
  uploadImmutableInstagramReelVideo,
} from "../lib/instagram-reel.mjs";

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

async function createInstagramJpeg(
  supabase,
  sourceUrl,
  publicationGroupId,
  position
) {
  let parsedUrl;

  try {
    parsedUrl = new URL(String(sourceUrl || "").trim());
  } catch {
    throw new Error(
      `URL invalida para o slide ${position} do Instagram.`
    );
  }

  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new Error(
      `O slide ${position} precisa usar uma URL HTTPS publica.`
    );
  }

  const response = await fetch(parsedUrl);

  if (!response.ok) {
    throw new Error(
      `Nao foi possivel baixar o slide ${position}: HTTP ${response.status}.`
    );
  }

  const input = Buffer.from(
    await response.arrayBuffer()
  );

  const jpeg = await sharp(input)
    .flatten({
      background: {
        r: 0,
        g: 0,
        b: 0,
      },
    })
    .jpeg({
      quality: 92,
    })
    .toBuffer();

  const filename =
    `instagram-${publicationGroupId}-slide-${position}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from("wiregeek-banners")
    .upload(filename, jpeg, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(
      `Nao foi possivel salvar o JPEG do slide ${position}: ${uploadError.message}`
    );
  }

  const { data } = supabase.storage
    .from("wiregeek-banners")
    .getPublicUrl(filename);

  const publicUrl = String(
    data?.publicUrl || ""
  ).trim();

  if (!publicUrl) {
    throw new Error(
      `O Storage nao retornou URL publica para o slide ${position}.`
    );
  }

  return publicUrl;
}
function getInstagramConfig() {
  const userId = String(
    process.env.INSTAGRAM_USER_ID || ""
  ).trim();

  const accessToken = String(
    process.env.INSTAGRAM_ACCESS_TOKEN ||
    process.env.META_ACCESS_TOKEN ||
    ""
  ).trim();

  const apiVersion = String(
    process.env.INSTAGRAM_GRAPH_API_VERSION ||
    "v26.0"
  ).trim();

  const baseUrl = String(
    process.env.INSTAGRAM_GRAPH_BASE_URL ||
    "https://graph.instagram.com"
  )
    .trim()
    .replace(/\/+$/, "");

  if (!userId) {
    throw new Error(
      "INSTAGRAM_USER_ID nao configurado."
    );
  }

  if (!accessToken) {
    throw new Error(
      "INSTAGRAM_ACCESS_TOKEN nao configurado."
    );
  }

  return {
    userId,
    accessToken,
    apiVersion,
    baseUrl,
  };
}

async function callInstagramApi(
  config,
  path,
  {
    method = "GET",
    body = null,
  } = {}
) {
  const cleanPath =
    String(path || "")
      .replace(/^\/+/, "");

  const url = new URL(
    `${config.baseUrl}/${config.apiVersion}/${cleanPath}`
  );

  let requestBody;

  if (method === "GET") {
    for (
      const [key, value]
      of Object.entries(body || {})
    ) {
      if (
        value === undefined ||
        value === null ||
        value === ""
      ) {
        continue;
      }

      url.searchParams.set(
        key,
        String(value)
      );
    }
  }
  else {
    const form =
      new URLSearchParams();

    for (
      const [key, value]
      of Object.entries(body || {})
    ) {
      if (
        value === undefined ||
        value === null ||
        value === ""
      ) {
        continue;
      }

      form.set(
        key,
        String(value)
      );
    }

    requestBody = form;
  }

  const response =
    await fetch(
      url,
      {
        method,

        headers: {
          Authorization:
            `Bearer ${config.accessToken}`,

          ...(method !== "GET"
            ? {
                "Content-Type":
                  "application/x-www-form-urlencoded",
              }
            : {}),
        },

        body:
          requestBody,
      }
    );

  const raw =
    await response.text();

  let data = {};

  try {
    data =
      raw
        ? JSON.parse(raw)
        : {};
  }
  catch {
    data = {
      raw,
    };
  }

  if (
    !response.ok ||
    data?.error
  ) {
    const apiMessage =
      data?.error?.message ||
      data?.error?.error_user_msg ||
      `Instagram API respondeu HTTP ${response.status}.`;

    throw new Error(
      `Instagram API: ${apiMessage}`
    );
  }

  return data;
}

async function waitForInstagramContainer(
  config,
  creationId,
  maxAttempts = 37,
  delayMs = 5000
) {
  const normalizedCreationId =
    String(
      creationId ||
      ""
    ).trim();

  if (!normalizedCreationId) {
    throw new Error(
      "creationId ausente ao aguardar container Instagram."
    );
  }

  const safeMaxAttempts =
    Number.isInteger(
      maxAttempts
    ) &&
    maxAttempts > 0
      ? maxAttempts
      : 37;

  const safeDelayMs =
    Number.isFinite(
      delayMs
    ) &&
    delayMs >= 1000
      ? delayMs
      : 5000;

  let lastStatus =
    null;

  for (
    let attempt = 1;
    attempt <= safeMaxAttempts;
    attempt++
  ) {
    const status =
      await callInstagramApi(
        config,
        normalizedCreationId,
        {
          method:
            "GET",

          body: {
            fields:
              "id,status_code,status",
          },
        }
      );

    lastStatus =
      status;

    if (
      status?.status_code ===
      "FINISHED"
    ) {
      return status;
    }

    if (
      status?.status_code ===
        "ERROR" ||
      status?.status_code ===
        "EXPIRED"
    ) {
      throw new Error(
        `O container ${normalizedCreationId} retornou ${status.status_code}: ${status?.status || "sem detalhes"}. ID preservado para auditoria manual; recriacao automatica bloqueada.`
      );
    }

    if (
      status?.status_code ===
      "PUBLISHED"
    ) {
      throw new Error(
        `O container ${normalizedCreationId} ja consta como PUBLISHED. Nenhuma recriacao automatica sera executada.`
      );
    }

    if (
      attempt <
      safeMaxAttempts
    ) {
      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            safeDelayMs
          )
      );
    }
  }

  const waitedSeconds =
    Math.round(
      (
        Math.max(
          0,
          safeMaxAttempts - 1
        ) *
        safeDelayMs
      ) /
      1000
    );

  throw new Error(
    `Timeout aguardando o container ${normalizedCreationId} ficar FINISHED apos aproximadamente ${waitedSeconds}s. Ultimo status: ${lastStatus?.status_code || "desconhecido"} - ${lastStatus?.status || "sem detalhes"}. Container preservado; nao recriar automaticamente.`
  );
}

async function createInstagramCarouselContainers(
  instagramImages,
  caption
) {
  if (
    !Array.isArray(instagramImages) ||
    instagramImages.length !== 3
  ) {
    throw new Error(
      "O Instagram exige exatamente os tres JPEGs preparados para este teste."
    );
  }

  const config =
    getInstagramConfig();

  const childContainers = [];

  for (
    let index = 0;
    index < instagramImages.length;
    index++
  ) {
    const imageUrl =
      String(
        instagramImages[index] ||
        ""
      ).trim();

    if (!imageUrl) {
      throw new Error(
        `A URL JPEG do slide ${index + 1} esta vazia.`
      );
    }

    const parsed =
      new URL(imageUrl);

    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error(
        `O JPEG do slide ${index + 1} precisa usar URL HTTPS publica.`
      );
    }

    const created =
      await callInstagramApi(
        config,
        `${config.userId}/media`,
        {
          method:
            "POST",

          body: {
            image_url:
              imageUrl,

            is_carousel_item:
              "true",
          },
        }
      );

    if (!created?.id) {
      throw new Error(
        `Instagram nao retornou ID para o container filho ${index + 1}.`
      );
    }

    const status =
      await waitForInstagramContainer(
        config,
        created.id
      );

    childContainers.push({
      position:
        index + 1,

      id:
        String(created.id),

      image_url:
        imageUrl,

      status_code:
        status.status_code,
    });
  }

  const children =
    childContainers
      .map((item) => item.id)
      .join(",");

  const parent =
    await callInstagramApi(
      config,
      `${config.userId}/media`,
      {
        method:
          "POST",

        body: {
          media_type:
            "CAROUSEL",

          children,

          caption:
            String(
              caption ||
              ""
            ).trim(),
        },
      }
    );

  if (!parent?.id) {
    throw new Error(
      "Instagram nao retornou o ID do container pai."
    );
  }

  const parentStatus =
    await waitForInstagramContainer(
      config,
      parent.id
    );

  return {
    api_version:
      config.apiVersion,

    graph_base_url:
      config.baseUrl,

    child_containers:
      childContainers,

    parent_container_id:
      String(parent.id),

    parent_status_code:
      parentStatus.status_code,
  };
}


async function resolveApprovedInstagramReelAsset(
  supabase,
  publicationGroupId
) {
  const {
    createHash,
  } =
    await import(
      "node:crypto"
    );

  const groupId =
    String(
      publicationGroupId ||
      ""
    ).trim();

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      groupId
    )
  ) {
    throw new Error(
      "publication_group_id invalido para resolver o MP4 aprovado."
    );
  }

  const folder =
    "instagram-reels";

  const {
    data: files,
    error: listError,
  } =
    await supabase
      .storage
      .from(
        "wiregeek-banners"
      )
      .list(
        folder,
        {
          limit:
            100,

          search:
            groupId + "-",

          sortBy: {
            column:
              "name",

            order:
              "asc",
          },
        }
      );

  if (listError) {
    throw new Error(
      "Nao foi possivel listar os MP4 aprovados: " +
      listError.message
    );
  }

  const filenamePattern =
    new RegExp(
      "^" +
      groupId +
      "-([0-9a-f]{16})\\.mp4$",
      "i"
    );

  const candidates =
    Array.isArray(files)
      ? files.filter(
          (item) =>
            filenamePattern.test(
              String(
                item?.name ||
                ""
              )
            )
        )
      : [];

  if (
    candidates.length !== 1
  ) {
    throw new Error(
      "Esperado exatamente 1 MP4 imutavel para o grupo " +
      groupId +
      "; encontrados: " +
      candidates.length +
      "."
    );
  }

  const filename =
    String(
      candidates[0].name ||
      ""
    ).trim();

  const filenameMatch =
    filename.match(
      filenamePattern
    );

  if (!filenameMatch) {
    throw new Error(
      "Nome do MP4 imutavel invalido."
    );
  }

  const expectedHashPrefix =
    String(
      filenameMatch[1] ||
      ""
    )
      .trim()
      .toLowerCase();

  const storagePath =
    folder +
    "/" +
    filename;

  const {
    data: blob,
    error: downloadError,
  } =
    await supabase
      .storage
      .from(
        "wiregeek-banners"
      )
      .download(
        storagePath
      );

  if (
    downloadError ||
    !blob
  ) {
    throw new Error(
      "Nao foi possivel baixar o MP4 aprovado para validacao: " +
      (
        downloadError?.message ||
        "sem dados"
      )
    );
  }

  const buffer =
    Buffer.from(
      await blob.arrayBuffer()
    );

  if (
    buffer.length === 0
  ) {
    throw new Error(
      "MP4 aprovado esta vazio."
    );
  }

  const sha256 =
    createHash(
      "sha256"
    )
      .update(
        buffer
      )
      .digest(
        "hex"
      )
      .toLowerCase();

  if (
    sha256.slice(
      0,
      16
    ) !==
    expectedHashPrefix
  ) {
    throw new Error(
      "SHA256 real do MP4 nao corresponde ao hash do nome imutavel."
    );
  }

  const {
    data: publicData,
  } =
    supabase
      .storage
      .from(
        "wiregeek-banners"
      )
      .getPublicUrl(
        storagePath
      );

  const videoUrl =
    String(
      publicData?.publicUrl ||
      ""
    ).trim();

  if (
    !videoUrl.startsWith(
      "https://"
    )
  ) {
    throw new Error(
      "URL publica do MP4 aprovado e invalida."
    );
  }

  return {
    storagePath,
    videoUrl,
    sha256,

    bytes:
      buffer.length,
  };
}


async function loadInstagramReelPayload(
  supabase,
  group,
  publicationId,
  publicationGroupId
) {
  if (
    !Array.isArray(group) ||
    group.length !== 2 ||
    group[0]?.carousel_position !== 1 ||
    group[1]?.carousel_position !== 2
  ) {
    throw new Error(
      "O Reel exige exatamente dois editoriais nas posicoes 1 e 2."
    );
  }

  if (
    !group.some(
      (item) =>
        String(item.id) ===
        String(publicationId)
    )
  ) {
    throw new Error(
      "A publicacao selecionada nao pertence ao grupo editorial."
    );
  }

  const noticiaIds = [
    ...new Set(
      group
        .map(
          (item) =>
            Number(
              item?.noticia_id ||
              0
            )
        )
        .filter(
          (value) =>
            Number.isInteger(value) &&
            value > 0
        )
    ),
  ];

  if (
    noticiaIds.length !== 1
  ) {
    throw new Error(
      "Os dois editoriais precisam pertencer a mesma noticia."
    );
  }

  const {
    data: noticia,
    error: noticiaError,
  } =
    await supabase
      .from("noticias")
      .select("id,artigo")
      .eq(
        "id",
        noticiaIds[0]
      )
      .maybeSingle();

  if (
    noticiaError ||
    !String(
      noticia?.artigo ||
      ""
    ).trim()
  ) {
    throw new Error(
      `Nao foi possivel carregar a noticia completa: ${
        noticiaError?.message ||
        "artigo ausente"
      }`
    );
  }

  const hashtagSets =
    group.map(
      (item) =>
        normalizeInstagramHashtags(
          item?.hashtags
        )
    );

  for (
    const hashtags of
    hashtagSets
  ) {
    if (
      hashtags.length !== 5
    ) {
      throw new Error(
        `O Reel exige exatamente 5 hashtags. Encontradas: ${hashtags.length}.`
      );
    }
  }

  if (
    JSON.stringify(
      hashtagSets[0]
    ) !==
    JSON.stringify(
      hashtagSets[1]
    )
  ) {
    throw new Error(
      "Os dois editoriais precisam possuir as mesmas 5 hashtags."
    );
  }

  const captionInfo =
    buildInstagramReelCaption({
      article:
        noticia.artigo,

      hashtags:
        hashtagSets[0],
    });

  const bannerUrls = [
    String(
      group[0]?.banner_url ||
      ""
    ).trim(),

    String(
      group[1]?.banner_url ||
      ""
    ).trim(),

    String(
      group[0]?.cta_url ||
      ""
    ).trim(),
  ];

  if (
    !bannerUrls.every(Boolean)
  ) {
    throw new Error(
      "O Reel exige os dois banners editoriais e o CTA."
    );
  }

  if (
    String(
      group[0]?.cta_url ||
      ""
    ).trim() !==
    String(
      group[1]?.cta_url ||
      ""
    ).trim()
  ) {
    throw new Error(
      "Os dois editoriais precisam usar o mesmo CTA."
    );
  }

  for (
    const value of bannerUrls
  ) {
    let parsed;

    try {
      parsed =
        new URL(value);
    }
    catch {
      throw new Error(
        "URL de frame invalida."
      );
    }

    if (
      parsed.protocol !==
        "https:" ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error(
        "Os frames do Reel precisam usar URLs HTTPS publicas."
      );
    }
  }

  const approvedReel =
    await resolveApprovedInstagramReelAsset(
      supabase,
      publicationGroupId
    );

  const storagePath =
    approvedReel.storagePath;

  const videoUrl =
    approvedReel.videoUrl;

  return {
    noticia,
    bannerUrls,
    captionInfo,
    storagePath,
    videoUrl,
  };
}


async function createInstagramReelContainer({
  videoUrl,
  caption,
}) {
  const config =
    getInstagramConfig();

  const created =
    await callInstagramApi(
      config,
      `${config.userId}/media`,
      {
        method:
          "POST",

        body: {
          media_type:
            "REELS",

          video_url:
            videoUrl,

          caption:
            caption,

          share_to_feed:
            true,
        },
      }
    );

  const id =
    String(
      created?.id ||
      ""
    ).trim();

  if (!id) {
    throw new Error(
      "Instagram nao retornou ID para o container Reel."
    );
  }

  /*
   * IMPORTANTE:
   *
   * Não esperamos FINISHED aqui.
   *
   * O caller recebe o ID imediatamente,
   * persiste no Supabase e somente depois
   * aguarda o processamento.
   *
   * Isso evita criar outro container em caso
   * de timeout depois do POST /media.
   */
  return {
    api_version:
      config.apiVersion,

    graph_base_url:
      config.baseUrl,

    media_type:
      "REELS",

    share_to_feed:
      true,

    reel_container_id:
      id,

    parent_container_id:
      id,

    child_containers:
      [],

    video_url:
      videoUrl,
  };
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
    const wantsInstagramReelAsset =
      req.body?.instagram_reel_asset === true ||
      String(
        req.body?.instagram_reel_asset || ""
      )
        .trim()
        .toLowerCase() === "true";

    const wantsInstagramContainers =
      req.body?.instagram_containers === true ||
      String(
        req.body?.instagram_containers || ""
      )
        .trim()
        .toLowerCase() === "true";
    const wantsInstagramPublishPreflight =
      req.body?.instagram_publish_preflight === true ||
      String(
        req.body?.instagram_publish_preflight || ""
      )
        .trim()
        .toLowerCase() === "true";
    const wantsInstagramPublish =
      req.body?.instagram_publish === true ||
      String(
        req.body?.instagram_publish || ""
      )
        .trim()
        .toLowerCase() === "true";
    const instagramModeCount =
      [
        wantsInstagramReelAsset,
        wantsInstagramContainers,
        wantsInstagramPublishPreflight,
        wantsInstagramPublish,
      ]
        .filter(Boolean)
        .length;

    if (instagramModeCount > 1) {
      return res.status(400).json({
        error:
          "Use somente um modo Instagram por chamada.",

        publish_called:
          false,
      });
    }

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
      .select("id,noticia_id,status,published_at,carousel_position,banner_url,cta_url,caption,hashtags,instagram_parent_container_id,instagram_child_container_ids,instagram_containers_created_at,instagram_status,instagram_post_id,instagram_url,publish_attempts,last_error,idempotency_key")
      .eq("publication_group_id", selected.publication_group_id)
      .order("carousel_position", { ascending: true });

    if (groupError) {
      throw new Error(`Nao foi possivel carregar o carrossel: ${groupError.message}`);
    }
    if (wantsInstagramReelAsset) {
      /*
       * ======================================================
       * INSTAGRAM REEL - MP4 IMUTAVEL
       * ======================================================
       *
       * NAO chama a Meta.
       * NAO cria container.
       * NAO executa media_publish.
       * NAO altera publicacoes no banco.
       */

      if (
        !Array.isArray(group) ||
        group.length !== 2 ||
        !group.some(
          (item) =>
            String(item.id) ===
            String(id)
        ) ||
        group[0].carousel_position !== 1 ||
        group[1].carousel_position !== 2
      ) {
        return res.status(409).json({
          success:
            false,

          mode:
            "instagram_reel_asset",

          publish_called:
            false,

          instagram_api_called:
            false,

          error:
            "O grupo editorial esta incompleto ou inconsistente.",
        });
      }

      if (
        group.some(
          (item) =>
            item.status !==
            "APROVADO"
        )
      ) {
        return res.status(409).json({
          success:
            false,

          mode:
            "instagram_reel_asset",

          publish_called:
            false,

          instagram_api_called:
            false,

          error:
            "Os dois editoriais precisam estar APROVADOS.",
        });
      }

      if (
        group.some(
          (item) =>
            item.published_at !==
              null ||
            String(
              item.instagram_post_id ||
              ""
            ).trim()
        )
      ) {
        return res.status(409).json({
          success:
            false,

          mode:
            "instagram_reel_asset",

          publish_called:
            false,

          instagram_api_called:
            false,

          already_published:
            true,

          error:
            "O grupo ja possui evidencia de publicacao.",
        });
      }

      const parentIds = [
        ...new Set(
          group
            .map(
              (item) =>
                String(
                  item
                    ?.instagram_parent_container_id ||
                  ""
                ).trim()
            )
            .filter(Boolean)
        ),
      ];

      const childIds =
        group.flatMap(
          (item) =>
            Array.isArray(
              item
                ?.instagram_child_container_ids
            )
              ? item
                  .instagram_child_container_ids
                  .map(
                    (value) =>
                      String(
                        value ||
                        ""
                      ).trim()
                  )
                  .filter(Boolean)
              : []
        );

      if (
        parentIds.length !== 0 ||
        childIds.length !== 0
      ) {
        return res.status(409).json({
          success:
            false,

          mode:
            "instagram_reel_asset",

          publish_called:
            false,

          instagram_api_called:
            false,

          error:
            "Ja existem metadados de container Instagram. Novo MP4 bloqueado.",
        });
      }

      const noticiaIds = [
        ...new Set(
          group
            .map(
              (item) =>
                Number(
                  item?.noticia_id ||
                  0
                )
            )
            .filter(
              (value) =>
                Number.isInteger(value) &&
                value > 0
            )
        ),
      ];

      if (
        noticiaIds.length !== 1
      ) {
        return res.status(409).json({
          success:
            false,

          mode:
            "instagram_reel_asset",

          publish_called:
            false,

          instagram_api_called:
            false,

          error:
            "Os dois editoriais precisam pertencer a mesma noticia.",
        });
      }

      const {
        data: noticia,
        error: noticiaError,
      } =
        await supabase
          .from("noticias")
          .select("id,artigo")
          .eq(
            "id",
            noticiaIds[0]
          )
          .maybeSingle();

      if (
        noticiaError ||
        !String(
          noticia?.artigo ||
          ""
        ).trim()
      ) {
        throw new Error(
          `Nao foi possivel carregar a noticia completa: ${
            noticiaError?.message ||
            "artigo ausente"
          }`
        );
      }

      const hashtagSets =
        group.map(
          (item) =>
            normalizeInstagramHashtags(
              item?.hashtags
            )
        );

      for (
        const hashtags of
        hashtagSets
      ) {
        if (
          hashtags.length !== 5
        ) {
          return res.status(409).json({
            success:
              false,

            mode:
              "instagram_reel_asset",

            publish_called:
              false,

            instagram_api_called:
              false,

            error:
              `O Reel exige exatamente 5 hashtags. Encontradas: ${hashtags.length}.`,
          });
        }
      }

      if (
        JSON.stringify(
          hashtagSets[0]
        ) !==
        JSON.stringify(
          hashtagSets[1]
        )
      ) {
        return res.status(409).json({
          success:
            false,

          mode:
            "instagram_reel_asset",

          publish_called:
            false,

          instagram_api_called:
            false,

          error:
            "Os dois editoriais precisam possuir as mesmas 5 hashtags.",
        });
      }

      const captionInfo =
        buildInstagramReelCaption({
          article:
            noticia.artigo,

          hashtags:
            hashtagSets[0],
        });

      const bannerUrls = [
        String(
          group[0]?.banner_url ||
          ""
        ).trim(),

        String(
          group[1]?.banner_url ||
          ""
        ).trim(),

        String(
          group[0]?.cta_url ||
          ""
        ).trim(),
      ];

      if (
        !bannerUrls.every(Boolean) ||
        String(
          group[0]?.cta_url ||
          ""
        ).trim() !==
        String(
          group[1]?.cta_url ||
          ""
        ).trim()
      ) {
        return res.status(409).json({
          success:
            false,

          mode:
            "instagram_reel_asset",

          publish_called:
            false,

          instagram_api_called:
            false,

          error:
            "O Reel exige os dois banners editoriais e o mesmo CTA.",
        });
      }

      for (
        const value of
        bannerUrls
      ) {
        let parsed;

        try {
          parsed =
            new URL(value);
        }
        catch {
          return res.status(409).json({
            success:
              false,

            mode:
              "instagram_reel_asset",

            publish_called:
              false,

            instagram_api_called:
              false,

            error:
              "URL de frame invalida.",
          });
        }

        if (
          parsed.protocol !==
            "https:" ||
          parsed.username ||
          parsed.password
        ) {
          return res.status(409).json({
            success:
              false,

            mode:
              "instagram_reel_asset",

            publish_called:
              false,

            instagram_api_called:
              false,

            error:
              "Os frames precisam usar URLs HTTPS publicas.",
          });
        }
      }

      /*
       * Se o asset imutavel ja existe,
       * somente o validamos e reutilizamos.
       *
       * Isso torna refresh/reabertura idempotente.
       */
      let immutableAsset =
        null;

      let reelVideo =
        null;

      try {
        const existing =
          await resolveApprovedInstagramReelAsset(
            supabase,
            selected.publication_group_id
          );

        immutableAsset = {
          storage_path:
            existing.storagePath,

          video_url:
            existing.videoUrl,

          sha256:
            existing.sha256,

          hash_prefix:
            existing.sha256.slice(
              0,
              16
            ),

          bytes:
            existing.bytes,

          reused:
            true,

          immutable:
            true,
        };
      }
      catch (existingError) {
        const message =
          String(
            existingError?.message ||
            ""
          );

        if (
          !message.includes(
            "encontrados: 0"
          )
        ) {
          throw existingError;
        }
      }

      if (!immutableAsset) {
        reelVideo =
          await buildInstagramReelVideo({
            bannerUrls,
          });

        const uploaded =
          await uploadImmutableInstagramReelVideo({
            supabase,

            publicationGroupId:
              selected.publication_group_id,

            buffer:
              reelVideo.buffer,
          });

        const verified =
          await resolveApprovedInstagramReelAsset(
            supabase,
            selected.publication_group_id
          );

        if (
          verified.sha256 !==
            uploaded.sha256 ||
          verified.storagePath !==
            uploaded.storage_path ||
          verified.videoUrl !==
            uploaded.video_url
        ) {
          throw new Error(
            "O MP4 foi salvo, mas a verificacao imutavel retornou dados divergentes."
          );
        }

        immutableAsset =
          uploaded;
      }

      return res.status(200).json({
        success:
          true,

        mode:
          "instagram_reel_asset",

        publication_type:
          "REEL",

        publish_called:
          false,

        instagram_api_called:
          false,

        publication_group_id:
          selected.publication_group_id,

        publication_ids:
          group.map(
            (item) =>
              item.id
          ),

        asset:
          immutableAsset,

        reel: {
          width:
            reelVideo?.width ||
            1080,

          height:
            reelVideo?.height ||
            1920,

          duration_seconds:
            reelVideo
              ?.duration_seconds ||
            30,

          frame_seconds:
            reelVideo
              ?.frame_seconds ||
            [12, 12, 6],

          frames:
            bannerUrls,
        },

        caption: {
          caption_preview:
            captionInfo
              .caption_preview,

          caption_length:
            captionInfo
              .caption_length,

          hashtags:
            captionInfo
              .hashtags,

          hashtags_count:
            captionInfo
              .hashtags_count,
        },

        next_action:
          "create_instagram_reel_container",
      });
    }


    if (wantsInstagramPublishPreflight) {
      /*
       * ======================================================
       * INSTAGRAM REEL PREFLIGHT
       * ======================================================
       *
       * SOMENTE LEITURA:
       * - nao gera MP4
       * - nao altera Supabase
       * - nao cria container
       * - nao executa media_publish
       */

      if (wantsInstagramContainers) {
        return res.status(400).json({
          error:
            "instagram_publish_preflight e instagram_containers nao podem ser usados juntos.",

          publish_called:
            false,
        });
      }

      if (
        !Array.isArray(group) ||
        group.length !== 2 ||
        !group.some(
          (item) =>
            String(item.id) ===
            String(id)
        ) ||
        group[0].carousel_position !== 1 ||
        group[1].carousel_position !== 2
      ) {
        return res.status(409).json({
          success:
            false,

          mode:
            "instagram_publish_preflight",

          publication_type:
            "REEL",

          ready_to_publish:
            false,

          publish_called:
            false,

          error:
            "O grupo editorial esta incompleto ou inconsistente.",
        });
      }

      if (
        group.some(
          (item) =>
            item.status !==
            "APROVADO"
        )
      ) {
        return res.status(409).json({
          success:
            false,

          mode:
            "instagram_publish_preflight",

          publication_type:
            "REEL",

          ready_to_publish:
            false,

          publish_called:
            false,

          error:
            "Os dois editoriais precisam permanecer APROVADOS.",
        });
      }

      if (
        group.some(
          (item) =>
            item.published_at !==
              null ||
            String(
              item.instagram_post_id ||
              ""
            ).trim()
        )
      ) {
        return res.status(409).json({
          success:
            false,

          mode:
            "instagram_publish_preflight",

          publication_type:
            "REEL",

          ready_to_publish:
            false,

          already_published:
            true,

          publish_called:
            false,

          error:
            "O grupo ja possui evidencia de publicacao.",
        });
      }

      const reelPayload =
        await loadInstagramReelPayload(
          supabase,
          group,
          id,
          selected.publication_group_id
        );

      const parentIds = [
        ...new Set(
          group
            .map(
              (item) =>
                String(
                  item
                    ?.instagram_parent_container_id ||
                  ""
                ).trim()
            )
            .filter(Boolean)
        ),
      ];

      const childVariants = [
        ...new Set(
          group.map(
            (item) =>
              JSON.stringify(
                Array.isArray(
                  item
                    ?.instagram_child_container_ids
                )
                  ? item
                      .instagram_child_container_ids
                      .map(
                        (value) =>
                          String(
                            value ||
                            ""
                          ).trim()
                      )
                      .filter(Boolean)
                  : []
              )
          )
        ),
      ];

      let childIds = [];

      if (
        childVariants.length === 1
      ) {
        try {
          childIds =
            JSON.parse(
              childVariants[0]
            );
        }
        catch {
          childIds = [];
        }
      }

      if (
        parentIds.length !== 1 ||
        childVariants.length !== 1 ||
        !Array.isArray(
          childIds
        ) ||
        childIds.length !== 0
      ) {
        return res.status(409).json({
          success:
            false,

          mode:
            "instagram_publish_preflight",

          publication_type:
            "REEL",

          ready_to_publish:
            false,

          publish_called:
            false,

          error:
            "O container Reel esta ausente ou existem metadados antigos de carrossel.",
        });
      }

      const config =
        getInstagramConfig();

      const parentId =
        parentIds[0];

      const parentStatus =
        await callInstagramApi(
          config,
          parentId,
          {
            method:
              "GET",

            body: {
              fields:
                "id,status_code,status",
            },
          }
        );

      if (
        parentStatus?.status_code !==
        "FINISHED"
      ) {
        return res.status(409).json({
          success:
            false,

          mode:
            "instagram_publish_preflight",

          publication_type:
            "REEL",

          ready_to_publish:
            false,

          publish_called:
            false,

          error:
            "O container Reel nao esta FINISHED.",

          instagram: {
            reel_container_id:
              parentId,

            parent_container_id:
              parentId,

            status_code:
              parentStatus?.status_code ||
              null,

            status:
              parentStatus?.status ||
              null,
          },
        });
      }

      return res.status(200).json({
        success:
          true,

        mode:
          "instagram_publish_preflight",

        publication_type:
          "REEL",

        ready_to_publish:
          true,

        publish_called:
          false,

        publication_group_id:
          selected.publication_group_id,

        publication_ids:
          group.map(
            (item) =>
              item.id
          ),

        instagram: {
          api_version:
            config.apiVersion,

          account_id:
            config.userId,

          media_type:
            "REELS",

          share_to_feed:
            true,

          reel_container_id:
            parentId,

          parent_container_id:
            parentId,

          child_containers:
            [],

          parent_status_code:
            parentStatus.status_code,

          video_url:
            reelPayload.videoUrl,

          persisted:
            true,

          reused:
            true,
        },

        caption: {
          caption_preview:
            reelPayload
              .captionInfo
              .caption_preview,

          caption_length:
            reelPayload
              .captionInfo
              .caption_length,

          hashtags:
            reelPayload
              .captionInfo
              .hashtags,

          hashtags_count:
            reelPayload
              .captionInfo
              .hashtags_count,
        },

        next_action:
          "explicit_publish_confirmation_required",
      });
    }

    if (wantsInstagramPublish) {
      if (
        wantsInstagramContainers ||
        wantsInstagramPublishPreflight
      ) {
        return res.status(400).json({
          error:
            "instagram_publish nao pode ser combinado com outros modos.",
          publish_called:
            false,
        });
      }

      const publishConfirmation =
        String(
          req.body?.publish_confirmation ||
          ""
        ).trim();

      if (
        publishConfirmation !==
        `PUBLICAR_INSTAGRAM_${id}`
      ) {
        return res.status(400).json({
          error:
            "Confirmacao explicita de publicacao invalida.",
          publish_called:
            false,
        });
      }

      const expectedParentId =
        String(
          req.body?.expected_parent_container_id ||
          ""
        ).trim();

      const expectedGroupId =
        String(
          req.body?.expected_publication_group_id ||
          ""
        ).trim();

      const expectedAccountId =
        String(
          req.body?.expected_account_id ||
          ""
        ).trim();

      if (
        !Array.isArray(group) ||
        group.length !== 2 ||
        !group.some(
          (item) =>
            String(item.id) ===
            String(id)
        ) ||
        group[0].carousel_position !== 1 ||
        group[1].carousel_position !== 2
      ) {
        return res.status(409).json({
          error:
            "O grupo do carrossel esta incompleto ou inconsistente.",
          publish_called:
            false,
        });
      }

      if (
        String(
          selected.publication_group_id
        ) !== expectedGroupId
      ) {
        return res.status(409).json({
          error:
            "O publication_group_id nao corresponde ao grupo autorizado.",
          publish_called:
            false,
        });
      }

      if (
        group.some(
          (item) =>
            item.published_at !== null ||
            String(
              item.instagram_post_id ||
              ""
            ).trim()
        )
      ) {
        return res.status(409).json({
          error:
            "O carrossel ja possui evidencia de publicacao.",
          already_published:
            true,
          publish_called:
            false,
        });
      }

      if (
        group.some(
          (item) =>
            item.status !== "APROVADO"
        )
      ) {
        return res.status(409).json({
          error:
            "Os dois editoriais precisam estar APROVADOS.",
          publish_called:
            false,
        });
      }

      const reelPayload =
        await loadInstagramReelPayload(
          supabase,
          group,
          id,
          selected.publication_group_id
        );

      const parentIds = [
        ...new Set(
          group
            .map(
              (item) =>
                String(
                  item?.instagram_parent_container_id ||
                  ""
                ).trim()
            )
            .filter(Boolean)
        ),
      ];

      const childVariants = [
        ...new Set(
          group.map(
            (item) =>
              JSON.stringify(
                Array.isArray(
                  item?.instagram_child_container_ids
                )
                  ? item.instagram_child_container_ids
                      .map(
                        (value) =>
                          String(
                            value || ""
                          ).trim()
                      )
                      .filter(Boolean)
                  : []
              )
          )
        ),
      ];

      let childIds = [];

      if (
        childVariants.length === 1
      ) {
        try {
          childIds =
            JSON.parse(
              childVariants[0]
            );
        }
        catch {
          childIds = [];
        }
      }

      if (
        parentIds.length !== 1 ||
        childVariants.length !== 1 ||
        !Array.isArray(childIds) ||
        childIds.length !== 0
      ) {
        return res.status(409).json({
          error:
            "Os containers persistidos estao incompletos ou inconsistentes.",
          publish_called:
            false,
        });
      }

      const parentId =
        parentIds[0];

      if (
        parentId !== expectedParentId
      ) {
        return res.status(409).json({
          error:
            "O parent container nao corresponde ao parent autorizado.",
          expected:
            expectedParentId,
          received:
            parentId,
          publish_called:
            false,
        });
      }

      const config =
        getInstagramConfig();

      if (
        config.userId !==
        expectedAccountId
      ) {
        return res.status(409).json({
          error:
            "A conta Instagram configurada nao corresponde a conta autorizada.",
          publish_called:
            false,
        });
      }

      /*
       * REEL NAO POSSUI CHILD CONTAINERS.
       */

      /*
       * PREFLIGHT FINAL DO PARENT
       */

      const parentStatus =
        await callInstagramApi(
          config,
          parentId,
          {
            method:
              "GET",

            body: {
              fields:
                "id,status_code,status",
            },
          }
        );

      if (
        parentStatus?.status_code !==
        "FINISHED"
      ) {
        return res.status(409).json({
          error:
            "O parent container nao esta FINISHED.",
          parent_status_code:
            parentStatus?.status_code ||
            null,
          publish_called:
            false,
        });
      }

      /*
       * RESERVA ATOMICA
       */

      const {
        data: reservedGroup,
        error: reserveError,
      } =
        await supabase.rpc(
          "reserve_publication_group",
          {
            p_group_id:
              selected.publication_group_id,
          }
        );

      if (
        reserveError ||
        !Array.isArray(reservedGroup) ||
        reservedGroup.length !== 2
      ) {
        return res.status(409).json({
          error:
            `Nao foi possivel reservar atomicamente o carrossel: ${
              reserveError?.message ||
              "grupo indisponivel"
            }`,
          publish_called:
            false,
        });
      }

      const nextAttempt =
        Math.max(
          0,
          ...group.map(
            (item) =>
              Number(
                item.publish_attempts ||
                0
              )
          )
        ) + 1;

      const idempotencyKey =
        `instagram:${selected.publication_group_id}:${parentId}`;

      /*
       * A idempotency_key possui indice UNIQUE por registro.
       *
       * Como este carrossel possui dois registros em publicacoes,
       * a chave do GRUPO fica somente no registro ancora:
       * carousel_position = 1.
       *
       * O segundo editorial permanece sem idempotency_key.
       */

      const idempotencyAnchor =
        group.find(
          (item) =>
            item.carousel_position === 1
        );

      if (!idempotencyAnchor?.id) {
        await supabase
          .from("publicacoes")
          .update({
            status:
              "APROVADO",

            atualizado_em:
              new Date().toISOString(),
          })
          .eq(
            "publication_group_id",
            selected.publication_group_id
          )
          .eq(
            "status",
            "PUBLICANDO"
          )
          .is(
            "published_at",
            null
          );

        return res.status(500).json({
          error:
            "Nao foi possivel identificar o registro ancora do carrossel.",
          publish_called:
            false,
        });
      }

      const attemptAt =
        new Date().toISOString();

      /*
       * Primeiro reservamos a idempotency_key SOMENTE no anchor.
       *
       * A Meta ainda NAO foi chamada neste ponto.
       */

      const {
        data: idempotencyRows,
        error: idempotencyError,
      } =
        await supabase
          .from("publicacoes")
          .update({
            idempotency_key:
              idempotencyKey,

            atualizado_em:
              attemptAt,
          })
          .eq(
            "id",
            idempotencyAnchor.id
          )
          .eq(
            "publication_group_id",
            selected.publication_group_id
          )
          .eq(
            "status",
            "PUBLICANDO"
          )
          .is(
            "published_at",
            null
          )
          .select(
            "id,idempotency_key"
          );

      if (
        idempotencyError ||
        !Array.isArray(idempotencyRows) ||
        idempotencyRows.length !== 1
      ) {
        await supabase
          .from("publicacoes")
          .update({
            status:
              "APROVADO",

            instagram_status:
              "NAO_SELECIONADO",

            idempotency_key:
              null,

            last_error:
              idempotencyError?.message ||
              "Nao foi possivel reservar a chave de idempotencia.",

            atualizado_em:
              new Date().toISOString(),
          })
          .eq(
            "publication_group_id",
            selected.publication_group_id
          )
          .eq(
            "status",
            "PUBLICANDO"
          )
          .is(
            "published_at",
            null
          );

        return res.status(500).json({
          error:
            "Nao foi possivel reservar a chave de idempotencia.",
          details:
            idempotencyError?.message ||
            "registro ancora indisponivel",
          publish_called:
            false,
        });
      }

      /*
       * Agora marcamos os DOIS registros como PUBLICANDO.
       * Nao repetimos a idempotency_key aqui.
       */

      const {
        data: markedRows,
        error: markError,
      } =
        await supabase
          .from("publicacoes")
          .update({
            instagram_status:
              "PUBLICANDO",

            publish_attempts:
              nextAttempt,

            last_error:
              null,

            atualizado_em:
              attemptAt,
          })
          .eq(
            "publication_group_id",
            selected.publication_group_id
          )
          .eq(
            "status",
            "PUBLICANDO"
          )
          .is(
            "published_at",
            null
          )
          .select("id");

      if (
        markError ||
        !Array.isArray(markedRows) ||
        markedRows.length !== 2
      ) {
        /*
         * Meta ainda NAO foi chamada.
         * Podemos restaurar tudo com seguranca.
         */

        await supabase
          .from("publicacoes")
          .update({
            status:
              "APROVADO",

            instagram_status:
              "NAO_SELECIONADO",

            idempotency_key:
              null,

            publish_attempts:
              Math.max(
                0,
                nextAttempt - 1
              ),

            last_error:
              markError?.message ||
              "Falha preparando a tentativa de publicacao.",

            atualizado_em:
              new Date().toISOString(),
          })
          .eq(
            "publication_group_id",
            selected.publication_group_id
          )
          .eq(
            "status",
            "PUBLICANDO"
          )
          .is(
            "published_at",
            null
          );

        return res.status(500).json({
          error:
            "Nao foi possivel preparar o estado antes da publicacao.",
          details:
            markError?.message ||
            "grupo incompleto",
          publish_called:
            false,
        });
      }

      /*
       * ======================================================
       * PONTO SEM RETORNO
       * ======================================================
       *
       * A proxima chamada PUBLICA.
       */

      let publishedMedia;

      try {
        publishedMedia =
          await callInstagramApi(
            config,
            `${config.userId}/media_publish`,
            {
              method:
                "POST",

              body: {
                creation_id:
                  parentId,
              },
            }
          );
      }
      catch (publishError) {
        const errorMessage =
          publishError?.message ||
          "Erro desconhecido durante media_publish.";

        const { error: manualReviewPersistError } = await supabase
          .from("publicacoes")
          .update({
            instagram_status:
              "VERIFICAR_MANUALMENTE",

            last_error:
              errorMessage,

            atualizado_em:
              new Date().toISOString(),
          })
          .eq(
            "publication_group_id",
            selected.publication_group_id
          )
          .eq(
            "status",
            "PUBLICANDO"
          )
          .is(
            "published_at",
            null
          );

                if (manualReviewPersistError) {
          console.error(
            "WIRE/GEEK: falha ao persistir VERIFICAR_MANUALMENTE:",
            manualReviewPersistError
          );
        }
return res.status(502).json({
          success:
            false,

          mode:
            "instagram_publish",

          publish_called:
            true,

          publish_succeeded:
            "unknown",

          do_not_retry:
            true,

          error:
            errorMessage,

          instagram: {
            account_id:
              config.userId,

            parent_container_id:
              parentId,
          },

          next_action:
            "verify_instagram_before_any_retry",
        });
      }

      const mediaId =
        String(
          publishedMedia?.id ||
          ""
        ).trim();

      if (!mediaId) {
        const errorMessage =
          "A Meta respondeu ao media_publish sem retornar media ID.";

        await supabase
          .from("publicacoes")
          .update({
            instagram_status:
              "VERIFICAR_MANUALMENTE",

            last_error:
              errorMessage,

            atualizado_em:
              new Date().toISOString(),
          })
          .eq(
            "publication_group_id",
            selected.publication_group_id
          )
          .eq(
            "status",
            "PUBLICANDO"
          )
          .is(
            "published_at",
            null
          );

        return res.status(502).json({
          success:
            false,

          mode:
            "instagram_publish",

          publish_called:
            true,

          publish_succeeded:
            "unknown",

          do_not_retry:
            true,

          error:
            errorMessage,
        });
      }

      /*
       * META CONFIRMOU A PUBLICACAO.
       */

      const publishedAt =
        new Date().toISOString();

      const {
        data: publishedRows,
        error: persistPublishError,
      } =
        await supabase
          .from("publicacoes")
          .update({
            status:
              "PUBLICADO",

            instagram_status:
              "PUBLICADO",

            instagram_post_id:
              mediaId,

            published_at:
              publishedAt,

            last_error:
              null,

            atualizado_em:
              publishedAt,
          })
          .eq(
            "publication_group_id",
            selected.publication_group_id
          )
          .eq(
            "status",
            "PUBLICANDO"
          )
          .is(
            "published_at",
            null
          )
          .select(`
            id,
            status,
            published_at,
            instagram_status,
            instagram_post_id,
            instagram_url
          `);

      if (
        persistPublishError ||
        !Array.isArray(publishedRows) ||
        publishedRows.length !== 2
      ) {
        /*
         * A Meta JA PUBLICOU.
         * NUNCA repetir media_publish.
         */

        return res.status(500).json({
          success:
            false,

          mode:
            "instagram_publish",

          publish_called:
            true,

          publish_succeeded:
            true,

          do_not_retry:
            true,

          error:
            "O Instagram confirmou a publicacao, mas a persistencia local falhou.",

          details:
            persistPublishError?.message ||
            "grupo incompleto",

          instagram: {
            post_id:
              mediaId,

            parent_container_id:
              parentId,
          },

          next_action:
            "repair_database_do_not_republish",
        });
      }

      /*
       * CONSULTAR PERMALINK
       */

      let permalink = null;
      let mediaType = null;
      let instagramTimestamp = null;
      let permalinkWarning = null;

      for (
        let attempt = 1;
        attempt <= 5;
        attempt++
      ) {
        try {
          const mediaInfo =
            await callInstagramApi(
              config,
              mediaId,
              {
                method:
                  "GET",

                body: {
                  fields:
                    "id,permalink,media_type,timestamp",
                },
              }
            );

          permalink =
            String(
              mediaInfo?.permalink ||
              ""
            ).trim() ||
            null;

          mediaType =
            mediaInfo?.media_type ||
            null;

          instagramTimestamp =
            mediaInfo?.timestamp ||
            null;

          break;
        }
        catch (permalinkError) {
          permalinkWarning =
            permalinkError?.message ||
            "Nao foi possivel consultar o permalink.";

          if (attempt < 5) {
            await new Promise(
              (resolve) =>
                setTimeout(
                  resolve,
                  1000
                )
            );
          }
        }
      }

      if (permalink) {
        const {
          error: urlUpdateError,
        } =
          await supabase
            .from("publicacoes")
            .update({
              instagram_url:
                permalink,

              atualizado_em:
                new Date().toISOString(),
            })
            .eq(
              "publication_group_id",
              selected.publication_group_id
            )
            .eq(
              "instagram_post_id",
              mediaId
            );

        if (urlUpdateError) {
          permalinkWarning =
            `Post publicado, mas nao foi possivel salvar o permalink: ${urlUpdateError.message}`;
        }
      }

      return res.status(200).json({
        success:
          true,

        mode:
          "instagram_publish",

        publish_called:
          true,

        published:
          true,

        do_not_retry:
          true,

        publication_group_id:
          selected.publication_group_id,

        publication_ids:
          group.map(
            (item) => item.id
          ),

        instagram: {
          account_id:
            config.userId,

          parent_container_id:
            parentId,

          post_id:
            mediaId,

          permalink,

          media_type:
            mediaType,

          timestamp:
            instagramTimestamp,
        },

        database: {
          status:
            "PUBLICADO",

          instagram_status:
            "PUBLICADO",

          published_at:
            publishedAt,

          rows:
            publishedRows.length,
        },

        warning:
          permalinkWarning,

        next_action:
          "verify_publication_and_checkpoint",
      });
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

    const instagramImages = [];

    /*
     * O dry-run legado ainda pode preparar JPEGs.
     *
     * instagram_containers=true agora significa:
     * preparar um unico MP4 Reel.
     */
    if (!wantsInstagramContainers) {
      for (
        let index = 0;
        index < carouselImages.length;
        index++
      ) {
        instagramImages.push(
          await createInstagramJpeg(
            supabase,
            carouselImages[index],
            selected.publication_group_id,
            index + 1
          )
        );
      }
    }

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
    let instagramContainersResult = null;

    if (wantsInstagramContainers) {
      const config =
        getInstagramConfig();

      const reelPayload =
        await loadInstagramReelPayload(
          supabase,
          group,
          id,
          selected.publication_group_id
        );

      const persistedParents = [
        ...new Set(
          group
            .map(
              (item) =>
                String(
                  item
                    ?.instagram_parent_container_id ||
                  ""
                ).trim()
            )
            .filter(Boolean)
        ),
      ];

      const childVariants = [
        ...new Set(
          group.map(
            (item) =>
              JSON.stringify(
                Array.isArray(
                  item
                    ?.instagram_child_container_ids
                )
                  ? item
                      .instagram_child_container_ids
                      .map(
                        (value) =>
                          String(
                            value ||
                            ""
                          ).trim()
                      )
                      .filter(Boolean)
                  : []
              )
          )
        ),
      ];

      let persistedChildIds = [];

      if (
        childVariants.length === 1
      ) {
        try {
          persistedChildIds =
            JSON.parse(
              childVariants[0]
            );
        }
        catch {
          persistedChildIds = [];
        }
      }

      /*
       * Nunca converter silenciosamente um conjunto
       * antigo de carousel em Reel.
       */
      if (
        persistedChildIds.length > 0
      ) {
        throw new Error(
          "Existem child containers de carrossel persistidos. Limpeza manual obrigatoria antes do Reel."
        );
      }

      /*
       * REUTILIZAR REEL EXISTENTE.
       */
      if (
        persistedParents.length === 1 &&
        childVariants.length === 1 &&
        persistedChildIds.length === 0
      ) {
        const reelContainerId =
          persistedParents[0];

        let status =
          await callInstagramApi(
            config,
            reelContainerId,
            {
              method:
                "GET",

              body: {
                fields:
                  "id,status_code,status",
              },
            }
          );

        if (
          status?.status_code ===
          "PUBLISHED"
        ) {
          throw new Error(
            `O container Reel ${reelContainerId} ja consta como PUBLISHED. Novo container bloqueado.`
          );
        }

        if (
          status?.status_code ===
            "ERROR" ||
          status?.status_code ===
            "EXPIRED"
        ) {
          throw new Error(
            `O container Reel ${reelContainerId} retornou ${status.status_code}: ${status?.status || "sem detalhes"}. ID preservado para auditoria manual; recriacao automatica bloqueada.`
          );
        }
        else {
          if (
            status?.status_code !==
            "FINISHED"
          ) {
            status =
              await waitForInstagramContainer(
                config,
                reelContainerId
              );
          }

          instagramContainersResult = {
            api_version:
              config.apiVersion,

            graph_base_url:
              config.baseUrl,

            media_type:
              "REELS",

            share_to_feed:
              true,

            reel_container_id:
              reelContainerId,

            parent_container_id:
              reelContainerId,

            child_containers:
              [],

            parent_status_code:
              status.status_code,

            video_url:
              reelPayload.videoUrl,

            caption_preview:
              reelPayload
                .captionInfo
                .caption_preview,

            caption_length:
              reelPayload
                .captionInfo
                .caption_length,

            hashtags:
              reelPayload
                .captionInfo
                .hashtags,

            hashtags_count:
              reelPayload
                .captionInfo
                .hashtags_count,

            reused:
              true,

            persisted:
              true,
          };
        }
      }
      else if (
        persistedParents.length > 1 ||
        childVariants.length !== 1
      ) {
        throw new Error(
          "Metadados de container Instagram inconsistentes entre os dois editoriais."
        );
      }

      /*
       * CRIAR NOVO REEL.
       */
      if (
        !instagramContainersResult
      ) {
        /*
         * O MP4 desta publicacao ja foi:
         * - gerado;
         * - aprovado visualmente;
         * - persistido em Storage;
         * - identificado por hash.
         *
         * Nao regenerar nem sobrescrever nesta etapa.
         */
        const reelVideo = {
          width:
            1080,

          height:
            1920,

          duration_seconds:
            30,

          frame_seconds:
            [12, 12, 6],
        };

        const uploaded = {
          video_url:
            reelPayload.videoUrl,

          storage_path:
            reelPayload.storagePath,
        };

        /*
         * POST /media.
         *
         * Ainda NÃO chama media_publish.
         */
        const created =
          await createInstagramReelContainer({
            videoUrl:
              uploaded.video_url,

            caption:
              reelPayload
                .captionInfo
                .caption,
          });

        const reelContainerId =
          String(
            created
              .reel_container_id ||
            ""
          ).trim();

        if (!reelContainerId) {
          throw new Error(
            "Instagram retornou container Reel invalido."
          );
        }

        /*
         * PERSISTIR PRIMEIRO.
         *
         * Se houver timeout depois deste ponto,
         * a chamada seguinte encontrará este ID.
         */
        const {
          data: persistedRows,
          error: persistError,
        } =
          await supabase
            .from("publicacoes")
            .update({
              instagram_parent_container_id:
                reelContainerId,

              instagram_child_container_ids:
                [],

              instagram_containers_created_at:
                new Date().toISOString(),

              atualizado_em:
                new Date().toISOString(),
            })
            .eq(
              "publication_group_id",
              selected.publication_group_id
            )
            .is(
              "published_at",
              null
            )
            .select("id");

        if (
          persistError ||
          !Array.isArray(
            persistedRows
          ) ||
          persistedRows.length !== 2
        ) {
          throw new Error(
            `O container Reel ${reelContainerId} foi criado na Meta, mas nao foi possivel persisti-lo no Supabase: ${
              persistError?.message ||
              "grupo incompleto"
            }. NAO CRIAR OUTRO CONTAINER SEM AUDITORIA.`
          );
        }

        /*
         * Somente depois da persistência esperamos
         * o processamento do vídeo.
         */
        const finalStatus =
          await waitForInstagramContainer(
            config,
            reelContainerId
          );

        instagramContainersResult = {
          ...created,

          parent_status_code:
            finalStatus.status_code,

          storage_path:
            uploaded.storage_path,

          video_url:
            uploaded.video_url,

          width:
            reelVideo.width,

          height:
            reelVideo.height,

          duration_seconds:
            reelVideo.duration_seconds,

          caption_preview:
            reelPayload
              .captionInfo
              .caption_preview,

          caption_length:
            reelPayload
              .captionInfo
              .caption_length,

          hashtags:
            reelPayload
              .captionInfo
              .hashtags,

          hashtags_count:
            reelPayload
              .captionInfo
              .hashtags_count,

          reused:
            false,

          persisted:
            true,
        };
      }
    }

    return res.status(200).json({
      success:
        true,

      dry_run:
        !wantsInstagramContainers,

      ...(wantsInstagramContainers
        ? {
            mode:
              "instagram_reel_container_only",

            publication_type:
              "REEL",

            publish_called:
              false,

            instagram:
              instagramContainersResult,
          }
        : {}),

      reel: {
        publication_group_id:
          selected.publication_group_id,

        publication_ids:
          group.map(
            (item) =>
              item.id
          ),

        frames:
          carouselImages,

        video_url:
          instagramContainersResult
            ?.video_url ||
          null,

        share_to_feed:
          true,
      },

      transicao: [
        "APROVADO",
        "PUBLICANDO",
        "APROVADO",
      ],

      publicacao: {
        id:
          restored.id,

        noticia_id:
          restored.noticia_id,

        banner_url:
          restored.banner_url,

        caption:
          restored.caption,

        hashtags:
          restored.hashtags,

        status:
          restored.status,

        published_at:
          restored.published_at,
      },
    });

  } catch (error) {
    console.error("WIRE/GEEK: erro na preparacao de publicacao:", error);

    return res.status(500).json({
      error: "Nao foi possivel preparar a publicacao.",
      details: error?.message || "Erro desconhecido.",
    });
  }
}
