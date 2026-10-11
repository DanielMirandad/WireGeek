import test from 'node:test';
import assert from 'node:assert/strict';
import { executeReservedHomologation } from '../lib/paid-homologation-reserved-transport.mjs';
const reservation = {pilotId:'00000000-0000-4000-8000-000000000001',newsId:11,arm:'sol',
 stage:'site-editorial',model:'test-model',maxInputTokens:100,maxOutputTokens:50,
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
  send:async()=>{order.push('send');return response},settleMicroUsd:()=>8000});
 assert.equal(result.success,true);
 assert.deepEqual(order,['reserve_editorial_pilot_request','send','complete_editorial_pilot_reservation']);
});
test('reservation denied means no send',async()=>{
 const supabase=db();supabase.rpc=async()=>({data:false,error:null});
 let called=false;
 const result=await executeReservedHomologation({supabase,reservation,send:async()=>{called=true},settleMicroUsd:()=>0});
 assert.equal(called,false);assert.equal(result.code,'PILOT_RESERVATION_DENIED');
});
test('unbounded cost, exceeded tokens, and uncertain send never settle or retry',async()=>{
 const supabase=db();
 assert.equal((await executeReservedHomologation({supabase,reservation:{...reservation,reserveMicroUsd:1000001},
  send:async()=>response,settleMicroUsd:()=>0})).code,'HOMOLOGATION_BOUNDS_REQUIRED');
 const over=await executeReservedHomologation({supabase,reservation,
  send:async()=>({usage:{input_tokens:1000,output_tokens:1}}),settleMicroUsd:()=>0});
 assert.equal(over.code,'HOMOLOGATION_USAGE_UNVERIFIED');
 const unknown=await executeReservedHomologation({supabase,reservation,send:async()=>{throw Error('timeout')},settleMicroUsd:()=>0});
 assert.equal(unknown.code,'HOMOLOGATION_SEND_UNCERTAIN');
 assert.equal(supabase.calls.filter(x=>x.name==='complete_editorial_pilot_reservation').length,0);
});
test('unverifiable price retains the reservation',async()=>{
 const supabase=db();
 const result=await executeReservedHomologation({supabase,reservation,send:async()=>response,settleMicroUsd:()=>Infinity});
 assert.equal(result.code,'HOMOLOGATION_COST_UNVERIFIED');
 assert.equal(supabase.calls.length,1);
});
