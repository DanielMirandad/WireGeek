import {
  collectSourceImages,
  downloadImage,
  sameImage,
  searchImageCandidates,
  searchBraveImageCandidates,
} from "./shared/banner-images.mjs";

import {
  validateVisualCandidates,
} from "./banner-vision-briefing.mjs";

const MIN_SHORT_SIDE = 400;
const MIN_LONG_SIDE = 700;
const MIN_ASPECT = 0.55;
const MAX_ASPECT = 1.90;

function cleanText(value) {
  return String(value || "").trim();
}

function sameAssetUrl(first, second) {
  try {
    const firstUrl = new URL(cleanText(first));
    const secondUrl = new URL(cleanText(second));

    firstUrl.search = "";
    firstUrl.hash = "";

    secondUrl.search = "";
    secondUrl.hash = "";

    return firstUrl.href === secondUrl.href;
  } catch {
    return false;
  }
}

function canonicalUrl(value) {
  try {
    const url = new URL(cleanText(value));

    url.hash = "";

    for (const key of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
    ]) {
      url.searchParams.delete(key);
    }

    return url.toString();
  } catch {
    return cleanText(value);
  }
}

function uniqueUrls(values) {
  const result = [];
  const seen = new Set();

  for (const value of values || []) {
    const url = canonicalUrl(
      typeof value === "string"
        ? value
        : value?.url
    );

    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    result.push(url);
  }

  return result;
}

function sourceUrls(request) {
  return uniqueUrls([
    ...(request?.source_urls || []),
    ...((request?.fontes || []).map(
      (source) => source?.url
    )),
  ]);
}

function editorialBanners(request) {
  return Array.isArray(request?.banners)
    ? request.banners
        .filter(
          (banner) =>
            cleanText(banner?.type).toLowerCase() ===
            "editorial"
        )
        .slice(0, 2)
    : [];
}

function searchQuery(request, banner) {
  return [
    cleanText(banner?.image_query),
    cleanText(banner?.visual_subject),
    cleanText(banner?.banner_title),
    cleanText(request?.titulo_curto),
    cleanText(request?.titulo),
  ]
    .filter(Boolean)
    .filter(
      (value, index, array) =>
        array.indexOf(value) === index
    )
    .join(" ");
}

function explicitCandidates(banner) {
  const values = [];

  if (banner?.image_url) {
    values.push({
      url: banner.image_url,
      provider: "briefing",
      title: "imagem definida pelo briefing",
    });
  }

  for (const candidate of
    banner?.image_candidates || []) {
    if (typeof candidate === "string") {
      values.push({
        url: candidate,
        provider: "briefing",
        title: "candidato do briefing",
      });
      continue;
    }

    if (candidate?.url) {
      values.push({
        ...candidate,
        provider:
          candidate.provider || "briefing",
      });
    }
  }

  return values;
}

function sourceCandidates(values) {
  return (values || [])
    .map((candidate) => {
      if (typeof candidate === "string") {
        return {
          url: candidate,
          provider: "source",
          title: "imagem da fonte",
        };
      }

      return {
        ...candidate,
        provider:
          candidate?.provider || "source",
      };
    })
    .filter((candidate) => candidate?.url);
}

async function externalCandidates(
  request,
  banner
) {
  const query = searchQuery(request, banner);

  if (!query) {
    return [];
  }

  const serpApiKey =
    process.env.SERPAPI_KEY ||
    process.env.SERP_API_KEY ||
    "";

  const braveApiKey =
    process.env.BRAVE_SEARCH_API_KEY ||
    "";

  const result = [];

  if (serpApiKey) {
    try {
      const found =
        await searchImageCandidates(
          query,
          {
            apiKey: serpApiKey,
            semanticQuery: query,
            searchProfile: "default",
          }
        );

      result.push(
        ...(found || []).map(
          (candidate) => ({
            ...candidate,
            provider:
              candidate?.provider ||
              "serpapi",
          })
        )
      );
    } catch (error) {
      console.log(
        "WIRE/GEEK BRIEFING: busca SerpAPI indisponivel",
        {
          erro: error.message,
        }
      );
    }
  }

  if (braveApiKey) {
    try {
      const found =
        await searchBraveImageCandidates(
          query,
          {
            apiKey: braveApiKey,
            semanticQuery: query,
            searchProfile: "default",
          }
        );

      result.push(
        ...(found || []).map(
          (candidate) => ({
            ...candidate,
            provider:
              candidate?.provider ||
              "brave",
          })
        )
      );
    } catch (error) {
      console.log(
        "WIRE/GEEK BRIEFING: busca Brave indisponivel",
        {
          erro: error.message,
        }
      );
    }
  }

  return result;
}

async function materializeCandidate({
  request,
  banner,
  candidate,
  download,
  validateVisual,
  rejectDuplicate,
}) {
  const url =
    canonicalUrl(candidate?.url);

  if (!url) {
    throw new Error(
      "Candidato sem URL de imagem valida."
    );
  }

  const image =
    await download(
      url,
      {
        timeoutMs: 15000,
      }
    );

  const width =
    Number(
      image?.fingerprint?.width
    ) || 0;

  const height =
    Number(
      image?.fingerprint?.height
    ) || 0;

  if (!width || !height) {
    throw new Error(
      "Imagem sem dimensoes validas."
    );
  }

  const shortSide =
    Math.min(width, height);

  const longSide =
    Math.max(width, height);

  const aspect =
    width / height;

  if (
    shortSide < MIN_SHORT_SIDE ||
    longSide < MIN_LONG_SIDE ||
    aspect < MIN_ASPECT ||
    aspect > MAX_ASPECT
  ) {
    throw new Error(
      "Imagem fora das dimensoes editoriais."
    );
  }

  rejectDuplicate?.(image);

  await validateVisual({
    images: [
      image,
    ],
    subject:
      cleanText(
        banner?.visual_subject ||
        banner?.banner_title ||
        request?.titulo_curto ||
        request?.titulo
      ),
    query:
      searchQuery(
        request,
        banner
      ),
    highlights: [
      cleanText(
        banner?.highlight
      ),
    ].filter(Boolean),
    provenance: {
      provider: cleanText(candidate?.provider),
      source_url: cleanText(candidate?.source_url),
      title: cleanText(candidate?.title),
    },
  });

  return {
    ...candidate,
    ...image,
    url: image.url,
    width,
    height,
  };
}

async function selectCandidate({
  request,
  banner,
  candidates,
  blockedUrls,
  download,
  validateVisual,
  rejectDuplicate,
}) {
  const attempted = new Set();

  for (const candidate of
    candidates || []) {
    const url =
      canonicalUrl(candidate?.url);

    if (
      !url ||
      attempted.has(url) ||
      blockedUrls.has(url)
    ) {
      continue;
    }

    attempted.add(url);

    try {
      return await materializeCandidate({
        request,
        banner,
        candidate: {
          ...candidate,
          url,
        },
        download,
        validateVisual,
        rejectDuplicate,
      });
    } catch (error) {
      console.log(
        "WIRE/GEEK BRIEFING: candidato de imagem rejeitado",
        {
          url,
          provider: cleanText(candidate?.provider),
          erro:
            error instanceof Error
              ? error.message
              : String(error),
        }
      );
    }
  }

  return null;
}
async function resolveOneBanner({
  request,
  banner,
  sources,
  blockedUrls,
  download,
  validateVisual,
  rejectDuplicate,
}) {
  const explicit =
    explicitCandidates(banner);

  let selected =
    await selectCandidate({
      request,
      banner,
      candidates: explicit,
      blockedUrls,
      download,
      validateVisual,
      rejectDuplicate,
    });

  if (selected) {
    return selected;
  }

  selected =
    await selectCandidate({
      request,
      banner,
      candidates:
        sourceCandidates(sources),
      blockedUrls,
      download,
      validateVisual,
      rejectDuplicate,
    });

  if (selected) {
    return selected;
  }

  const external =
    await externalCandidates(
      request,
      banner
    );

  selected =
    await selectCandidate({
      request,
      banner,
      candidates: external,
      blockedUrls,
      download,
      validateVisual,
      rejectDuplicate,
    });

  if (selected) {
    return selected;
  }

  throw new Error(
    `Nao encontrei imagem adequada para o banner ${
      Number(banner?.index || 0) + 1
    }: ${cleanText(
      banner?.banner_title
    )}`
  );
}

export async function resolveBriefingBannerImages(
  request,
  dependencies = {}
) {
  const resolveOne =
    dependencies.resolveOneBanner ||
    resolveOneBanner;

  const collectSources =
    dependencies.collectSourceImages ||
    collectSourceImages;

  const rawDownload =
    dependencies.downloadImage ||
    downloadImage;

  // Reuse successful downloads only within this execution; URL bytes can change.
  const downloads = new Map();
  const download = async (url, options) => {
    const key = canonicalUrl(url);
    if (!downloads.has(key)) downloads.set(key, Promise.resolve().then(() => rawDownload(url, options)));
    try {
      const image = await downloads.get(key);
      while (downloads.size > 4) downloads.delete(downloads.keys().next().value);
      return image;
    }
    catch (error) { downloads.delete(key); throw error; }
  };

  const validateVisual =
    dependencies.validateVisualCandidates ||
    validateVisualCandidates;

  const compareImages =
    dependencies.sameImage ||
    sameImage;


  if (
    !request ||
    request.mode !== "briefing"
  ) {
    throw new Error(
      "Payload invalido para o resolvedor Briefing."
    );
  }

  const banners =
    editorialBanners(request);

  if (banners.length !== 2) {
    throw new Error(
      "O Briefing precisa fornecer exatamente 2 banners editoriais."
    );
  }

  let sources = [];

  const urls =
    sourceUrls(request);

  if (urls.length > 0) {
    try {
      sources =
        await collectSources(urls);
    } catch (error) {
      console.log(
        "WIRE/GEEK BRIEFING: coleta de imagens das fontes indisponivel",
        {
          erro: error.message,
        }
      );
    }
  }

  const first =
    await resolveOne({
      request,
      banner: banners[0],
      sources,
      blockedUrls: new Set(),
      download,
      validateVisual,
    });

  const blocked =
    new Set([
      canonicalUrl(first.url),
    ]);

  let second = null;

  for (
    let attempt = 1;
    attempt <= 2;
    attempt += 1
  ) {
    try {
      const candidate =
        await resolveOne({
          request,
          banner: banners[1],
          sources,
          blockedUrls: blocked,
          download,
          validateVisual,
          rejectDuplicate(image) {
            if (sameAssetUrl(first.url, image.url) || compareImages(first.fingerprint, image.fingerprint)) {
              blocked.add(canonicalUrl(image.url));
              throw new Error('Segunda imagem semelhante a primeira; analise por IA dispensada.');
            }
          },
        });

      if (
        sameAssetUrl(first.url, candidate.url) ||
        compareImages(
          first.fingerprint,
          candidate.fingerprint
        )
      ) {
        blocked.add(
          canonicalUrl(candidate.url)
        );

        console.log(
          "WIRE/GEEK BRIEFING: segunda imagem rejeitada por similaridade"
        );

        continue;
      }

      second = candidate;
      break;
    } catch (error) {
      console.log(
        "WIRE/GEEK BRIEFING: segunda imagem nao resolvida",
        {
          tentativa: attempt,
          erro: error.message,
        }
      );
    }
  }

  if (!second) {
    console.log(
      "WIRE/GEEK BRIEFING: somente uma imagem editorial valida; resultado parcial mantido."
    );

    return [first];
  }

  return [
    first,
    second,
  ];
}