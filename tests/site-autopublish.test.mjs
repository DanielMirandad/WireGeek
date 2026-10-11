import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInternalSiteCaller,
  readAutopublishConfig,
  runSiteAutopublish,
} from '../lib/site-autopublish.mjs';

const NOW = Date.parse('2026-10-12T13:00:00.000Z');
const HOUR = 3600 * 1000;
const iso = (hoursAgo) => new Date(NOW - hoursAgo * HOUR).toISOString();

const ENV = {
  SITE_AUTOPUBLISH: 'on',
  WIREGEEK_AUTOMATION_KEY: 'k1',
  WIREGEEK_ACCESS_KEY: 'k2',
  BAGACA_SITE_PUBLISH_URL: 'https://example.org/api/integrations/wiregeek/publish',
  BAGACA_SITE_PUBLISH_KEY: 'k3',
};

// Query builder minimo que aplica filtros sobre fixtures em memoria.
function fakeDb(tables) {
  return {
    from(name) {
      let rows = [...(tables[name] || [])];
      const q = {
        select() { return q; },
        eq(field, value) { rows = rows.filter((r) => r[field] === value); return q; },
        in(field, values) { rows = rows.filter((r) => values.includes(r[field])); return q; },
        gte(field, value) { rows = rows.filter((r) => r[field] >= value); return q; },
        not(field, op, value) {
          if (op === 'is' && value === null) rows = rows.filter((r) => r[field] != null);
          return q;
        },
        order() { return q; },
        limit(n) { rows = rows.slice(0, n); return q; },
        then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
      };
      return q;
    },
  };
}

const pub = (id, hoursAgo = 1, status = 'APROVADO') => ({
  noticia_id: id, status, source_image_url: 'https://img.example/' + id + '.jpg', criado_em: iso(hoursAgo),
});

function recorder(script = {}) {
  const calls = [];
  const callAction = async (body) => {
    calls.push(body);
    const key = body.action + ':' + body.noticia_id;
    if (script[key]) return script[key];
    if (body.action === 'generate-editorial') {
      return { status: 200, body: { success: true, data: {
        materia_site: 'materia ' + body.noticia_id, resumo_site: 'resumo ' + body.noticia_id,
        approval_receipt: 'receipt-' + body.noticia_id } } };
    }
    if (body.action === 'approve-editorial') return { status: 200, body: { success: true, data: {} } };
    return { status: 201, body: { success: true, action: 'published', data: { site_url: 'https://example.org/noticias/n' + body.noticia_id } } };
  };
  return { calls, callAction };
}

const run = (tables, opts = {}) => {
  const rec = recorder(opts.script);
  return runSiteAutopublish({
    supabase: fakeDb(tables), callAction: rec.callAction, env: opts.env || ENV, now: NOW, dryRun: opts.dryRun,
  }).then((result) => ({ result, calls: rec.calls }));
};

test('config: desligado por padrao e limites com valores seguros', () => {
  assert.deepEqual(readAutopublishConfig({}), { enabled: false, dailyLimit: 3, windowHours: 48 });
  assert.equal(readAutopublishConfig({ SITE_AUTOPUBLISH: 'ON' }).enabled, true);
  assert.equal(readAutopublishConfig({ SITE_AUTOPUBLISH: 'true' }).enabled, false);
  assert.equal(readAutopublishConfig({ SITE_AUTOPUBLISH_DAILY_LIMIT: '999' }).dailyLimit, 10);
  assert.equal(readAutopublishConfig({ SITE_AUTOPUBLISH_DAILY_LIMIT: '0' }).dailyLimit, 1);
  assert.equal(readAutopublishConfig({ SITE_AUTOPUBLISH_DAILY_LIMIT: 'x' }).dailyLimit, 3);
  assert.equal(readAutopublishConfig({ SITE_AUTOPUBLISH_WINDOW_HOURS: '1' }).windowHours, 6);
});

test('interruptor desligado: nao consulta nem executa nada', async () => {
  const { result, calls } = await run({ publicacoes: [pub(1)] }, { env: { ...ENV, SITE_AUTOPUBLISH: 'off' } });
  assert.equal(result.status, 200);
  assert.equal(result.body.enabled, false);
  assert.deepEqual(result.body.published, []);
  assert.equal(calls.length, 0);
});

test('variaveis ausentes: falha fechada listando apenas os nomes', async () => {
  const { result, calls } = await run({ publicacoes: [pub(1)] }, { env: { SITE_AUTOPUBLISH: 'on' } });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'AUTOPUBLISH_NOT_CONFIGURED');
  assert.deepEqual(result.body.missing, ['WIREGEEK_AUTOMATION_KEY', 'WIREGEEK_ACCESS_KEY', 'BAGACA_SITE_PUBLISH_URL', 'BAGACA_SITE_PUBLISH_KEY']);
  assert.equal(calls.length, 0);
});

test('dry run: lista candidatas sem gerar nem publicar, mesmo desligado', async () => {
  const { result, calls } = await run({
    publicacoes: [pub(1), pub(2)],
    site_editorial_approvals: [{ noticia_id: 2 }],
  }, { env: {}, dryRun: true });
  assert.equal(result.status, 200);
  assert.equal(result.body.dry_run, true);
  assert.deepEqual(result.body.candidates, [
    { noticia_id: 1, has_approval: false },
    { noticia_id: 2, has_approval: true },
  ]);
  assert.equal(calls.length, 0);
});

test('caminho feliz: gera, aprova e publica, nessa ordem e com o recibo', async () => {
  const { result, calls } = await run({ publicacoes: [pub(10)] });
  assert.deepEqual(calls.map((c) => c.action), ['generate-editorial', 'approve-editorial', 'publish']);
  assert.equal(calls[1].approval_receipt, 'receipt-10');
  assert.equal(calls[1].materia_site, 'materia 10');
  assert.equal(calls[1].resumo_site, 'resumo 10');
  assert.deepEqual(result.body.published, [{ noticia_id: 10, action: 'published', site_url: 'https://example.org/noticias/n10' }]);
  assert.deepEqual(result.body.skipped, []);
});

test('limite diario: conta publicacoes das ultimas 24h e respeita o restante', async () => {
  const { result, calls } = await run({
    publicacoes: [pub(1), pub(2), pub(3), pub(4)],
    site_news: [
      { origin: 'wiregeek', wiregeek_noticia_id: 900, published_at: iso(2) },
      { origin: 'wiregeek', wiregeek_noticia_id: 901, published_at: iso(5) },
      { origin: 'wiregeek', wiregeek_noticia_id: 902, published_at: iso(30) }, // fora das 24h
    ],
  });
  assert.equal(result.body.remaining_before, 1);
  assert.equal(result.body.published.length, 1);
  assert.equal(calls.filter((c) => c.action === 'publish').length, 1);
});

test('limite diario atingido: nao chama nenhuma acao', async () => {
  const { result, calls } = await run({
    publicacoes: [pub(1)],
    site_news: [1, 2, 3].map((n) => ({ origin: 'wiregeek', wiregeek_noticia_id: 900 + n, published_at: iso(1) })),
  });
  assert.equal(result.body.limit_reached, true);
  assert.equal(calls.length, 0);
});

test('ignora noticia ja publicada no site e noticias fora da janela ou sem imagem aprovada', async () => {
  const { result, calls } = await run({
    publicacoes: [
      pub(1), // ja publicada
      pub(2, 100), // fora da janela de 48h
      pub(3, 1, 'AGUARDANDO_APROVACAO'), // imagem nao aprovada
      { ...pub(4), source_image_url: null }, // sem imagem
      pub(5),
    ],
    site_news: [{ origin: 'wiregeek', wiregeek_noticia_id: 1, published_at: iso(40) }],
  });
  assert.deepEqual(result.body.published.map((p) => p.noticia_id), [5]);
  assert.deepEqual([...new Set(calls.map((c) => c.noticia_id))], [5]);
});

test('falha na geracao: registra, pula para a proxima e nao publica a que falhou', async () => {
  const { result, calls } = await run({ publicacoes: [pub(1), pub(2)] }, {
    script: { 'generate-editorial:1': { status: 422, body: { success: false, code: 'EDITORIAL_UNSUPPORTED_CLAIM', error: 'Sem suporte nas fontes.' } } },
  });
  assert.deepEqual(result.body.skipped, [{ noticia_id: 1, stage: 'generate', code: 'EDITORIAL_UNSUPPORTED_CLAIM', error: 'Sem suporte nas fontes.' }]);
  assert.deepEqual(result.body.published.map((p) => p.noticia_id), [2]);
  assert.equal(calls.some((c) => c.noticia_id === 1 && c.action !== 'generate-editorial'), false);
});

test('geracao sem recibo e tratada como falha, sem aprovar', async () => {
  const { result, calls } = await run({ publicacoes: [pub(1)] }, {
    script: { 'generate-editorial:1': { status: 200, body: { success: true, data: { materia_site: 'm', resumo_site: 'r' } } } },
  });
  assert.equal(result.body.skipped[0].stage, 'generate');
  assert.deepEqual(calls.map((c) => c.action), ['generate-editorial']);
});

test('aprovacao ja gravada: publica direto, sem gerar de novo', async () => {
  const { result, calls } = await run({ publicacoes: [pub(7)], site_editorial_approvals: [{ noticia_id: 7 }] });
  assert.deepEqual(calls.map((c) => c.action), ['publish']);
  assert.equal(result.body.published.length, 1);
});

test('falha no publish: registra etapa e nao conta como publicada', async () => {
  const { result } = await run({ publicacoes: [pub(1)] }, {
    script: { 'publish:1': { status: 502, body: { success: false, error: 'Site indisponivel.' } } },
  });
  assert.deepEqual(result.body.published, []);
  assert.deepEqual(result.body.skipped, [{ noticia_id: 1, stage: 'publish', code: 'HTTP_502', error: 'Site indisponivel.' }]);
});

test('tentativas por execucao sao limitadas mesmo com muitas falhas', async () => {
  const many = Array.from({ length: 20 }, (_, i) => pub(i + 1));
  const fail = { status: 500, body: { success: false, error: 'falha' } };
  const script = Object.fromEntries(many.map((p) => ['generate-editorial:' + p.noticia_id, fail]));
  const { result, calls } = await run({ publicacoes: many }, { script });
  // limite 3 -> no maximo 6 tentativas (teto fixo), cada uma com 1 chamada de geracao
  assert.equal(result.body.attempts, 6);
  assert.equal(calls.length, 6);
  assert.equal(result.body.published.length, 0);
});

test('excecao do handler vira registro, nao derruba a execucao', async () => {
  const supabase = fakeDb({ publicacoes: [pub(1), pub(2)] });
  let n = 0;
  const callAction = async (body) => {
    if (body.noticia_id === 1) throw new Error('rede caiu');
    n += 1;
    if (body.action === 'generate-editorial') return { status: 200, body: { success: true, data: { materia_site: 'm', resumo_site: 'r', approval_receipt: 'x' } } };
    return { status: 200, body: { success: true, action: 'published', data: {} } };
  };
  const result = await runSiteAutopublish({ supabase, callAction, env: ENV, now: NOW });
  assert.equal(result.body.skipped[0].code, 'AUTOPUBLISH_EXCEPTION');
  assert.deepEqual(result.body.published.map((p) => p.noticia_id), [2]);
  assert.ok(n >= 3);
});

test('chamador interno envia a chave de automacao e devolve status e corpo do handler', async () => {
  let seen;
  const handler = async (req, res) => {
    seen = req;
    return res.status(201).json({ success: true });
  };
  const call = createInternalSiteCaller(handler, { WIREGEEK_AUTOMATION_KEY: 'segredo' });
  const out = await call({ action: 'publish', noticia_id: 5 });
  assert.deepEqual(out, { status: 201, body: { success: true } });
  assert.equal(seen.method, 'POST');
  assert.equal(seen.query.mode, 'site-publish');
  assert.equal(seen.headers['x-wiregeek-automation-key'], 'segredo');
  assert.deepEqual(seen.body, { action: 'publish', noticia_id: 5 });
});

test('chamador interno trata handler sem resposta como erro 500', async () => {
  const call = createInternalSiteCaller(async () => {}, {});
  const out = await call({ action: 'publish', noticia_id: 1 });
  assert.equal(out.status, 500);
  assert.equal(out.body.success, false);
});
