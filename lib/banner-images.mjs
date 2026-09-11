import "./fontconfig-env.mjs";
import sharp from "sharp";
import { createHash } from "node:crypto";

const MAX_BYTES = 20 * 1024 * 1024;
const USER_AGENT = "Mozilla/5.0 (compatible; WireGeek/3.0)";
const fail = message => Object.assign(new Error(message), { statusCode: 422 });

export function imageUrl(value, base) {
  if (!String(value || "").trim()) return "";
  try {
    const url = new URL(String(value || "").trim(), base);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return "";
    url.hash = "";
    return url.href;
  } catch { return ""; }
}

function canonicalCandidateImageUrl(value) {
  const normalized = imageUrl(value);
  if (!normalized) return "";

  try {
    const url = new URL(normalized);

    // IGN's /t/ endpoints are transformed CDN variants. We observed one
    // resolving to stale/unrelated bytes while the corresponding original
    // asset was correct. Resolve those variants to the original asset before
    // relevance, dedupe and download.
    if (
      url.hostname.toLowerCase() === "sm.ign.com" &&
      url.pathname.startsWith("/t/")
    ) {
      url.pathname = url.pathname
        .replace(/^\/t\//, "/")
        .replace(/\.\d+(?=\.(?:jpe?g|png|webp)$)/i, "");
    }

    return url.href;
  } catch {
    return normalized;
  }
}

function decodeEntities(text) {
  return String(text).replace(/&(?:amp|quot|apos|lt|gt);|&#(?:x[0-9a-f]+|\d+);/gi, entity => {
    const named = { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const hex = entity.slice(2, 3).toLowerCase() === "x";
    const code = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

export function extractSourceImages(html, pageUrl) {
  const results = [];
  const add = (value, priority = "fallback") => {
    const url = imageUrl(decodeEntities(value), pageUrl);
    if (url && !results.some(result => result.url === url)) results.push({ url, source_url: pageUrl, priority });
  };
  const parseAttributes = tag => {
    const attributes = {};
    for (const match of String(tag).matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attributes[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
    }
    return attributes;
  };
  const addSrcset = value => {
    const candidates = String(value || "")
      .split(",")
      .map(part => {
        const match = part.trim().match(/^(\S+)(?:\s+(\d+(?:\.\d+)?)(w|x))?$/i);
        if (!match) return null;
        const amount = Number(match[2] || 1);
        return { url: match[1], score: match[3]?.toLowerCase() === "w" ? amount : amount * 1000 };
      })
      .filter(Boolean)
      .sort((first, second) => second.score - first.score);
    if (candidates[0]) add(candidates[0].url);
  };
  for (const tag of String(html).match(/<meta\b[^>]*>/gi) || []) {
    const attributes = parseAttributes(tag);
    const property = attributes.property || attributes.name || attributes.itemprop || "";
    if (/^(?:og:image(?::url|:secure_url)?|twitter:image(?::src)?|image)$/i.test(property)) add(attributes.content || attributes.href || "", "primary");
  }
  const addImage = value => {
    if (typeof value === "string") add(value, "primary");
    else if (Array.isArray(value)) value.forEach(addImage);
    else if (value && typeof value === "object") add(value.contentUrl || value.url || "", "primary");
  };
  const visit = value => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    const types = [value["@type"]].flat();
    if (types.some(type => /^(?:NewsArticle|Article|BlogPosting|ReportageNewsArticle|ImageGallery)$/.test(type))) addImage(value.image);
    if (value["@graph"]) visit(value["@graph"]);
    if (value.mainEntity) visit(value.mainEntity);
  };
  for (const tag of String(html).matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(tag[1])); } catch { /* Ignore malformed publisher metadata. */ }
  }

  // Many publishers expose only one og:image. Inspect the article markup as a
  // fallback so a second editorial photo can be found without an external
  // image-search request. Prefer the largest srcset candidate and lazy-load
  // attributes used by common CMSs; the byte/pixel checks happen on download.
  for (const tag of String(html).match(/<img\b[^>]*>/gi) || []) {
    const attributes = parseAttributes(tag);
    addSrcset(attributes.srcset || attributes["data-srcset"] || "");
    for (const name of ["src", "data-src", "data-lazy-src", "data-original", "data-image", "data-image-url", "data-fallback-src", "data-cfsrc"]) {
      if (attributes[name]) { add(attributes[name]); break; }
    }
  }
  for (const tag of String(html).match(/<source\b[^>]*>/gi) || []) {
    const attributes = parseAttributes(tag);
    addSrcset(attributes.srcset || attributes["data-srcset"] || "");
  }
  for (const tag of String(html).match(/<link\b[^>]*>/gi) || []) {
    const attributes = parseAttributes(tag);
    if (/^(?:image_src|preload)$/i.test(attributes.rel || "") && (!attributes.as || attributes.as === "image")) add(attributes.href || "");
  }
  return results.slice(0, 10);
}

async function readLimited(response, limit) {
  if (Number(response.headers.get("content-length")) > limit) throw fail("Arquivo de imagem ou página excede o limite permitido.");
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw fail("Arquivo excede o limite permitido."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

export async function collectSourceImages(urls, { fetchImpl = fetch, signal } = {}) {
  const pages = [...new Set((Array.isArray(urls) ? urls : []).map(url => imageUrl(url)).filter(Boolean))].slice(0, 3);
  const groups = await Promise.all(pages.map(async page => {
    try {
      const timeout = AbortSignal.timeout(5000);
      const response = await fetchImpl(page, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { "User-Agent": USER_AGENT, Accept: "text/html" } });
      if (!response.ok) return [];
      return extractSourceImages((await readLimited(response, 2 * 1024 * 1024)).toString("utf8"), response.url || page);
    } catch { return []; }
  }));
  return groups.flat().filter((item, index, all) => all.findIndex(other => other.url === item.url) === index).slice(0, 10);
}

export async function imageFingerprint(buffer) {
  const options = { limitInputPixels: 50_000_000 };
  const metadata = await sharp(buffer, options).metadata();
  if (!metadata.width || !metadata.height || metadata.width < 320 || metadata.height < 200) throw fail("Use uma imagem de pelo menos 320 × 200 pixels.");
  if ((metadata.pages || 1) > 1) throw fail("Use uma imagem estática para o banner.");
  const base = sharp(buffer, options).rotate().flatten({ background: "#fff" }).toColourspace("srgb");
  const full = await base.clone().resize(32, 32, { fit: "fill" }).removeAlpha().raw().toBuffer();
  // Also compare the actual crop that the approved banner will display.
  const cropBuffer = await base.clone().resize(1064, 810, { fit: "cover", position: "centre" }).png().toBuffer();
  const crop = await sharp(cropBuffer).resize(32, 32, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const fullHashPixels = await base
    .clone()
    .greyscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer();

  const cropHashPixels = await sharp(cropBuffer)
    .greyscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer();

  return {
    width: metadata.width,
    height: metadata.height,
    exact: createHash("sha256").update(buffer).digest("hex"),
    full,
    crop,
    fullHash: differenceHash(fullHashPixels),
    cropHash: differenceHash(cropHashPixels),
  };
}

function pixelDistance(first, second) {
  let total = 0;
  for (let i = 0; i < first.length; i++) total += Math.abs(first[i] - second[i]);
  return total / first.length;
}

function differenceHash(pixels) {
  if (!pixels || pixels.length < 72) return "";

  let hash = "";

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = pixels[y * 9 + x];
      const right = pixels[y * 9 + x + 1];

      hash += left > right ? "1" : "0";
    }
  }

  return hash;
}

function hammingDistance(first, second) {
  if (
    !first ||
    !second ||
    first.length !== second.length
  ) {
    return Infinity;
  }

  let distance = 0;

  for (let i = 0; i < first.length; i++) {
    if (first[i] !== second[i]) {
      distance++;
    }
  }

  return distance;
}

function canonicalImageKey(value) {
  try {
    const url = new URL(String(value || "").trim());

    url.hash = "";
    url.search = "";

    return url.toString();
  } catch {
    return String(value || "").trim();
  }
}

export function sameImage(first, second) {
  if (!first || !second) {
    return false;
  }

  return (
    first.exact === second.exact ||
    pixelDistance(first.full, second.full) <= 7 ||
    pixelDistance(first.crop, second.crop) <= 7 ||
    hammingDistance(first.fullHash, second.fullHash) <= 10 ||
    hammingDistance(first.cropHash, second.cropHash) <= 10
  );
}

export async function downloadImage(url, { fetchImpl = fetch, signal } = {}) {
  const target = imageUrl(url);
  if (!target) throw fail("Informe uma URL HTTP ou HTTPS de imagem.");
  const timeout = AbortSignal.timeout(7000);
  const response = await fetchImpl(target, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { "User-Agent": USER_AGENT, Accept: "image/*" } });
  if (!response.ok) throw fail(`Não foi possível baixar uma imagem (HTTP ${response.status}).`);
  const type = response.headers.get("content-type") || "";
  if (/text\/html|application\/json/i.test(type)) throw fail("A URL recebida é uma página, não um arquivo de imagem.");
  const buffer = await readLimited(response, MAX_BYTES);
  return { url: target, imageBuffer: buffer, fingerprint: await imageFingerprint(buffer) };
}

function normalizeImageSearchText(value) {
  return String(value || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const IMAGE_SEARCH_STOPWORDS = new Set(["official","press","photo","editorial","gameplay","screenshot","in","game","scene","still","cast","character","image","movie","anime","the","of","and","de","da","do","das","dos","e","a","o","em","para","com"]);

function imageQueryTerms(query) {
  const positiveQuery = String(query || "").split(/\s+-[a-z]/i)[0];
  return [...new Set(normalizeImageSearchText(positiveQuery).split(/\s+/).filter(term => term && (term.length >= 3 || /^\d+$/.test(term)) && !IMAGE_SEARCH_STOPWORDS.has(term)))];
}

function candidateSearchText(candidate) {
  return normalizeImageSearchText(
    String(candidate?.title || "") + " " +
    String(candidate?.source_url || "") + " " +
    String(candidate?.url || "")
  );
}

function candidateVisualText(candidate) {
  return normalizeImageSearchText(
    String(candidate?.title || "") + " " +
    String(candidate?.url || "")
  );
}

function isObviousImageNoise(candidate) {
  return /\b(youtube|youtu|tiktok|instagram|facebook|pinterest|reddit|shorts|reels|thumbnail|wallpaper|logo|poster|template|collage|meme|fanart|mockup|avatar|author|profile|headshot|desktop|interface|montagem|scorecardresearch|doubleclick|googletagmanager|google-analytics|tracking|tracker|beacon)\b/.test(
    candidateSearchText(candidate)
  );
}

function candidateTermMatches(text, words, term) {
  return (
    words.has(term) ||
    (term.length >= 5 && text.includes(term))
  );
}

function candidateMatchesQuery(candidate, query) {
  if (isObviousImageNoise(candidate)) return false;

  const terms = imageQueryTerms(query);
  if (!terms.length) return true;

  // A relevancia visual deve vir da propria imagem.
  // A URL da pagina de origem nao pode validar uma imagem irrelevante.
  const text = candidateVisualText(candidate);
  const words = new Set(text.split(/\s+/));

  // O primeiro termo relevante da query representa o assunto principal.
  // Ex.: Onimusha precisa aparecer no titulo ou URL da imagem.
  const subjectAnchor = terms[0];

  if (
    subjectAnchor &&
    !candidateTermMatches(text, words, subjectAnchor)
  ) {
    return false;
  }

  const matches = terms.filter((term) =>
    candidateTermMatches(text, words, term)
  ).length;

  if (matches < (terms.length >= 4 ? 2 : 1)) {
    return false;
  }

  for (const critical of ["remake", "remaster", "reboot"]) {
    if (
      terms.includes(critical) &&
      !words.has(critical)
    ) {
      return false;
    }
  }

  const requestedNumbers = terms.filter(term => /^[2-9]$/.test(term));

  if (requestedNumbers.some(term => !words.has(term))) {
    return false;
  }

  const sequelTerms = ["continuacao", "sequel"];

  if (
    !requestedNumbers.length &&
    terms.some(term => sequelTerms.includes(term)) &&
    !sequelTerms.some(term => words.has(term))
  ) {
    return false;
  }

  if (
    terms.includes("temporada") &&
    !words.has("temporada")
  ) {
    return false;
  }

  return true;
}

function candidateImageScore(candidate, query) {
  const terms = imageQueryTerms(query);

  // Ranking tambem usa somente evidencias da propria imagem.
  const text = candidateVisualText(candidate);
  const words = new Set(text.split(/\s+/));

  let score = 0;

  for (const term of terms) {
    if (words.has(term)) {
      score += 24;
    } else if (
      term.length >= 5 &&
      text.includes(term)
    ) {
      score += 12;
    }
  }

  if (
    /\b(official|oficial|gameplay|screenshot|still|scene|cena|elenco|cast|press|promotional)\b/.test(text)
  ) {
    score += 18;
  }

  const pixels =
    Number(candidate.width || 0) *
    Number(candidate.height || 0);

  if (pixels >= 4000000) score += 18;
  else if (pixels >= 2000000) score += 12;
  else if (pixels >= 1000000) score += 6;

  return score;
}
export async function searchImageCandidates(query, { apiKey, fetchImpl = fetch, signal, semanticQuery = query } = {}) {
  const stats = {
    recebidas: 0, inseguras: 0, url_invalida: 0,
    dimensoes: 0, texto: 0, disponiveis: 0, enviadas: 0,
  };

  const report = etapa =>
    console.log("WIRE/GEEK: busca de imagens", { etapa, ...stats });

  if (!apiKey || !String(query || "").trim()) {
    report(!apiKey ? "chave_ausente" : "consulta_vazia");
    return [];
  }

  const endpoint = new URL("https://serpapi.com/search.json");
  endpoint.search = new URLSearchParams({
    engine: "google_images",
    q: String(query).trim(),
    api_key: apiKey,
    safe: "active",
    tbs: "isz:l",
  }).toString();

  let stage = "requisicao";

  try {
    const response = await fetchImpl(endpoint, {
      signal: signal || AbortSignal.timeout(6000),
    });

    if (!response.ok) {
      report("http_" + response.status);
      return [];
    }

    stage = "leitura_json";
    const data = JSON.parse(
      (await readLimited(response, 2 * 1024 * 1024)).toString("utf8")
    );

    if (data.error) {
      const safeError = String(data.error)
        .split(String(apiKey)).join("[CHAVE OCULTA]")
        .split(encodeURIComponent(String(apiKey))).join("[CHAVE OCULTA]")
        .replace(/https?:\/\/\S+/gi, "[URL OCULTA]")
        .replace(/api[_-]?key\s*[:=]\s*\S+/gi, "api_key=[OCULTA]")
        .slice(0, 600);
      console.error("WIRE/GEEK: detalhe SerpAPI:", safeError);
      report("erro_serpapi");
      return [];
    }

    stage = "filtros";
    const raw = Array.isArray(data.images_results) ? data.images_results : [];
    stats.recebidas = raw.length;
    const accepted = [];

    for (const item of raw) {
      if (item.unsafe) {
        stats.inseguras++;
        continue;
      }

      const candidate = {
        url: imageUrl(item.original),
        source_url: imageUrl(item.link),
        title: String(item.title || ""),
        width: Number(item.original_width || 0),
        height: Number(item.original_height || 0),
      };

      if (!candidate.url) {
        stats.url_invalida++;
        continue;
      }

      if (candidate.width && candidate.height) {
        const aspect = candidate.width / candidate.height;

        if (!(
          candidate.width >= 1200 &&
          candidate.height >= 675 &&
          candidate.width > candidate.height &&
          aspect >= 1.25 &&
          aspect <= 1.85
        )) {
          stats.dimensoes++;
          continue;
        }
      }

      if (!candidateMatchesQuery(candidate, semanticQuery)) {
        stats.texto++;
        continue;
      }

      accepted.push(candidate);
    }

    accepted.sort((a, b) =>
      candidateImageScore(b, semanticQuery) - candidateImageScore(a, semanticQuery) ||
      (b.width * b.height) - (a.width * a.height)
    );

    stats.disponiveis = accepted.length;
    const result = accepted.slice(0, 20);
    stats.enviadas = result.length;
    report("concluida");
    return result;
  } catch {
    report(signal?.aborted ? "prazo_esgotado" : "falha_" + stage);
    return [];
  }
}


function buildFallbackImageQueries(query) {
  const raw = String(query || "").trim();
  if (!raw) return [];

  const positive = raw.split(/\s+-[a-z]/i)[0].trim();
  const terms = imageQueryTerms(raw);
  const subject = terms.slice(0, 5).join(" ").trim();

  return [...new Set([
    positive ? `${positive} official image` : "",
    subject ? `${subject} official press photo` : "",
  ].filter(value => value && value !== raw))].slice(0, 2);
}
function matchesRejectedImage(
  image,
  url,
  rejectedImages = []
) {
  if (!Array.isArray(rejectedImages) || !rejectedImages.length) {
    return false;
  }

  const currentUrl = canonicalImageKey(url);

  return rejectedImages.some((rejected) => {
    const rejectedUrl = canonicalImageKey(
      String(rejected?.image_url || "")
    );

    if (
      currentUrl &&
      rejectedUrl &&
      currentUrl === rejectedUrl
    ) {
      return true;
    }

    const fullDistance = hammingDistance(
      image?.fingerprint?.fullHash,
      rejected?.full_hash
    );

    const cropDistance = hammingDistance(
      image?.fingerprint?.cropHash,
      rejected?.crop_hash
    );

    return fullDistance <= 10 || cropDistance <= 10;
  });
}

export async function resolveBannerImages({ entries, candidates = [], sources = [], query = "", manual = false, rejectedImages = [] }, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const apiKey = dependencies.apiKey ?? process.env.SERPAPI_KEY ?? "";
  const signal = dependencies.signal || AbortSignal.timeout(24000);
  const diagnostic = {
    urls_invalidas: 0, texto: 0, urls_repetidas: 0,
    tentativas_download: 0, falhas_download_ou_leitura: 0,
    rejeitadas_antes: 0, dimensoes: 0, semelhantes: 0,
  };
  const selected = [];
  const attempted = new Set();
  const tryCandidates = async list => {
    for (const candidate of list) {
      if (selected.length === entries.length || attempted.size >= 30 || signal.aborted) break;

      const url = canonicalCandidateImageUrl(
        typeof candidate === "string"
          ? candidate
          : candidate?.url
      );

      if (!url) { diagnostic.urls_invalidas++; continue; }
      const semanticCandidate =
        typeof candidate === "string"
          ? { url: candidate }
          : candidate?.priority === "primary"
            ? { ...candidate, source_url: "" }
            : candidate;

      if (!candidateMatchesQuery(semanticCandidate, query)) { diagnostic.texto++; continue; }
      const attemptKey =
        canonicalImageKey(url);

      if (attempted.has(attemptKey)) {
        diagnostic.urls_repetidas++;
        continue;
      }

      attempted.add(attemptKey);
      diagnostic.tentativas_download++;
      try {
        const image = await downloadImage(url, { fetchImpl, signal });

      if (
        matchesRejectedImage(
          image,
          url,
          rejectedImages
        )
      ) {
        diagnostic.rejeitadas_antes++;
        console.log(
          "WIRE/GEEK: imagem previamente rejeitada descartada"
        );
        continue;
      }
        const { width, height } = image.fingerprint;
        const aspect = width / height;
        if (candidate?.priority === "primary") { if (width < 1200 || height < 630 || width <= height || aspect < 1.25 || aspect > 1.95) { diagnostic.dimensoes++; continue; } } else { if (width < 1200 || height < 675 || width <= height || aspect < 1.25 || aspect > 1.85) { diagnostic.dimensoes++; continue; } }
        if (selected.some(other => sameImage(image.fingerprint, other.fingerprint))) { diagnostic.semelhantes++; continue; }
        selected.push({ ...image, source_url: imageUrl(candidate?.source_url) });
      } catch { diagnostic.falhas_download_ou_leitura++; }
    }
  };
  if (manual) {
    for (const entry of entries) {
      const image = await downloadImage(entry.image_url, {
        fetchImpl,
        signal,
      });

      if (
        selected.some(other =>
          sameImage(image.fingerprint, other.fingerprint)
        )
      ) {
        throw fail(
          "As duas URLs mostram a mesma imagem ou uma versão muito semelhante. Escolha uma segunda foto diferente."
        );
      }

      selected.push(image);
    }
  } else {
    // AUTOMATICO: Google Images exclusivamente via SerpAPI.
    // IGN, Omelete e demais sites sao fontes editoriais da noticia,
    // nunca fontes diretas de imagem para o banner.
    if (!signal.aborted) {
      const googleCandidates = await searchImageCandidates(
        query,
        {
          apiKey,
          fetchImpl,
          signal,
          semanticQuery: query,
        }
      );

      await tryCandidates(googleCandidates);
    }

    // Se a consulta principal nao entregar duas imagens realmente distintas,
    // tente consultas mais curtas, mas mantenha a validacao semantica presa
    // ao assunto original. Isso amplia cobertura sem aceitar imagem fora de contexto.
    if (selected.length < entries.length && !signal.aborted) {
      for (const fallbackQuery of buildFallbackImageQueries(query)) {
        if (selected.length === entries.length || signal.aborted) break;

        console.log("WIRE/GEEK: busca alternativa de imagem", {
          consulta: fallbackQuery,
          selecionadas: selected.length,
          necessarias: entries.length,
        });

        const fallbackCandidates = await searchImageCandidates(
          fallbackQuery,
          {
            apiKey,
            fetchImpl,
            signal,
            semanticQuery: query,
          }
        );

        await tryCandidates(fallbackCandidates);
      }
    }
  }
  console.log("WIRE/GEEK: selecao de imagens", {
    modo: manual ? "manual" : "automatic",
    ...diagnostic,
    selecionadas: selected.length,
    necessarias: entries.length,
    prazo_esgotado: signal.aborted,
    limite_tentativas: attempted.size >= 30,
  });
  if (selected.length !== entries.length) throw fail(entries.length === 2
    ? "Não foram encontradas duas imagens oficiais e distintas adequadas para esta notícia. A geração automática foi interrompida para evitar imagens incorretas ou fora de contexto. Você pode informar duas imagens manualmente."
    : "Não encontrei uma imagem utilizável. Informe outra URL de imagem.");
  return selected;
}
