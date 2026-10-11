// Integration seam for the TEST pilot. It intentionally accepts only an injected
// mock transport: no API key, HTTP client, or real OpenAI dispatch exists here.
import { reserveEditorialPilotRequest } from './editorial-pilot-reservation.mjs';

export async function simulateReservedEditorialRequest({
  reservation, supabase, mockSend, pilotExecutionEnabled = false,
}) {
  if (pilotExecutionEnabled) {
    return { success: false, code: 'PILOT_PAID_EXECUTION_DISABLED' };
  }
  if (typeof mockSend !== 'function' || !reservation) {
    return { success: false, code: 'PILOT_MOCK_TRANSPORT_REQUIRED' };
  }
  const held = await reserveEditorialPilotRequest({ ...reservation, supabase });
  if (!held.allowed) return { success: false, code: held.code };
  try {
    const response = await mockSend({ purpose: reservation.stage, model: reservation.model });
    const input = response?.usage?.input_tokens;
    const output = response?.usage?.output_tokens;
    const actualMicroUsd = response?.actual_micro_usd;
    if (![input, output, actualMicroUsd].every(Number.isSafeInteger) ||
        input < 0 || output < 0 || actualMicroUsd < 0 ||
        input > reservation.maxInputTokens || output > reservation.maxOutputTokens ||
        actualMicroUsd > reservation.reserveMicroUsd) {
      return { success: false, code: 'PILOT_USAGE_UNVERIFIED' };
    }
    try {
      const result = await supabase.rpc('complete_editorial_pilot_reservation', {
        p_idempotency_key: held.idempotencyKey,
        p_input_tokens: input, p_output_tokens: output, p_actual_micro_usd: actualMicroUsd,
      });
      if (result?.error || result?.data !== true)
        return { success: false, code: 'PILOT_COMPLETION_UNCONFIRMED' };
    } catch {
      return { success: false, code: 'PILOT_COMPLETION_UNCONFIRMED' };
    }
    return { success: true, code: 'PILOT_MOCK_RESPONSE', response, idempotencyKey: held.idempotencyKey };
  } catch {
    // The reservation is intentionally not released: an uncertain send may have occurred.
    return { success: false, code: 'PILOT_MOCK_RESPONSE_UNCERTAIN' };
  }
}
