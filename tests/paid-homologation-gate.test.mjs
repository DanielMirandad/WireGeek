import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPaidHomologationTransportReady } from '../lib/paid-homologation-gate.mjs';
import { createOpenAIResponse } from '../lib/openai-responses.mjs';

test('normal execution remains unchanged when homologation is not enabled', () => {
  assert.doesNotThrow(() => assertPaidHomologationTransportReady({enabled:'0'}));
});
test('homologation denies unknown stages and missing output bounds', () => {
  assert.throws(() => assertPaidHomologationTransportReady({enabled:'1',maxOutputTokens:10}), /HOMOLOGATION_PURPOSE_REQUIRED/);
  assert.throws(() => assertPaidHomologationTransportReady({enabled:'1',purpose:'briefing'}), /HOMOLOGATION_OUTPUT_LIMIT_REQUIRED/);
});
test('homologation denies unbounded web tools and all unreserved requests', () => {
  assert.throws(() => assertPaidHomologationTransportReady({enabled:'1',purpose:'briefing',maxOutputTokens:10,tools:[{type:'web_search'}]}), /HOMOLOGATION_TOOL_COST_UNBOUNDED/);
  assert.throws(() => assertPaidHomologationTransportReady({enabled:'1',purpose:'briefing',maxOutputTokens:10}), /HOMOLOGATION_TRANSPORT_RESERVATION_REQUIRED/);
});
test('real transport is blocked before checking key or executing any network request', async () => {
  const before = process.env.WIREGEEK_PAID_HOMOLOGATION_ENABLED;
  process.env.WIREGEEK_PAID_HOMOLOGATION_ENABLED='1';
  try {
    await assert.rejects(createOpenAIResponse({model:'test',purpose:'briefing',input:'dummy',maxOutputTokens:10}), /HOMOLOGATION_REQUEST_UNBOUNDED/);
  } finally {
    if (before === undefined) delete process.env.WIREGEEK_PAID_HOMOLOGATION_ENABLED;
    else process.env.WIREGEEK_PAID_HOMOLOGATION_ENABLED=before;
  }
});
