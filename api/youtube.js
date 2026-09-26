import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { hasValidSession } from './auth.js';
import { CHANNELS, SCOPES, hash, channelKey, seal, unseal, metadata, checkGroup, uploadLocation, googleJSON, failure } from '../lib/youtube-core.mjs';


const TABLE = 'wiregeek_youtube_';
function config() {
  const env = process.env;
  const required = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','YOUTUBE_CLIENT_ID','YOUTUBE_CLIENT_SECRET','YOUTUBE_REDIRECT_URI','YOUTUBE_TOKEN_KEY'];
  if (required.some(k => !env[k])) throw failure('YouTube ainda não configurado. Conclua a instalação.', 503);
  const redirect = new URL(env.YOUTUBE_REDIRECT_URI);
  if (redirect.protocol !== 'https:' && !['127.0.0.1','localhost'].includes(redirect.hostname)) throw failure('Callback deve usar HTTPS.', 503);
  return { env, redirect, key: env.YOUTUBE_TOKEN_KEY };
}
async function checked(query) {
  const {data,error} = await query;
  if (error) throw failure('Falha ao acessar os registros do YouTube. Verifique a instalação do banco.', 503);
  return data;
}
function cookies(req) {
  return Object.fromEntries(String(req.headers?.cookie || '').split(';').map(x => {const i=x.indexOf('=');return [x.slice(0,i).trim(),x.slice(i+1).trim()];}));
}
function publicJob(row) {
  return { slot:row.slot, status:row.status, video_id:row.video_id, privacy:row.privacy, error:row.error, url:row.video_id ? `https://www.youtube.com/watch?v=${row.video_id}` : null };
}
async function token(channel, c) {
  const data = await googleJSON('https://oauth2.googleapis.com/token', { method:'POST', body:new URLSearchParams({ client_id:c.env.YOUTUBE_CLIENT_ID, client_secret:c.env.YOUTUBE_CLIENT_SECRET, grant_type:'refresh_token', refresh_token:unseal(channel.refresh_cipher,c.key) }) });
  return data.access_token;
}
const yt = (resource, params, access) => googleJSON(`https://www.googleapis.com/youtube/v3/${resource}?${new URLSearchParams(params)}`, {headers:{Authorization:`Bearer ${access}`}});
async function connection(db, slot) {
  const row = await checked(db.from(TABLE+'channels').select('*').eq('slot',channelKey(slot)).maybeSingle());
  if (!row) throw failure(`Conecte ${CHANNELS[slot].label}.`);
  return row;
}
async function verifiedAsset(db, groupId) {
  const rows=await checked(db.from('publicacoes').select('id,noticia_id,status,publication_group_id,carousel_position,cta_url').eq('publication_group_id',groupId));
  checkGroup(rows,groupId);
  const storage=db.storage.from('wiregeek-banners');
  const files=await checked(storage.list('instagram-reels',{search:groupId+'-',limit:100}));
  const pattern=new RegExp('^'+groupId+'-([a-f0-9]{16})\\.mp4$','i');
  const candidates=files.filter(f=>pattern.test(f.name));
  if(candidates.length!==1)throw failure('Gere o MP4 imutável deste grupo antes de enviar.');
  if(Number(candidates[0].metadata?.size)>100*1024*1024)throw failure('O MP4 excede 100 MB.');
  const blob=await checked(storage.download('instagram-reels/'+candidates[0].name));
  if(!blob.size || blob.size>100*1024*1024)throw failure('Tamanho de MP4 inválido.');
  const buffer=Buffer.from(await blob.arrayBuffer()), sha=hash(buffer);
  if(!sha.startsWith(candidates[0].name.match(pattern)[1].toLowerCase()))throw failure('MP4 alterado; revise o arquivo.');
  return {buffer,sha};
}

export default async function handler(req,res) {

  res.setHeader('Cache-Control','no-store');
  if(!hasValidSession(req))return res.status(401).json({error:'Faça login no WireGeek.'});
  try {
    const c=config();
    const action=String(req.query?.action || req.body?.action || 'status');
    const callback=action==='callback';
    if(!['GET','POST'].includes(req.method))throw failure('Método não permitido.',405);
    if(req.method==='POST' && (req.headers.origin!==c.redirect.origin || !String(req.headers['content-type']||'').startsWith('application/json')))throw failure('Origem da operação inválida.',403);
    if(['authorize','upload','associate','reconcile','disconnect'].includes(action) && req.method!=='POST')throw failure('Use POST.',405);
    if(['status','search','callback'].includes(action) && req.method!=='GET')throw failure('Use GET.',405);
    const db=createClient(c.env.SUPABASE_URL,c.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    if(action==='authorize') {
      const slot=channelKey(req.body.slot),state=crypto.randomBytes(32).toString('base64url'),verifier=crypto.randomBytes(48).toString('base64url');
      await checked(db.from(TABLE+'oauth').delete().lt('expires_at',new Date().toISOString()));
      await checked(db.from(TABLE+'oauth').insert({state_hash:hash(state),session_hash:hash(cookies(req).wiregeek_session||''),slot,verifier_cipher:seal(verifier,c.key),expires_at:new Date(Date.now()+600000).toISOString()}));
      res.setHeader('Set-Cookie',`wiregeek_youtube_state=${state}; HttpOnly; SameSite=Lax; Path=/api/youtube; Max-Age=600${c.redirect.protocol==='https:'?'; Secure':''}`);
      const params=new URLSearchParams({client_id:c.env.YOUTUBE_CLIENT_ID,redirect_uri:c.redirect.href,response_type:'code',scope:SCOPES.join(' '),state,access_type:'offline',prompt:'consent select_account',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
      return res.json({url:'https://accounts.google.com/o/oauth2/v2/auth?'+params});
    }
    if(callback) {
      const state=String(req.query.state||'');
      if(!state || state!==cookies(req).wiregeek_youtube_state)throw failure('Conexão expirada ou inválida. Tente conectar novamente.',403);
      const pending=await checked(db.from(TABLE+'oauth').delete().eq('state_hash',hash(state)).eq('session_hash',hash(cookies(req).wiregeek_session||'')).gt('expires_at',new Date().toISOString()).select().maybeSingle());
      res.setHeader('Set-Cookie','wiregeek_youtube_state=; HttpOnly; SameSite=Lax; Path=/api/youtube; Max-Age=0');
      if(!pending || req.query.error || !req.query.code)throw failure('Conexão cancelada ou expirada.');
      channelKey(pending.slot);
      const data=await googleJSON('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:c.env.YOUTUBE_CLIENT_ID,client_secret:c.env.YOUTUBE_CLIENT_SECRET,redirect_uri:c.redirect.href,code:String(req.query.code),grant_type:'authorization_code',code_verifier:unseal(pending.verifier_cipher,c.key)})});
      if(!data.refresh_token || SCOPES.some(scope=>!String(data.scope||'').split(' ').includes(scope)))throw failure('Autorize leitura e upload para conectar o canal.');
      const mine=await yt('channels',{part:'snippet',mine:'true'},data.access_token);
      const expected=await yt('channels',{part:'id',forHandle:CHANNELS[pending.slot].handle},data.access_token);
      const selected=mine.items?.find(row=>row.id===expected.items?.[0]?.id);
      if(!selected)throw failure(`A conta autorizada não selecionou ${CHANNELS[pending.slot].handle}. Reconecte escolhendo esse canal.`);
      await checked(db.from(TABLE+'channels').upsert({slot:pending.slot,channel_id:selected.id,title:selected.snippet.title,refresh_cipher:seal(data.refresh_token,c.key),connected_at:new Date().toISOString()}));
      return res.redirect(303,'/?youtube=connected');
    }
    if(action==='status') {
      const channels=await checked(db.from(TABLE+'channels').select('slot,channel_id,title,connected_at').eq('slot','bagaca'));
      const group=String(req.query.group_id||'');
      const jobs=group?await checked(db.from(TABLE+'uploads').select('slot,status,video_id,privacy,error').eq('group_id',group).eq('slot','bagaca')):[];
      const id=Number(req.query.noticia_id);
      const sources=Number.isSafeInteger(id)&&id>0?await checked(db.from(TABLE+'sources').select('video_id,title,channel_id').eq('noticia_id',id)):[];
      return res.json({channels,jobs:jobs.map(publicJob),sources:sources.filter(source=>channels.some(ch=>ch.channel_id===source.channel_id)),uploads_enabled:c.env.YOUTUBE_UPLOAD_ENABLED==='true'});
    }
    if(action==='disconnect') {
      await checked(db.from(TABLE+'channels').delete().eq('slot',channelKey(req.body.slot)));
      return res.json({success:true});
    }
    if(action==='search') {
      const query=String(req.query.q||'').trim().slice(0,200);
      const slots=req.query.slot==='both'?Object.keys(CHANNELS):[channelKey(req.query.slot || 'bagaca')];
      const results=[],errors=[];
      for(const slot of slots)try {
        const ch=await connection(db,slot),access=await token(ch,c);
        if(query) {
          const data=await yt('search',{part:'snippet',channelId:ch.channel_id,q:query,type:'video',maxResults:'10',order:'relevance'},access);
          results.push(...(data.items||[]).map(v=>({video_id:v.id.videoId,title:v.snippet.title,channel_id:ch.channel_id,channel:CHANNELS[slot].label,url:`https://www.youtube.com/watch?v=${v.id.videoId}`})));
        } else {
          const info=await yt('channels',{part:'contentDetails',id:ch.channel_id},access);
          const uploads=info.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
          if(uploads){const data=await yt('playlistItems',{part:'snippet',playlistId:uploads,maxResults:'10'},access);results.push(...(data.items||[]).map(v=>({video_id:v.snippet.resourceId.videoId,title:v.snippet.title,channel_id:ch.channel_id,channel:CHANNELS[slot].label,url:`https://www.youtube.com/watch?v=${v.snippet.resourceId.videoId}`})));}
        }
      }catch(error){errors.push({slot,error:error.message});}
      return res.json({results,errors});
    }
    if(action==='associate') {
      const id=Number(req.body.noticia_id),videoId=String(req.body.video_id||'');
      if(!Number.isSafeInteger(id)||id<1||!/^[\w-]{11}$/.test(videoId))throw failure('Notícia ou vídeo inválido.');
      if(!await checked(db.from('noticias').select('id').eq('id',id).maybeSingle()))throw failure('Notícia não encontrada.');
      const channels=await checked(db.from(TABLE+'channels').select('*').eq('slot','bagaca'));
      if(!channels.length)throw failure('Conecte um canal.');
      const data=await yt('videos',{part:'snippet',id:videoId},await token(channels[0],c));
      const video=data.items?.[0];
      if(!video || !channels.some(ch=>ch.channel_id===video.snippet.channelId))throw failure('Vídeo fora dos canais conectados.');
      await checked(db.from(TABLE+'sources').upsert({noticia_id:id,video_id:videoId,channel_id:video.snippet.channelId,title:video.snippet.title}));
      return res.json({success:true});
    }
    if(action==='reconcile') {
      const row=await checked(db.from(TABLE+'uploads').select('*').eq('group_id',String(req.body.group_id)).eq('slot',channelKey(req.body.slot)).maybeSingle());
      if(!row)throw failure('Envio não encontrado.');
      if(row.video_id)return res.json(publicJob(row));
      if(!row.session_cipher)throw failure('Sessão não registrada. Confira o YouTube Studio; não inicie outro envio automaticamente.');
      const ch=await connection(db,row.slot);
      if(ch.channel_id!==row.channel_id)throw failure('O canal conectado mudou.');
      const response=await fetch(uploadLocation(unseal(row.session_cipher,c.key)),{method:'PUT',headers:{Authorization:`Bearer ${await token(ch,c)}`,'Content-Length':'0','Content-Range':`bytes */${row.bytes}`},redirect:'manual',signal:AbortSignal.timeout(20000)});
      if(response.ok){const data=await response.json();if(!data.id)throw failure('Resultado de envio inconclusivo.');await checked(db.from(TABLE+'uploads').update({video_id:data.id,status:'ENVIADO',privacy:data.status?.privacyStatus||row.metadata.status.privacyStatus,error:null}).eq('id',row.id));return res.json({success:true});}
      throw failure('Upload incompleto ou sessão expirada. Confira o YouTube Studio antes de uma nova tentativa.');
    }
    if(action==='upload') {
      if(c.env.YOUTUBE_UPLOAD_ENABLED!=='true')throw failure('Uploads desativados. Conclua a conexão e habilite o envio.',403);
      const slot=channelKey(req.body.slot),groupId=String(req.body.group_id||''),meta=metadata(req.body);
      const previous=await checked(db.from(TABLE+'uploads').select('*').eq('group_id',groupId).eq('slot',slot).maybeSingle());
      if(previous)return res.json(publicJob(previous));
      const ch=await connection(db,slot),access=await token(ch,c);
      const mine=await yt('channels',{part:'id',mine:'true'},access);
      if(!mine.items?.some(x=>x.id===ch.channel_id))throw failure('Reconecte o canal de destino.');
      const asset=await verifiedAsset(db,groupId);
      if(req.body.asset_sha256!==asset.sha)throw failure('O MP4 mudou desde a revisão. Atualize e revise novamente.');
      const {data:job,error:claimError}=await db.from(TABLE+'uploads').insert({group_id:groupId,slot,channel_id:ch.channel_id,asset_sha256:asset.sha,metadata:meta,bytes:asset.buffer.length}).select().single();
      if(claimError)throw failure('Já existe uma tentativa para este canal. Atualize o status.',409);
      try {
        const started=await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json','X-Upload-Content-Type':'video/mp4','X-Upload-Content-Length':String(asset.buffer.length)},body:JSON.stringify(meta),redirect:'error',signal:AbortSignal.timeout(20000)});
        if(!started.ok)throw failure(`YouTube recusou iniciar o envio (HTTP ${started.status}).`,502);
        const location=uploadLocation(started.headers.get('location'));
        await checked(db.from(TABLE+'uploads').update({session_cipher:seal(location,c.key)}).eq('id',job.id));
        const uploaded=await fetch(location,{method:'PUT',headers:{Authorization:`Bearer ${access}`,'Content-Type':'video/mp4','Content-Length':String(asset.buffer.length)},body:asset.buffer,redirect:'error',signal:AbortSignal.timeout(180000)});
        if(!uploaded.ok)throw failure(`Envio requer verificação (HTTP ${uploaded.status}).`,502);
        const data=await uploaded.json();if(!data.id)throw failure('O YouTube não retornou o ID do vídeo.',502);
        const done={status:'ENVIADO',video_id:data.id,privacy:data.status?.privacyStatus||meta.status.privacyStatus,error:null};
        await checked(db.from(TABLE+'uploads').update(done).eq('id',job.id));
        return res.json(publicJob({...job,...done}));
      } catch(error) {
        await db.from(TABLE+'uploads').update({status:'VERIFICAR',error:'Envio interrompido. Verifique o resultado antes de tentar novamente.'}).eq('id',job.id);
        throw failure('Envio interrompido. Use Verificar envio; uma nova tentativa automática foi bloqueada.',502);
      }
    }
    throw failure('Ação não reconhecida.');
  } catch(error) { return res.status(error.status||500).json({error:error.status?error.message:'Não foi possível concluir a operação do YouTube.'}); }
}
