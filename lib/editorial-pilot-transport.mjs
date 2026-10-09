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
    return { success: true, code: 'PILOT_MOCK_RESPONSE', response, idempotencyKey: held.idempotencyKey };
  } catch {
    // The reservation is intentionally not released: an uncertain send may have occurred.
    return { success: false, code: 'PILOT_MOCK_RESPONSE_UNCERTAIN' };
  }
}
