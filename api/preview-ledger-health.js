import { createClient } from '@supabase/supabase-js';
import { assertPreviewSupabaseIsolation } from '../lib/preview-supabase-isolation.mjs';

// GET-only, Preview-only, read-only connectivity check. Never exposes data,
// credentials, project identifiers or provider errors in its response.
export async function checkPreviewLedgerHealth(env = process.env, makeClient = createClient) {
  if (env.VERCEL_ENV !== 'preview') return { status: 404, body: { ok: false } };
  try {
    assertPreviewSupabaseIsolation(env);
    const supabase = makeClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    assertPreviewSupabaseIsolation(env, supabase);
    const result = await supabase.from('editorial_pilot_budgets').select('id', { head: true, count: 'exact' });
    if (result.error || !Number.isSafeInteger(result.count)) {
      return { status: 503, body: { ok: false, code: 'PREVIEW_LEDGER_UNAVAILABLE' } };
    }
    return { status: 200, body: { ok: true, code: 'PREVIEW_LEDGER_READ_CONFIRMED' } };
  } catch {
    return { status: 503, body: { ok: false, code: 'PREVIEW_LEDGER_UNAVAILABLE' } };
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  const result = await checkPreviewLedgerHealth();
  return res.status(result.status).json(result.body);
}
