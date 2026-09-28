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

const MIN_SHORT_SIDE = 650;
const MIN_LONG_SIDE = 1000;
const MIN_ASPECT = 0.55;
const MAX_ASPECT = 1.90;

function cleanText(value) {
  return String(value || "").trim();
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

async function inspectImage(url) {
  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    15000
  );

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 WireGeek/1.0",
        accept: "image/*",
      },
    });

    if (!response.ok) {
      return null;
    }

    const type =
      response.headers.get("content-type") ||
      "";

    if (
      type &&
      !type.toLowerCase().includes("image")
    ) {
      return null;
    }

    const buffer = Buffer.from(
      await response.arrayBuffer()
    );

    const metadata =
      await sharp(buffer).metadata();

    const width =
      Number(metadata.width) || 0;

    const height =
      Number(metadata.height) || 0;

    if (!width || !height) {
      return null;
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
      return null;
    }

    return {
      width,
      height,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function visualApproval(
  candidate,
  request,
  banner
) {
  const query = searchQuery(
    request,
    banner
  );

  const subject =
    cleanText(
      banner?.visual_subject ||
      banner?.banner_title ||
      request?.titulo_curto ||
      request?.titulo
    );

  try {
    const validation =
      await validateVisualCandidates({
        images: [
          {
            url: candidate.url,
            title:
              candidate.title || "",
            source_url:
              candidate.source_url || "",
          },
        ],
        subject,
        query,
        highlights: [
          cleanText(banner?.highlight),
        ].filter(Boolean),
      });

    if (
      validation?.skipped === true
    ) {
      return true;
    }

    const approved =
      validation?.approved ||
      validation?.images ||
      validation?.valid ||
      [];

    if (Array.isArray(approved)) {
      return approved.some(
        (item) =>
          canonicalUrl(
            item?.url ||
            item?.image_url
          ) ===
          canonicalUrl(candidate.url)
      );
    }

    return validation?.approved === true;
  } catch (error) {
    console.log(
      "WIRE/GEEK BRIEFING: validacao visual indisponivel",
      {
        erro: error.message,
      }
    );

    return false;
  }
}

async function selectCandidate({
  request,
  banner,
  candidates,
  blockedUrls,
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

    const metadata =
      await inspectImage(url);

    if (!metadata) {
      continue;
    }

    const approved =
      await visualApproval(
        {
          ...candidate,
          url,
        },
        request,
        banner
      );

    if (!approved) {
      continue;
    }

    return {
      ...candidate,
      url,
      width: metadata.width,
      height: metadata.height,
    };
  }

  return null;
}

async function resolveOneBanner({
  request,
  banner,
  sources,
  blockedUrls,
}) {
  const explicit =
    explicitCandidates(banner);

  let selected =
    await selectCandidate({
      request,
      banner,
      candidates: explicit,
      blockedUrls,
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

async function verifyPair(
  first,
  second
) {
  if (!first || !second) {
    return null;
  }

  if (
    canonicalUrl(first.url) ===
    canonicalUrl(second.url)
  ) {
    return null;
  }

  try {
    return await resolveBannerImages(
      {
        entries: [
          {
            image_url: first.url,
          },
          {
            image_url: second.url,
          },
        ],
        candidates: [],
        sources: [],
        query: "",
        manual: true,
        rejectedImages: [],
      },
      {
        downloadTimeoutMs: 15000,
      }
    );
  } catch (error) {
    console.log(
      "WIRE/GEEK BRIEFING: par rejeitado por similaridade",
      {
        erro: error.message,
      }
    );

    return null;
  }
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

  const verifyImages =
    dependencies.verifyPair ||
    verifyPair;
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
        });

      const pair =
        await verifyImages(
          first,
          candidate
        );

      if (pair) {
        second = candidate;
        break;
      }

      blocked.add(
        canonicalUrl(candidate.url)
      );
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