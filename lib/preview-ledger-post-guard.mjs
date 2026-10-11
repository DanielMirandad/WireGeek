export function checkPreviewLedgerPostAccess(
  req,
  env,
  validateSession,
) {
  if (env.VERCEL_ENV !== 'preview') {
    return { status: 404, body: { ok: false } };
  }

  if (env.WIREGEEK_LEDGER_HOMOLOGATION_ENABLED !== '1') {
    return {
      status: 403,
      body: {
        ok: false,
        code: 'LEDGER_HOMOLOGATION_DISABLED',
      },
    };
  }

  // A missing signing key must never authorize a cookie signed with an empty key.
  let authenticated = false;
  if (typeof env.WIREGEEK_ACCESS_KEY === 'string' && env.WIREGEEK_ACCESS_KEY.trim()) {
    try {
      authenticated = validateSession(req);
    } catch {
      // Malformed cookies fail closed before constructing a database client.
    }
  }
  if (!authenticated) {
    return { status: 401, body: { ok: false } };
  }

  const expectedHost = env.VERCEL_URL;

  if (
    !expectedHost ||
    req.headers?.host !== expectedHost ||
    req.headers?.origin !== `https://${expectedHost}`
  ) {
    return {
      status: 403,
      body: {
        ok: false,
        code: 'LEDGER_ORIGIN_REJECTED',
      },
    };
  }

  const contentType = req.headers?.['content-type'];

  if (
    typeof contentType !== 'string' ||
    contentType.split(';')[0].trim() !== 'application/json' ||
    req.body == null ||
    typeof req.body !== 'object' ||
    Array.isArray(req.body) ||
    Object.keys(req.body).length !== 0
  ) {
    return {
      status: 400,
      body: {
        ok: false,
        code: 'LEDGER_REQUEST_INVALID',
      },
    };
  }

  return null;
}
