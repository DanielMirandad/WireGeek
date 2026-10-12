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