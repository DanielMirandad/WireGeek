import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkPreviewLedgerPostAccess,
} from '../lib/preview-ledger-post-guard.mjs';

const validEnv = {
  VERCEL_ENV: 'preview',
  WIREGEEK_LEDGER_HOMOLOGATION_ENABLED: '1',
  VERCEL_URL: 'wiregeek-test.vercel.app',
};

function request(overrides = {}) {
  return {
    method: 'POST',
    headers: {
      host: validEnv.VERCEL_URL,
      origin: `https://${validEnv.VERCEL_URL}`,
      'content-type': 'application/json',
    },
    body: {},
    ...overrides,
  };
}

function check(req, env = validEnv, authenticated = true) {
  return checkPreviewLedgerPostAccess(
    req,
    env,
    () => authenticated,
  );
}

test('valid Preview request passes authorization', () => {
  assert.equal(check(request()), null);
});

test('production environment rejects POST', () => {
  assert.equal(
    check(request(), { ...validEnv, VERCEL_ENV: 'production' })
      .status,
    404,
  );
});

test('disabled feature rejects POST', () => {
  assert.equal(
    check(request(), {
      ...validEnv,
      WIREGEEK_LEDGER_HOMOLOGATION_ENABLED: '0',
    }).status,
    403,
  );
});

test('missing session rejects POST', () => {
  assert.equal(check(request(), validEnv, false).status, 401);
});

test('wrong host rejects POST', () => {
  const req = request();
  req.headers.host = 'another-preview.vercel.app';
  assert.equal(check(req).status, 403);
});

test('wrong origin rejects POST', () => {
  const req = request();
  req.headers.origin = 'https://example.com';
  assert.equal(check(req).status, 403);
});

test('missing origin rejects POST', () => {
  const req = request();
  delete req.headers.origin;
  assert.equal(check(req).status, 403);
});

test('invalid content type rejects POST', () => {
  const req = request();
  req.headers['content-type'] = 'text/plain';
  assert.equal(check(req).status, 400);
});

test('nonempty payload rejects POST', () => {
  assert.equal(
    check(request({ body: { execute: true } })).status,
    400,
  );
});

test('array payload rejects POST', () => {
  assert.equal(check(request({ body: [] })).status, 400);
});

test('null payload rejects POST', () => {
  assert.equal(check(request({ body: null })).status, 400);
});

test('missing deployment host fails closed', () => {
  assert.equal(
    check(request(), { ...validEnv, VERCEL_URL: undefined })
      .status,
    403,
  );
});


test('malformed content-type array fails closed', async () => {
  const { checkPreviewLedgerPostAccess } = await import(
    '../lib/preview-ledger-post-guard.mjs'
  );

  const result = checkPreviewLedgerPostAccess(
    {
      headers: {
        host: 'wiregeek-test.vercel.app',
        origin: 'https://wiregeek-test.vercel.app',
        'content-type': ['application/json'],
      },
      body: {},
    },
    {
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'wiregeek-test.vercel.app',
      WIREGEEK_LEDGER_HOMOLOGATION_ENABLED: '1',
    },
    () => true,
  );

  assert.equal(result.status, 400);
});

test('malformed numeric content-type fails closed', async () => {
  const { checkPreviewLedgerPostAccess } = await import(
    '../lib/preview-ledger-post-guard.mjs'
  );

  const result = checkPreviewLedgerPostAccess(
    {
      headers: {
        host: 'wiregeek-test.vercel.app',
        origin: 'https://wiregeek-test.vercel.app',
        'content-type': 123,
      },
      body: {},
    },
    {
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'wiregeek-test.vercel.app',
      WIREGEEK_LEDGER_HOMOLOGATION_ENABLED: '1',
    },
    () => true,
  );

  assert.equal(result.status, 400);
});
