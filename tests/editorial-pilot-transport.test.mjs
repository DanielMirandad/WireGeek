import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateReservedEditorialRequest } from '../lib/editorial-pilot-transport.mjs';
const reservation = { pilotId:'00000000-0000-4000-8000-000000000001',
 idempotencyKey:'00000000-0000-4000-8000-000000000002',
 newsId:6, arm:'luna', stage:'site-editorial', model:'mock',
 maxInputTokens:1000, maxOutputTokens:1000, reserveMicroUsd:100 };
test('paid execution always stays disabled before any database operation', async () => {
 const result = await simulateReservedEditorialRequest({ reservation, pilotExecutionEnabled:true,
  supabase:{rpc(){assert.fail('no database call');}}, mockSend(){assert.fail('no dispatch');} });
 assert.equal(result.code,'PILOT_PAID_EXECUTION_DISABLED');
});
test('denied reservation never reaches mock transport', async () => {
 const result = await simulateReservedEditorialRequest({reservation,
  supabase:{async rpc(){return {data:false,error:null};}},
  mockSend(){assert.fail('no dispatch');}});
 assert.equal(result.success,false);
 assert.equal(result.code,'PILOT_RESERVATION_DENIED');
});
test('successful mock transport follows confirmed reservation', async () => {
 const events=[];
 const result=await simulateReservedEditorialRequest({reservation,
  supabase:{async rpc(){events.push('reserve');return {data:true,error:null};}},
  async mockSend(){events.push('send');return {usage:{input_tokens:2,output_tokens:3}};}});
 assert.equal(result.success,true);
 assert.deepEqual(events,['reserve','send']);
});
test('ambiguous mock transport error is denied without retry', async () => {
 let count=0;
 const result=await simulateReservedEditorialRequest({reservation,
  supabase:{async rpc(){return {data:true,error:null};}},
  async mockSend(){count++;throw new Error('private');}});
 assert.equal(result.code,'PILOT_MOCK_RESPONSE_UNCERTAIN');
 assert.equal(count,1);
 assert.equal(JSON.stringify(result).includes('private'),false);
});
