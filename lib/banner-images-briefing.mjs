import sharp from "sharp";

import {
  collectSourceImages,
  resolveBannerImages,
  searchImageCandidates,
} from "./shared/banner-images.mjs";

import {
  validateVisualCandidates,
} from "./banner-vision-briefing.mjs";


/*
 * ==========================================================
 * QUALIDADE VISUAL
 * ==========================================================
 *
 * Não obrigamos imagem horizontal.
 *
 * Permitimos:
 * - key visual vertical
 * - still horizontal
 * - arte promocional
 *
 * Mas imagens pequenas demais são rejeitadas antes
 * de chegar ao renderer.
 */

const MIN_SHORT_SIDE = 650;
const MIN_LONG_SIDE = 1000;

const MIN_ASPECT = 0.55;
const MAX_ASPECT = 1.90;


/*
 * ==========================================================
 * TEXTO / RELEVÂNCIA
 * ==========================================================
 */

const SEARCH_STOPWORDS = new Set([
  "official",
  "oficial",
  "image",
  "imagem",
  "visual",
  "key",
  "still",
  "scene",
  "cena",
  "trailer",
  "press",
  "anime",
  "manga",
  "cour",
  "season",
  "temporada",
  "new",
  "novo",
  "nova",
  "character",
  "characters",
  "personagem",
  "personagens",
  "elenco",
  "principal",
  "main",
  "the",
  "and",
  "with",
  "from",
  "for",
  "in",
  "is",
  "of",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "a",
  "o",
  "as",
  "os",
  "em",
  "com",
  "para",
]);


function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function uniqueValues(values) {
  return [
    ...new Set(
      values
        .map((value) =>
          String(value || "").trim()
        )
        .filter(Boolean)
    ),
  ];
}


function contextTerms(banner) {
  const source = normalizeText(
    [
      banner.visual_subject,
      banner.image_query,
      banner.contexto_visual,
    ]
      .filter(Boolean)
      .join(" ")
  );

  return uniqueValues(
    source
      .split(/\s+/)
      .filter(
        (term) =>
          term.length >= 4 &&
          !SEARCH_STOPWORDS.has(term) &&
          !/^\d+$/.test(term)
      )
  ).slice(0, 10);
}


/*
 * Busca externa precisa demonstrar que realmente pertence
 * ao assunto.
 *
 * Exemplo:
 *
 * Chitose sozinho = insuficiente.
 *
 * Chitose + Ramune = muito mais seguro.
 */

function searchCandidateMatchesBanner(
  candidate,
  banner
) {
  const terms = contextTerms(banner);

  if (!terms.length) {
    return true;
  }

  const text = normalizeText(
    [
      candidate?.title,
      candidate?.url,
      candidate?.source_url,
    ]
      .filter(Boolean)
      .join(" ")
  );

  if (!text) {
    return false;
  }

  const matches = terms.filter(
    (term) =>
      text.includes(term)
  );

  const anchor = terms[0];
  const hasSpecificMatch = matches.some((term) => term.length >= 7);

  if (
    anchor &&
    !text.includes(anchor) &&
    !hasSpecificMatch
  ) {
    return false;
  }

  /*
   * Para contexto com vários termos,
   * exige pelo menos dois elementos
   * específicos do assunto.
   */
  const minimum =
    terms.length >= 2
      ? 2
      : 1;

  return matches.length >= minimum || hasSpecificMatch;
}


/*
 * ==========================================================
 * QUALIDADE DA IMAGEM
 * ==========================================================
 */

function imageQualityIssue(image) {
  const width = Number(
    image?.fingerprint?.width || 0
  );

  const height = Number(
    image?.fingerprint?.height || 0
  );

  if (!width || !height) {
    return "dimensões desconhecidas";
  }

  const shortSide =
    Math.min(width, height);

  const longSide =
    Math.max(width, height);

  const aspect =
    width / height;

  if (
    shortSide < MIN_SHORT_SIDE ||
    longSide < MIN_LONG_SIDE
  ) {
    return (
      `resolução insuficiente ` +
      `(${width}x${height})`
    );
  }

  if (
    aspect < MIN_ASPECT ||
    aspect > MAX_ASPECT
  ) {
    return (
      `proporção inadequada ` +
      `(${width}x${height})`
    );
  }

  return "";
}


function rejectedRecord(image) {
  if (!image) {
    return null;
  }

  return {
    image_url:
      image.url || "",

    full_hash:
      image.fingerprint?.fullHash ||
      "",

    crop_hash:
      image.fingerprint?.cropHash ||
      "",
  };
}


function visualValidationQuery(
  banner
) {
  return [
    banner.image_query,
    banner.contexto_visual,
    `Headline do banner: ${banner.banner_title}`,
  ]
    .filter(Boolean)
    .join("\n");
}


/*
 * ==========================================================
 * DOWNLOAD CONTROLADO
 * ==========================================================
 *
 * Reutilizamos o downloader já existente, mas em modo
 * manual e com UMA imagem de cada vez.
 *
 * Assim o modo Briefing controla a decisão editorial.
 */

async function downloadOne(url) {
  const normalized =
    String(url || "").trim();

  if (
    !/^https?:\/\//i.test(
      normalized
    )
  ) {
    return null;
  }

  const images =
    await resolveBannerImages({
      entries: [
        {
          image_url:
            normalized,
        },
      ],

      candidates: [],
      sources: [],
      query: "",
      manual: true,
      rejectedImages: [],
    });

  return images?.[0] || null;
}


/*
 * ==========================================================
 * VALIDAÇÃO VISUAL
 * ==========================================================
 */

async function approveImage({
  image,
  banner,
  label,
}) {
  if (!image) {
    return false;
  }

  const qualityIssue =
    imageQualityIssue(image);

  if (qualityIssue) {
    console.log(
      "WIRE/GEEK BRIEFING: imagem rejeitada por qualidade",
      {
        banner:
          banner.index + 1,

        origem:
          label,

        url:
          image.url,

        motivo:
          qualityIssue,
      }
    );

    return false;
  }

  /*
   * Se BANNER_VISION_ENABLED estiver desligado,
   * validateVisualCandidates retorna skipped.
   *
   * Se estiver ligado, Gemini verifica se a imagem
   * realmente corresponde ao assunto.
   */
  try {
    const cropPreviewBuffer =
      await sharp(image.imageBuffer, {
        limitInputPixels: 50_000_000,
      })
        .rotate()
        .resize(1080, 960, {
          fit: "cover",
          position: "centre",
        })
        .jpeg({
          quality: 88,
        })
        .toBuffer();

    const cropPreviewImage = {
      ...image,
      imageBuffer: cropPreviewBuffer,
    };

    const visualResult =
      await validateVisualCandidates({
        images: [cropPreviewImage],

        subject:
          banner.visual_subject ||
          banner.banner_title,

        query: [
          visualValidationQuery(banner),

          "VALIDAÇÃO DE COMPOSIÇÃO PARA O BANNER:",
          "A imagem enviada representa aproximadamente o crop final usado no layout.",
          "Rejeite a imagem se houver close-up extremo.",
          "Rejeite se rosto, cabeça ou personagem principal estiver excessivamente cortado.",
          "Rejeite se um único rosto ocupar quase todo o frame.",
          "Rejeite se não houver contexto visual suficiente da cena ou da obra.",
          "Prefira plano médio, plano aberto, grupo de personagens ou composição promocional.",
          "A imagem precisa funcionar como fotografia editorial em um banner 1080x960.",
          "Não aprove apenas porque pertence à obra correta.",
        ].join("\n"),

        highlights: [
          banner.highlight,
        ],
      });

    if (visualResult?.skipped) {
      console.log(
        "WIRE/GEEK BRIEFING: revisão de composição por IA está desativada",
        {
          banner:
            banner.index + 1,
        }
      );
    }
  } catch (error) {
    if (
      error?.code ===
      "BANNER_VISUAL_REJECTED"
    ) {
      console.log(
        "WIRE/GEEK BRIEFING: imagem rejeitada pela revisão visual",
        {
          banner:
            banner.index + 1,

          origem:
            label,

          url:
            image.url,

          motivo:
            error.message,
        }
      );

      return false;
    }

    throw error;
  }

  console.log(
    "WIRE/GEEK BRIEFING: imagem aprovada",
    {
      banner:
        banner.index + 1,

      origem:
        label,

      url:
        image.url,

      width:
        image.fingerprint?.width,

      height:
        image.fingerprint?.height,
    }
  );

  return true;
}


/*
 * ==========================================================
 * TESTAR UMA URL
 * ==========================================================
 */

function briefingBaseAssetKey(
  value
) {
  const raw =
    String(value || "").trim();

  if (!raw) {
    return "";
  }

  try {
    const parsed =
      new URL(raw);

    let pathname =
      decodeURIComponent(
        parsed.pathname || ""
      )
        .replace(/\/+/g, "/")
        .toLowerCase();

    /*
     * CDNs podem acrescentar transformacoes
     * depois da extensao original:
     *
     * imagem.jpg/m/filters...
     */
    const imagePath =
      pathname.match(
        /^(.+?\.(?:jpe?g|png|webp|avif))(?:\/.*)?$/i
      );

    if (imagePath) {
      pathname =
        imagePath[1];
    }

    /*
     * Remove sufixos comuns de resize.
     *
     * foto-1200x800.jpg
     * foto-640x480.webp
     */
    pathname =
      pathname.replace(
        /-\d{2,5}x\d{2,5}(?=\.(?:jpe?g|png|webp|avif)$)/i,
        ""
      );

    /*
     * Query string e hash sao deliberadamente
     * ignorados.
     *
     * Assim:
     *
     * foto.jpg?crop=A
     * foto.jpg?crop=B
     *
     * representam o MESMO asset.
     */
    return (
      parsed.hostname
        .toLowerCase()
        .replace(/^www\./, "") +
      pathname
    );
  }
  catch {
    return raw
      .split(/[?#]/, 1)[0]
      .toLowerCase();
  }
}


function sameBriefingBaseAsset(
  firstUrl,
  secondUrl
) {
  const firstKey =
    briefingBaseAssetKey(
      firstUrl
    );

  const secondKey =
    briefingBaseAssetKey(
      secondUrl
    );

  return Boolean(
    firstKey &&
    secondKey &&
    firstKey === secondKey
  );
}

async function tryImageUrl({
  url,
  banner,
  label,
  attemptedUrls,
  blockedUrls,
}) {
  const normalized =
    String(url || "").trim();

  if (
    !/^https?:\/\//i.test(
      normalized
    )
  ) {
    return null;
  }

  if (
    attemptedUrls.has(
      normalized
    )
  ) {
    return null;
  }

  const blockedByExactUrl =
    blockedUrls.has(
      normalized
    );

  const blockedByBaseAsset =
    [...blockedUrls].some(
      (blockedUrl) =>
        sameBriefingBaseAsset(
          normalized,
          blockedUrl
        )
    );

  if (
    blockedByExactUrl ||
    blockedByBaseAsset
  ) {
    if (
      blockedByBaseAsset &&
      !blockedByExactUrl
    ) {
      console.log(
        "WIRE/GEEK BRIEFING: candidato ignorado por mesmo arquivo-base",
        {
          banner:
            banner.index + 1,

          candidato:
            normalized,

          asset_key:
            briefingBaseAssetKey(
              normalized
            ),
        }
      );
    }

    return null;
  }

  attemptedUrls.add(
    normalized
  );

  try {
    const image =
      await downloadOne(
        normalized
      );

    const approved =
      await approveImage({
        image,
        banner,
        label,
      });

    return approved
      ? image
      : null;
  } catch (error) {
    console.log(
      "WIRE/GEEK BRIEFING: falha ao testar imagem",
      {
        banner:
          banner.index + 1,

        origem:
          label,

        url:
          normalized,

        erro:
          error.message,
      }
    );

    return null;
  }
}


/*
 * ==========================================================
 * BUSCA EXTERNA ESPECÍFICA
 * ==========================================================
 */

function buildSearchQueries(
  request,
  banner
) {
  const category =
    String(
      request.categoria || ""
    ).toLowerCase();

  const queries = [
    banner.image_query,

    [
      banner.visual_subject,
      category === "anime"
        ? "official anime key visual"
        : "official press image",
    ]
      .filter(Boolean)
      .join(" "),

    [
      request.titulo,
      category === "anime"
        ? "official anime trailer still"
        : "official image",
    ]
      .filter(Boolean)
      .join(" "),
  ];

  return uniqueValues(
    queries
  ).slice(0, 3);
}


async function fetchBriefingImageSearch(
  url,
  options = {}
) {
  const retryableStatus =
    new Set([
      408,
      429,
      500,
      502,
      503,
      504,
    ]);

  let lastError = null;

  for (
    let attempt = 1;
    attempt <= 2;
    attempt++
  ) {
    try {
      const response =
        await fetch(url, {
          ...options,
          signal:
            AbortSignal.timeout(10000),
        });
      /*
       * Diagnostico temporario da SerpAPI.
       *
       * Nao altera retries, selecao de imagens ou renderer.
       * Apenas registra de forma sanitizada o motivo real
       * quando a busca externa retorna HTTP 429.
       */
      if (response.status === 429) {
        let body = "";

        try {
          body =
            await response
              .clone()
              .text();
        } catch {
          body = "";
        }

        const serpApiKey =
          process.env.SERPAPI_KEY ||
          "";

        let safeBody =
          String(body);

        if (serpApiKey) {
          safeBody =
            safeBody
              .split(serpApiKey)
              .join("[CHAVE OCULTA]")
              .split(
                encodeURIComponent(
                  serpApiKey
                )
              )
              .join("[CHAVE OCULTA]");
        }

        safeBody =
          safeBody
            .replace(
              /https?:\/\/\S+/gi,
              "[URL OCULTA]"
            )
            .replace(
              /api[_-]?key\s*[:=]\s*\S+/gi,
              "api_key=[OCULTA]"
            )
            .slice(0, 800);

        const quotaExhausted =
          /run out of searches/i.test(
            safeBody
          );

        if (quotaExhausted) {
          const error =
            new Error(
              "A busca externa de imagens esta indisponivel porque a conta SerpAPI ficou sem buscas disponiveis."
            );

          error.code =
            "SERPAPI_QUOTA_EXHAUSTED";

          error.statusCode =
            503;

          console.error(
            "WIRE/GEEK BRIEFING: SerpAPI sem cota de buscas"
          );

          throw error;
        }

        console.error(
          "WIRE/GEEK BRIEFING: detalhe HTTP 429 SerpAPI",
          {
            retry_after:
              response.headers.get(
                "retry-after"
              ),

            corpo:
              safeBody,
          }
        );
      }
      if (
        response.ok ||
        !retryableStatus.has(
          response.status
        ) ||
        attempt === 2
      ) {
        return response;
      }

      try {
        await response.body?.cancel();
      } catch {}

      console.log(
        "WIRE/GEEK BRIEFING: repetindo busca de imagem após HTTP transitório",
        {
          tentativa:
            attempt,
          status:
            response.status,
        }
      );
    } catch (error) {
            if (
        error?.code ===
        "SERPAPI_QUOTA_EXHAUSTED"
      ) {
        throw error;
      }
lastError = error;

      if (attempt === 2) {
        throw error;
      }

      console.log(
        "WIRE/GEEK BRIEFING: repetindo busca de imagem após falha transitória",
        {
          tentativa:
            attempt,
          erro:
            error?.name ||
            "erro",
        }
      );
    }

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          600 * attempt
        )
    );
  }

  throw (
    lastError ||
    new Error(
      "Falha transitória na busca de imagens."
    )
  );
}

async function searchExternalImages({
  request,
  banner,
}) {
  const apiKey =
    process.env.SERPAPI_KEY ||
    "";

  if (!apiKey) {
    console.log(
      "WIRE/GEEK BRIEFING: SERPAPI_KEY ausente; busca externa ignorada."
    );

    return [];
  }

  const results = [];

  for (
    const query of
    buildSearchQueries(
      request,
      banner
    )
  ) {
    console.log(
      "WIRE/GEEK BRIEFING: buscando imagem",
      {
        banner:
          banner.index + 1,

        consulta:
          query,
      }
    );

    const found =
      await searchImageCandidates(
        query,
        {
          apiKey,
          fetchImpl:
            fetchBriefingImageSearch,

          /*
           * Mantemos a consulta completa.
           * Nunca reduzimos para apenas:
           *
           * "Chitose"
           */
          semanticQuery:
            query,
        }
      );

    for (
      const candidate of found
    ) {
      if (
        !searchCandidateMatchesBanner(
          candidate,
          banner
        )
      ) {
        console.log(
          "WIRE/GEEK BRIEFING: resultado de busca descartado por baixa relevância",
          {
            banner:
              banner.index + 1,

            titulo:
              candidate?.title ||
              "",

            url:
              candidate?.url ||
              "",
          }
        );

        continue;
      }

      results.push(
        candidate
      );
    }

    if (
      results.length >= 12
    ) {
      break;
    }
  }

  const seen =
    new Set();

  return results.filter(
    (candidate) => {
      const url =
        String(
          candidate?.url || ""
        ).trim();

      if (
        !url ||
        seen.has(url)
      ) {
        return false;
      }

      seen.add(url);

      return true;
    }
  );
}


/*
 * ==========================================================
 * RESOLVER UM BANNER
 * ==========================================================
 */

async function resolveOneBanner({
  request,
  banner,
  sourceCandidates,
  blockedUrls = new Set(),
}) {
  const attemptedUrls =
    new Set();


  /*
   * --------------------------------------------------------
   * PRIORIDADE 1
   * imagem explicitamente escolhida pelo Briefing
   * --------------------------------------------------------
   */

  if (banner.image_url) {
    const selected =
      await tryImageUrl({
        url:
          banner.image_url,

        banner,

        label:
          "imagem explícita do briefing",

        attemptedUrls,
        blockedUrls,
      });

    if (selected) {
      return selected;
    }
  }


  /*
   * --------------------------------------------------------
   * PRIORIDADE 2
   * outras imagens fornecidas pelo Briefing
   * --------------------------------------------------------
   */

  for (
    const candidate of
    banner.image_candidates || []
  ) {
    const selected =
      await tryImageUrl({
        url:
          candidate?.url ||
          candidate,

        banner,

        label:
          "candidato do briefing",

        attemptedUrls,
        blockedUrls,
      });

    if (selected) {
      return selected;
    }
  }


  /*
   * --------------------------------------------------------
   * PRIORIDADE 3
   * imagens extraídas da página da própria matéria
   * --------------------------------------------------------
   */

  for (
    const candidate of
    sourceCandidates
  ) {
    const selected =
      await tryImageUrl({
        url:
          candidate?.url ||
          candidate,

        banner,

        label:
          "fonte editorial",

        attemptedUrls,
        blockedUrls,
      });

    if (selected) {
      return selected;
    }
  }


  /*
   * --------------------------------------------------------
   * PRIORIDADE 4
   * busca externa específica para ESTE banner
   * --------------------------------------------------------
   */

  const externalCandidates =
    await searchExternalImages({
      request,
      banner,
    });

  for (
    const candidate of
    externalCandidates
  ) {
    const selected =
      await tryImageUrl({
        url:
          candidate.url,

        banner,

        label:
          `busca externa: ${
            candidate.title ||
            "resultado"
          }`,

        attemptedUrls,
        blockedUrls,
      });

    if (selected) {
      return selected;
    }
  }


  throw new Error(
    `Não encontrei imagem adequada para o banner ${banner.index + 1}: ${banner.banner_title}`
  );
}


/*
 * ==========================================================
 * VERIFICAR PAR FINAL
 * ==========================================================
 *
 * Usa a checagem técnica de similaridade do pipeline.
 *
 * Aqui ela é usada SOMENTE como verificador técnico.
 */

async function verifyFinalPair(
  first,
  second
) {
  /*
   * Defesa final:
   *
   * dois crops/tamanhos/qualidades do mesmo
   * arquivo nunca constituem duas imagens.
   */
  if (
    sameBriefingBaseAsset(
      first?.url,
      second?.url
    )
  ) {
    console.log(
      "WIRE/GEEK BRIEFING: par rejeitado por mesmo arquivo-base",
      {
        banner1:
          first?.url || "",

        banner2:
          second?.url || "",

        asset_key:
          briefingBaseAssetKey(
            first?.url
          ),
      }
    );

    return null;
  }

  try {
    const pair =
      await resolveBannerImages({
        entries: [
          {
            image_url:
              first.url,
          },
          {
            image_url:
              second.url,
          },
        ],

        candidates: [],
        sources: [],
        query: "",
        manual: true,
        rejectedImages: [],
      });

    return pair;
  } catch (error) {
    console.log(
      "WIRE/GEEK BRIEFING: par rejeitado por similaridade",
      {
        erro:
          error.message,
      }
    );

    return null;
  }
}


/*
 * ==========================================================
 * FUNÇÃO PRINCIPAL
 * ==========================================================
 */

export async function
resolveBriefingBannerImages(
  request
) {
  if (
    !request ||
    request.mode !== "briefing"
  ) {
    throw new Error(
      "Payload inválido para o resolvedor Briefing."
    );
  }

  const banners =
    Array.isArray(
      request.banners
    )
      ? request.banners.filter(
          (banner) =>
            String(
              banner?.type ||
              "editorial"
            )
              .trim()
              .toLowerCase() ===
            "editorial"
        )
      : [];

  if (
    banners.length !== 2
  ) {
    throw new Error(
      "O modo Briefing exige exatamente dois banners."
    );
  }


  /*
   * Carrega imagens encontradas nas páginas das fontes
   * uma única vez.
   */

  let sourceCandidates = [];

  if (
    Array.isArray(
      request.source_urls
    ) &&
    request.source_urls.length
  ) {
    try {
      sourceCandidates =
        await collectSourceImages(
          request.source_urls
        );

      console.log(
        "WIRE/GEEK BRIEFING: imagens encontradas nas fontes",
        {
          quantidade:
            sourceCandidates.length,
        }
      );
    } catch (error) {
      console.log(
        "WIRE/GEEK BRIEFING: não foi possível coletar imagens das fontes",
        {
          erro:
            error.message,
        }
      );

      sourceCandidates = [];
    }
  }


  /*
   * ========================================================
   * BANNER 1
   * ========================================================
   */

  const first =
    await resolveOneBanner({
      request,

      banner:
        banners[0],

      sourceCandidates,

      blockedUrls:
        new Set(),
    });


  /*
   * ========================================================
   * BANNER 2
   *
   * A URL usada no primeiro banner já fica bloqueada.
   * ========================================================
   */

  const blockedSecond =
    new Set([
      first.url,
    ]);

  let second =
    await resolveOneBanner({
      request,

      banner:
        banners[1],

      sourceCandidates,

      blockedUrls:
        blockedSecond,
    });


  /*
   * Verificação final:
   * não basta URL diferente.
   *
   * O sistema antigo já possui fingerprint para detectar
   * imagem igual ou muito semelhante.
   */

  let verified =
    await verifyFinalPair(
      first,
      second
    );


  /*
   * Se a segunda imagem for visualmente quase igual
   * à primeira, rejeitamos somente a segunda e buscamos
   * outra.
   */

  if (!verified) {
    blockedSecond.add(
      second.url
    );

    console.log(
      "WIRE/GEEK BRIEFING: procurando outra imagem para o banner 2."
    );

    second =
      await resolveOneBanner({
        request,

        banner:
          banners[1],

        sourceCandidates,

        blockedUrls:
          blockedSecond,
      });

    verified =
      await verifyFinalPair(
        first,
        second
      );
  }


  if (!verified) {
    throw new Error(
      "Não foi possível obter duas imagens distintas e adequadas para os banners."
    );
  }


  console.log(
    "WIRE/GEEK BRIEFING: par visual aprovado",
    {
      banner1: {
        url:
          verified[0].url,

        width:
          verified[0]
            .fingerprint
            ?.width,

        height:
          verified[0]
            .fingerprint
            ?.height,
      },

      banner2: {
        url:
          verified[1].url,

        width:
          verified[1]
            .fingerprint
            ?.width,

        height:
          verified[1]
            .fingerprint
            ?.height,
      },
    }
  );


  return verified;
}
