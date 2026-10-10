// Server-only bridge for the TEST Supabase pilot ledger.
// This module deliberately DOES NOT invoke the OpenAI transport.
import { randomUUID } from 'node:crypto';

export async function reserveEditorialPilotRequest({
  supabase, pilotId, newsId, arm, stage, model,
  maxInputTokens, maxOutputTokens, reserveMicroUsd,
  idempotencyKey = randomUUID(),
}) {
  const deny = code => ({ allowed: false, code });
  if (!supabase || typeof supabase.rpc !== 'function') return deny('PILOT_LEDGER_UNAVAILABLE');
  if (!/^[a-f0-9-]{36}$/i.test(String(pilotId || ''))) return deny('PILOT_ID_INVALID');
  if (!/^[a-f0-9-]{36}$/i.test(String(idempotencyKey || ''))) return deny('PILOT_KEY_INVALID');
  if (!Number.isSafeInteger(newsId) || newsId <= 0 ||
      !['luna', 'sol'].includes(arm) ||
      !['site-editorial', 'site-editorial-verification'].includes(stage) ||
      typeof model !== 'string' || !model.trim() || model.length > 100 ||
      !Number.isSafeInteger(maxInputTokens) || maxInputTokens < 1 ||
      !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 ||
      !Number.isSafeInteger(reserveMicroUsd) || reserveMicroUsd < 1 || reserveMicroUsd > 5_000_000) {
    return deny('PILOT_RESERVATION_INVALID');
  }
  try {
    const { data, error } = await supabase.rpc('reserve_editorial_pilot_request', {
      p_pilot_id: pilotId, p_key: idempotencyKey, p_news_id: newsId,
      p_arm: arm, p_stage: stage, p_model: model,
      p_max_input_tokens: maxInputTokens, p_max_output_tokens: maxOutputTokens,
      p_reserved_micro_usd: reserveMicroUsd,
    });
    if (error || data !== true) return deny('PILOT_RESERVATION_DENIED');
    return { allowed: true, code: 'PILOT_RESERVATION_HELD', idempotencyKey };
  } catch {
    // Uncertain RPC state must never trigger an automatic retry.
    return deny('PILOT_RESERVATION_UNCERTAIN');
  }
}
