// Server-owned allowlist. Matching URLs alone must never authorize Production.
export const PREVIEW_SUPABASE_PROJECT = 'lftqhpoaydelblobichr';

export class PreviewSupabaseIsolationError extends Error {
  constructor(code, diagnostic = null) {
    super('Isolamento Supabase do Preview nao confirmado. Operacao bloqueada.');
    this.name = 'PreviewSupabaseIsolationError';
    this.code = code;
    this.status = 503;
    this.diagnostic = diagnostic;
  }
}

const blocked = (code, diagnostic) => { throw new PreviewSupabaseIsolationError(code, diagnostic); };
const value = raw => String(raw || '').trim();

function projectFromUrl(raw) {
  if (!value(raw)) blocked('PREVIEW_SUPABASE_CONFIG_MISSING');
  let url;
  try { url = new URL(value(raw)); } catch { blocked('PREVIEW_SUPABASE_CONFIG_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.pathname !== '/' || url.search || url.hash ||
      !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname)) {
    blocked('PREVIEW_SUPABASE_CONFIG_INVALID');
  }
  return url.hostname.split('.')[0];
}

function validateKey(raw, role, project, variable, usedByBackend) {
  const key = value(raw);
  const opaquePrefix = role === 'service_role' ? 'sb_secret_' : 'sb_publishable_';
  if (key.startsWith(opaquePrefix) && /^[A-Za-z0-9_-]+$/.test(key) && key.length > opaquePrefix.length) return;
  // Legacy JWT metadata is a consistency check, never signature/auth verification.
  // The subsequent authenticated DB read must succeed before any inference.
  const fail = reason => blocked('PREVIEW_SUPABASE_KEY_MISMATCH', {
    variable, reason, used_by_backend: usedByBackend,
  });
  let claims;
  try {
    const parts = key.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return fail('INVALID_FORMAT');
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (error) {
    if (error instanceof PreviewSupabaseIsolationError) throw error;
    return fail('INVALID_STRUCTURE');
  }
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return fail('INVALID_STRUCTURE');
  if (claims.ref !== project) return fail('PROJECT_MISMATCH');
  if (claims.role !== role) return fail('ROLE_MISMATCH');
}

export function assertPreviewSupabaseIsolation(env = process.env, supabase) {
  if (env.VERCEL_ENV !== 'preview') return null;
  const backend = projectFromUrl(env.SUPABASE_URL);
  // Read only trusted deployment configuration, never req.body/query/headers.
  const frontend = projectFromUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  if (backend !== frontend || backend !== PREVIEW_SUPABASE_PROJECT) {
    blocked('PREVIEW_SUPABASE_PROJECT_MISMATCH');
  }
  // Match getSupabase's actual raw || precedence, including whitespace values.
  const selected = env.SUPABASE_SERVICE_ROLE_KEY ? 'SUPABASE_SERVICE_ROLE_KEY' : 'SUPABASE_SECRET_KEY';
  const privateNames = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'].filter(name => value(env[name]));
  if (!privateNames.length || !value(env[selected])) blocked('PREVIEW_SUPABASE_CONFIG_MISSING', {
    variable: selected, reason: 'MISSING_PRIVATE_KEY', used_by_backend: true,
  });
  for (const name of privateNames) validateKey(env[name], 'service_role', backend, name, name === selected);
  for (const name of ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'].filter(name => value(env[name]))) {
    validateKey(env[name], 'anon', frontend, name, false);
  }
  if (supabase && projectFromUrl(supabase.supabaseUrl) !== backend) {
    blocked('PREVIEW_SUPABASE_CLIENT_MISMATCH');
  }
  return { environment: 'preview', project_ref: backend };
}
