import test from 'node:test';
import assert from 'node:assert/strict';
import { planEditorialPilot } from '../lib/editorial-pilot-budget.mjs';

const req = { model: 'draft', purpose: 'site-editorial', maxInputTokens: 12000, maxOutputTokens: 7000 };
const prices = { draft: { inputPerMillion: 1, outputPerMillion: 2 } };
test('offline plan cannot enable paid execution', () => {
  const result = planEditorialPilot({ requests: [req], prices });
  assert.equal(result.allowed, true);
  assert.equal(result.executionEnabled, false);
});
test('missing pricing blocks', () => assert.equal(planEditorialPilot({ requests: [req] }).allowed, false));
test('missing input cap blocks', () => assert.equal(planEditorialPilot({
  requests: [{ ...req, maxInputTokens: undefined }], prices,
}).allowed, false));
test('unrecognized stage blocks', () => assert.equal(planEditorialPilot({
  requests: [{ ...req, purpose: 'site-editorial-repair' }], prices,
}).allowed, false));
test('more than 20 calls blocks', () => assert.equal(planEditorialPilot({
  requests: Array(21).fill(req), prices,
}).code, 'PILOT_CALL_COUNT_INVALID'));
test('missing or excessive dollar ceiling blocks', () => {
  for (const budgetUsd of [0, -1, 6, Infinity, NaN]) {
    assert.equal(planEditorialPilot({ requests: [req], prices, budgetUsd }).allowed, false);
  }
});
test('worst-case token expenditure above cap blocks', () => {
  const result = planEditorialPilot({ requests: [{ ...req, maxInputTokens: 5_000_000 }], prices });
  assert.equal(result.code, 'PILOT_BUDGET_EXCEEDED');
});
test('20 calls within a stated price and token ceiling only produce offline estimate', () => {
  const result = planEditorialPilot({ requests: Array(20).fill(req), prices });
  assert.equal(result.allowed, true);
  assert.equal(result.requestCount, 20);
  assert.equal(result.executionEnabled, false);
});
