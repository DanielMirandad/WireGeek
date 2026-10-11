import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPreviewLedgerHealth } from '../api/preview-ledger-health.js';

const ref = 'lftqhpoaydelblobichr';
const url = `https://${ref}.supabase.co`;
const jwt = (project,role) => Buffer.from('{}').toString('base64url') + '.' +
  Buffer.from(JSON.stringify({ref:project,role})).toString('base64url') + '.synthetic';
const env = { VERCEL_ENV:'preview', SUPABASE_URL:url, NEXT_PUBLIC_SUPABASE_URL:url,
 SUPABASE_SERVICE_ROLE_KEY:jwt(ref,'service_role'), NEXT_PUBLIC_SUPABASE_ANON_KEY:jwt(ref,'anon') };
test('no production health check or DB operation', async () => {
 const r=await checkPreviewLedgerHealth({...env,VERCEL_ENV:'production'},()=>assert.fail('never construct db'));
 assert.equal(r.status,404);
});
test('real Preview trusted client mock verifies read-only DB query', async () => {
 let count=0;
 const result=await checkPreviewLedgerHealth(env,(endpoint)=>{
  assert.equal(endpoint,url);
  return {supabaseUrl:endpoint,from(table){assert.equal(table,'editorial_pilot_budgets');return {
   select(columns,opts){count++;assert.equal(columns,'id');assert.equal(opts.head,true);
    return {count:0,error:null};},
  };}};
 });
 assert.equal(result.status,200);
 assert.equal(result.body.code,'PREVIEW_LEDGER_READ_CONFIRMED');
 assert.equal(count,1);
});
test('wrong project is blocked before constructing client', async () => {
 const result=await checkPreviewLedgerHealth({...env,SUPABASE_URL:'https://bytxdmxpqsdxxcjbufnf.supabase.co'},
  ()=>assert.fail('production access forbidden'));
 assert.equal(result.status,503);
});
test('database failure is masked and fails closed', async () => {
 const result=await checkPreviewLedgerHealth(env,endpoint=>({supabaseUrl:endpoint,from(){
 return {select(){return {count:null,error:{message:'sensitive details'}};}};}}));
 assert.equal(result.status,503);
 assert.doesNotMatch(JSON.stringify(result),/sensitive|lftqh|bytxdm/);
});
