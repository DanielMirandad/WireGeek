import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

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
  creationId
) {
  const maxAttempts = 20;
  const delayMs = 2000;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt++
  ) {
    const status =
      await callInstagramApi(
        config,
        String(creationId),
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
        `O container ${creationId} retornou ${status.status_code}: ${status?.status || "sem detalhes"}.`
      );
    }

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          delayMs
        )
    );
  }

  throw new Error(
    `Timeout aguardando o container ${creationId} ficar FINISHED.`
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
    const wantsInstagramContainers =
      req.body?.instagram_containers === true ||
      String(
        req.body?.instagram_containers || ""
      )
        .trim()
        .toLowerCase() === "true";
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
      .select("id,status,published_at,carousel_position,banner_url,cta_url,caption,hashtags")
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

    const instagramImages = [];

    for (let index = 0; index < carouselImages.length; index++) {
      instagramImages.push(
        await createInstagramJpeg(
          supabase,
          carouselImages[index],
          selected.publication_group_id,
          index + 1
        )
      );
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
      const selectedPublication =
        group.find(
          (item) =>
            String(item.id) ===
            String(id)
        ) ||
        group[0];

      const captionParts = [
        String(
          selectedPublication?.caption ||
          ""
        ).trim(),

        String(
          selectedPublication?.hashtags ||
          ""
        ).trim(),
      ].filter(Boolean);

      instagramContainersResult =
        await createInstagramCarouselContainers(
          instagramImages,
          captionParts.join("\n\n")
        );
    }
    return res.status(200).json({
      success: true,
      dry_run: !wantsInstagramContainers,

      ...(wantsInstagramContainers
        ? {
            mode:
              "instagram_containers_only",

            publish_called:
              false,

            instagram:
              instagramContainersResult,
          }
        : {}),
      carrossel: {
        publication_group_id: selected.publication_group_id,
        publication_ids: group.map((item) => item.id),
        imagens: carouselImages,
        imagens_instagram: instagramImages,
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
    console.error("WIRE/GEEK: erro na preparacao de publicacao:", error);

    return res.status(500).json({
      error: "Nao foi possivel preparar a publicacao.",
      details: error?.message || "Erro desconhecido.",
    });
  }
}
