import sharp from "sharp";

import {
  collectSourceImages,
  resolveBannerImages,
  searchImageCandidates,
  searchBraveImageCandidates,
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
  /*
   * A relevancia visual precisa partir primeiro
   * do assunto que a imagem deve representar.
   *
   * Copy editorial pode conter termos genericos:
   * plataforma, estreia, anunciou, definiu etc.
   *
   * Se esses termos ocuparem o limite antes de
   * image_query / visual_subject, uma imagem correta
   * da obra pode ser rejeitada pelo guard semantico.
   *
   * Mantemos titulo e highlight como contexto
   * complementar depois do assunto visual.
   */
  const source = normalizeText(
    [
      banner.image_query,
      banner.visual_subject,
      banner.contexto_visual,
      banner.banner_title,
      banner.highlight,
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

  /*
   * Nao usamos o primeiro termo como ancora obrigatoria.
   *
   * O primeiro termo pode ser editorial/generico
   * ("ator", "estreia", "adaptacao"), enquanto o
   * candidato correto demonstra relevancia por entidades
   * especificas como Billy + Boyd + Pippin ou Legend + Zelda.
   */
  const hasSpecificMatch =
    matches.some(
      (term) =>
        term.length >= 7
    );

  /*
   * Para contexto com vários termos,
   * exige pelo menos dois elementos
   * específicos do assunto.
   */
  const minimum =
    terms.length >= 2
      ? 2
      : 1;

  /*
   * A validacao principal continua sendo o angulo
   * editorial especifico deste banner.
   */
  if (
    matches.length >= minimum ||
    hasSpecificMatch
  ) {
    return true;
  }

  /*
   * O segundo banner usa propositalmente uma busca
   * mais diversa.
   *
   * Quando a copy do slide e generica
   * ("painel", "evento", "comemorar"...), uma imagem
   * editorial correta pode demonstrar relevancia pelas
   * entidades do assunto em vez das palavras da copy.
   *
   * Essa segunda chance vale SOMENTE para o banner 2.
   * O banner 1 permanece com a validacao estrita acima.
   */
  if (Number(banner?.index) !== 1) {
    return false;
  }

  const subjectSource =
    normalizeText(
      [
        banner.image_query,
        banner.visual_subject,
        banner.contexto_visual,
      ]
        .filter(Boolean)
        .join(" ")
    );

  const subjectTerms =
    uniqueValues(
      subjectSource
        .split(/\s+/)
        .filter(
          (term) =>
            term.length >= 4 &&
            !SEARCH_STOPWORDS.has(term) &&
            !/^\d+$/.test(term)
        )
    ).slice(0, 12);

  const subjectMatches =
    subjectTerms.filter(
      (term) =>
        text.includes(term)
    );

  /*
   * Exigimos pelo menos dois sinais do assunto.
   *
   * Um deles precisa ser forte:
   * - conter numero, como CCXP26;
   * - ou possuir 7+ caracteres.
   *
   * Isso evita liberar candidatos por palavras
   * genericas isoladas.
   */
  const hasStrongSubjectMatch =
    subjectMatches.some(
      (term) =>
        /\d/.test(term) ||
        term.length >= 7
    );

  const acceptedBySubject =
    subjectMatches.length >= 2 &&
    hasStrongSubjectMatch;

  if (acceptedBySubject) {
    console.log(
      "WIRE/GEEK BRIEFING: banner 2 aceito por relevancia do assunto",
      {
        banner:
          banner.index + 1,

        titulo:
          candidate?.title ||
          "",

        termos:
          subjectMatches,
      }
    );
  }

  return acceptedBySubject;
}


/*
 * ==========================================================
 * QUALIDADE DA IMAGEM
 * ==========================================================
 */

function imageQualityIssue(
  image,
  imageProfile = "default"
) {
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

  const minShortSide =
    imageProfile === "brand_logo"
      ? 400
      : MIN_SHORT_SIDE;

  const minLongSide =
    imageProfile === "brand_logo"
      ? 800
      : MIN_LONG_SIDE;

  const minAspect =
    imageProfile === "brand_logo"
      ? 0.55
      : MIN_ASPECT;

  const maxAspect =
    imageProfile === "brand_logo"
      ? 1.90
      : MAX_ASPECT;

  if (
    shortSide < minShortSide ||
    longSide < minLongSide
  ) {
    return (
      `resolução insuficiente ` +
      `(${width}x${height})`
    );
  }

  if (
    aspect < minAspect ||
    aspect > maxAspect
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
    }, {
      downloadTimeoutMs: 15000,
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
  imageProfile = "default",
}) {
  if (!image) {
    return false;
  }

  const qualityIssue =
    imageQualityIssue(
      image,
      imageProfile
    );

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
  imageProfile = "default",
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
        imageProfile,
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

function isCorporateGameAngle(
  request,
  banner
) {
  const category =
    String(
      request?.categoria || ""
    ).toLowerCase();

  const angleText =
    normalizeText(
      [
        banner?.banner_title,
        banner?.highlight,
      ]
        .filter(Boolean)
        .join(" ")
    );

  const corporateActors =
    /\b(microsoft|xbox|sony|playstation|nintendo|activision|ubisoft|electronic arts|embracer|tencent|sega|capcom)\b/;

  const corporateEvents =
    /\b(demissao|demissoes|funcionario|funcionarios|layoff|layoffs|employee|employees|workforce|reorganizacao|reorganiza|reestruturacao|restructuring|cortes|corte|empregos|emprego)\b/;

  return (
    category === "games" &&
    corporateActors.test(
      angleText
    ) &&
    corporateEvents.test(
      angleText
    )
  );
}


function decodeEmbeddedCandidateText(
  value
) {
  const raw =
    String(value || "");

  const decoded = [];

  /*
   * Alguns CDNs/resizers guardam a URL original
   * da imagem em Base64 dentro do path.
   *
   * Exemplo real encontrado:
   * .../aHR0.../halo-sad-master-chief.jpg.webp
   *
   * O objetivo aqui nao e confiar no conteudo
   * decodificado, apenas torna-lo pesquisavel
   * pelo guard semantico.
   */
  const segments =
    raw.split(/[/?&=]/);

  for (
    const segment of segments
  ) {
    let candidate =
      String(segment || "")
        .trim()
        .replace(
          /\.(?:jpe?g|png|webp|avif)$/i,
          ""
        );

    if (
      candidate.length < 24 ||
      !/^[A-Za-z0-9_-]+={0,2}$/.test(
        candidate
      )
    ) {
      continue;
    }

    try {
      candidate =
        candidate
          .replace(/-/g, "+")
          .replace(/_/g, "/");

      const padding =
        (4 -
          (candidate.length % 4)) %
        4;

      const padded =
        candidate +
        "=".repeat(padding);

      const text =
        Buffer
          .from(
            padded,
            "base64"
          )
          .toString("utf8");

      if (
        /https?:\/\/|halo|master[ -]?chief|gameplay|screenshot/i.test(
          text
        )
      ) {
        decoded.push(text);
      }
    } catch {
      /*
       * Segmento nao era Base64 valido.
       * Apenas ignoramos.
       */
    }
  }

  return decoded.join(" ");
}


function corporateCandidateBlockReason(
  candidate,
  request,
  banner
) {
  const imageUrl =
    String(
      candidate?.url ||
      ""
    );

  const sourceUrl =
    String(
      candidate?.source_url ||
      ""
    );

  const title =
    String(
      candidate?.title ||
      ""
    );

  const angleText =
    normalizeText(
      [
        banner?.banner_title,
        banner?.highlight,
      ]
        .filter(Boolean)
        .join(" ")
    );

  const requestText =
    normalizeText(
      request?.titulo ||
      ""
    );

  const candidateText =
    normalizeText(
      [
        title,
        imageUrl,
        sourceUrl,
        decodeEmbeddedCandidateText(
          imageUrl
        ),
        decodeEmbeddedCandidateText(
          sourceUrl
        ),
      ]
        .filter(Boolean)
        .join(" ")
    );

  /*
   * Conteudo visual inadequado para
   * um slide corporativo.
   */
  if (
    /\b(master chief|masterchief|gameplay|screenshot|wallpaper|cosplay|fanart)\b/
      .test(candidateText)
  ) {
    return "asset_visual_nao_corporativo";
  }

  /*
   * Regra contextual:
   *
   * Se Halo esta na materia geral, mas NAO esta
   * no titulo/highlight deste banner corporativo,
   * qualquer candidato visual associado a Halo
   * deve ser descartado.
   *
   * Isso impede que a franquia contamine
   * um slide cujo assunto e Microsoft/Xbox
   * corporativo.
   */
  const haloOutsideAngle =
    requestText.includes("halo") &&
    !angleText.includes("halo") &&
    /\bhalo\b/.test(
      candidateText
    );

  if (haloOutsideAngle) {
    return "franquia_halo_fora_do_angulo";
  }

  return "";
}

/*
 * ==========================================================
 * DIVERSIDADE VISUAL DO SEGUNDO EDITORIAL
 * ==========================================================
 *
 * Nao altera deduplicacao, qualidade ou renderer.
 *
 * Somente quando o segundo slide possui um angulo
 * explicitamente ligado a painel, palco, reuniao ou
 * celebracao, a busca recebe qualificadores que
 * favorecem composicoes coletivas e planos mais abertos.
 */

function secondBannerDiversityProfile(
  banner
) {
  if (Number(banner?.index) !== 1) {
    return {
      active: false,
      qualifier: "",
    };
  }

  const angleText =
    normalizeText(
      [
        banner?.banner_title,
        banner?.highlight,
        banner?.contexto_visual,
      ]
        .filter(Boolean)
        .join(" ")
    );

  const strongEventAngle =
    /\b(painel|panel|palco|stage|reuniao|reunion|celebracao|celebration|aniversario|anniversary)\b/
      .test(angleText);

  const contextualEventAngle =
    /\b(evento|event|programacao)\b/
      .test(angleText) &&
    /\b(comemorar|comemoracao|celebracao|celebration|painel|panel)\b/
      .test(angleText);

  const active =
    strongEventAngle ||
    contextualEventAngle;

  return {
    active,

    qualifier:
      active
        ? "official panel stage group cast event photo wide shot"
        : "",
  };
}

function brandLogoFallbackProfile(request, banner) {
  const source = [
    request?.titulo,
    banner?.image_query,
    banner?.visual_subject,
    banner?.contexto_visual,
  ].filter(Boolean).join(' ');

  const normalized = normalizeText(source);

  const event = source.match(
    /\b(CCXP\d*|BGS\d*|SDCC\d*|D23|TGA\d*|TGS\d*|GDC\d*|CES\d*)\b/i
  )?.[1]?.toUpperCase() || '';

  const companies = [
    ['microsoft', 'Microsoft'],
    ['xbox', 'Xbox'],
    ['sony', 'Sony'],
    ['playstation', 'PlayStation'],
    ['nintendo', 'Nintendo'],
    ['activision', 'Activision'],
    ['ubisoft', 'Ubisoft'],
    ['electronic arts', 'Electronic Arts'],
    ['capcom', 'Capcom'],
    ['sega', 'Sega'],
    ['netflix', 'Netflix'],
    ['disney', 'Disney'],
    ['warner bros', 'Warner Bros'],
    ['warner', 'Warner Bros'],
    ['prime video', 'Prime Video'],
    ['amazon', 'Amazon'],
    ['crunchyroll', 'Crunchyroll'],
    ['paramount', 'Paramount'],
    ['universal', 'Universal'],
    ['marvel', 'Marvel'],
    ['hbo', 'HBO'],
  ];

  const company = companies.find(
    ([key]) => normalized.includes(key)
  )?.[1] || '';

  if (secondBannerDiversityProfile(banner).active && event) {
    return { subject: event, kind: 'event' };
  }

  if (company) {
    return { subject: company, kind: 'company' };
  }

  if (event) {
    return { subject: event, kind: 'event' };
  }

  return { subject: '', kind: '' };
}

function buildSearchQueries(
  request,
  banner
) {
  const category =
    String(
      request.categoria || ""
    ).toLowerCase();

  const angleTitle =
    String(
      banner.banner_title || ""
    ).trim();

  const angleHighlight =
    String(
      banner.highlight || ""
    ).trim();

  const angleText =
    normalizeText(
      [
        angleTitle,
        angleHighlight,
      ]
        .filter(Boolean)
        .join(" ")
    );

  const requestText =
    normalizeText(
      request.titulo ||
      ""
    );

  /*
   * Detecta um angulo corporativo dentro
   * de uma noticia de games.
   *
   * Exemplo atual:
   * Microsoft + demissoes/funcionarios
   * deve buscar Xbox corporativo,
   * nao gameplay de Halo.
   */
  const corporateGameAngle =
    isCorporateGameAngle(
      request,
      banner
    );
  let exclusions =
    "";

  if (corporateGameAngle) {
    const exclusionParts = [
      "-gameplay",
      "-screenshot",
      "-wallpaper",
      "-cosplay",
      "-fanart",
    ];

    /*
     * Se a materia geral menciona Halo,
     * mas o slide corporativo nao,
     * evita que a franquia domine a imagem.
     */
    if (
      requestText.includes("halo") &&
      !angleText.includes("halo")
    ) {
      exclusionParts.push("-Halo");
      exclusionParts.push('-"Master Chief"');
    }

    exclusions =
      exclusionParts.join(" ");
  }

  const qualifier =
    corporateGameAngle
      ? "official corporate press photo newsroom studio office Xbox Microsoft"
      : category === "anime"
        ? "official anime key visual trailer still"
        : category === "games"
          ? "official gameplay screenshot key art press image"
          : category === "cinema"
            ? "official movie still press image"
            : "official press image promotional still";

  let queries;

  if (corporateGameAngle) {
    const corporateEntities = [
      ["microsoft", "Microsoft"],
      ["xbox", "Xbox"],
      ["sony", "Sony"],
      ["playstation", "PlayStation"],
      ["nintendo", "Nintendo"],
      ["activision", "Activision"],
      ["ubisoft", "Ubisoft"],
      ["electronic arts", "Electronic Arts"],
      ["embracer", "Embracer"],
      ["tencent", "Tencent"],
      ["sega", "Sega"],
      ["capcom", "Capcom"],
    ]
      .filter(([key]) =>
        angleText.includes(key)
      )
      .map(([, label]) =>
        label
      )
      .slice(0, 2)
      .join(" ");

    const hasLayoffAngle =
      /\b(demissao|demissoes|funcionario|funcionarios|layoff|layoffs|employee|employees|workforce|cortes|corte|empregos|emprego)\b/
        .test(angleText);

    const hasRestructuringAngle =
      /\b(reorganizacao|reorganiza|reestruturacao|restructuring)\b/
        .test(angleText);

    const corporateSubject =
      corporateEntities ||
      "video game company";

    const corporateEventTerms =
      [
        hasLayoffAngle
          ? "layoffs"
          : "",

        hasRestructuringAngle
          ? "restructuring"
          : "",
      ]
        .filter(Boolean)
        .join(" ") ||
      "corporate";

    queries = [
      [
        corporateSubject,
        corporateEventTerms,
        "official press photo",
        exclusions,
      ]
        .filter(Boolean)
        .join(" "),

      [
        corporateSubject,
        "corporate office studio official press image",
        exclusions,
      ]
        .filter(Boolean)
        .join(" "),

      [
        corporateSubject,
        "headquarters newsroom official corporate photo",
        exclusions,
      ]
        .filter(Boolean)
        .join(" "),
    ];

    if (corporateEntities) {
      queries.push(
        `${corporateEntities} official company logo brand identity press kit`
      );
    }
  }
  else {
    /*
     * Busca visual generica:
     *
     * Evita enviar ao provedor frases editoriais
     * inteiras e repetidas.
     *
     * Mantemos:
     * - assunto principal
     * - angulo especifico do banner
     * - qualificadores da categoria
     *
     * O filtro de relevancia, qualidade e deduplicacao
     * continua inalterado.
     */
    const compactSearchTerms =
      (
        value,
        limit = 7
      ) => {
        const result = [];
        const seen = new Set();

        for (
          const rawWord of
          String(value || "")
            .replace(
              /[,:;!?()[\]{}"'“”‘’]+/gu,
              " "
            )
            .split(/\s+/)
        ) {
          const cleanWord =
            String(rawWord || "")
              .replace(
                /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,
                ""
              )
              .trim();

          const key =
            normalizeText(
              cleanWord
            );

          if (
            !key ||
            key.length < 2 ||
            SEARCH_STOPWORDS.has(key) ||
            seen.has(key)
          ) {
            continue;
          }

          seen.add(key);
          result.push(cleanWord);

          if (
            result.length >= limit
          ) {
            break;
          }
        }

        return result.join(" ");
      };

    const mergeSearchParts =
      (...parts) => {
        const result = [];
        const seen = new Set();

        for (
          const part of
          parts
        ) {
          for (
            const rawWord of
            String(part || "")
              .split(/\s+/)
          ) {
            const word =
              String(rawWord || "")
                .trim();

            const key =
              normalizeText(
                word
              );

            if (
              !key ||
              seen.has(key)
            ) {
              continue;
            }

            seen.add(key);
            result.push(word);
          }
        }

        return result.join(" ");
      };

    const subjectSeed =
      compactSearchTerms(
        banner.image_query ||
        banner.visual_subject ||
        request.titulo,
        7
      );

    const visualSeed =
      compactSearchTerms(
        banner.visual_subject ||
        request.titulo,
        7
      );

    const requestSeed =
      compactSearchTerms(
        request.titulo,
        7
      );

    const angleSeed =
      compactSearchTerms(
        [
          angleTitle,
          angleHighlight,
        ]
          .filter(Boolean)
          .join(" "),
        5
      );

    const alternateQualifier =
      category === "anime"
        ? "official key visual promotional art"
        : category === "games"
          ? "official key art promotional image"
          : category === "cinema"
            ? "official cast press photo movie still"
            : "official event press photo promotional image";

    const diversityProfile =
      secondBannerDiversityProfile(
        banner
      );

    const primarySearchQualifier =
      diversityProfile.active
        ? diversityProfile.qualifier
        : qualifier;

    const alternateSearchQualifier =
      diversityProfile.active
        ? diversityProfile.qualifier
        : alternateQualifier;

    if (diversityProfile.active) {
      console.log(
        "WIRE/GEEK BRIEFING: diversidade visual reforcada no banner 2",
        {
          banner:
            banner.index + 1,

          qualifier:
            diversityProfile.qualifier,
        }
      );
    }

    const logoProfile =
      brandLogoFallbackProfile(request, banner);

    const primarySubject =
      subjectSeed ||
      visualSeed ||
      requestSeed;

    queries = [
      mergeSearchParts(
        primarySubject,
        angleSeed,
        primarySearchQualifier
      ),

      mergeSearchParts(
        primarySubject,
        primarySearchQualifier
      ),

      mergeSearchParts(
        visualSeed ||
        requestSeed ||
        primarySubject,
        alternateSearchQualifier
      ),
    ];

    if (
      logoProfile.subject &&
      (diversityProfile.active || logoProfile.kind === 'company')
    ) {
      const baseEvent = logoProfile.kind === 'event'
        ? logoProfile.subject.replace(/\d+$/, '')
        : '';

      queries.push(
        mergeSearchParts(
          logoProfile.subject,
          baseEvent,
          logoProfile.kind === 'company'
            ? 'official company logo brand identity press kit'
            : 'official event logo brand identity press kit'
        )
      );

      console.log(
        'WIRE/GEEK BRIEFING: fallback de logomarca adicionado',
        {
          banner: banner.index + 1,
          subject: logoProfile.subject,
          kind: logoProfile.kind,
        }
      );
    }
    console.log(
      "WIRE/GEEK BRIEFING: contexto compacto da busca visual",
      {
        banner:
          banner.index + 1,

        assunto:
          primarySubject,

        angulo:
          angleSeed,

        categoria:
          category,
      }
    );
  }
  const finalQueries =
    uniqueValues(
      queries
    ).slice(0, 4);

  console.log(
    "WIRE/GEEK BRIEFING: queries editoriais por banner",
    {
      banner:
        banner.index + 1,

      angulo:
        angleTitle ||
        angleHighlight ||
        "",

      estrategia:
        corporateGameAngle
          ? "games_corporativo"
          : "conteudo_visual",

      exclusoes:
        exclusions ||
        "",

      consultas:
        finalQueries,
    }
  );

  return finalQueries;
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

function searchProfileForQuery(query, defaultProfile) {
  const normalized = normalizeText(query);

  return (
    /\b(company|event) logo\b/.test(normalized) ||
    /\bbrand identity\b/.test(normalized)
  )
    ? 'brand_logo'
    : defaultProfile;
}

async function searchExternalImages({
  request,
  banner,
}) {
  const serpApiKey =
    process.env.SERPAPI_KEY ||
    "";

  const braveApiKey =
    process.env.BRAVE_SEARCH_API_KEY ||
    "";

  if (!serpApiKey && !braveApiKey) {
    console.log(
      "WIRE/GEEK BRIEFING: nenhum provedor de busca externa configurado."
    );

    return [];
  }

  const corporateSearch = isCorporateGameAngle(request, banner);
  const searchProfile = corporateSearch ? 'games_corporativo' : 'default';
  const results = [];

  /*
   * Uma vez confirmada a falta de cota,
   * nao consultamos a SerpAPI novamente
   * nesta geracao.
   */
  let serpDisabled =
    !serpApiKey;

  const filterForBanner =
    (candidates, activeProfile = searchProfile) => {
      const accepted = [];

      for (
        const candidate of
        candidates || []
      ) {
        const corporateBlockReason =
          activeProfile === 'games_corporativo'
            ? corporateCandidateBlockReason(
                candidate,
                request,
                banner
              )
            : "";

        if (corporateBlockReason) {
          console.log(
            "WIRE/GEEK BRIEFING: candidato rejeitado pelo guard corporativo",
            {
              banner:
                banner.index + 1,

              titulo:
                candidate?.title ||
                "",

              url:
                candidate?.url ||
                "",

              motivo:
                corporateBlockReason,

              provider:
                candidate?.provider ||
                "serpapi",
            }
          );

          continue;
        }
        if (
          activeProfile === 'default' && !searchCandidateMatchesBanner(
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

              provider:
                candidate?.provider ||
                "serpapi",
            }
          );

          continue;
        }

        accepted.push(
          candidate
        );
      }

      return accepted;
    };

  const searchQueries =
    buildSearchQueries(request, banner);

  for (
    let queryIndex = 0;
    queryIndex < searchQueries.length;
    queryIndex++
  ) {
    const query =
      searchQueries[queryIndex];

    const querySearchProfile =
      searchProfileForQuery(query, searchProfile);

    if (querySearchProfile === 'brand_logo') {
      console.log(
        'WIRE/GEEK BRIEFING: buscando logomarca oficial',
        { banner: banner.index + 1, consulta: query }
      );
    }
    console.log(
      "WIRE/GEEK BRIEFING: buscando imagem",
      {
        banner:
          banner.index + 1,

        consulta:
          query,
      }
    );

    let accepted = [];
    let fallbackReason =
      "sem_resultados_validos_na_serpapi";

    if (!serpDisabled) {
      try {
        const serpFound =
          await searchImageCandidates(
            query,
            {
              apiKey:
                serpApiKey,

              fetchImpl:
                fetchBriefingImageSearch,

              searchProfile:
                querySearchProfile,

            semanticQuery:
                query,
            }
          );

        accepted =
          filterForBanner(
            serpFound,
            querySearchProfile
          );
      }
      catch (error) {
        if (
          error?.code ===
          "SERPAPI_QUOTA_EXHAUSTED"
        ) {
          serpDisabled = true;
          fallbackReason =
            "quota_serpapi_esgotada";

          console.warn(
            "WIRE/GEEK BRIEFING: SerpAPI sem cota; ativando Brave",
            {
              banner:
                banner.index + 1,

              consulta:
                query,
            }
          );

          if (!braveApiKey) {
            throw error;
          }
        }
        else {
          throw error;
        }
      }
    }
    else if (serpApiKey) {
      fallbackReason =
        "quota_serpapi_esgotada";
    }
    else {
      fallbackReason =
        "serpapi_nao_configurada";
    }

    if (
      !accepted.length &&
      braveApiKey
    ) {
      console.log(
        "WIRE/GEEK BRIEFING: buscando imagem no Brave",
        {
          banner:
            banner.index + 1,

          consulta:
            query,

          motivo:
            fallbackReason,
        }
      );

      const braveFound =
        await searchBraveImageCandidates(
          query,
          {
            apiKey:
              braveApiKey,

            searchProfile:
              querySearchProfile,

              semanticQuery:
              query,
          }
        );

      accepted =
        filterForBanner(
          braveFound,
          querySearchProfile
        );
    }

    results.push(
      ...accepted.map(
        candidate => ({
          ...candidate,
          search_profile:
            candidate?.search_profile ||
            querySearchProfile,
        })
      )
    );

    const logoStillPending =
      searchQueries
        .slice(queryIndex + 1)
        .some(nextQuery =>
          searchProfileForQuery(
            nextQuery,
            searchProfile
          ) === 'brand_logo'
        );

    if (
      results.length >= 12 &&
      !logoStillPending
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
          candidate?.url ||
          ""
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

        imageProfile:
          candidate?.search_profile ||
          "default",

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
      }, {
        downloadTimeoutMs: 15000,
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
