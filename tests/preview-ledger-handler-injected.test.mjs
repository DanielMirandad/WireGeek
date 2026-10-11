import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  createPreviewLedgerHandler,
} from '../api/preview-ledger-health.js';

const host = 'wiregeek-test.vercel.app';

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) {
      this.headers[k] = v;
      return this;
    },
    status(n) {
      this.statusCode = n;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
}

async function rejectedRequest({
  method = 'POST',
  environment = 'preview',
  enabled = '1',
  session = true,
  origin = 'https://' + host,
  requestHost = host,
  body = {},
  contentType = 'application/json',
} = {}) {
  const keys = [
    'VERCEL_ENV',
    'WIREGEEK_LEDGER_HOMOLOGATION_ENABLED',
    'VERCEL_URL',
    'WIREGEEK_ACCESS_KEY',
  ];

  const old = Object.fromEntries(
    keys.map(k => [k, process.env[k]]),
  );

  const calls = {
    client: 0,
    homologation: 0,
  };

  try {
    process.env.VERCEL_ENV = environment;
    process.env.WIREGEEK_LEDGER_HOMOLOGATION_ENABLED = enabled;
    process.env.VERCEL_URL = host;
    process.env.WIREGEEK_ACCESS_KEY = 'synthetic-ledger-session-key';

    const req = {
      method,
      headers: {
        host: requestHost,
        origin,
        'content-type': contentType,
      },
      body,
    };

    const res = response();

    await createPreviewLedgerHandler({
      validateSession: () => session,
      createClient: () => {
        calls.client++;
        throw new Error('CLIENT_MUST_NOT_BE_CREATED');
      },
      runHomologation: () => {
        calls.homologation++;
        throw new Error('HOMOLOGATION_MUST_NOT_RUN');
      },
    })(req, res);

    assert.equal(
      calls.client,
      0,
      'Rejected request must not construct Supabase client',
    );
    assert.equal(
      calls.homologation,
      0,
      'Rejected request must not start homologation',
    );

    return res;
  } finally {
    for (const key of keys) {
      if (old[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = old[key];
      }
    }
  }
}

test('production never constructs Supabase client', async () => {
  const res = await rejectedRequest({
    environment: 'production',
  });
  assert.equal(res.statusCode, 404);
});

test('disabled Preview never constructs client', async () => {
  const res = await rejectedRequest({ enabled: '0' });
  assert.equal(res.statusCode, 403);
});

test('invalid session never constructs client', async () => {
  const res = await rejectedRequest({ session: false });
  assert.equal(res.statusCode, 401);
});

test('wrong origin never constructs client', async () => {
  const res = await rejectedRequest({
    origin: 'https://example.com',
  });
  assert.equal(res.statusCode, 403);
});

test('wrong host never constructs client', async () => {
  const res = await rejectedRequest({
    requestHost: 'example.com',
  });
  assert.equal(res.statusCode, 403);
});

test('invalid payload never constructs client', async () => {
  const res = await rejectedRequest({
    body: { unexpected: true },
  });
  assert.equal(res.statusCode, 400);
});

test('unsupported method never constructs client', async () => {
  const res = await rejectedRequest({ method: 'DELETE' });
  assert.equal(res.statusCode, 405);
});

function syntheticJwt(project, role) {
  const header = Buffer.from('{}').toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ ref: project, role }),
  ).toString('base64url');
  return `${header}.${payload}.synthetic`;
}

async function authorizedPreviewTest(mockResult, override = {}) {
  const project = 'lftqhpoaydelblobichr';
  const url = `https://${project}.supabase.co`;

  const environment = {
    VERCEL_ENV: 'preview',
    VERCEL_URL: host,
    WIREGEEK_LEDGER_HOMOLOGATION_ENABLED: '1',
    WIREGEEK_ACCESS_KEY: 'synthetic-ledger-session-key',
    SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: syntheticJwt(
      project,
      'service_role',
    ),
  };

  const names = [
    ...Object.keys(environment),
    'SUPABASE_SECRET_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  ];

  const saved = Object.fromEntries(
    names.map(name => [name, process.env[name]]),
  );

  const calls = { client: 0, homologation: 0 };
  const req = {
    method: 'POST',
    headers: {
      host,
      origin: `https://${host}`,
      'content-type': 'application/json',
    },
    body: {},
  };
  const res = response();

  try {
    for (const name of names) {
      delete process.env[name];
    }

    Object.assign(process.env, environment, override);

    await createPreviewLedgerHandler({
      validateSession: () => true,
      createClient: endpoint => {
        calls.client++;
        assert.equal(endpoint, url);
        return { supabaseUrl: endpoint };
      },
      runHomologation: async client => {
        calls.homologation++;
        assert.equal(client.supabaseUrl, url);
        return mockResult;
      },
    })(req, res);

    return { res, calls };
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    }
  }
}

test('authorized Preview returns sanitized success', async () => {
  const { res, calls } = await authorizedPreviewTest({
    ok: true,
    code: 'INTERNAL_SUCCESS',
    fixtureId: 'secret-fixture-identifier',
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    code: 'LEDGER_MOCK_HOMOLOGATION_PASSED',
  });
  assert.deepEqual(calls, {
    client: 1,
    homologation: 1,
  });
  assert.doesNotMatch(
    JSON.stringify(res.body),
    /fixtureId|secret-fixture|INTERNAL_SUCCESS/,
  );
});

test('authorized Preview returns sanitized failure', async () => {
  const { res, calls } = await authorizedPreviewTest({
    ok: false,
    code: 'INTERNAL_DATABASE_DETAILS',
    fixtureId: 'hidden-fixture-identifier',
  });

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, {
    ok: false,
    code: 'LEDGER_HOMOLOGATION_FAILED',
  });
  assert.deepEqual(calls, {
    client: 1,
    homologation: 1,
  });
  assert.doesNotMatch(
    JSON.stringify(res.body),
    /fixtureId|hidden-fixture|INTERNAL_DATABASE_DETAILS/,
  );
});

test('authorized POST rejects production Supabase before creating client', async () => {
  const { res, calls } = await authorizedPreviewTest(
    { ok: true },
    {
      SUPABASE_URL:
        'https://bytxdmxpqsdxxcjbufnf.supabase.co',
    },
  );

  assert.equal(res.statusCode, 503);
  assert.equal(
    res.body.code,
    'LEDGER_HOMOLOGATION_UNAVAILABLE',
  );
  assert.deepEqual(calls, {
    client: 0,
    homologation: 0,
  });
});

async function realSessionRequest({ signingKey, cookieKey = '', cookie } = {}) {
  const environment = {
    VERCEL_ENV: 'preview',
    VERCEL_URL: host,
    WIREGEEK_LEDGER_HOMOLOGATION_ENABLED: '1',
    WIREGEEK_ACCESS_KEY: signingKey,
    SUPABASE_URL: 'https://lftqhpoaydelblobichr.supabase.co',
    NEXT_PUBLIC_SUPABASE_URL: 'https://lftqhpoaydelblobichr.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: syntheticJwt('lftqhpoaydelblobichr', 'service_role'),
    SUPABASE_SECRET_KEY: undefined,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
  };
  const saved = Object.fromEntries(Object.keys(environment).map(name => [name, process.env[name]]));
  const calls = { client: 0, homologation: 0 };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', cookieKey).update(timestamp).digest('base64url');
  const req = {
    method: 'POST',
    headers: {
      host, origin: `https://${host}`, 'content-type': 'application/json',
      cookie: cookie ?? `wiregeek_session=${timestamp}.${signature}`,
    },
    body: {},
  };
  const res = response();
  try {
    for (const [name, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    // Keep the production session validator; replace only operations after auth.
    await createPreviewLedgerHandler({
      createClient(endpoint) {
        calls.client++;
        return { supabaseUrl: endpoint };
      },
      async runHomologation() {
        calls.homologation++;
        return { ok: true };
      },
    })(req, res);
    return { res, calls };
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

for (const [label, signingKey, cookieKey] of [
  ['missing signing key', undefined, ''],
  ['empty signing key', '', ''],
  ['whitespace signing key', '   ', '   '],
  ['configured key with forged empty-key signature', 'synthetic-ledger-session-key', ''],
]) {
  test(`${label} rejects forged cookie before database operations`, async () => {
    const { res, calls } = await realSessionRequest({ signingKey, cookieKey });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { ok: false });
    assert.deepEqual(calls, { client: 0, homologation: 0 });
    assert.equal(res.headers['Cache-Control'], 'no-store');
  });
}

test('malformed session cookie returns 401 before database operations', async () => {
  const { res, calls } = await realSessionRequest({
    signingKey: 'synthetic-ledger-session-key', cookie: 'wiregeek_session=%E0%A4%A',
  });
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { ok: false });
  assert.deepEqual(calls, { client: 0, homologation: 0 });
});

test('valid signed session still reaches sanitized mock homologation', async () => {
  const { res, calls } = await realSessionRequest({
    signingKey: 'synthetic-ledger-session-key', cookieKey: 'synthetic-ledger-session-key',
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, code: 'LEDGER_MOCK_HOMOLOGATION_PASSED' });
  assert.deepEqual(calls, { client: 1, homologation: 1 });
});
