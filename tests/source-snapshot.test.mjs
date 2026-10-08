import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { captureSourceSnapshot, resolveSourceURL, publicAddress, extractSource, verifyCollectedSources } from '../lib/source-snapshot.mjs';
const resolve = async () => [{ address: '93.184.216.34', family: 4 }];
const body = '<html><head><title>Anúncio oficial</title><meta property="article:published_time" content="2026-10-04T12:00:00Z"></head><body><article>A atualização foi anunciada. ' + 'Conteúdo público verificável. '.repeat(6) + '</article><script>segredo</script><p hidden>invisível</p></body></html>';
function transport(pages) {
  return (url, options, callback) => {
    const req = new EventEmitter();
    req.end = () => queueMicrotask(() => {
      options.lookup(url.hostname, {}, (_error, address) => assert.equal(address, '93.184.216.34'));
      const page = pages.shift();
      if (!page) return;
      const res = new PassThrough(); res.statusCode = page.status || 200;
      res.headers = { 'content-type': 'text/html; charset=utf-8', ...page.headers };
      callback(res); res.end(page.body ?? body);
    });
    options.signal.addEventListener('abort', () => req.emit('error', options.signal.reason), { once: true });
    return req;
  };
}
test('SSRF rejects literals, mapped IPv6, reserved ranges and internal DNS including mixed answers', async () => {
  for (const ip of ['127.0.0.1','10.1.1.1','172.16.0.1','192.168.1.1','169.254.169.254','0.0.0.0','100.64.0.1','192.0.2.1','198.18.0.1','224.0.0.1','240.0.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1']) assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('8.8.8.8'), true);
  for (const url of ['http://localhost/a','http://127.1/a','http://2130706433/a','http://[::1]/a','http://example.local/a','ftp://example.org/a','https://user:pass@example.org/a','http://example.org:8080/a']) await assert.rejects(resolveSourceURL(url, resolve), /SSRF/);
  await assert.rejects(resolveSourceURL('https://public.example/a', async () => [{ address: '10.0.0.1', family: 4 }]), /SSRF/);
  await assert.rejects(resolveSourceURL('https://public.example/a', async () => [...await resolve(), { address: '127.0.0.1', family: 4 }]), /SSRF/);
});
test('deterministic visible text, NFC, title, date, stable hash and final URL', async () => {
  const snapshot = await captureSourceSnapshot('https://example.org/start', { resolve, request: transport([{ status: 302, headers: { location: '/final' } }, {}]) });
  assert.equal(snapshot.final_url, 'https://example.org/final');
  assert.equal(snapshot.title, 'Anúncio oficial'); assert.equal(snapshot.publicado_em, '2026-10-04');
  assert.equal(snapshot.published_at, '2026-10-04T12:00:00.000Z');
  assert.ok(!snapshot.text.includes('segredo')); assert.ok(!snapshot.text.includes('invisível'));
  assert.equal(snapshot.source_hash, extractSource(body.normalize('NFD'), 'text/html', snapshot.final_url).source_hash);
  const raw = { candidatos: [{ evidencias: [{ fato: 'Atualização anunciada', trecho: 'A atualização foi anunciada.'.normalize('NFD'), fonte: 'Oficial', url: 'https://example.org/start', publicado_em: 'inventada' }] }] };
  const verified = await verifyCollectedSources(raw, { captureSource: async () => snapshot });
  assert.equal(verified.candidatos[0].evidencias[0].source_verified, true);
  assert.equal(verified.candidatos[0].evidencias[0].publicado_em, '2026-10-04');
  assert.equal(raw.candidatos[0].evidencias[0].publicado_em, 'inventada');
  raw.candidatos[0].evidencias[0].trecho = 'Uma paráfrase da atualização';
  await assert.rejects(verifyCollectedSources(raw, { captureSource: async () => snapshot }), /NOT_LITERAL/);
});
test('redirects revalidate destinations and enforce a finite limit', async () => {
  await assert.rejects(captureSourceSnapshot('https://example.org/a', { resolve, request: transport([{ status: 302, headers: { location: 'http://127.0.0.1/a' } }]) }), /SSRF/);
  await assert.rejects(captureSourceSnapshot('https://example.org/a', { resolve, maxRedirects: 0, request: transport([{ status: 302, headers: { location: '/b' } }]) }), /REDIRECT_LIMIT/);
});
test('timeout includes DNS and response; content type, byte limit and HTTP errors fail closed', async () => {
  await assert.rejects(captureSourceSnapshot('https://example.org/a', { resolve: () => new Promise(() => {}), timeoutMs: 10 }), /TIMEOUT/);
  await assert.rejects(captureSourceSnapshot('https://example.org/a', { resolve, request: transport([]), timeoutMs: 10 }), /TIMEOUT/);
  for (const [page, pattern, options] of [
    [{ headers: { 'content-type': 'application/json' } }, /CONTENT_TYPE/, {}],
    [{ headers: { 'content-length': '5000' } }, /TOO_LARGE/, { maxBytes: 100 }],
    [{}, /TOO_LARGE/, { maxBytes: 100 }],
    [{ status: 403 }, /HTTP_403/, {}],
    [{ body: '<script>application only</script>' }, /NO_VERIFIABLE/, {}],
    [{ body: '<p>Subscribe to continue ' + 'blocked '.repeat(30) + '</p>' }, /BLOCKED/, {}],
  ]) await assert.rejects(captureSourceSnapshot('https://example.org/a', { resolve, request: transport([page]), ...options }), pattern);
});
test('plain text and time datetime supported; absent date stays empty', () => {
  const snapshot = extractSource('Texto verificável '.repeat(10), 'text/plain', 'https://example.org/a');
  assert.equal(snapshot.publicado_em, ''); assert.equal(snapshot.title, '');
  assert.equal(extractSource('<time datetime="2026-10-03">ontem</time><p>' + 'Texto '.repeat(30) + '</p>', 'text/html', 'https://example.org').publicado_em, '2026-10-03');
});

test('inline HTML does not insert artificial whitespace or join block paragraphs', () => {
  const snapshot = extractSource('<p>Before <em>Gears of War</em>, confirmed.</p><p>' + 'Text '.repeat(30) + '</p>', 'text/html', 'https://example.org');
  assert.ok(snapshot.text.includes('Before Gears of War, confirmed. Text'));
  assert.ok(!snapshot.text.includes('War ,'));
});


test('W26 charset UTF-8 valido prevalece sobre header latin1 incorreto', () => {
  const original =
    '“RuneScape” – anúncio oficial アニメ';

  const bytes =
    Buffer.from(
      original,
      'utf8'
    );

  const decoded =
    new TextDecoder(
      'utf-8',
      { fatal: true }
    ).decode(bytes);

  assert.equal(
    decoded,
    original
  );
});

test('W26 data sem horario nao cria published_at artificial', () => {
  const snapshot =
    extractSource(
      '<html><head><meta property="article:published_time" content="2026-10-03"></head><body><p>Texto editorial suficientemente longo para ser considerado verificavel pela captura independente da fonte.</p></body></html>',
      'text/html',
      'https://example.com/news'
    );

  assert.equal(
    snapshot.publicado_em,
    '2026-10-03'
  );

  assert.equal(
    snapshot.published_at,
    ''
  );
});

test('W26 timestamp real preserva published_at preciso', () => {
  const snapshot =
    extractSource(
      '<html><head><meta property="article:published_time" content="2026-10-03T21:44:49Z"></head><body><p>Texto editorial suficientemente longo para ser considerado verificavel pela captura independente da fonte.</p></body></html>',
      'text/html',
      'https://example.com/news'
    );

  assert.equal(
    snapshot.publicado_em,
    '2026-10-03'
  );

  assert.equal(
    snapshot.published_at,
    '2026-10-03T21:44:49.000Z'
  );
});

test('literalidade aceita variantes tipograficas equivalentes sem fuzzy matching', async () => {
  const snapshot = {
    final_url: 'https://example.org/noticia',
    text: 'O estúdio confirmou “Novo Projeto” — com lançamento previsto para outubro.',
    publicado_em: '2026-10-04',
    source_hash: 'sha256:' + 'd'.repeat(64),
  };

  const collected = {
    candidatos: [
      {
        evidencias: [
          {
            fato: 'Novo Projeto foi confirmado.',
            trecho: 'O estúdio confirmou "Novo Projeto" - com lançamento previsto para outubro.',
            fonte: 'Fonte oficial',
            url: 'https://example.org/noticia',
            publicado_em: '2026-10-04',
          }
        ]
      }
    ]
  };

  const verified =
    await verifyCollectedSources(
      collected,
      {
        captureSource:
          async () => snapshot
      }
    );

  assert.equal(
    verified
      .candidatos[0]
      .evidencias[0]
      .source_verified,
    true
  );
});

test('literalidade continua rejeitando parafrase semanticamente parecida', async () => {
  const snapshot = {
    final_url: 'https://example.org/noticia',
    text: 'O estúdio confirmou “Novo Projeto” — com lançamento previsto para outubro.',
    publicado_em: '2026-10-04',
    source_hash: 'sha256:' + 'e'.repeat(64),
  };

  const collected = {
    candidatos: [
      {
        evidencias: [
          {
            fato: 'Novo Projeto foi confirmado.',
            trecho: 'A empresa anunciou que o jogo chega em outubro.',
            fonte: 'Fonte oficial',
            url: 'https://example.org/noticia',
            publicado_em: '2026-10-04',
          }
        ]
      }
    ]
  };

  await assert.rejects(
    verifyCollectedSources(
      collected,
      {
        captureSource:
          async () => snapshot
      }
    ),
    /SOURCE_EXCERPT_NOT_LITERAL/
  );
});


test('semantic article selects real headline and removes recommendations, ads and navigation', () => {
  const html = `<html><head><title>The Verge</title>
    <meta property="og:title" content="Bose starts adding Auracast to its headphones">
    <meta property="article:published_time" content="2026-09-28T19:31:24Z"></head>
    <body><nav>Skip to main content Navigation</nav>
    <article><h1>Bose starts adding Auracast to its headphones</h1>
    <p>A new firmware update for Bose QuietComfort Ultra Headphones Gen 2 adds Bluetooth LE Audio and Auracast as beta features.</p>
    <p>The firmware 10.12.12 also improves USB audio for gaming and web conferencing, with support planned for other models.</p>
    <aside class="recirculation">Most Popular Xbox has secured GTA 6 streaming rights.</aside>
    <div class="advertisement">Advertiser Content From</div><div class="tly2fw0">Follow topics and authors</div></article>
    <section class="related-stories">Google investments and unrelated headlines</section>
    <footer>Top Stories and advertisements</footer></body></html>`;
  const snapshot = extractSource(html, 'text/html', 'https://example.org/tech/bose');
  assert.equal(snapshot.title, 'Bose starts adding Auracast to its headphones');
  assert.equal(snapshot.publicado_em, '2026-09-28');
  assert.match(snapshot.text, /firmware 10\.12\.12/);
  for (const noise of ['Most Popular', 'GTA 6', 'Advertiser Content', 'Follow topics and authors', 'Google investments', 'Top Stories', 'Skip to main content']) {
    assert.ok(!snapshot.text.includes(noise), noise);
  }
  assert.equal(snapshot.source_hash, extractSource(html, 'text/html', 'https://example.org/tech/bose').source_hash);
});

test('text-only and non-article pages keep fallback content and do not accept tiny article wrappers', () => {
  const page = '<html><head><title>Boletim completo</title></head><body><article>Breve.</article><main><p>' +
    'A informação comprovada está no corpo principal. '.repeat(8) +
    '</p></main></body></html>';
  const snapshot = extractSource(page, 'text/html', 'https://example.org/boletim');
  assert.match(snapshot.text, /informação comprovada/);
  assert.equal(snapshot.title, 'Boletim completo');
  assert.match(extractSource('Conteúdo oficial. '.repeat(10), 'text/plain', 'https://example.org/plain').text, /Conteúdo oficial/);
});
