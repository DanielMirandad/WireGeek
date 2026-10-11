import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSourceURL, resolveSourceURL } from '../lib/source-snapshot.mjs';

const publicDNS = async () => [{ address: '93.184.215.14', family: 4 }];

test('removes copy-paste artifacts only at URL boundaries', () => {
  const url = 'https://example.com/news/story?lang=pt&x=1';
  assert.equal(sanitizeSourceURL('  ' + url + '\u2060\uFFFD  '), url);
  assert.equal(sanitizeSourceURL(url), url);
});

test('source URL resolves after removing trailing invisible artifacts', async () => {
  const result = await resolveSourceURL('https://example.com/story/\u2060\uFFFD', publicDNS);
  assert.equal(result.url.href, 'https://example.com/story/');
});

test('rejects unsafe source URLs after normalization', async () => {
  await assert.rejects(resolveSourceURL('http://localhost/private\u2060', publicDNS), /SOURCE_SSRF_BLOCKED/);
});

test('does not silently modify embedded invalid characters', () => {
  assert.equal(sanitizeSourceURL('https://example.com/a\uFFFDb'), 'https://example.com/a\uFFFDb');
});
