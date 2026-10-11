import { checkPreviewLedgerPostAccess } from '../lib/preview-ledger-post-guard.mjs';
import { hasValidSession } from './auth.js';
import { runPreviewLedgerHomologation } from '../lib/preview-ledger-homologation.mjs';
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

export function createPreviewLedgerHandler(dependencies = {}) {
  return async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const result = await checkPreviewLedgerHealth();
    return res.status(result.status).json(result.body);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false });
  }

  const denial = checkPreviewLedgerPostAccess(
    req,
    process.env,
    dependencies.validateSession ?? hasValidSession,
  );

  if (denial) {
    return res.status(denial.status).json(denial.body);
  }

  try {
    assertPreviewSupabaseIsolation(process.env);

    const supabase = (dependencies.createClient ?? createClient)(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SECRET_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    assertPreviewSupabaseIsolation(process.env, supabase);

    const result = await (dependencies.runHomologation ?? runPreviewLedgerHomologation)(supabase);

    return res.status(result.ok === true ? 200 : 503).json({
      ok: result.ok === true,
      code: result.ok === true
        ? 'LEDGER_MOCK_HOMOLOGATION_PASSED'
        : 'LEDGER_HOMOLOGATION_FAILED',
    });
  } catch {
    return res.status(503).json({
      ok: false,
      code: 'LEDGER_HOMOLOGATION_UNAVAILABLE',
    });
  }
}
}

export default createPreviewLedgerHandler();
