import { boundReservedTextCost, settleReservedTextCost } from './paid-homologation-pricing.mjs';
import { reserveEditorialPilotRequest } from './editorial-pilot-reservation.mjs';

// Transport-agnostic adapter. The caller must provide a trustworthy *upper*
// bound for all billable usage; web tools or unbounded inputs are not allowed.
// Every uncertainty permanently retains the reservation for later reconciliation.
export async function executeReservedHomologation({
  supabase, reservation, send, settleMicroUsd,
}) {
  if (typeof send !== 'function' || typeof settleMicroUsd !== 'function' ||
      !reservation || reservation.reserveMicroUsd > 1_000_000 ||
      !Number.isSafeInteger(reservation.reserveMicroUsd) ||
      !Number.isSafeInteger(reservation.maxInputTokens) ||
      !Number.isSafeInteger(reservation.maxOutputTokens)) {
    return { success: false, code: 'HOMOLOGATION_BOUNDS_REQUIRED' };
  }
  const worstCase = boundReservedTextCost({
    model: reservation.model,
    maxInputTokens: reservation.maxInputTokens,
    maxOutputTokens: reservation.maxOutputTokens,
    tools: reservation.tools,
    toolChoice: reservation.toolChoice,
  });
  if (worstCase === null || worstCase > reservation.reserveMicroUsd) {
    return { success: false, code: 'HOMOLOGATION_PRICE_RESERVATION_INSUFFICIENT' };
  }
  const held = await reserveEditorialPilotRequest({ supabase, ...reservation });
  if (!held.allowed) return { success: false, code: held.code };
  let response;
  try {
    response = await send();
  } catch {
    return { success: false, code: 'HOMOLOGATION_SEND_UNCERTAIN', key: held.idempotencyKey };
  }
  const input = response?.usage?.input_tokens;
  const output = response?.usage?.output_tokens;
  if (![input,output].every(Number.isSafeInteger) || input < 0 || output < 0 ||
      input > reservation.maxInputTokens || output > reservation.maxOutputTokens) {
    return { success:false, code:'HOMOLOGATION_USAGE_UNVERIFIED', key: held.idempotencyKey };
  }
  let actual;
  try { actual = settleMicroUsd(response.usage); } catch {}
  if (!Number.isSafeInteger(actual) || actual < 0 || actual > reservation.reserveMicroUsd) {
    return { success:false, code:'HOMOLOGATION_COST_UNVERIFIED', key: held.idempotencyKey };
  }
  try {
    const {data,error} = await supabase.rpc('complete_editorial_pilot_reservation', {
      p_idempotency_key: held.idempotencyKey,
      p_input_tokens: input, p_output_tokens: output, p_actual_micro_usd: actual,
    });
    if (!error && data === true) return { success:true, code:'HOMOLOGATION_SETTLED', response, key:held.idempotencyKey };
  } catch {}
  return { success:false, code:'HOMOLOGATION_SETTLEMENT_UNCONFIRMED', key:held.idempotencyKey };
}
