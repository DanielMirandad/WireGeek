import test from 'node:test';
import assert from 'node:assert/strict';
import { executeReservedHomologation } from '../lib/paid-homologation-reserved-transport.mjs';
const reservation = {pilotId:'00000000-0000-4000-8000-000000000001',newsId:11,arm:'sol',
 stage:'site-editorial',model:'gpt-6-luna',maxInputTokens:100,maxOutputTokens:50,
 reserveMicroUsd:10000,idempotencyKey:'00000000-0000-4000-8000-000000000002'};
function db() {
 const calls=[];
 return {supabaseUrl:'https://lftqhpoaydelblobichr.supabase.co/',calls,
 async rpc(name,args){calls.push({name,args});return {data:true,error:null};}};
}
const response={usage:{input_tokens:30,output_tokens:20}};
test('atomic reservation always precedes the send and settlement',async()=>{
 const supabase=db();const order=[];
 const original=supabase.rpc.bind(supabase);
 supabase.rpc=async (...args)=>{order.push(args[0]);return original(...args)};
 const result=await executeReservedHomologation({supabase,reservation,
  send:async()=>{order.push('send');return response}});
 assert.equal(result.success,true);
 assert.deepEqual(order,['reserve_editorial_pilot_request','send','complete_editorial_pilot_reservation']);
});
test('reservation denied means no send',async()=>{
 const supabase=db();supabase.rpc=async()=>({data:false,error:null});
 let called=false;
 const result=await executeReservedHomologation({supabase,reservation,send:async()=>{called=true}});
 assert.equal(called,false);assert.equal(result.code,'PILOT_RESERVATION_DENIED');
});
test('unbounded cost, exceeded tokens, and uncertain send never settle or retry',async()=>{
 const supabase=db();
 assert.equal((await executeReservedHomologation({supabase,reservation:{...reservation,reserveMicroUsd:1000001},
  send:async()=>response})).code,'HOMOLOGATION_BOUNDS_REQUIRED');
 const over=await executeReservedHomologation({supabase,reservation,
  send:async()=>({usage:{input_tokens:1000,output_tokens:1}})});
 assert.equal(over.code,'HOMOLOGATION_USAGE_UNVERIFIED');
 const unknown=await executeReservedHomologation({supabase,reservation,send:async()=>{throw Error('timeout')}});
 assert.equal(unknown.code,'HOMOLOGATION_SEND_UNCERTAIN');
 assert.equal(supabase.calls.filter(x=>x.name==='complete_editorial_pilot_reservation').length,0);
});
test('unverifiable token usage retains the reservation',async()=>{
 const supabase=db();
 const result=await executeReservedHomologation({supabase,reservation,send:async()=>({usage:{input_tokens:1,output_tokens:0}})});
 assert.equal(result.code,'HOMOLOGATION_COST_UNVERIFIED');
 assert.equal(supabase.calls.length,1);
});

test('insufficient reserved price rejects before ledger and send', async () => {
  const supabase=db(); let sent=false;
  const result=await executeReservedHomologation({supabase,
    reservation:{...reservation,reserveMicroUsd:1},
    send:async()=>{sent=true;return response;}});
  assert.equal(result.code,'HOMOLOGATION_PRICE_RESERVATION_INSUFFICIENT');
  assert.equal(sent,false);assert.equal(supabase.calls.length,0);
});
test('failed settlement retains the reservation and reports uncertainty', async () => {
  const supabase=db();let sends=0;
  const real=supabase.rpc.bind(supabase);
  supabase.rpc=async(name,args)=>name==='complete_editorial_pilot_reservation'
    ? {data:false,error:null} : real(name,args);
  const result=await executeReservedHomologation({supabase,reservation,
    send:async()=>{sends++;return response;}});
  assert.equal(result.code,'HOMOLOGATION_SETTLEMENT_UNCONFIRMED');
  assert.equal(sends,1);
  assert.equal(supabase.calls.filter(x=>x.name==='reserve_editorial_pilot_request').length,1);
});
test('an incorrect Supabase project prevents all sends', async () => {
  const supabase=db();supabase.supabaseUrl='https://not-test.supabase.co/';
  let sent=false;
  const result=await executeReservedHomologation({supabase,reservation,
    send:async()=>{sent=true;return response;}});
  assert.equal(result.code,'PILOT_TEST_PROJECT_REQUIRED');
  assert.equal(sent,false);assert.equal(supabase.calls.length,0);
});
