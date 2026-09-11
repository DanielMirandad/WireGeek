import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { hasValidSession } from "./auth.js";
import { resolveBannerImages } from "../lib/banner-images.mjs";
import { validateVisualCandidates } from "../lib/banner-vision.mjs";
import { validateHighlights } from "../lib/editorial-rules.mjs";
import { validateBannerCopy } from "../lib/banner-copy.mjs";
import { WIDTH, HEIGHT, inputError, normalizeBanner, renderBanner } from "../lib/banner-renderer.mjs";

async function uploadBanner(png, noticiaId) {
  const supabase = createClient(
    String(process.env.SUPABASE_URL || "").trim(),
    String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  const filename = `wiregeek-${noticiaId || Date.now()}.png`;

  const { error } = await supabase.storage
    .from("wiregeek-banners")
    .upload(filename, png, {
      contentType: "image/png",
      upsert: true,
    });

  if (error) {
    throw new Error(`Nao foi possivel salvar o banner: ${error.message}`);
  }

  const { data } = supabase.storage
    .from("wiregeek-banners")
    .getPublicUrl(filename);

  return data.publicUrl;
}

async function createPublication(noticiaId, bannerUrl, headline, sourceImage = {}) {
  if (!noticiaId) {
    return null;
  }

  const supabase = createClient(
    String(process.env.SUPABASE_URL || "").trim(),
    String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  const { data: hashtagRows, error: hashtagsError } = await supabase
    .from("hashtags")
    .select("hashtag")
    .eq("noticia_id", noticiaId);

  if (hashtagsError) {
    throw new Error(
      `Nao foi possivel carregar as hashtags: ${hashtagsError.message}`
    );
  }

  const hashtags = (hashtagRows || [])
    .map((item) => String(item.hashtag || "").trim())
    .filter(Boolean)
    .join(" ");

  const { data: publication, error } = await supabase
    .from("publicacoes")
    .insert({
      noticia_id: noticiaId,
      banner_url: bannerUrl,
      caption: headline,
      hashtags,
      status: "AGUARDANDO_APROVACAO",
      source_image_url: sourceImage.url || null,
      source_image_full_hash: sourceImage.fullHash || null,
      source_image_crop_hash: sourceImage.cropHash || null,
    })
    .select("id,status,banner_url")
    .single();

  if (error) {
    throw new Error(
      `Nao foi possivel criar a publicacao: ${error.message}`
    );
  }

  return publication;
}

async function resolveBannerCategory(noticiaId, fallbackCategory) {
  if (!noticiaId) {
    return String(fallbackCategory || "").trim();
  }

  const supabase = createClient(
    String(process.env.SUPABASE_URL || "").trim(),
    String(
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      ""
    ).trim(),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  const { data, error } = await supabase
    .from("noticias")
    .select("categoria")
    .eq("id", noticiaId)
    .single();

  if (error) {
    throw new Error(
      `Nao foi possivel carregar a categoria atual da noticia: ${error.message}`
    );
  }

  return String(data?.categoria || fallbackCategory || "").trim();
}

async function loadRejectedImages(noticiaId) {
  if (!noticiaId) return [];

  const supabase = createClient(
    String(process.env.SUPABASE_URL || "").trim(),
    String(
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      ""
    ).trim(),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  const { data, error } = await supabase
    .from("imagens_rejeitadas")
    .select("image_url,full_hash,crop_hash")
    .eq("noticia_id", noticiaId);

  if (error) {
    throw new Error(
      "Nao foi possivel carregar imagens rejeitadas: " +
      error.message
    );
  }

  return data || [];
}


async function readBinaryBody(
  req,
  maxBytes = 10 * 1024 * 1024
) {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > maxBytes) {
      throw Object.assign(
        new Error(
          "O banner excede o limite de 10 MB."
        ),
        { statusCode: 413 }
      );
    }

    return req.body;
  }

  if (req.body instanceof Uint8Array) {
    const buffer = Buffer.from(req.body);

    if (buffer.length > maxBytes) {
      throw Object.assign(
        new Error(
          "O banner excede o limite de 10 MB."
        ),
        { statusCode: 413 }
      );
    }

    return buffer;
  }

  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk);

    total += buffer.length;

    if (total > maxBytes) {
      throw Object.assign(
        new Error(
          "O banner excede o limite de 10 MB."
        ),
        { statusCode: 413 }
      );
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks, total);
}

async function handleBriefingFinalBanner(
  req,
  res
) {
  if (!hasValidSession(req)) {
    return res.status(401).json({
      error: "Acesso nao autorizado.",
    });
  }

  const requestUrl = new URL(
    req.url || "/api/banner",
    "http://localhost"
  );

  const noticiaId = Number(
    requestUrl.searchParams.get("noticia_id")
  );

  const headline = String(
    requestUrl.searchParams.get("headline") || ""
  ).trim();

  if (
    !Number.isInteger(noticiaId) ||
    noticiaId <= 0
  ) {
    return res.status(400).json({
      error: "Informe um noticia_id valido.",
    });
  }

  if (!headline) {
    return res.status(400).json({
      error:
        "Informe o headline do banner do Briefing.",
    });
  }

  const contentType = String(
    req.headers?.["content-type"] || ""
  ).toLowerCase();

  if (
    !/^image\/(?:png|jpeg|webp)(?:;|$)/i.test(
      contentType
    )
  ) {
    return res.status(415).json({
      error:
        "Envie o banner final como PNG, JPEG ou WebP.",
    });
  }

  const original = await readBinaryBody(req);

  if (!original.length) {
    return res.status(400).json({
      error: "O arquivo do banner esta vazio.",
    });
  }

  let metadata;
  let png;

  try {
    const image = sharp(original, {
      limitInputPixels: 50_000_000,
    }).rotate();

    metadata = await image.metadata();

    png = await image
      .png({
        compressionLevel: 9,
        adaptiveFiltering: true,
      })
      .toBuffer();
  } catch (error) {
    throw Object.assign(
      new Error(
        "O arquivo recebido nao e uma imagem valida: " +
          (error?.message || "erro desconhecido")
      ),
      { statusCode: 400 }
    );
  }

  if (!metadata?.width || !metadata?.height) {
    return res.status(400).json({
      error:
        "Nao foi possivel identificar as dimensoes do banner.",
    });
  }

  const storageId =
    "briefing-" +
    noticiaId +
    "-" +
    randomUUID();

  const bannerUrl = await uploadBanner(
    png,
    storageId
  );

  const publication = await createPublication(
    noticiaId,
    bannerUrl,
    headline
  );

  const result = {
    success: true,
    source: "briefing",
    format: "png",
    mimeType: "image/png",
    filename:
      "wiregeek-" + storageId + ".png",
    width: metadata.width,
    height: metadata.height,
    headline,
    banner_url: bannerUrl,
    publication_id:
      publication?.id || null,
    status:
      publication?.status || null,
  };

  console.log(
    "WIRE/GEEK: banner final do Briefing importado",
    {
      noticia_id: noticiaId,
      publication_id:
        result.publication_id,
      width: result.width,
      height: result.height,
    }
  );

  return res.status(200).json(result);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Metodo nao permitido" });
  }

  const requestUrl = new URL(
    req.url || "/api/banner",
    "http://localhost"
  );

  if (
    requestUrl.searchParams.get("mode") ===
    "briefing-final"
  ) {
    try {
      return await handleBriefingFinalBanner(
        req,
        res
      );
    } catch (error) {
      console.error(
        "WIRE/GEEK: erro ao importar banner final do Briefing:",
        error
      );

      return res
        .status(error?.statusCode || 500)
        .json({
          error:
            "Nao foi possivel importar o banner final do Briefing.",
          details:
            error?.message ||
            "Erro desconhecido",
        });
    }
  }

  const completed = [];
  try {
    const body = req.body || {};
    const pair = body.banners !== undefined;
    if (pair && (!Array.isArray(body.banners) || body.banners.length !== 2)) {
      throw inputError("Envie exatamente dois itens em banners.");
    }
    const entries = pair ? body.banners : [body];
    if (entries.some(item => !item || typeof item !== "object" || Array.isArray(item))) {
      throw inputError("Cada banner deve ser um objeto.");
    }
    if (pair) {
      const issues = validateHighlights(entries.map(item => item.highlight || item.headline || ""));
      if (issues.length) throw inputError(issues.join("; "));
      for (const item of entries) {
        const title = String(
          item.titulo_curto || body.titulo_curto || ""
        ).trim();

        if (!title || title.length > 24) {
          throw inputError(
            "Informe um título curto de até 24 caracteres para o banner."
          );
        }

        const bannerHighlight = String(
          item.highlight || item.headline || ""
        ).trim();

        const fitIssues = await validateBannerCopy({
          titulo_curto: title,
          highlights: [bannerHighlight],
        });
        if (fitIssues.length) {
          throw inputError(
            "O texto precisa ser encurtado para caber no modelo aprovado. " +
            fitIssues.join("; ")
          );
        }
      }
    }
    const manualImages = body.image_mode === "manual";
    const rejectedImages = manualImages
      ? []
      : await loadRejectedImages(body.noticia_id);
    const runtimeRejectedImages = [...rejectedImages];
    const maxVisualAttempts = manualImages ? 1 : 3;
    let images;

    // Resolve, inspect and retry only the images rejected by Gemini. Nothing is
    // rendered or persisted until the complete pair passes visual review.
    for (let visualAttempt = 1; visualAttempt <= maxVisualAttempts; visualAttempt++) {
      images = await resolveBannerImages({
        rejectedImages: runtimeRejectedImages,
        entries: entries.map(item => ({
          ...item,
          image_url: item.image_url || item.imageUrl || item.imagem || "",
        })),
        candidates: Array.isArray(body.image_candidates) ? body.image_candidates : [],
        sources: Array.isArray(body.source_urls) ? body.source_urls : [],
        query: body.image_query || body.titulo_curto || "",
        manual: manualImages,
      });

      try {
        await validateVisualCandidates({
          images,
          subject: body.titulo_curto || entries[0]?.titulo_curto || "",
          query: body.image_query || "",
          highlights: entries.map(item => item.highlight || item.headline || ""),
        });
        break;
      } catch (error) {
        const rejectedIndexes = Array.isArray(error?.rejectedIndexes)
          ? error.rejectedIndexes.filter(index =>
              Number.isInteger(index) && index >= 0 && index < images.length
            )
          : [];

        const canRetry =
          !manualImages &&
          error?.code === "BANNER_VISUAL_REJECTED" &&
          rejectedIndexes.length > 0 &&
          visualAttempt < maxVisualAttempts;

        if (!canRetry) {
          throw error;
        }

        for (const index of rejectedIndexes) {
          const rejectedImage = images[index];
          if (!rejectedImage) continue;

          runtimeRejectedImages.push({
            image_url: rejectedImage.url || "",
            full_hash: rejectedImage.fingerprint?.fullHash || "",
            crop_hash: rejectedImage.fingerprint?.cropHash || "",
          });
        }

        console.log("WIRE/GEEK: revisao visual rejeitou candidato; buscando substituto", {
          tentativa: visualAttempt,
          proxima_tentativa: visualAttempt + 1,
          rejeitadas: rejectedIndexes.map(index => index + 1),
          total_rejeitadas_na_execucao: runtimeRejectedImages.length,
        });
      }
    }

    const currentCategory = await resolveBannerCategory(
      body.noticia_id,
      entries[0]?.categoria || body.categoria
    );

    const normalized = entries.map((item, index) => normalizeBanner({
      ...item,
      categoria: currentCategory || item.categoria || body.categoria,
      cor: item.cor || body.cor,
      titulo_curto: item.titulo_curto || body.titulo_curto,
      image_url: images[index].url,
    }));
    // Render both before any persistence. Invalid text/image never saves half a pair.
    const rendered = [];
    for (let index = 0; index < normalized.length; index++) {
      const item = normalized[index];
      rendered.push({ ...item, sourceUrl: images[index].source_url || "",
        ...await renderBanner({ ...item, imageBuffer: images[index].imageBuffer }),
      });
    }
    const generationId = randomUUID();
    for (let index = 0; index < rendered.length; index++) {
      const item = rendered[index];
      // Immutable names avoid stale caches and prevent a second banner overwriting the first.
      const storageId = generationId + "-" + (index + 1);
      const bannerUrl = await uploadBanner(item.png, storageId);
      const result = {
        success: true, format: "png", mimeType: "image/png",
        filename: "wiregeek-" + storageId + ".png", width: WIDTH, height: HEIGHT,
        categoria: item.category, headline: item.headline, titulo_curto: item.shortTitle,
        image_url: item.imageUrl, source_url: item.sourceUrl,
        banner_url: bannerUrl, publication_id: null, status: null,
      };
      completed.push(result);
      const publication = await createPublication(
        body.noticia_id,
        bannerUrl,
        item.headline,
        {
          url: images[index]?.url || item.imageUrl || "",
          fullHash: images[index]?.fingerprint?.fullHash || "",
          cropHash: images[index]?.fingerprint?.cropHash || "",
        }
      );
      result.publication_id = publication?.id || null;
      result.status = publication?.status || null;
      // Legacy response still contains the exact uploaded bytes.
      // Pair previews use banner_url to avoid doubling large base64 bodies.
      if (!pair) result.data = "data:image/png;base64," + item.png.toString("base64");
    }
    return res.status(200).json(pair
      ? { success: true, quantidade: 2, banners: completed }
      : completed[0]);
  } catch (error) {
    console.error("WIRE/GEEK: erro no banner:", error);
    return res.status(error?.statusCode || 500).json({
      error: "Nao foi possivel gerar o banner.",
      details: error?.message || "Erro desconhecido",
      ...(completed.length ? {
        parcial: true, banners: completed,
        aviso: "Alguns arquivos ja foram salvos. Verifique antes de tentar novamente.",
      } : {}),
    });
  }
}
