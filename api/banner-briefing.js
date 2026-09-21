import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { hasValidWireGeekAuth } from "./auth.js";
import { WIDTH, HEIGHT, inputError, normalizeBanner, renderBanner } from "../lib/banner-renderer-briefing.mjs";
import { buildBriefingBannerRequest } from "../lib/banner-request-briefing.mjs";
import { resolveBriefingBannerImages } from "../lib/banner-images-briefing.mjs";
import { renderCtaBanner } from "../lib/banner-cta-renderer.mjs";



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

async function createPublication(noticiaId, bannerUrl, headline, sourceImage = {}, carousel) {
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

  const { data: existing, error: existingError } = await supabase
    .from("publicacoes")
    .select("id,status,banner_url")
    .eq("noticia_id", noticiaId)
    .eq("caption", headline)
    .eq("status", "AGUARDANDO_APROVACAO")
    .is("published_at", null)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Nao foi possivel verificar publicacao pendente: ${existingError.message}`
    );
  }

  if (existing) {
    const { data: publication, error: updateError } = await supabase
      .from("publicacoes")
      .update({
        banner_url: bannerUrl,
        publication_group_id: carousel.publicationGroupId,
        carousel_position: carousel.position,
        cta_url: carousel.ctaUrl,
        caption: headline,
        hashtags,
        source_image_url: sourceImage.url || null,
        source_image_full_hash: sourceImage.fullHash || null,
        source_image_crop_hash: sourceImage.cropHash || null,
        atualizado_em: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("status", "AGUARDANDO_APROVACAO")
      .is("published_at", null)
      .select("id,status,banner_url")
      .single();

    if (updateError) {
      throw new Error(
        `Nao foi possivel atualizar a publicacao pendente: ${updateError.message}`
      );
    }

    return publication;
  }

  const { data: publication, error } = await supabase
    .from("publicacoes")
    .insert({
      noticia_id: noticiaId,
      banner_url: bannerUrl,
      publication_group_id: carousel.publicationGroupId,
      carousel_position: carousel.position,
      cta_url: carousel.ctaUrl,
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

async function handleBriefingGeneratedBanners(
  req,
  res
) {
  if (!hasValidWireGeekAuth(req)) {
    return res.status(401).json({
      error: "Acesso nao autorizado.",
    });
  }

  const body = req.body || {};

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Buffer.isBuffer(body) ||
    body instanceof Uint8Array
  ) {
    throw inputError(
      "Envie um payload JSON valido para o modo Briefing."
    );
  }

  /*
   * ========================================================
   * CONTRATO OFICIAL DO BRIEFING
   * ========================================================
   *
   * O builder separa:
   *
   * 2 x editorial
   * 1 x CTA opcional/institucional
   *
   * Este fluxo usa somente o pipeline do Briefing.
   */

  const briefing =
    buildBriefingBannerRequest(body);

  const editorialBanners =
    briefing.banners.filter(
      (banner) =>
        banner.type === "editorial"
    );

  const ctaBanner =
    briefing.banners.find(
      (banner) =>
        banner.type === "cta"
    );

  if (
    editorialBanners.length !== 2
  ) {
    throw inputError(
      "O modo Briefing exige exatamente dois banners editoriais."
    );
  }

  if (!ctaBanner) {
    throw inputError(
      "O modo Briefing exige o terceiro banner CTA."
    );
  }

  /*
   * ========================================================
   * IMAGENS EDITORIAIS
   * ========================================================
   *
   * resolveBriefingBannerImages já executa:
   *
   * - candidatos explícitos;
   * - fontes editoriais;
   * - busca externa;
   * - qualidade;
   * - composição;
   * - Gemini Vision;
   * - distinção entre banner 1 e 2.
   */

  const images =
    await resolveBriefingBannerImages(
      briefing
    );

  if (
    !Array.isArray(images) ||
    images.length !== 2
  ) {
    throw new Error(
      "O Briefing nao conseguiu resolver exatamente duas imagens editoriais."
    );
  }

  /*
   * Mantém a categoria atual salva
   * na notícia, preservando o comportamento atual.
   */

  const currentCategory =
    await resolveBannerCategory(
      body.noticia_id,
      briefing.categoria
    );

  /*
   * ========================================================
   * RENDER EDITORIAL
   * ========================================================
   *
   * Tudo é renderizado antes de qualquer upload.
   */

  const rendered = [];

  for (
    let index = 0;
    index < editorialBanners.length;
    index++
  ) {
    const banner =
      editorialBanners[index];

    const image =
      images[index];

    if (!image?.imageBuffer) {
      throw new Error(
        `Imagem do banner editorial ${index + 1} nao possui buffer valido.`
      );
    }

    const normalized =
      normalizeBanner({
        categoria:
          currentCategory ||
          briefing.categoria,

        banner_title:
          banner.banner_title,

        highlight:
          banner.highlight,

        /*
         * Campo mantido apenas para
         * compatibilidade interna com
         * o renderer.
         *
         * O renderer usa banner_title
         * como headline final.
         */
        titulo_curto:
          body.titulo_curto ||
          briefing.titulo_curto ||
          banner.titulo_curto ||
          banner.short_title ||
          banner.shortTitle,

        contexto_visual:
          banner.contexto_visual ||
          banner.visual_subject ||
          body.contexto_visual ||
          body.visual_subject ||
          "",

        image_position:
          banner.image_position ||
          body.image_position ||
          "",

        image_url:
          image.url,
      });

    const output =
      await renderBanner({
        ...normalized,

        imageBuffer:
          image.imageBuffer,
      });

    rendered.push({
      type:
        "editorial",

      bannerIndex:
        index,

      normalized,

      sourceImage:
        image,

      png:
        output.png,
    });
  }

  /*
   * ========================================================
   * RENDER CTA
   * ========================================================
   *
   * Não usa:
   * - busca externa
   * - Gemini
   * - imagem editorial
   */

  const ctaOutput =
    await renderCtaBanner({
      assetPath:
        ctaBanner.asset_path,
    });

  if (!ctaOutput?.png) {
    throw new Error(
      "O renderer CTA nao retornou uma imagem valida."
    );
  }

  rendered.push({
    type:
      "cta",

    bannerIndex:
      2,

    cta:
      ctaBanner,

    layout:
      ctaOutput.layout,

    png:
      ctaOutput.png,
  });

  /*
   * Somente agora, depois dos três
   * renders terem sido concluídos,
   * começamos a persistência.
   */

  const generationId =
    randomUUID();

  const uploaded = [];

  for (
    let index = 0;
    index < rendered.length;
    index++
  ) {
    const item =
      rendered[index];

    const storageId =
      "briefing-" +
      String(
        body.noticia_id ||
        "sem-id"
      ) +
      "-" +
      generationId +
      "-" +
      String(index + 1);

    const bannerUrl =
      await uploadBanner(
        item.png,
        storageId
      );

    uploaded.push({ item, storageId, bannerUrl });
  }

  // Os três uploads precisam terminar antes de salvar os editoriais.
  const ctaUrl = uploaded.find(({ item }) => item.type === "cta")?.bannerUrl;

  if (!ctaUrl) {
    throw new Error("O Briefing nao conseguiu salvar a URL do terceiro banner CTA.");
  }

  const completed = [];

  for (let index = 0; index < uploaded.length; index++) {
    const { item, storageId, bannerUrl } = uploaded[index];

    /*
     * Os banners editoriais continuam
     * podendo gerar registros em
     * publicacoes.
     *
     * O CTA é um slide institucional
     * fixo e NÃO cria uma publicação
     * separada.
     */

    let publication = null;

    if (
      item.type === "editorial"
    ) {
      const normalized =
        item.normalized;

      const sourceImage =
        item.sourceImage;

      publication =
        await createPublication(
          body.noticia_id,
          bannerUrl,
          normalized.headline,
          {
            url:
              sourceImage?.url ||
              normalized.imageUrl ||
              "",

            fullHash:
              sourceImage
                ?.fingerprint
                ?.fullHash ||
              "",

            cropHash:
              sourceImage
                ?.fingerprint
                ?.cropHash ||
              "",
          },
          {
            publicationGroupId: generationId,
            position: item.bannerIndex + 1,
            ctaUrl,
          }
        );
    }

    if (
      item.type === "editorial"
    ) {
      const normalized =
        item.normalized;

      completed.push({
        success:
          true,

        mode:
          "briefing",

        type:
          "editorial",

        index:
          index,

        format:
          "png",

        mimeType:
          "image/png",

        filename:
          "wiregeek-" +
          storageId +
          ".png",

        width:
          WIDTH,

        height:
          HEIGHT,

        categoria:
          normalized.category,

        banner_title:
          editorialBanners[index]
            ?.banner_title ||
          normalized.shortTitle,

        headline:
          normalized.headline,

        image_url:
          item.sourceImage?.url ||
          normalized.imageUrl ||
          "",

        source_url:
          item.sourceImage
            ?.source_url ||
          "",

        banner_url:
          bannerUrl,

        publication_id:
          publication?.id ||
          null,

        status:
          publication?.status ||
          null,
      });

      continue;
    }

    completed.push({
      success:
        true,

      mode:
        "briefing",

      type:
        "cta",

      index:
        index,

      format:
        "png",

      mimeType:
        "image/png",

      filename:
        "wiregeek-" +
        storageId +
        ".png",

      width:
        item.layout
          ?.outputWidth ||
        WIDTH,

      height:
        item.layout
          ?.outputHeight ||
        HEIGHT,

      asset_path:
        item.cta?.asset_path ||
        "",

      banner_url:
        bannerUrl,

      publication_id:
        null,

      status:
        null,
    });
  }

  console.log(
    "WIRE/GEEK BRIEFING: carrossel gerado",
    {
      noticia_id:
        body.noticia_id ||
        null,

      quantidade:
        completed.length,

      tipos:
        completed.map(
          (item) => item.type
        ),
    }
  );

  return res
    .status(200)
    .json({
      success:
        true,

      mode:
        "briefing",

      quantidade:
        completed.length,

      banners:
        completed,
    });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Metodo nao permitido",
    });
  }

  try {
    return await handleBriefingGeneratedBanners(
      req,
      res
    );
  } catch (error) {
    console.error(
      "WIRE/GEEK BRIEFING: erro ao gerar carrossel:",
      error
    );

    return res
      .status(error?.statusCode || 500)
      .json({
        error:
          error?.message ||
          "Nao foi possivel gerar os banners do Briefing.",
      });
  }
}
