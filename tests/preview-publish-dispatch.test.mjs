import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/site-publish-handler.mjs';

const ref = 'lftqhpoaydelblobichr';
const host = 'bagaca-cast-site-1vvlzd5fi-danielmirandads-projects.vercel.app';
const path = '/api/integrations/wiregeek/publish';
const jwt = (role) => `e30.${Buffer.from(JSON.stringify({ref,role})).toString('base64url')}.synthetic`;
const body = Array.from({length:6}, (_,i)=>`Paragrafo ${i+1}: ${'conteudo editorial '.repeat(17)}`).join('\n\n');
const old = {};
const vars = ['VERCEL_ENV','SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY','WIREGEEK_AUTOMATION_KEY','WIREGEEK_ACCESS_KEY','BAGACA_SITE_PUBLISH_URL','BAGACA_SITE_PREVIEW_PUBLISH_HOST','BAGACA_SITE_PUBLISH_KEY'];
function response() {return {status(n){this.code=n;return this},json(v){this.data=v;return this},setHeader(){}}}
function chain(final) {return {select(){return this},eq(){return this},not(){return this},in(){return this},order(){return this},limit(){return Promise.resolve(final)},maybeSingle(){return Promise.resolve(final)}}}
function database() {return {supabaseUrl:`https://${ref}.supabase.co`,from(table){
  if(table==='site_editorial_approvals') return chain({data:{noticia_id:1,materia_site:body,resumo_site:'resumo '.repeat(23),source_hashes:['sha256:'+'a'.repeat(64)],approved_at:'2026-10-10T00:00:00Z'}});
  if(table==='publicacoes') return chain({data:[{source_image_url:'https://example.org/official.jpg'}]});
  throw new Error(`Unexpected table: ${table}`);
}}}
async function attempt(endpoint,allowHost) {
  vars.forEach(k=>old[k]=process.env[k]);
  Object.assign(process.env,{VERCEL_ENV:'preview',SUPABASE_URL:`https://${ref}.supabase.co`,NEXT_PUBLIC_SUPABASE_URL:`https://${ref}.supabase.co`,SUPABASE_SERVICE_ROLE_KEY:jwt('service_role'),SUPABASE_SECRET_KEY:'',WIREGEEK_AUTOMATION_KEY:'test-secret',WIREGEEK_ACCESS_KEY:'',BAGACA_SITE_PUBLISH_URL:endpoint,BAGACA_SITE_PREVIEW_PUBLISH_HOST:allowHost,BAGACA_SITE_PUBLISH_KEY:'synthetic'});
  const originalFetch=globalThis.fetch;
  let fetchCount=0;
  globalThis.fetch=async()=>{fetchCount++;throw new Error('Must not publish')};
  try {
    const res=response();
    await handler({method:'POST',headers:{'x-wiregeek-automation-key':'test-secret'},body:{noticia_id:1,action:'publish'},query:{}},res,{supabase:database()});
    return {res,fetchCount};
  } finally {
    globalThis.fetch=originalFetch;
    for(const k of vars) {if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k]}
  }
}
for(const [label,url,allowed] of [
  ['production',`https://bagacacast.com${path}`,host],
  ['missing allowlist',`https://${host}${path}`,''],
  ['malicious host',`https://${host}.evil.test${path}`,host],
  ['unexpected Preview',`https://bagaca-cast-site-aaaaaaaa-danielmirandads-projects.vercel.app${path}`,host],
]) test(`handler does not dispatch to ${label}`,async()=>{
  const {res,fetchCount}=await attempt(url,allowed);
  assert.equal(fetchCount,0);
  assert.equal(res.code,500);
  assert.match(res.data.error,/Destino de publicacao Preview nao autorizado/);
});
