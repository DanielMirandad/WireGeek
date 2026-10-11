// This guard is deliberately fail closed. A budget reservation must be
// integrated at the transport layer before any paid homologation request.
// Merely configuring a dollar amount or creating a budget row does not
// make an OpenAI call bounded, especially with web_search tool usage.
export function assertPaidHomologationTransportReady({
  enabled = process.env.WIREGEEK_PAID_HOMOLOGATION_ENABLED,
  purpose,
  maxOutputTokens,
  tools,
  toolChoice,
} = {}) {
  if (enabled !== '1') return;
  if (typeof purpose !== 'string' || !purpose.trim()) {
    throw new Error('HOMOLOGATION_PURPOSE_REQUIRED');
  }
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) {
    throw new Error('HOMOLOGATION_OUTPUT_LIMIT_REQUIRED');
  }
  if ((Array.isArray(tools) && tools.length > 0) || toolChoice != null) {
    throw new Error('HOMOLOGATION_TOOL_COST_UNBOUNDED');
  }
  // No transport authorization is available until input usage, pinned
  // model pricing, and a durable atomic reserve/settlement gate are wired.
  throw new Error('HOMOLOGATION_TRANSPORT_RESERVATION_REQUIRED');
}
