import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";

import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";


export const INSTAGRAM_REEL_WIDTH = 1080;
export const INSTAGRAM_REEL_HEIGHT = 1920;

export const INSTAGRAM_REEL_FRAME_SECONDS =
  Object.freeze([
    12,
    12,
    6,
  ]);

export const INSTAGRAM_REEL_SLIDE_COUNT =
  INSTAGRAM_REEL_FRAME_SECONDS.length;

export const INSTAGRAM_REEL_DURATION_SECONDS =
  INSTAGRAM_REEL_FRAME_SECONDS.reduce(
    (total, seconds) =>
      total + seconds,
    0
  );


export const INSTAGRAM_REEL_CAPTION_FOOTER =
  [
    "---",
    "Estaremos acompanhando tudo e traremos as informações até vocês.",
    "SEGUE A GENTE, COMPARTILHA E COMENTA!",
    "LIVES TODOS OS SÁBADOS!!",
    "https://www.twitch.tv/bagacacast_lives",
    "https://youtube.com/@bagacastudios",
    "REDES SOCIAIS:",
    "Instagram: @bagacastudios",
    "TikTok: @bagacastudios",
    "Youtube: @bagacastudios",
    "SEJA VIP:",
    "https://linktr.ee/Bagacacast",
    "CANAL DE CORTES:",
    "https://www.youtube.com/@CortesBCastOficial",
  ].join("\n");


function cleanText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim();
}


export function normalizeInstagramHashtags(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/\s+/);

  const normalized = [];
  const seen = new Set();

  for (const item of raw) {
    let tag =
      String(item || "")
        .trim();

    if (!tag) {
      continue;
    }

    if (!tag.startsWith("#")) {
      tag = `#${tag}`;
    }

    tag =
      tag.replace(
        /[^\p{L}\p{N}_#]/gu,
        ""
      );

    if (
      tag.length <= 1 ||
      seen.has(tag.toLowerCase())
    ) {
      continue;
    }

    seen.add(tag.toLowerCase());
    normalized.push(tag);
  }

  return normalized;
}


export function buildInstagramReelCaption({
  article,
  hashtags,
}) {
  const fullArticle =
    cleanText(article);

  if (!fullArticle) {
    throw new Error(
      "A noticia completa esta vazia."
    );
  }

  const normalizedHashtags =
    normalizeInstagramHashtags(
      hashtags
    );

  if (
    normalizedHashtags.length !== 5
  ) {
    throw new Error(
      `O Reel exige exatamente 5 hashtags. Recebidas: ${normalizedHashtags.length}.`
    );
  }

  const caption =
    [
      fullArticle,
      INSTAGRAM_REEL_CAPTION_FOOTER,
      normalizedHashtags.join(" "),
    ].join("\n\n");

  /*
   * O Wire/Geek trabalha com artigos de ate 2000 caracteres.
   * A validacao evita criar um container caso a legenda final
   * ultrapasse o limite operacional do Instagram.
   */
  if (caption.length > 2200) {
    throw new Error(
      `Legenda do Reel excede 2200 caracteres: ${caption.length}.`
    );
  }

  const captionSha256 =
    createHash("sha256")
      .update(
        caption,
        "utf8"
      )
      .digest("hex");


  return {
    caption,

    caption_preview:
      caption.length > 320
        ? `${caption.slice(0, 320)}...`
        : caption,

    caption_length:
      caption.length,

    caption_sha256:
      captionSha256,

    footer:
      INSTAGRAM_REEL_CAPTION_FOOTER,

    hashtags:
      normalizedHashtags,

    hashtags_count:
      normalizedHashtags.length,
  };
}


async function downloadImage(url) {
  const normalizedUrl =
    cleanText(url);

  if (!normalizedUrl) {
    throw new Error(
      "URL de banner vazia."
    );
  }

  const response =
    await fetch(
      normalizedUrl,
      {
        signal:
          AbortSignal.timeout(
            20000
          ),
      }
    );

  if (!response.ok) {
    throw new Error(
      `Falha ao baixar banner: HTTP ${response.status}.`
    );
  }

  return Buffer.from(
    await response.arrayBuffer()
  );
}


async function prepareVerticalFrame({
  sourceBuffer,
  outputPath,
}) {
  const metadata =
    await sharp(
      sourceBuffer
    ).metadata();

  if (
    metadata.width !== 1080 ||
    metadata.height !== 1350
  ) {
    throw new Error(
      `Banner fora do modelo aprovado: ${metadata.width}x${metadata.height}. Esperado: 1080x1350.`
    );
  }

  /*
   * O banner aprovado permanece intacto no centro.
   *
   * A area adicional necessaria para 9:16 usa uma versao
   * desfocada do proprio banner como fundo.
   *
   * Assim o renderer editorial continua sendo a fonte visual
   * e nao fazemos crop da composicao aprovada.
   */
  const background =
    await sharp(
      sourceBuffer
    )
      .resize(
        INSTAGRAM_REEL_WIDTH,
        INSTAGRAM_REEL_HEIGHT,
        {
          fit: "cover",
        }
      )
      .blur(28)
      .modulate({
        brightness: 0.5,
      })
      .png()
      .toBuffer();

  const foreground =
    await sharp(
      sourceBuffer
    )
      .resize(
        1080,
        1350,
        {
          fit: "fill",
        }
      )
      .png()
      .toBuffer();

  await sharp(
    background
  )
    .composite([
      {
        input:
          foreground,

        gravity:
          "center",
      },
    ])
    .png()
    .toFile(
      outputPath
    );
}


async function runFfmpeg(args) {
  if (!ffmpegPath) {
    throw new Error(
      "ffmpeg-static nao disponibilizou um binario para esta plataforma."
    );
  }

  await new Promise(
    (
      resolve,
      reject
    ) => {
      const child =
        spawn(
          ffmpegPath,
          args,
          {
            windowsHide:
              true,

            stdio: [
              "ignore",
              "ignore",
              "pipe",
            ],
          }
        );

      let stderr = "";

      child.stderr.on(
        "data",
        (chunk) => {
          stderr +=
            chunk.toString();
        }
      );

      child.on(
        "error",
        reject
      );

      child.on(
        "close",
        (code) => {
          if (code === 0) {
            resolve();
            return;
          }

          reject(
            new Error(
              `FFmpeg terminou com codigo ${code}: ${stderr.slice(-2000)}`
            )
          );
        }
      );
    }
  );
}


export async function buildInstagramReelVideo({
  bannerUrls,
}) {
  if (
    !Array.isArray(
      bannerUrls
    ) ||
    bannerUrls.length !==
      INSTAGRAM_REEL_SLIDE_COUNT
  ) {
    throw new Error(
      "O Reel exige exatamente 3 frames: editorial 1, editorial 2 e CTA."
    );
  }

  const tempDir =
    await mkdtemp(
      path.join(
        os.tmpdir(),
        "wiregeek-reel-"
      )
    );

  try {
    const framePaths = [];

    for (
      let index = 0;
      index <
        bannerUrls.length;
      index++
    ) {
      const sourceBuffer =
        await downloadImage(
          bannerUrls[index]
        );

      const framePath =
        path.join(
          tempDir,
          `frame-${index + 1}.png`
        );

      await prepareVerticalFrame({
        sourceBuffer,
        outputPath:
          framePath,
      });

      framePaths.push(
        framePath
      );
    }

    const outputPath =
      path.join(
        tempDir,
        "instagram-reel.mp4"
      );

    const args = [
      "-y",

      "-loop",
      "1",
      "-framerate",
      "30",
      "-t",
      String(
        INSTAGRAM_REEL_FRAME_SECONDS[0]
      ),
      "-i",
      framePaths[0],

      "-loop",
      "1",
      "-framerate",
      "30",
      "-t",
      String(
        INSTAGRAM_REEL_FRAME_SECONDS[1]
      ),
      "-i",
      framePaths[1],

      "-loop",
      "1",
      "-framerate",
      "30",
      "-t",
      String(
        INSTAGRAM_REEL_FRAME_SECONDS[2]
      ),
      "-i",
      framePaths[2],

      "-f",
      "lavfi",
      "-t",
      String(
        INSTAGRAM_REEL_DURATION_SECONDS
      ),
      "-i",
      "anullsrc=r=48000:cl=stereo",

      "-filter_complex",
      [
        "[0:v]fps=30,",
        "scale=1080:1920,",
        "setsar=1[v0];",

        "[1:v]fps=30,",
        "scale=1080:1920,",
        "setsar=1[v1];",

        "[2:v]fps=30,",
        "scale=1080:1920,",
        "setsar=1[v2];",

        "[v0][v1][v2]",
        "concat=n=3:v=1:a=0[outv]",
      ].join(""),

      "-map",
      "[outv]",

      "-map",
      "3:a:0",

      "-c:v",
      "libx264",

      "-preset",
      "medium",

      "-crf",
      "20",

      "-pix_fmt",
      "yuv420p",

      "-r",
      "30",

      "-c:a",
      "aac",

      "-ar",
      "48000",

      "-b:a",
      "128k",

      "-shortest",

      "-movflags",
      "+faststart",

      outputPath,
    ];

    await runFfmpeg(
      args
    );

    const buffer =
      await readFile(
        outputPath
      );

    if (
      !buffer ||
      buffer.length === 0
    ) {
      throw new Error(
        "FFmpeg gerou um MP4 vazio."
      );
    }

    return {
      buffer,

      content_type:
        "video/mp4",

      width:
        INSTAGRAM_REEL_WIDTH,

      height:
        INSTAGRAM_REEL_HEIGHT,

      duration_seconds:
        INSTAGRAM_REEL_DURATION_SECONDS,

      /*
       * Mantido somente por compatibilidade.
       * Agora os frames possuem duracoes diferentes.
       */
      slide_seconds:
        null,

      frame_seconds:
        [...INSTAGRAM_REEL_FRAME_SECONDS],

      slides:
        INSTAGRAM_REEL_SLIDE_COUNT,

      bytes:
        buffer.length,
    };
  }
  finally {
    await rm(
      tempDir,
      {
        recursive:
          true,

        force:
          true,
      }
    );
  }
}


export async function uploadInstagramReelVideo({
  supabase,
  publicationGroupId,
  buffer,
  bucket = "wiregeek-banners",
}) {
  if (
    !supabase
  ) {
    throw new Error(
      "Cliente Supabase ausente."
    );
  }

  const groupId =
    cleanText(
      publicationGroupId
    );

  if (!groupId) {
    throw new Error(
      "publication_group_id ausente."
    );
  }

  if (
    !Buffer.isBuffer(
      buffer
    ) ||
    buffer.length === 0
  ) {
    throw new Error(
      "Buffer MP4 invalido."
    );
  }

  const storagePath =
    `instagram-reels/${groupId}.mp4`;

  const {
    error:
      uploadError,
  } =
    await supabase
      .storage
      .from(bucket)
      .upload(
        storagePath,
        buffer,
        {
          contentType:
            "video/mp4",

          upsert:
            true,

          cacheControl:
            "3600",
        }
      );

  if (uploadError) {
    throw new Error(
      `Nao foi possivel salvar o Reel no Supabase Storage: ${uploadError.message}`
    );
  }

  const {
    data:
      publicUrlData,
  } =
    supabase
      .storage
      .from(bucket)
      .getPublicUrl(
        storagePath
      );

  const videoUrl =
    cleanText(
      publicUrlData?.publicUrl
    );

  if (!videoUrl) {
    throw new Error(
      "Supabase nao retornou URL publica do Reel."
    );
  }

  return {
    bucket,

    storage_path:
      storagePath,

    video_url:
      videoUrl,
  };
}


export async function uploadImmutableInstagramReelVideo({
  supabase,
  publicationGroupId,
  buffer,
  bucket = "wiregeek-banners",
}) {
  if (!supabase) {
    throw new Error(
      "Cliente Supabase ausente."
    );
  }

  const groupId =
    cleanText(
      publicationGroupId
    );

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      groupId
    )
  ) {
    throw new Error(
      "publication_group_id invalido."
    );
  }

  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length === 0
  ) {
    throw new Error(
      "Buffer MP4 invalido."
    );
  }

  const {
    createHash,
  } =
    await import(
      "node:crypto"
    );

  const sha256 =
    createHash("sha256")
      .update(buffer)
      .digest("hex")
      .toLowerCase();

  const hashPrefix =
    sha256.slice(0, 16);

  const folder =
    "instagram-reels";

  const filename =
    `${groupId}-${hashPrefix}.mp4`;

  const storagePath =
    `${folder}/${filename}`;

  const {
    data: existingFiles,
    error: listError,
  } =
    await supabase
      .storage
      .from(bucket)
      .list(
        folder,
        {
          limit: 100,

          search:
            `${groupId}-`,

          sortBy: {
            column: "name",
            order: "asc",
          },
        }
      );

  if (listError) {
    throw new Error(
      `Nao foi possivel consultar os MP4 existentes: ${listError.message}`
    );
  }

  const pattern =
    new RegExp(
      `^${groupId}-([0-9a-f]{16})\\.mp4$`,
      "i"
    );

  const candidates =
    Array.isArray(existingFiles)
      ? existingFiles.filter(
          (item) =>
            pattern.test(
              String(
                item?.name ||
                ""
              )
            )
        )
      : [];

  /*
   * Idempotencia:
   *
   * se o MESMO asset ja existir,
   * validamos o SHA real e o reutilizamos.
   *
   * Se existir outro hash para o grupo,
   * interrompemos. Nunca sobrescrevemos.
   */
  if (candidates.length > 0) {
    if (
      candidates.length !== 1 ||
      String(
        candidates[0]?.name ||
        ""
      ) !== filename
    ) {
      throw new Error(
        `Conflito de MP4 imutavel para o grupo ${groupId}. Auditoria manual obrigatoria.`
      );
    }

    const {
      data: existingBlob,
      error: existingDownloadError,
    } =
      await supabase
        .storage
        .from(bucket)
        .download(
          storagePath
        );

    if (
      existingDownloadError ||
      !existingBlob
    ) {
      throw new Error(
        `Nao foi possivel validar o MP4 imutavel existente: ${
          existingDownloadError?.message ||
          "sem dados"
        }`
      );
    }

    const existingBuffer =
      Buffer.from(
        await existingBlob.arrayBuffer()
      );

    const existingSha256 =
      createHash("sha256")
        .update(existingBuffer)
        .digest("hex")
        .toLowerCase();

    if (
      existingSha256 !== sha256
    ) {
      throw new Error(
        "O MP4 existente possui nome compativel, mas SHA256 diferente."
      );
    }

    const {
      data: existingPublicData,
    } =
      supabase
        .storage
        .from(bucket)
        .getPublicUrl(
          storagePath
        );

    const existingVideoUrl =
      cleanText(
        existingPublicData?.publicUrl
      );

    if (
      !existingVideoUrl.startsWith(
        "https://"
      )
    ) {
      throw new Error(
        "URL publica do MP4 imutavel existente e invalida."
      );
    }

    return {
      bucket,
      storage_path:
        storagePath,
      video_url:
        existingVideoUrl,
      sha256,
      hash_prefix:
        hashPrefix,
      bytes:
        existingBuffer.length,
      reused:
        true,
      immutable:
        true,
    };
  }

  const {
    error: uploadError,
  } =
    await supabase
      .storage
      .from(bucket)
      .upload(
        storagePath,
        buffer,
        {
          contentType:
            "video/mp4",

          /*
           * CRITICO:
           * asset imutavel nunca usa upsert.
           */
          upsert:
            false,

          cacheControl:
            "31536000",
        }
      );

  if (uploadError) {
    throw new Error(
      `Nao foi possivel salvar o MP4 imutavel: ${uploadError.message}`
    );
  }

  const {
    data: publicUrlData,
  } =
    supabase
      .storage
      .from(bucket)
      .getPublicUrl(
        storagePath
      );

  const videoUrl =
    cleanText(
      publicUrlData?.publicUrl
    );

  if (
    !videoUrl.startsWith(
      "https://"
    )
  ) {
    throw new Error(
      "Supabase nao retornou URL HTTPS publica para o MP4 imutavel."
    );
  }

  return {
    bucket,
    storage_path:
      storagePath,
    video_url:
      videoUrl,
    sha256,
    hash_prefix:
      hashPrefix,
    bytes:
      buffer.length,
    reused:
      false,
    immutable:
      true,
  };
}
