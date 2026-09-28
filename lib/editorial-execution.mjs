import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

function getClient() {
  const url=process.env.SUPABASE_URL?.trim(), key=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if(!url || !key) throw new Error('EXECUTION_STORAGE_NOT_CONFIGURED');
  return createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
}
export function cronSlot(now=new Date()) {
  return new Date(Math.floor(now.getTime()/7200000)*7200000).toISOString();
}
function outcome(response) {
  if(response.body?.code==='NO_VALID_CANDIDATES') return 'no_candidates';
  if(response.body?.code==='NO_NEW_STORIES') return 'no_new_stories';
  if(response.status>=200 && response.status<300) return 'completed';
  return response.status<500 ? 'invalid' : 'failed';
}
// Internal callbacks receive a run object; HTTP bodies cannot inject it.
export async function runEditorialRequest({source,slot=null}, handler) {
  const id=randomUUID();
  let acquired=false, client;
  const counts={researched:0,approved:0,persisted:0};
  async function rpc(name,params) {
    const {data,error}=await client.rpc(name,params);
    if(error) throw new Error('EXECUTION_STORAGE_ERROR', {cause:error});
    return data;
  }
  try {
    client=getClient();
    const claim=await rpc('begin_editorial_execution',{p_id:id,p_source:source,p_slot:slot});
    if(!claim || typeof claim.acquired!=='boolean') throw new Error('INVALID_EXECUTION_RESPONSE');
    if(!claim.acquired) {
      const duplicate=claim.status==='skipped_duplicate';
      console.log('WIRE/GEEK: rodada ignorada',{run_id:id,source,status:claim.status});
      return {status:source==='cron'?200:409,body:{success:source==='cron',skipped:true,
        code:duplicate?'CRON_SLOT_ALREADY_RUN':'GENERATION_BUSY',run_id:id,
        error:duplicate?'Esta rodada automática já foi executada.':'Outra rodada está em andamento. Aguarde sua conclusão.'}};
    }
    acquired=true;
    console.log('WIRE/GEEK: rodada iniciada',{run_id:id,source,slot});
    const run={id,async progress(values={}){
      const params={p_id:id};
      for(const key of Object.keys(counts)) if(values[key]!==undefined) {
        if(!Number.isSafeInteger(values[key]) || values[key]<0) throw new Error('INVALID_EXECUTION_COUNT');
        params[`p_${key}`]=values[key];
      }
      if(await rpc('progress_editorial_execution',params)!==true) throw new Error('EXECUTION_LEASE_LOST');
      Object.assign(counts,values);
    }};
    let response;
    const res={status(code){this.statusCode=code;return this;},json(body){
      if(response) throw new Error('RESPONSE_ALREADY_SENT');
      response={status:this.statusCode||200,body};return this;
    }};
    await handler(res,run);
    if(!response) throw new Error('MISSING_EXECUTION_RESPONSE');
    const status=outcome(response);
    if(await rpc('finish_editorial_execution',{p_id:id,p_status:status,p_error_code:response.body?.code || (status==='failed'?'GENERATION_FAILED':null)})!==true) throw new Error('EXECUTION_LEASE_LOST');
    acquired=false;
    console.log('WIRE/GEEK: rodada concluída',{run_id:id,source,status,...counts});
    if(source==='cron' && ['no_candidates','no_new_stories'].includes(status)) {
      return {status:200,body:{success:true,skipped:true,code:response.body.code,run_id:id,...counts}};
    }
    return {...response,body:{...response.body,run_id:id}};
  } catch(error) {
    if(acquired) {
      try {await rpc('finish_editorial_execution',{p_id:id,p_status:'failed',p_error_code:'EXECUTION_FAILED'});}
      catch {console.error('WIRE/GEEK: registro de falha pendente; bloqueio expira automaticamente',{run_id:id});}
    }
    console.error('WIRE/GEEK: falha na execução editorial',{run_id:id,source,code:error.message});
    return {status:503,body:{error:'A rodada não foi concluída. Consulte o registro da execução antes de tentar novamente.',code:'EDITORIAL_EXECUTION_FAILED',run_id:id}};
  }
}
