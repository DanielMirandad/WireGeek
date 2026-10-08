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
  const url = new URL(raw);
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
      if (/(?:duet--layout--rail|duet--ad--)/i.test(descriptor)) return true;
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

export async function verifyCollectedSources(collected, { captureSource = captureSourceSnapshot, onSnapshot } = {}) {
  const result = structuredClone(collected); const cache = new Map();
  if (!Array.isArray(result?.candidatos) || result.candidatos.length < 1 || result.candidatos.length > 12) fail('COLLECTED_CANDIDATES_REQUIRED_OR_LIMIT');
  let count = 0;
  for (const candidate of result.candidatos) {
    if (!candidate.evidencias?.length) fail('COLLECTED_EVIDENCE_REQUIRED');
    for (const evidence of candidate.evidencias) {
      if (++count > 48) fail('SOURCE_EVIDENCE_LIMIT');
      if (!cache.has(evidence.url)) cache.set(evidence.url, await captureSource(evidence.url));
      const snapshot = cache.get(evidence.url);
      const excerpt =
        normalizeSourceText(
          evidence.trecho || ''
        );

      const sourceLiteral =
        normalizeLiteralComparison(
          snapshot.text
        );

      const evidenceLiteral =
        normalizeLiteralComparison(
          excerpt
        );

      if (
        !evidenceLiteral ||
        !sourceLiteral.includes(
          evidenceLiteral
        )
      ) {
        fail(
          'SOURCE_EXCERPT_NOT_LITERAL'
        );
      }
      if (!normalizeSourceText(evidence.fato || '') || !normalizeSourceText(evidence.fonte || '')) fail('SOURCE_FACT_OR_NAME_REQUIRED');
      evidence.trecho = excerpt;
      evidence.url = snapshot.final_url;

      // Para verificacao de frescor, preserve a maior precisao temporal
      // disponibilizada diretamente pela fonte.
      // O contrato editorial continua usando somente YYYY-MM-DD.
      // published_at permanece metadado operacional do sourceSnapshot.
      evidence.publicado_em =
        snapshot.publicado_em ||
        '';

      evidence.source_verified = true;
      evidence.source_hash = snapshot.source_hash;
      onSnapshot?.(snapshot);
    }
  }
  return result;
}
