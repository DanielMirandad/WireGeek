// Offline pilot budget planner. Never performs or authorizes network requests.
// A durable cross-instance transport gate is required before paid execution.
const MAX_CALLS = 20;
const MAX_USD = 5;

export function planEditorialPilot({ requests, prices, budgetUsd = MAX_USD }) {
  if (!Array.isArray(requests) || requests.length === 0 || requests.length > MAX_CALLS) {
    return { allowed: false, code: 'PILOT_CALL_COUNT_INVALID' };
  }
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > MAX_USD) {
    return { allowed: false, code: 'PILOT_BUDGET_INVALID' };
  }
  let microUsd = 0;
  for (const request of requests) {
    const price = prices?.[request?.model];
    if (!price || !Number.isFinite(price.inputPerMillion) ||
        !Number.isFinite(price.outputPerMillion) ||
        price.inputPerMillion < 0 || price.outputPerMillion < 0 ||
        !Number.isSafeInteger(request.maxInputTokens) || request.maxInputTokens < 1 ||
        !Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1 ||
        !['site-editorial', 'site-editorial-verification'].includes(request.purpose)) {
      return { allowed: false, code: 'PILOT_REQUEST_UNBOUNDED' };
    }
    const estimate = request.maxInputTokens * price.inputPerMillion +
      request.maxOutputTokens * price.outputPerMillion;
    if (!Number.isFinite(estimate)) return { allowed: false, code: 'PILOT_COST_UNBOUNDED' };
    microUsd += estimate;
    if (!Number.isFinite(microUsd) || microUsd > budgetUsd * 1_000_000) {
      return { allowed: false, code: 'PILOT_BUDGET_EXCEEDED' };
    }
  }
  return { allowed: true, code: 'PILOT_PLAN_WITHIN_BUDGET',
    estimatedMaxUsd: microUsd / 1_000_000, requestCount: requests.length,
    executionEnabled: false };
}
