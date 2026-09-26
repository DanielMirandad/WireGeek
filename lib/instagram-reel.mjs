import { normalizeInstagramProfiles, selectInstagramProfiles, selectInstagramProfilesV1 } from "./instagram-profiles.mjs";
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

/*
 * O Reel roda dentro do limite de memoria da Function.
 *
 * O cache do libvips e desabilitado e a concorrencia fica
 * limitada a um worker para evitar picos de memoria durante
 * resize, blur e composicao.
 */
sharp.cache(false);
sharp.concurrency(1);


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
  profileUsernames = [],
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

  const profiles = normalizeInstagramProfiles(profileUsernames);

  const caption =
    [
      fullArticle,
      INSTAGRAM_REEL_CAPTION_FOOTER,
      ...(profiles.length ? [`Perfis: ${profiles.map((name) => `@${name}`).join(" ")}`] : []),
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
    profile_usernames: profiles,

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


export function buildGroupInstagramReelCaption({
  article,
  hashtags,
  group,
}) {
  const noProfiles =
    buildInstagramReelCaption({
      article,
      hashtags,
    });

  const hasContainer =
    group.some(
      (row) =>
        row.instagram_parent_container_id
    );

  const hashes =
    group.map(
      (row) =>
        String(
          row.instagram_caption_sha256 ||
          ""
        ).toLowerCase()
    );

  /*
   * Containers anteriores a qualquer suporte a perfis.
   */
  if (
    hasContainer &&
    hashes.every(
      (hash) =>
        hash ===
        noProfiles.caption_sha256
    )
  ) {
    return noProfiles;
  }

  /*
   * Containers criados com o catalogo V1.
   *
   * Esta verificacao precisa acontecer ANTES do V2
   * para preservar byte a byte captions ja persistidas.
   */
  const v1 =
    buildInstagramReelCaption({
      article,
      hashtags,
      profileUsernames:
        selectInstagramProfilesV1(article),
    });

  if (
    hasContainer &&
    hashes.every(
      (hash) =>
        hash ===
        v1.caption_sha256
    )
  ) {
    return v1;
  }

  /*
   * Novos Reels usam o catalogo ampliado V2.
   */
  const v2 =
    buildInstagramReelCaption({
      article,
      hashtags,
      profileUsernames:
        selectInstagramProfiles(article),
    });

  if (
    hasContainer &&
    !hashes.every(
      (hash) =>
        hash ===
        v2.caption_sha256
    )
  ) {
    throw new Error(
      "Legenda ou perfis divergentes do container persistido. Auditoria manual obrigatória."
    );
  }

  return v2;
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
   * Evita manter background e foreground simultaneamente
   * como grandes Buffers no heap.
   *
   * O background desfocado e o foreground original sao
   * materializados em disco e compostos sequencialmente.
   */
  const backgroundPath =
    `${outputPath}.background.png`;

  const foregroundPath =
    `${outputPath}.foreground`;

  try {
    await writeFile(
      foregroundPath,
      sourceBuffer
    );

    await sharp(
      sourceBuffer,
      {
        sequentialRead:
          true,
      }
    )
      .resize(
        INSTAGRAM_REEL_WIDTH,
        INSTAGRAM_REEL_HEIGHT,
        {
          fit:
            "cover",
        }
      )
      .blur(28)
      .modulate({
        brightness:
          0.5,
      })
      .png({
        compressionLevel:
          9,
      })
      .toFile(
        backgroundPath
      );

    await sharp(
      backgroundPath,
      {
        sequentialRead:
          true,
      }
    )
      .composite([
        {
          input:
            foregroundPath,

          gravity:
            "center",
        },
      ])
      .png({
        compressionLevel:
          9,
      })
      .toFile(
        outputPath
      );
  }
  finally {
    await rm(
      backgroundPath,
      {
        force:
          true,
      }
    );

    await rm(
      foregroundPath,
      {
        force:
          true,
      }
    );
  }
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
    const framePaths =
      [];

    /*
     * Os frames sao preparados um por vez.
     *
     * O Sharp esta com cache desabilitado e concurrency=1.
     */
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

    /*
     * Cada slide vira um MP4 independente.
     *
     * Isso elimina o filter_complex anterior, que mantinha
     * tres streams 1080x1920 ativos simultaneamente.
     */
    const segmentPaths =
      [];

    for (
      let index = 0;
      index <
        framePaths.length;
      index++
    ) {
      const seconds =
        INSTAGRAM_REEL_FRAME_SECONDS[
          index
        ];

      const segmentPath =
        path.join(
          tempDir,
          `segment-${index + 1}.mp4`
        );

      const args = [
        "-y",

        "-loop",
        "1",

        "-framerate",
        "30",

        "-t",
        String(
          seconds
        ),

        "-i",
        framePaths[index],

        "-f",
        "lavfi",

        "-t",
        String(
          seconds
        ),

        "-i",
        "anullsrc=r=48000:cl=stereo",

        "-vf",
        "fps=30,scale=1080:1920,setsar=1",

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

        /*
         * Um unico encoder thread evita o pico de memoria
         * criado pelo paralelismo automatico do x264.
         */
        "-threads",
        "1",

        "-c:a",
        "aac",

        "-ar",
        "48000",

        "-b:a",
        "128k",

        "-t",
        String(
          seconds
        ),

        "-shortest",

        "-movflags",
        "+faststart",

        segmentPath,
      ];

      await runFfmpeg(
        args
      );

      segmentPaths.push(
        segmentPath
      );
    }

    /*
     * Os tres segmentos possuem os mesmos codecs e parametros.
     *
     * A concatenacao final usa stream copy, portanto nao abre
     * outro encoder H.264 e praticamente nao aumenta a memoria.
     */
    const concatPath =
      path.join(
        tempDir,
        "segments.txt"
      );

    const concatContent =
      segmentPaths
        .map(
          (segmentPath) =>
            `file '${segmentPath.replace(
              /\\/g,
              "/"
            )}'`
        )
        .join("\n") +
      "\n";

    await writeFile(
      concatPath,
      concatContent,
      "utf8"
    );

    const outputPath =
      path.join(
        tempDir,
        "instagram-reel.mp4"
      );

    await runFfmpeg([
      "-y",

      "-f",
      "concat",

      "-safe",
      "0",

      "-i",
      concatPath,

      "-c",
      "copy",

      "-movflags",
      "+faststart",

      outputPath,
    ]);

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

      slide_seconds:
        null,

      frame_seconds:
        [
          ...INSTAGRAM_REEL_FRAME_SECONDS,
        ],

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
