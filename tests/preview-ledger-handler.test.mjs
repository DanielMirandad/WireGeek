import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/preview-ledger-health.js';

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function invoke(method, env, options = {}) {
  const previous = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    WIREGEEK_LEDGER_HOMOLOGATION_ENABLED:
      process.env.WIREGEEK_LEDGER_HOMOLOGATION_ENABLED,
  };

  const previousFetch = globalThis.fetch;
  let networkCalls = 0;

  try {
    process.env.VERCEL_ENV = env.VERCEL_ENV;
    process.env.WIREGEEK_LEDGER_HOMOLOGATION_ENABLED =
      env.WIREGEEK_LEDGER_HOMOLOGATION_ENABLED;

    globalThis.fetch = async () => {
      networkCalls += 1;
      throw new Error('NETWORK_ACCESS_FORBIDDEN_IN_TEST');
    };

    const req = {
      method,
      headers: options.headers ?? {},
      body: options.body ?? {},
    };

    const res = response();
    await handler(req, res);

    return { res, networkCalls };
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    globalThis.fetch = previousFetch;
  }
}

test('production POST is rejected without network access', async () => {
  const { res, networkCalls } = await invoke('POST', {
    VERCEL_ENV: 'production',
    WIREGEEK_LEDGER_HOMOLOGATION_ENABLED: '1',
  });

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { ok: false });
  assert.equal(networkCalls, 0);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('disabled Preview POST is rejected without network access', async () => {
  const { res, networkCalls } = await invoke('POST', {
    VERCEL_ENV: 'preview',
    WIREGEEK_LEDGER_HOMOLOGATION_ENABLED: '0',
  });

  assert.equal(res.statusCode, 403);
  assert.equal(
    res.body.code,
    'LEDGER_HOMOLOGATION_DISABLED',
  );
  assert.equal(networkCalls, 0);
});

test('unsupported HTTP method never reaches the database', async () => {
  const { res, networkCalls } = await invoke('PUT', {
    VERCEL_ENV: 'preview',
    WIREGEEK_LEDGER_HOMOLOGATION_ENABLED: '0',
  });

  assert.equal(res.statusCode, 405);
  assert.equal(networkCalls, 0);
});

test('production GET remains unavailable', async () => {
  const { res, networkCalls } = await invoke('GET', {
    VERCEL_ENV: 'production',
    WIREGEEK_LEDGER_HOMOLOGATION_ENABLED: '0',
  });

  assert.equal(res.statusCode, 404);
  assert.equal(networkCalls, 0);
});
