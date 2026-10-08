// Server-owned allowlist. Matching URLs alone must never authorize Production.
export const PREVIEW_SUPABASE_PROJECT = 'lftqhpoaydelblobichr';

export class PreviewSupabaseIsolationError extends Error {
  constructor(code) {
    super('Isolamento Supabase do Preview nao confirmado. Operacao bloqueada.');
    this.name = 'PreviewSupabaseIsolationError';
    this.code = code;
    this.status = 503;
  }
}

const blocked = code => { throw new PreviewSupabaseIsolationError(code); };
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

function validateKey(raw, role, project) {
  const key = value(raw);
  const opaquePrefix = role === 'service_role' ? 'sb_secret_' : 'sb_publishable_';
  if (key.startsWith(opaquePrefix) && /^[A-Za-z0-9_-]+$/.test(key) && key.length > opaquePrefix.length) return;
  // Legacy JWT metadata is a consistency check, never signature/auth verification.
  // The subsequent authenticated DB read must succeed before any inference.
  try {
    const parts = key.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (claims.ref !== project || claims.role !== role) throw new Error();
  } catch { blocked('PREVIEW_SUPABASE_KEY_MISMATCH'); }
}

export function assertPreviewSupabaseIsolation(env = process.env, supabase) {
  if (env.VERCEL_ENV !== 'preview') return null;
  const backend = projectFromUrl(env.SUPABASE_URL);
  // Read only trusted deployment configuration, never req.body/query/headers.
  const frontend = projectFromUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  if (backend !== frontend || backend !== PREVIEW_SUPABASE_PROJECT) {
    blocked('PREVIEW_SUPABASE_PROJECT_MISMATCH');
  }
  const privateKeys = [env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_SECRET_KEY].filter(value);
  if (!privateKeys.length) blocked('PREVIEW_SUPABASE_CONFIG_MISSING');
  for (const key of privateKeys) validateKey(key, 'service_role', backend);
  for (const key of [env.NEXT_PUBLIC_SUPABASE_ANON_KEY, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY].filter(value)) {
    validateKey(key, 'anon', frontend);
  }
  if (supabase && projectFromUrl(supabase.supabaseUrl) !== backend) {
    blocked('PREVIEW_SUPABASE_CLIENT_MISMATCH');
  }
  return { environment: 'preview', project_ref: backend };
}
