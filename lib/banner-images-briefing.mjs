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


function visualEntityProfile(
  banner
) {
  const source =
    normalizeText(
      [
        banner?.image_query,
        banner?.visual_subject,
        banner?.contexto_visual,
      ]
        .filter(Boolean)
        .join(" ")
    );

  const tokens =
    source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 8);

  for (
    let index = 0;
    index < tokens.length - 1;
    index++
  ) {
    const brand =
      tokens[index];

    const model =
      tokens[index + 1];

    if (
      /^[a-z]{2,}$/.test(
        brand
      ) &&
      /^(?=[a-z0-9]*[a-z])(?=[a-z0-9]*\d)[a-z0-9]{2,}$/.test(
        model
      )
    ) {
      return {
        brand,
        model,
      };
    }
  }

  return {
    brand: "",
    model: "",
  };
}


function compactVisualModelText(
  value
) {
  return normalizeText(
    value
  ).replace(
    /\b([a-z]{1,12})\s+(\d{1,4}[a-z0-9]*)\b/g,
    "$1$2"
  );
}


function externalCandidateAuthorityScore(
  candidate,
  banner
) {
  const profile =
    visualEntityProfile(
      banner
    );

  const urls = [
    candidate?.source_url,
    candidate?.url,
  ].filter(Boolean);

  let authority = 0;
  let penalty = 0;

  for (const value of urls) {
    try {
      const parsed =
        new URL(
          String(value)
        );

      const host =
        parsed.hostname
          .toLowerCase()
          .replace(
            /^www\./,
            ""
          );

      const compactHost =
        host.replace(
          /[^a-z0-9]/g,
          ""
        );

      /*
       * Fonte governamental/regulatoria:
       * prioridade maxima.
       */
      if (
        host.endsWith(
          ".gov"
        )
      ) {
        authority =
          Math.max(
            authority,
            1000
          );
      }

      /*
       * Dominio que carrega o nome da marca:
       * forte sinal de fonte primaria.
       */
      if (
        profile.brand &&
        compactHost.includes(
          profile.brand
        )
      ) {
        authority =
          Math.max(
            authority,
            700
          );
      }

      /*
       * Para marcas sem identificador alfanumerico
       * de modelo, usa os termos fortes do proprio
       * assunto para reconhecer o dominio oficial.
       *
       * Exemplo:
       *
       * anthropic.com + termo "anthropic"
       * claude.ai     + termo "claude"
       */
      const authorityTerms =
        contextTerms(
          banner
        )
          .map(
            term =>
              String(term || "")
                .replace(
                  /[^a-z0-9]/g,
                  ""
                )
          )
          .filter(
            term =>
              term.length >= 4
          )
          .slice(0, 8);

      if (
        authorityTerms.some(
          term =>
            compactHost.includes(
              term
            )
        )
      ) {
        authority =
          Math.max(
            authority,
            700
          );
      }

      /*
       * Marketplace permanece como fallback,
       * nunca como primeira escolha quando existe
       * uma fonte primaria adequada.
       */
      if (
        /\b(amazon|ebay|aliexpress|walmart|bestbuy|mercadolivre|mercadolibre|shopee|temu)\b/
          .test(
            normalizeText(
              host
            )
          )
      ) {
        penalty =
          Math.min(
            penalty,
            -350
          );
      }
    }
    catch {
        /*
         * URL invalida nao recebe prioridade.
         */
    }
  }

  return (
    authority +
    penalty
  );
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

  /*
   * Quando o contexto possui entidade + modelo
   * alfanumerico explicito, o candidato externo
   * precisa carregar o MESMO modelo.
   *
   * Exemplo:
   *
   * INMO AIR3 -> aceita AIR3
   * INMO AIR3 -> rejeita AIR2
   *
   * "AIR 3" e "AIR3" sao tratados como equivalentes.
   */
  const visualProfile =
    visualEntityProfile(
      banner
    );

  if (visualProfile.model) {
    const compactCandidate =
      compactVisualModelText(
        text
      );

    if (
      !compactCandidate.includes(
        visualProfile.model
      )
    ) {
      console.log(
        "WIRE/GEEK BRIEFING: resultado descartado por modelo divergente",
        {
          banner:
            banner.index + 1,

          modelo_esperado:
            visualProfile.model,

          titulo:
            candidate?.title ||
            "",

          url:
            candidate?.url ||
            "",

          source_url:
            candidate?.source_url ||
            "",
        }
      );

      return false;
    }
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
  failureReasons = [],
}) {
  if (!image) {
    failureReasons.push("download: nenhuma imagem válida");
    return false;
  }

  const qualityIssue =
    imageQualityIssue(
      image,
      imageProfile
    );

  if (qualityIssue) {
    failureReasons.push(`qualidade: ${qualityIssue}`);
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

    const activeVisualProfile =
      imageProfile === "brand_logo"
        ? "brand_logo"
        : digitalProductVisualProfile(
            null,
            banner
          ).active
          ? "digital_product"
          : "default";

    const visualResult =
      await validateVisualCandidates({
        images: [cropPreviewImage],

        visualProfile:
          activeVisualProfile,

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

          "REGRA DE VINCULO VISUAL PARA MARCA, EMPRESA OU PRODUTO:",
          "Quando o assunto principal do slide for empresa, marca, produto, dispositivo, plataforma, componente ou tecnologia, exija evidencia VISUAL direta dessa relacao.",
          "Retrato humano isolado, headshot, foto de executivo ou rosto sem contexto nao comprova relacao com empresa, marca ou produto.",
          "Nao use titulo, URL, nome do arquivo ou pagina de origem como prova do vinculo; a evidencia precisa estar nos pixels.",
          "Considere evidencia visual valida: produto ou dispositivo visivel, marca ou logotipo contextualizado, embalagem, componente, palco, stand, apresentacao ou evento inequivocamente associado ao assunto.",
          "Se uma pessoa dominar a imagem e nao houver produto, marca ou contexto visual suficiente ligando-a ao assunto do slide, retorne approved false.",
          "Excecao: retrato humano pode ser aprovado quando o contexto editorial indicar explicitamente que aquela pessoa e o proprio assunto do slide.",

          ...(activeVisualProfile === "digital_product"
            ? [
                "PERFIL DIGITAL_PRODUCT:",
                "O assunto deste banner e software, IA, plataforma, modelo ou produto digital.",
                "Uma interface real do produto, dashboard, aplicativo, tela de software ou UI pode ser evidencia visual valida.",
                "Nao rejeite uma imagem apenas porque ela mostra uma interface desktop.",
                "A interface precisa mostrar sinais visuais suficientes da entidade ou produto correto.",
                "Continue rejeitando UI generica, outra marca, outro produto, placeholders e imagens sem vinculo visual verificavel com o assunto.",
              ]
            : []),

          ...(imageProfile === "brand_logo"
            ? [
                "EXCECAO PARA PERFIL BRAND_LOGO:",
                "Este candidato foi encontrado especificamente como identidade visual oficial da entidade nomeada.",
                "Para empresa, marca, modelo de IA, software ou servico digital, um logotipo ou wordmark isolado PODE ser aprovado quando os pixels identificarem claramente a entidade correta.",
                "Nao exija produto fisico, dispositivo, pessoa ou palco quando o assunto for software, IA ou servico puramente digital.",
                "Continue rejeitando logotipos de outras marcas, assets genericos, placeholders e identidade que nao corresponda ao assunto.",
              ]
            : []),
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

      failureReasons.push(`visual: ${error.message || "reprovada"}`);
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


function preferredBriefingImageUrl(
  value
) {
  const raw =
    String(
      value ||
      ""
    ).trim();

  if (
    !/^https?:\/\//i.test(
      raw
    )
  ) {
    return raw;
  }

  try {
    const parsed =
      new URL(
        raw
      );

    const hostname =
      parsed.hostname
        .toLowerCase();

    /*
     * Drupal/S3 da CPSC:
     *
     * /s3fs-public/styles/recall_thumb/public/FOTO.jpg
     *
     * e apenas uma derivacao pequena da imagem.
     *
     * O asset original fica em:
     *
     * /s3fs-public/FOTO.jpg
     */
    if (
      (
        hostname ===
          "cpsc.gov" ||
        hostname.endsWith(
          ".cpsc.gov"
        )
      ) &&
      /^\/s3fs-public\/styles\/[^/]+\/public\//i
        .test(
          parsed.pathname
        )
    ) {
      parsed.pathname =
        parsed.pathname.replace(
          /^\/s3fs-public\/styles\/[^/]+\/public\//i,
          "/s3fs-public/"
        );

      /*
       * itok pertence ao image-style.
       * VersionId e preservado.
       */
      parsed.searchParams.delete(
        "itok"
      );

      return parsed.href;
    }

    return raw;
  }
  catch {
    return raw;
  }
}


async function tryImageUrl({
  url,
  banner,
  label,
  attemptedUrls,
  blockedUrls,
  imageProfile = "default",
  failureReasons = [],
}) {
  const requestedUrl =
    String(
      url ||
      ""
    ).trim();

  const normalized =
    preferredBriefingImageUrl(
      requestedUrl
    );

  if (
    normalized &&
    normalized !==
      requestedUrl
  ) {
    console.log(
      "WIRE/GEEK BRIEFING: recuperando asset primario da fonte oficial",
      {
        banner:
          banner.index + 1,

        origem:
          label,

        thumbnail:
          requestedUrl,

        original:
          normalized,
      }
    );
  }

  if (
    !/^https?:\/\//i.test(
      normalized
    )
  ) {
    failureReasons.push("URL inválida");
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
    failureReasons.push("candidato repetido entre banners");
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
        failureReasons,
      });

    return approved
      ? image
      : null;
  } catch (error) {
    if (error?.code === "BANNER_VISUAL_UNAVAILABLE") {
      throw error;
    }

    const message = String(error?.message || error || "erro desconhecido")
      .replace(/https?:\/\/\S+/gi, "[URL]")
      .replace(/\s+/g, " ")
      .slice(0, 100);
    failureReasons.push(`download: ${message}`);
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



/*
 * Fallback semantico para anime com angulo musical.
 *
 * O segundo banner pode aceitar material oficial da obra
 * principal mesmo quando o metadata nao cita o artista,
 * opening ou ending.
 */
function searchCandidateMatchesAnimePrimarySubject(
  candidate,
  request,
  banner
) {
  const category =
    String(request?.categoria || "")
      .trim()
      .toLowerCase();

  if (
    category !== "anime" ||
    Number(banner?.index) !== 1
  ) {
    return false;
  }

  const angleText =
    normalizeText(
      [
        banner?.banner_title,
        banner?.highlight,
      ]
        .filter(Boolean)
        .join(" ")
    );

  if (
    !/\b(opening|ending|abertura|encerramento|tema|theme|musica|music|musical|cantor|cantora|artista|artist)\b/.test(
      angleText
    )
  ) {
    return false;
  }

  const candidateText =
    normalizeText(
      [
        candidate?.title,
        candidate?.url,
        candidate?.source_url,
      ]
        .filter(Boolean)
        .join(" ")
    );

  if (!candidateText) {
    return false;
  }

  const primaryTerms =
    contextTerms({
      image_query:
        request?.image_query || "",

      visual_subject:
        request?.titulo_curto ||
        request?.titulo ||
        "",

      contexto_visual:
        request?.contexto_visual || "",

      banner_title: "",
      highlight: "",
    });

  if (primaryTerms.length < 2) {
    return false;
  }

  const matches =
    primaryTerms.filter(
      term =>
        candidateText.includes(
          term
        )
    );

  const accepted =
    matches.length >= 2 ||
    matches.some(
      term =>
        term.length >= 7
    );

  if (accepted) {
    console.log(
      "WIRE/GEEK BRIEFING: fallback por entidade principal do anime",
      {
        banner:
          Number(banner?.index) + 1,

        termos:
          matches.slice(0, 5),

        titulo:
          candidate?.title || "",

        source_url:
          candidate?.source_url || "",
      }
    );
  }

  return accepted;
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


function digitalProductVisualProfile(
  request,
  banner
) {
  const source =
    normalizeText(
      [
        request?.titulo,
        request?.titulo_curto,
        banner?.titulo_curto,
        banner?.image_query,
        banner?.visual_subject,
        banner?.contexto_visual,
        banner?.banner_title,
        banner?.highlight,
      ]
        .filter(Boolean)
        .join(" ")
    );

  const active =
    /\b(ai|ia|llm|modelo|model|software|api|app|aplicativo|application|plataforma|platform|cybersecurity|ciberseguranca|cloud|nuvem|agent|agente|agents|agentes)\b/
      .test(
        source
      );

  return {
    active,
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
    ['anthropic', 'Anthropic'],
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

    const shortTitleSeed =
      compactSearchTerms(
        banner.titulo_curto ||
        request.titulo_curto ||
        "",
        5
      );

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

    const digitalProfile =
      digitalProductVisualProfile(
        request,
        banner
      );

    const alternateQualifier =
      digitalProfile.active
        ? "official product UI screenshot interface launch image brand asset"
        : category === "anime"
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
        : digitalProfile.active
          ? "official product screenshot interface UI launch image press kit"
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

    const namedEntitySource = [
      request?.titulo,
      request?.image_query,
      banner?.image_query,
      banner?.visual_subject,
      banner?.contexto_visual,
      banner?.banner_title,
    ]
      .filter(Boolean)
      .join(" ");

    const namedEntityPhrases = [
      ...new Set(
        namedEntitySource.match(
          /\b\p{Lu}[\p{L}\p{N}'’.-]*(?:\s+(?:(?:of|the|and|da|de|do|dos|das|e|a|o)\s+)?\p{Lu}[\p{L}\p{N}'’.-]*)+\b/gu
        ) || []
      ),
    ];

    const namedEntitySeed =
      compactSearchTerms(
        namedEntityPhrases.join(" "),
        10
      );

    /*
     * Em noticias de elenco, a busca deve partir da pessoa
     * destacada no banner e da obra. Juntar os nomes de todo
     * o elenco no inicio favorece montagens e fotos de evento
     * sem relacao direta com a pessoa em destaque.
     */
    const personTargetSeed =
      compactSearchTerms(
        banner.image_query ||
        banner.visual_subject ||
        banner.banner_title,
        4
      );

    const titleConnectors = new Set([
      "the",
      "of",
      "and",
      "da",
      "de",
      "do",
      "dos",
      "das",
      "e",
    ]);

    const targetPhraseKey =
      normalizeText(personTargetSeed);

    const productionEntitySeed =
      compactSearchTerms(
        namedEntityPhrases
          .filter((phrase) => {
            const phraseKey =
              normalizeText(phrase);

            if (
              !phraseKey ||
              phraseKey === targetPhraseKey
            ) {
              return false;
            }

            const words =
              phraseKey.split(/\\s+/).filter(Boolean);

            const hasTitleConnector =
              words.some(word =>
                titleConnectors.has(word)
              );

            /*
             * Nomes de duas palavras costumam ser outros atores.
             * Mantemos titulos de varias palavras ou com conectores,
             * como "The Last of Us".
             */
            return (
              words.length >= 3 ||
              hasTitleConnector
            );
          })
          .join(" "),
        8
      );

    const castingContext =
      normalizeText(
        [
          request.titulo,
          angleTitle,
          angleHighlight,
        ]
          .filter(Boolean)
          .join(" ")
      );

    const personCastingProfile =
      ["geek", "cinema"].includes(category) &&
      personTargetSeed.split(/\\s+/).filter(Boolean).length >= 2 &&
      productionEntitySeed &&
      /\\b(cast|casting|elenco|escalad\\w*|contratad\\w*|temporada|season|joins?)\\b/
        .test(castingContext);

    const primarySubject =
      compactSearchTerms(
        mergeSearchParts(
          namedEntitySeed,
          subjectSeed,
          visualSeed,
          requestSeed
        ),
        12
      );

    queries =
      digitalProfile.active &&
      shortTitleSeed
        ? [
            mergeSearchParts(
              shortTitleSeed,
              primarySearchQualifier
            ),

            mergeSearchParts(
              shortTitleSeed,
              alternateSearchQualifier
            ),

            mergeSearchParts(
              primarySubject,
              primarySearchQualifier
            ),
          ]
        : [
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
      personCastingProfile
    ) {
      queries.unshift(
        mergeSearchParts(
          personTargetSeed,
          productionEntitySeed,
          "official cast photo press image"
        ),
        mergeSearchParts(
          personTargetSeed,
          productionEntitySeed,
          "season HBO character promotional still"
        )
      );

      console.log(
        "WIRE/GEEK BRIEFING: busca de elenco prioriza a pessoa e a producao",
        {
          banner:
            banner.index + 1,
          pessoa:
            personTargetSeed,
          producao:
            productionEntitySeed,
        }
      );
    }

    if (
      digitalProfile.active
    ) {
      console.log(
        "WIRE/GEEK BRIEFING: perfil visual digital ativado",
        {
          banner:
            banner.index + 1,

          titulo_curto:
            shortTitleSeed,

          assunto:
            primarySubject,
        }
      );
    }

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
          activeProfile ===
          'default' &&
          !(
            searchCandidateMatchesBanner(
              candidate,
              banner
            ) ||
            searchCandidateMatchesAnimePrimarySubject(
              candidate,
              request,
              banner
            )
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

  const uniqueResults =
    results.filter(
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

  const rankedResults =
    uniqueResults
      .map(
        (
          candidate,
          index
        ) => ({
          candidate,
          index,

          score:
            externalCandidateAuthorityScore(
              candidate,
              banner
            ),
        })
      )
      .sort(
        (
          first,
          second
        ) =>
          second.score -
            first.score ||
          first.index -
            second.index
      );

  if (
    rankedResults[0]?.score > 0
  ) {
    console.log(
      "WIRE/GEEK BRIEFING: fonte primaria priorizada",
      {
        banner:
          banner.index + 1,

        score:
          rankedResults[0]
            .score,

        titulo:
          rankedResults[0]
            .candidate
            ?.title ||
          "",

        url:
          rankedResults[0]
            .candidate
            ?.url ||
          "",

        source_url:
          rankedResults[0]
            .candidate
            ?.source_url ||
          "",
      }
    );
  }

  return rankedResults.map(
    item =>
      item.candidate
  );
}

/*
 * ==========================================================
 * RESOLVER UM BANNER
 * ==========================================================
 */

function summarizeFailureReasons(reasons) {
  const counts = new Map();
  const visualReasons = new Map();
  let visualRejections = 0;

  for (const reason of reasons) {
    const safeReason = String(reason || "")
      .replace(/https?:\/\/\S+/gi, "[URL]")
      .replace(/\s+/g, " ")
      .slice(0, 180);

    if (!safeReason) {
      continue;
    }

    if (safeReason.startsWith("visual:")) {
      visualRejections++;
      const detail = safeReason
        .slice("visual:".length)
        .replace(/imagem\s+\d+\s*:\s*/gi, "")
        .slice(0, 100);
      visualReasons.set(detail, (visualReasons.get(detail) || 0) + 1);
      continue;
    }

    counts.set(safeReason, (counts.get(safeReason) || 0) + 1);
  }

  const summaries = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([reason, count]) => `${reason} (${count})`);

  if (visualRejections) {
    const examples = [...visualReasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason, count]) => `${reason} (${count})`);

    summaries.push(
      `rejeicoes_visuais=${visualRejections}; detalhes_visuais=${examples.join(" | ")}`
    );
  }

  return summaries.length
    ? [`motivos_rejeicao=${summaries.join(" | ").slice(0, 700)}`]
    : [];
}


async function resolveOneBanner({
  request,
  banner,
  sourceCandidates,
  blockedUrls = new Set(),
}) {
  const attemptedUrls =
    new Set();
  const failureReasons = [];


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
        failureReasons,
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
        failureReasons,
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
        failureReasons,
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
        failureReasons,
      });

    if (selected) {
      return selected;
    }
  }


  const configuredProviders = [
    process.env.SERPAPI_KEY ? "SerpAPI" : "",
    process.env.BRAVE_SEARCH_API_KEY ? "Brave" : "",
  ].filter(Boolean);

  const diagnostics = [
    `imagens_da_fonte=${sourceCandidates.length}`,
    `resultados_externos=${externalCandidates.length}`,
    `urls_testadas=${attemptedUrls.size}`,
    `provedores_configurados=${configuredProviders.join(",") || "nenhum"}`,
    ...summarizeFailureReasons(failureReasons),
  ].join("; ");

  throw new Error(
    `Não encontrei imagem adequada para o banner ${banner.index + 1}: ${banner.banner_title} [${diagnostics}]`
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
