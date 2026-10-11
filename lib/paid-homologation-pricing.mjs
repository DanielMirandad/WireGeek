// Only explicitly pinned, text-only, standard short-context prices can be used.
// Values are USD micro-units per million tokens, as of 2026-10-11.
// Reject model aliases and unknown tiers instead of estimating too low.
const STANDARD_TEXT_PRICES = Object.freeze({
  'gpt-6-luna': { input: 100000, output: 500000 },
  'gpt-6-sol': { input: 2000000, output: 10000000 },
  'gpt-5.6-sol': { input: 4000000, output: 20000000 },
});
export function boundReservedTextCost({
  model, maxInputTokens, maxOutputTokens, tools, toolChoice, maxContextTokens = 0,
}) {
  const rate = STANDARD_TEXT_PRICES[model];
  if (!rate || tools != null || toolChoice != null ||
      !Number.isSafeInteger(maxInputTokens) || maxInputTokens < 1 ||
      !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 ||
      maxInputTokens + maxOutputTokens > 128000 ||
      maxContextTokens > 128000) return null;
  const microUsd = Math.ceil((rate.input * maxInputTokens + rate.output * maxOutputTokens) / 1000000);
  return Number.isSafeInteger(microUsd) && microUsd > 0 ? microUsd : null;
}
export function settleReservedTextCost({ model, input_tokens, output_tokens }) {
  return boundReservedTextCost({ model, maxInputTokens: input_tokens, maxOutputTokens: output_tokens });
}
