import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { parse } from 'parse5';

export const normalizeSourceText = value =>
  String(value)
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim();

export const normalizeSourceUrlInput = value =>
  String(value ?? "")
    .normalize("NFC")
    .trim()
    .replace(/^[\u200B-\u200D\u2060\uFEFF\uFFFD]+|[\u200B-\u200D\u2060\uFEFF\uFFFD]+$/gu, "");

/*
 * Normalizacao exclusiva para COMPARACAO de literalidade.
 *
 * Nao cria palavras, nao remove palavras e nao faz fuzzy matching.
 * Apenas uniformiza variantes tipograficas equivalentes que podem
 * divergir entre resultado de busca e HTML da origem.
 */
export const normalizeLiteralComparison = value =>
  normalizeSourceText(value)
    .replace(/[\u2018\u2019\u201A\u201B]/gu, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/gu, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/gu, '-')
    .replace(/\u00A0/gu, ' ');
const fail = code => { throw new Error(code); };
export function publicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export async function resolveSourceURL(raw, resolve = lookup) {
  const normalizedRaw = normalizeSourceUrlInput(raw);
  const url = new URL(normalizedRaw);
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port)) || !host.includes('.') && !host.includes(':') ||
      /(^|\.)(localhost|local|localdomain|internal|intranet|corp|lan|home|test|invalid|onion)$/.test(host)) fail('SOURCE_SSRF_BLOCKED');
  const addresses = ipaddr.isValid(host) ? [{ address: host, family: ipaddr.parse(host).kind() === 'ipv4' ? 4 : 6 }] : await resolve(host, { all: true });
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) fail('SOURCE_SSRF_BLOCKED');
  url.hash = '';
  return { url, address: addresses[0] };
}

export function extractSource(body, contentType, finalURL) {
  let title = '', date = '', content = body;
  if (contentType === 'text/html') {
    const root = parse(body);
    const blocked = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head', 'nav', 'footer', 'form', 'aside', 'iframe']);
    const boundaries = new Set(['address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'li', 'main', 'ol', 'p', 'pre', 'section', 'table', 'td', 'th', 'tr', 'ul']);
    const attrsOf = node => Object.fromEntries((node.attrs || []).map(a => [a.name, a.value]));
    const textOf = node => (node.value || '') + (node.childNodes || []).map(textOf).join(' ');
    const isNoise = node => {
      const attrs = attrsOf(node);
      const descriptor = [attrs.id, attrs.class, attrs['data-testid'], attrs['aria-label']].filter(Boolean).join(' ');
      if (/(?:duet--layout--rail|duet--ad--|tly2fw0)/i.test(descriptor)) return true;
      return /(?:^|[\s_-])(?:advertis(?:ement|er)?|adslot|ad-unit|sponsor(?:ed)?|recirculation|related(?:-stories|-articles|-content)?|recommendations?|most-popular|trending|newsletter|social-share|share-tools)(?:$|[\s_-])/i.test(descriptor);
    };
    const candidates = [];
    const metaTitles = [];
    function inspect(node) {
      const attrs = attrsOf(node);
      if (node.tagName === 'title') title = normalizeSourceText(textOf(node));
      if (node.tagName === 'meta') {
        const name = (attrs.property || attrs.name || '').toLowerCase();
        if (['og:title', 'twitter:title'].includes(name) && attrs.content) metaTitles.push(normalizeSourceText(attrs.content));
        if (/^(article:published_time|datepublished|date|pubdate)$/.test(name)) date ||= attrs.content || '';
      }
      if (node.tagName === 'time') date ||= attrs.datetime || '';
      if (node.tagName === 'article' || attrs.itemprop === 'articleBody') candidates.push(node);
      for (const child of node.childNodes || []) inspect(child);
    }
    inspect(root);
    if (metaTitles.length) title = metaTitles[0];
    const visibleText = node => {
      const chunks = [];
      function visit(current, hidden = false) {
        const attrs = attrsOf(current);
        hidden ||= blocked.has(current.tagName) || isNoise(current) ||
          'hidden' in attrs || attrs['aria-hidden'] === 'true' ||
          /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attrs.style || '');
        if (hidden) return;
        if (boundaries.has(current.tagName)) chunks.push(' ');
        if (current.nodeName === '#text') chunks.push(current.value);
        for (const child of current.childNodes || []) visit(child, hidden);
        if (boundaries.has(current.tagName)) chunks.push(' ');
      }
      visit(node);
      return normalizeSourceText(chunks.join(''));
    };
    // Prefer the longest semantic article, but retain a fallback for pages
    // without article markup. No host-specific parsing or network changes.
    const articleText = candidates.map(visibleText).sort((a, b) => b.length - a.length)[0] || '';
    // Prefer the visible editorial headline over SEO-specific social titles.
    const articleHeadlines = [];
    for (const article of candidates) {
      const findHeading = node => {
        if (node.tagName === 'h1') articleHeadlines.push(normalizeSourceText(textOf(node)));
        for (const child of node.childNodes || []) findHeading(child);
      };
      findHeading(article);
    }
    if (articleHeadlines.find(headline => headline.length >= 12)) title = articleHeadlines.find(headline => headline.length >= 12);
    content = articleText.length >= 240 ? articleText : visibleText(root);
  }
  const text = normalizeSourceText(content);
  if (text.length < 80 || /access denied|verify you are human|enable javascript|subscribe to (continue|read)|sign in to (continue|read)/i.test(text)) fail('SOURCE_NO_VERIFIABLE_TEXT_OR_BLOCKED');
  const normalizedDate =
    String(date || '').trim();

  const dateOnly =
    /^\d{4}-\d{2}-\d{2}$/
      .test(normalizedDate);

  const timestamped =
    /^\d{4}-\d{2}-\d{2}T.+/
      .test(normalizedDate) &&
    !Number.isNaN(
      Date.parse(normalizedDate)
    );

  /*
   * published_at representa somente horario realmente fornecido
   * pela pagina. Uma data YYYY-MM-DD nao ganha meia-noite artificial.
   */
  const publishedAt =
    timestamped
      ? new Date(
          normalizedDate
        ).toISOString()
      : '';

  const published =
    timestamped
      ? publishedAt.slice(0, 10)
      : dateOnly
        ? normalizedDate
        : '';

  return {
    final_url: finalURL,
    title,
    publicado_em: published,
    published_at: publishedAt,
    text,
    source_hash:
      'sha256:' +
      createHash('sha256')
        .update(text, 'utf8')
        .digest('hex'),
  };
}

export async function captureSourceSnapshot(raw, { timeoutMs = 12000, maxBytes = 2000000, maxRedirects = 3, resolve = lookup, request } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('SOURCE_TIMEOUT')), timeoutMs);
  const deadline = promise => Promise.race([promise, new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  })]);
  try {
    let current = raw;
    for (let redirects = 0; ; redirects++) {
      const { url, address } = await deadline(resolveSourceURL(current, resolve));
      const response = await deadline(new Promise((accept, reject) => {
        const send = request || (url.protocol === 'https:' ? https.request : http.request);
        const req = send(url, { agent: false, signal: controller.signal,
          lookup: (_host, options, callback) => callback(null, options.all ? [address] : address.address, address.family),
          headers: { Accept: 'text/html, text/plain', 'Accept-Encoding': 'identity', 'User-Agent': 'WireGeek-SourceSnapshot/1.0' } }, res => {
          const status = res.statusCode;
          if ([301, 302, 303, 307, 308].includes(status)) { res.destroy(); accept({ redirect: res.headers.location }); return; }
          if (status !== 200) { res.destroy(); reject(new Error('SOURCE_HTTP_' + status)); return; }
          const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
          if (!['text/html', 'text/plain'].includes(type) || (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')) { res.destroy(); reject(new Error('SOURCE_CONTENT_TYPE')); return; }
          if (Number(res.headers['content-length']) > maxBytes) { res.destroy(); reject(new Error('SOURCE_TOO_LARGE')); return; }
          let size = 0; const chunks = [];
          res.on('data', chunk => { size += chunk.length; if (size > maxBytes) { res.destroy(); reject(new Error('SOURCE_TOO_LARGE')); } else chunks.push(chunk); });
          res.on('error', reject);
          res.on('end', () => {
            try {
              const buffer = Buffer.concat(chunks);

              const declaredCharset =
                /charset\s*=\s*["']?([^;\s"']+)/i
                  .exec(res.headers['content-type'] || '')?.[1]
                  ?.toLowerCase() ||
                '';

              /*
               * Muitos sites enviam HTML UTF-8 com header legado
               * iso-8859-1/windows-1252. Se os bytes formarem UTF-8
               * estrito válido, preferimos UTF-8 para evitar mojibake
               * como â€œ e ã‚¢. Se não forem UTF-8 válidos, usamos
               * o charset declarado pela origem.
               */
              let body;

              try {
                body =
                  new TextDecoder(
                    'utf-8',
                    { fatal: true }
                  ).decode(buffer);
              } catch {
                const charset =
                  declaredCharset ||
                  'utf-8';

                body =
                  new TextDecoder(
                    charset,
                    { fatal: true }
                  ).decode(buffer);
              }

              accept({
                body,
                type
              });
            } catch { reject(new Error('SOURCE_ENCODING')); }
          });
        });
        req.on('error', reject); req.end();
      }));
      if ('redirect' in response) {
        if (!response.redirect || redirects >= maxRedirects) fail('SOURCE_REDIRECT_LIMIT');
        current = new URL(response.redirect, url).href; continue;
      }
      return extractSource(response.body, response.type, url.href);
    }
  } finally { clearTimeout(timer); }
}

function sourceDiagnostic({
  candidateIndex,
  evidenceIndex,
  evidence,
  status,
  code = "",
  finalUrl = "",
}) {
  const message = String(code || "").trim();
  const httpMatch = /^SOURCE_HTTP_(\d{3})$/.exec(message);

  return {
    candidate_index: candidateIndex,
    evidence_index: evidenceIndex,
    fonte: normalizeSourceText(evidence?.fonte || ""),
    url: String(evidence?.url || "").trim(),
    final_url: String(finalUrl || "").trim(),
    status,
    error_code: message || null,
    http_status: httpMatch ? Number(httpMatch[1]) : null,
  };
}

export async function verifyCollectedSources(
  collected,
  {
    captureSource = captureSourceSnapshot,
    onSnapshot,
    onDiagnostic,
  } = {}
) {
  const result = structuredClone(collected);
  if (!Array.isArray(result?.candidatos) || result.candidatos.length < 1 || result.candidatos.length > 12) {
    fail('COLLECTED_CANDIDATES_REQUIRED_OR_LIMIT');
  }

  const cache = new Map();
  const verified = [];
  const diagnostics = [];
  let examined = 0;

  const record = diagnostic => {
    diagnostics.push(diagnostic);
    onDiagnostic?.(diagnostic);
  };

  for (let candidateIndex = 0; candidateIndex < result.candidatos.length; candidateIndex++) {
    const candidate = result.candidatos[candidateIndex];
    const evidenceList = candidate?.evidencias;
    if (!Array.isArray(evidenceList) || !evidenceList.length) continue;
    const accepted = [];

    for (let evidenceIndex = 0; evidenceIndex < evidenceList.length; evidenceIndex++) {
      const evidence = evidenceList[evidenceIndex];

      if (++examined > 48) fail('SOURCE_EVIDENCE_LIMIT');

      if (
        !evidence ||
        typeof evidence.url !== 'string' ||
        !normalizeSourceText(evidence.fato || '') ||
        !normalizeSourceText(evidence.fonte || '')
      ) {
        record(sourceDiagnostic({
          candidateIndex,
          evidenceIndex,
          evidence,
          status: 'invalid_evidence',
          code: 'SOURCE_EVIDENCE_INVALID',
        }));
        continue;
      }

      try {
        if (!cache.has(evidence.url)) {
          // Reuse failures as well as successes; never refetch blocked origins in one run.
          cache.set(evidence.url, Promise.resolve().then(() => captureSource(evidence.url)));
        }

        const snapshot = await cache.get(evidence.url);
        const excerpt = normalizeSourceText(evidence.trecho || '');
        const literalMatch =
          Boolean(excerpt) &&
          normalizeLiteralComparison(snapshot.text)
            .includes(normalizeLiteralComparison(excerpt));

        if (!literalMatch) {
          record(sourceDiagnostic({
            candidateIndex,
            evidenceIndex,
            evidence,
            status: 'literal_mismatch',
            code: excerpt ? 'SOURCE_LITERAL_MISMATCH' : 'SOURCE_EXCERPT_MISSING',
            finalUrl: snapshot.final_url,
          }));
          continue;
        }

        accepted.push({
          ...evidence,
          trecho: excerpt,
          url: snapshot.final_url,
          publicado_em: snapshot.publicado_em || '',
          source_verified: true,
          source_hash: snapshot.source_hash,
        });

        record(sourceDiagnostic({
          candidateIndex,
          evidenceIndex,
          evidence,
          status: 'verified',
          finalUrl: snapshot.final_url,
        }));

        onSnapshot?.(snapshot);
      } catch (error) {
        // Bad, blocked, timed-out or inaccessible sources must not invalidate
        // independent verified candidates. No unchecked evidence is retained.
        record(sourceDiagnostic({
          candidateIndex,
          evidenceIndex,
          evidence,
          status: 'capture_failed',
          code: error?.message || 'SOURCE_CAPTURE_FAILED',
        }));
      }
    }

    if (accepted.length) verified.push({ ...candidate, evidencias: accepted });
  }

  if (!verified.length) {
    const error = new Error('SOURCE_NO_VERIFIED_CANDIDATES');
    error.sourceDiagnostics = diagnostics;
    throw error;
  }

  result.candidatos = verified;
  Object.defineProperty(result, 'source_diagnostics', {
    value: diagnostics,
    enumerable: false,
  });

  return result;
}