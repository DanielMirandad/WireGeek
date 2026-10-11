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
  const names=['WIREGEEK_PAID_HOMOLOGATION_ENABLED','VERCEL_ENV','VERCEL_GIT_COMMIT_REF'];
  const saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  process.env.WIREGEEK_PAID_HOMOLOGATION_ENABLED='1';
  process.env.VERCEL_ENV='preview';
  process.env.VERCEL_GIT_COMMIT_REF='fix/editorial-test-cost-gate';
  try {
    await assert.rejects(createOpenAIResponse({model:'test',purpose:'briefing',input:'dummy',maxOutputTokens:10}), /HOMOLOGATION_REQUEST_UNBOUNDED/);
  } finally {
    for(const name of names) if(saved[name] === undefined) delete process.env[name]; else process.env[name]=saved[name];
  }
});

test('paid transport refuses missing ledger before any outbound HTTP request', async () => {
 const names=['VERCEL_ENV','VERCEL_GIT_COMMIT_REF','WIREGEEK_PAID_HOMOLOGATION_ENABLED','WIREGEEK_HOMOLOGATION_PILOT_ID','WIREGEEK_HOMOLOGATION_ARM','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];
 const saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 process.env.WIREGEEK_PAID_HOMOLOGATION_ENABLED='1';
 process.env.VERCEL_ENV='preview';
 process.env.VERCEL_GIT_COMMIT_REF='fix/editorial-test-cost-gate';
 for(const name of names.slice(3)) delete process.env[name];
 try {
  await assert.rejects(createOpenAIResponse({
   model:'gpt-6-luna',purpose:'site-editorial',input:'Fonte verificada de teste',maxOutputTokens:100,
  }), /HOMOLOGATION_LEDGER_NOT_CONFIGURED/);
 } finally {
  for(const name of names) if(saved[name] === undefined) delete process.env[name]; else process.env[name]=saved[name];
 }
});

test('paid requests cannot run outside the isolated PR30 Preview', async () => {
 const saved = Object.fromEntries(['WIREGEEK_PAID_HOMOLOGATION_ENABLED','VERCEL_ENV','VERCEL_GIT_COMMIT_REF'].map(k=>[k,process.env[k]]));
 process.env.WIREGEEK_PAID_HOMOLOGATION_ENABLED='1';
 process.env.VERCEL_ENV='production';
 process.env.VERCEL_GIT_COMMIT_REF='main';
 try {
   await assert.rejects(createOpenAIResponse({model:'gpt-6-luna',purpose:'site-editorial',input:'test',maxOutputTokens:10}), /HOMOLOGATION_PREVIEW_BRANCH_REQUIRED/);
   process.env.VERCEL_ENV='preview';
   await assert.rejects(createOpenAIResponse({model:'gpt-6-luna',purpose:'site-editorial',input:'test',maxOutputTokens:10}), /HOMOLOGATION_PREVIEW_BRANCH_REQUIRED/);
 } finally { for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;} }
});

test('paid request serialization is pinned between reserve and HTTP dispatch', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../lib/openai-responses.mjs', import.meta.url), 'utf8');
  assert.match(source, /const serializedBody = JSON\.stringify\(payload\)/);
  assert.match(source, /reservedBody: serializedBody/);
  assert.match(source, /reservedBody \?\? JSON\.stringify\(body\)/);
  assert.match(source, /payload\.service_tier = 'default'/);
});

test('PR30 Preview never bypasses ledger when pilot flag is off', async () => {
 const names=['VERCEL_ENV','VERCEL_GIT_COMMIT_REF','WIREGEEK_PAID_HOMOLOGATION_ENABLED'];
 const saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 process.env.VERCEL_ENV='preview';
 process.env.VERCEL_GIT_COMMIT_REF='fix/editorial-test-cost-gate';
 delete process.env.WIREGEEK_PAID_HOMOLOGATION_ENABLED;
 try {
  await assert.rejects(createOpenAIResponse({model:'gpt-6-luna',purpose:'site-editorial',input:'test',maxOutputTokens:100}), /HOMOLOGATION_PREVIEW_DISABLED/);
 } finally {
  for(const name of names) if(saved[name]===undefined) delete process.env[name]; else process.env[name]=saved[name];
 }
});

test('paid Preview rejects unexpected request knobs before ledger or HTTP', async () => {
 const names=['VERCEL_ENV','VERCEL_GIT_COMMIT_REF','WIREGEEK_PAID_HOMOLOGATION_ENABLED'];
 const saved=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'fix/editorial-test-cost-gate',WIREGEEK_PAID_HOMOLOGATION_ENABLED:'1'});
 try {
  for(const overrides of [
   {service_tier:'priority'}, {prompt_cache_retention:'24h'},
   {input:[{type:'input_image',image_url:'data:image/png;base64,AA=='}]},
   {text:{format:{type:'json_object'}}},
   {reasoning:{effort:'high'}},
  ]) {
   await assert.rejects(createOpenAIResponse({model:'gpt-6-luna',purpose:'site-editorial',input:'hello',maxOutputTokens:50,...overrides}),/HOMOLOGATION_REQUEST_UNBOUNDED/);
  }
 } finally { for(const [k,v] of Object.entries(saved)) if(v===undefined) delete process.env[k];else process.env[k]=v; }
});
