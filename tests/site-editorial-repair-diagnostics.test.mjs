import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEditorialRepairFailure } from '../lib/site-editorial.mjs';
const failure = (unidade, claim, code='EDITORIAL_UNSUPPORTED_CLAIM') =>
  ({ json: { review: { issue: { unidade, claim, code } } } });
test('detects same unsupported claim after repair', () => {
  assert.equal(classifyEditorialRepairFailure(failure(4,'Uma afirmacao.'), failure(4,'Uma afirmacao.')), 'same_claim');
});
test('detects new claim in same unit', () => {
  assert.equal(classifyEditorialRepairFailure(failure(4,'Uma afirmacao.'), failure(4,'Outra afirmacao.')), 'different_claim_same_unit');
});
test('detects rejection in a different unit', () => {
  assert.equal(classifyEditorialRepairFailure(failure(4,'Uma afirmacao.'), failure(5,'Outra afirmacao.')), 'different_unit');
});
test('handles missing verification diagnostics', () => {
  assert.equal(classifyEditorialRepairFailure(failure(4,'Uma afirmacao.'), {json:{}}), 'verification_failed');
});
