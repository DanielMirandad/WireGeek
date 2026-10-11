import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveEditorialPilotRequest } from '../lib/editorial-pilot-reservation.mjs';
const request = { pilotId: '00000000-0000-4000-8000-000000000001',
 newsId: 6, arm: 'luna', stage: 'site-editorial', model: 'test-model',
 maxInputTokens: 12000, maxOutputTokens: 7000, reserveMicroUsd: 1000,
 idempotencyKey: '00000000-0000-4000-8000-000000000002' };
test('missing ledger fails closed', async () => {
 assert.equal((await reserveEditorialPilotRequest(request)).code, 'PILOT_LEDGER_UNAVAILABLE');
});
test('malformed request never touches database', async () => {
 const supabase = { supabaseUrl: 'https://lftqhpoaydelblobichr.supabase.co', rpc() { assert.fail('RPC not permitted'); } };
 for (const bad of [{ model: '' }, { maxInputTokens: 0 }, { reserveMicroUsd: -1 }, { arm: 'other' }, { stage: 'site-editorial-repair' }]) {
  assert.equal((await reserveEditorialPilotRequest({ ...request, ...bad, supabase })).code, 'PILOT_RESERVATION_INVALID');
 }
});
test('only exact affirmative RPC result grants reservation', async () => {
 const calls = [];
 const supabase = { supabaseUrl: 'https://lftqhpoaydelblobichr.supabase.co', async rpc(name, args) {
  calls.push([name, args]);
  return { data: true, error: null };
 } };
 const result = await reserveEditorialPilotRequest({ ...request, supabase });
 assert.equal(result.allowed, true);
 assert.equal(result.idempotencyKey, request.idempotencyKey);
 assert.equal(calls[0][0], 'reserve_editorial_pilot_request');
 assert.equal(calls[0][1].p_reserved_micro_usd, 1000);
});
test('denial, RPC error and ambiguous failure never grant reservation', async () => {
 for (const rpc of [
  async () => ({data: false, error: null}),
  async () => ({data: true, error: {code: 'FAILED'}}),
  async () => { throw new Error('secret credentials'); },
 ]) {
  const result = await reserveEditorialPilotRequest({ ...request, supabase: {supabaseUrl: 'https://lftqhpoaydelblobichr.supabase.co', rpc} });
  assert.equal(result.allowed, false);
  assert.equal(JSON.stringify(result).includes('secret'), false);
 }
});

test('reservation exceeding USD 5 never reaches the ledger', async () => {
  const supabase = { supabaseUrl: 'https://lftqhpoaydelblobichr.supabase.co', rpc() { assert.fail('oversized reservation must not touch database'); } };
  for (const reserveMicroUsd of [5_000_001, Number.MAX_SAFE_INTEGER, 1.5]) {
    const result = await reserveEditorialPilotRequest({ ...request, reserveMicroUsd, supabase });
    assert.equal(result.code, 'PILOT_RESERVATION_INVALID');
  }
});

test('missing or production Supabase endpoint cannot reserve', async () => {
  for (const supabaseUrl of [
    undefined, 'https://bytxdmxpqsdxxcjbufnf.supabase.co',
    'http://lftqhpoaydelblobichr.supabase.co',
    'https://lftqhpoaydelblobichr.supabase.co.evil.example',
  ]) {
    const result = await reserveEditorialPilotRequest({ ...request,
      supabase: { supabaseUrl, rpc() { assert.fail('No database call allowed'); } } });
    assert.equal(result.code, 'PILOT_TEST_PROJECT_REQUIRED');
  }
});
